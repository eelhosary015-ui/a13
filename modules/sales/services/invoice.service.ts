import { InvoiceRepository } from "../repositories/invoice.repository.js";
import { CreateInvoiceDTO, UpdateInvoiceDTO } from "../dto/invoice.dto.js";
import { ERPCache, ERPEventBus, erpPool } from "../../../server-erp-core.js";
import { WarehouseService } from "../../warehouses/services/warehouse.service.js";
import { CustomerService } from "../../customers/services/customer.service.js";
import { SafeService } from "../../accounting/services/safe.service.js";
import { postSalesEntry, postCustomerPaymentEntry } from "../../accounts/services/auto-posting.service.js";

const LIST_CACHE_KEY = "sales:invoices:all";

export class InvoiceService {
  private repository: InvoiceRepository;
  private warehouseService: WarehouseService;
  private customerService: CustomerService;
  private safeService: SafeService;

  constructor() {
    this.repository = new InvoiceRepository();
    this.warehouseService = new WarehouseService();
    this.customerService = new CustomerService();
    this.safeService = new SafeService();
  }

  async getInvoices(): Promise<any[]> {
    const cached = ERPCache.get(LIST_CACHE_KEY);
    if (cached) return cached;

    const invoices = await this.repository.getAll();
    ERPCache.set(LIST_CACHE_KEY, invoices, 60);
    return invoices;
  }

  async getInvoiceById(id: number): Promise<any> {
    const invoice = await this.repository.getById(id);
    if (!invoice) {
      const err: any = new Error("Invoice not found");
      err.statusCode = 404;
      throw err;
    }
    return invoice;
  }

  /**
   * Creates the invoice and fully integrates it with:
   * 1. Warehouses (Inventory stock deduction and movement ledger)
   * 2. Customers (Customer balance debit/charge and credit payment transaction)
   * 3. Treasury / Safes (Cash collection deposit into safe)
   * 4. Accounting (Double-entry GL Journal Entry auto-posting)
   * 5. Sales Orders (Linking and updating order status)
   */
  async createInvoice(dto: CreateInvoiceDTO): Promise<any> {
    const invoice = await this.repository.create(dto);
    ERPCache.delete(LIST_CACHE_KEY);

    const integrationWarnings: string[] = [];
    const effectiveWarehouseId = dto.warehouseId || 1;

    // 1) Warehouse stock deduction
    for (const item of (dto.items || [])) {
      const qty = Number(item.qty) || 0;
      if (qty <= 0) continue;

      try {
        let ingId = item.ingredientId;
        // If ingredientId is not provided, try to find ingredient or product by code/name
        if (!ingId) {
          try {
            const lookup = await erpPool.query(
              "SELECT id FROM ingredients WHERE code = $1 OR name ILIKE $2 LIMIT 1",
              [item.code || "", item.name || ""]
            );
            if (lookup.rows.length > 0) {
              ingId = lookup.rows[0].id;
            }
          } catch (_) {}
        }

        if (ingId) {
          await this.warehouseService.adjustStock({
            warehouse_id: effectiveWarehouseId,
            ingredient_id: ingId,
            quantity: qty,
            type: "deduction",
            notes: `فاتورة مبيعات ${invoice.invoice_no || invoice.invoiceNo} — ${item.name}`
          });
        }
      } catch (e: any) {
        integrationWarnings.push(`تعذر خصم مخزون الصنف "${item.name}": ${e.message}`);
      }
    }

    // 2) Customer balance & transactions
    let customerId = dto.customerId;
    if (!customerId && dto.customerName) {
      try {
        // Try finding customer by name
        const custRes = await erpPool.query("SELECT id FROM customers WHERE name ILIKE $1 LIMIT 1", [dto.customerName]);
        if (custRes.rows.length > 0) {
          customerId = custRes.rows[0].id;
        }
      } catch (_) {}
    }

    const netAmount = parseFloat(invoice.net_amount || invoice.netAmount || 0);
    const paidAmount = parseFloat(dto.paidAmount || invoice.paid_amount || invoice.paidAmount || 0);

    if (customerId) {
      try {
        // Debit: Customer account for full invoice amount
        await this.customerService.recordTransaction({
          customer_id: customerId,
          amount: netAmount,
          type: "charge",
          notes: `فاتورة مبيعات ${invoice.invoice_no || invoice.invoiceNo}`
        });

        // Credit: If paid upon issuance, record the payment against customer balance
        if (paidAmount > 0) {
          await this.customerService.recordTransaction({
            customer_id: customerId,
            amount: paidAmount,
            type: "payment",
            notes: `سداد عند إصدار فاتورة ${invoice.invoice_no || invoice.invoiceNo}`
          });
        }
      } catch (e: any) {
        integrationWarnings.push(`تعذر تحديث رصيد العميل: ${e.message}`);
      }
    }

    // 3) Treasury / Safe: If payment made in cash/bank, deposit into safe
    if (paidAmount > 0) {
      try {
        const safes = await this.safeService.getSafes();
        const targetSafe = safes.length > 0 ? safes[0] : null;
        if (targetSafe) {
          await this.safeService.adjustSafeBalance(targetSafe.id, {
            amount: paidAmount,
            type: "in",
            notes: `تحصيل نقدي — فاتورة مبيعات ${invoice.invoice_no || invoice.invoiceNo}`
          });
        }
      } catch (e: any) {
        console.warn("Could not record safe deposit:", e.message);
      }
    }

    // 4) Linked Sales Order update
    if (dto.orderId) {
      try {
        await erpPool.query(
          "UPDATE erp_sales_orders SET status = 'مكتمل' WHERE id = $1",
          [dto.orderId]
        );
        ERPCache.delete("sales:orders:all");
      } catch (e: any) {
        console.warn("Could not update sales order status:", e.message);
      }
    }

    // 5) Double-Entry General Ledger Auto-Posting
    try {
      await postSalesEntry({
        id: invoice.id,
        total: parseFloat(invoice.subtotal || dto.subtotal || netAmount),
        discount: parseFloat(invoice.discount_total || invoice.discountTotal || dto.discountTotal || 0),
        tax_amount: parseFloat(invoice.tax_total || invoice.taxTotal || dto.taxTotal || 0),
        net_total: netAmount,
        payment_method: invoice.payment_method || invoice.paymentMethod || dto.paymentMethod || "نقدي",
        customer_id: customerId,
        customer_name: invoice.customer_name || invoice.customerName || dto.customerName,
        branch_id: 1,
        items: (dto.items || []).map(i => ({ product_name: i.name, total: i.total }))
      });
    } catch (e: any) {
      integrationWarnings.push(`تعذر ترحيل القيد المحاسبي: ${e.message}`);
    }

    ERPEventBus.getInstance().emitEvent("SalesInvoiceCreated", {
      invoiceId: invoice.id,
      invoiceNo: invoice.invoice_no || invoice.invoiceNo,
      customerId,
      customerName: invoice.customer_name || invoice.customerName,
      netAmount,
      paidAmount,
      timestamp: new Date()
    });

    return { ...invoice, integrationWarnings };
  }

  async updateInvoice(id: number, dto: UpdateInvoiceDTO): Promise<any> {
    const found = await this.repository.getById(id);
    if (!found) {
      const err: any = new Error("Invoice not found");
      err.statusCode = 404;
      throw err;
    }

    if (found.paidAmount && found.paidAmount > 0) {
      const err: any = new Error("Cannot edit an invoice that already has recorded payments");
      err.statusCode = 409;
      throw err;
    }

    const invoice = await this.repository.update(id, dto);
    ERPCache.delete(LIST_CACHE_KEY);

    ERPEventBus.getInstance().emitEvent("SalesInvoiceUpdated", {
      invoiceId: id,
      timestamp: new Date()
    });

    return invoice;
  }

  async deleteInvoice(id: number): Promise<void> {
    const found = await this.repository.getById(id);
    if (!found) {
      const err: any = new Error("Invoice not found");
      err.statusCode = 404;
      throw err;
    }

    if (found.paidAmount && found.paidAmount > 0) {
      const err: any = new Error("Cannot delete an invoice that already has recorded payments");
      err.statusCode = 409;
      throw err;
    }

    await this.repository.delete(id);
    ERPCache.delete(LIST_CACHE_KEY);

    ERPEventBus.getInstance().emitEvent("SalesInvoiceDeleted", {
      invoiceId: id,
      timestamp: new Date()
    });
  }

  /**
   * Records a payment/collection on an existing invoice:
   * 1. Updates invoice paid amount & status ('مدفوعة' / 'مدفوعة جزئياً')
   * 2. Inserts record into sales_invoice_payments
   * 3. Credits customer balance in customer_transactions
   * 4. Deposits cash into Treasury / Safe
   * 5. Posts GL payment collection entry
   */
  async recordPayment(id: number, amount: number, method?: string, notes?: string): Promise<any> {
    const found = await this.repository.getById(id);
    if (!found) {
      const err: any = new Error("Invoice not found");
      err.statusCode = 404;
      throw err;
    }

    const remaining = Number(found.netAmount) - Number(found.paidAmount);
    if (amount > remaining + 0.01) {
      const err: any = new Error(`قيمة الدفعة (${amount}) تتجاوز المبلغ المتبقي (${remaining.toFixed(2)})`);
      err.statusCode = 400;
      throw err;
    }

    const updatedInvoice = await this.repository.recordPayment(id, amount, method, notes);
    ERPCache.delete(LIST_CACHE_KEY);

    // 1. Customer account credit
    if (found.customerId) {
      try {
        await this.customerService.recordTransaction({
          customer_id: found.customerId,
          amount,
          type: "payment",
          notes: notes || `تحصيل دفعة فاتورة ${found.invoiceNo}`
        });
      } catch (e: any) {
        console.warn("Could not update customer transaction for payment:", e.message);
      }
    }

    // 2. Safe / Treasury deposit
    try {
      const safes = await this.safeService.getSafes();
      const targetSafe = safes.length > 0 ? safes[0] : null;
      if (targetSafe) {
        await this.safeService.adjustSafeBalance(targetSafe.id, {
          amount,
          type: "in",
          notes: `تحصيل دفعة فاتورة ${found.invoiceNo} — ${found.customerName}`
        });
      }
    } catch (e: any) {
      console.warn("Could not record safe deposit on payment:", e.message);
    }

    // 3. GL Entry auto-posting for payment collection
    try {
      await postCustomerPaymentEntry({
        customer_id: found.customerId || 0,
        customer_name: found.customerName,
        amount,
        type: "payment",
        source_id: id
      });
    } catch (e: any) {
      console.warn("Could not post customer payment GL entry:", e.message);
    }

    ERPEventBus.getInstance().emitEvent("SalesInvoicePaymentRecorded", {
      invoiceId: id,
      amount,
      method: method || "نقدي",
      timestamp: new Date()
    });

    return updatedInvoice;
  }
}
