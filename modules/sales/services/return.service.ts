import { ReturnRepository } from "../repositories/return.repository.js";
import { CreateReturnDTO, UpdateReturnDTO } from "../dto/return.dto.js";
import { ERPCache, ERPEventBus, erpPool } from "../../../server-erp-core.js";
import { WarehouseService } from "../../warehouses/services/warehouse.service.js";
import { CustomerService } from "../../customers/services/customer.service.js";
import { SafeService } from "../../accounting/services/safe.service.js";
import { postReturnEntry } from "../../accounts/services/auto-posting.service.js";

const LIST_CACHE_KEY = "sales:returns:all";

export class ReturnService {
  private repository: ReturnRepository;
  private warehouseService: WarehouseService;
  private customerService: CustomerService;
  private safeService: SafeService;

  constructor() {
    this.repository = new ReturnRepository();
    this.warehouseService = new WarehouseService();
    this.customerService = new CustomerService();
    this.safeService = new SafeService();
  }

  async getReturns(): Promise<any[]> {
    const cached = ERPCache.get(LIST_CACHE_KEY);
    if (cached) return cached;

    const returns = await this.repository.getAll();
    ERPCache.set(LIST_CACHE_KEY, returns, 60);
    return returns;
  }

  async getReturnById(id: number): Promise<any> {
    const returnDoc = await this.repository.getById(id);
    if (!returnDoc) {
      const err: any = new Error("Sales return not found");
      err.statusCode = 404;
      throw err;
    }
    return returnDoc;
  }

  /**
   * Creates a sales return and fully integrates it with:
   * 1. Warehouses: restocks items back into the inventory
   * 2. Customers: adjusts balance (credit note) or refunds cash
   * 3. Treasury / Safe: withdraws cash if cash refund
   * 4. Accounting: double-entry GL auto-posting for sales returns
   */
  async createReturn(dto: CreateReturnDTO): Promise<any> {
    const returnDoc = await this.repository.create(dto);
    ERPCache.delete(LIST_CACHE_KEY);

    const integrationWarnings: string[] = [];
    const grandTotal = parseFloat(returnDoc.grand_total || returnDoc.grandTotal || 0);
    const itemsTotal = parseFloat(returnDoc.items_total || returnDoc.itemsTotal || 0);
    const taxTotal = parseFloat(returnDoc.tax_total || returnDoc.taxTotal || 0);

    // 1) Warehouse Restocking
    for (const item of (dto.items || [])) {
      const qty = Number(item.qtyReturned) || 0;
      if (qty <= 0) continue;

      try {
        let ingId = item.ingredientId;
        if (!ingId) {
          try {
            const lookup = await erpPool.query(
              "SELECT id FROM ingredients WHERE code = $1 OR name ILIKE $2 LIMIT 1",
              [item.itemCode || "", item.itemName || ""]
            );
            if (lookup.rows.length > 0) {
              ingId = lookup.rows[0].id;
            }
          } catch (_) {}
        }

        if (ingId) {
          await this.warehouseService.adjustStock({
            warehouse_id: 1, // Default warehouse
            ingredient_id: ingId,
            quantity: qty,
            type: "addition",
            notes: `مرتجع مبيعات ${returnDoc.return_no || returnDoc.returnNo} — ${item.itemName}`
          });
        }
      } catch (e: any) {
        integrationWarnings.push(`تعذر إضافة المخزون المرتجع للصنف "${item.itemName}": ${e.message}`);
      }
    }

    // 2) Customer balance & transactions
    let customerId = dto.customerId;
    if (!customerId && dto.customerName) {
      try {
        const custRes = await erpPool.query("SELECT id FROM customers WHERE name ILIKE $1 LIMIT 1", [dto.customerName]);
        if (custRes.rows.length > 0) {
          customerId = custRes.rows[0].id;
        }
      } catch (_) {}
    }

    const isCreditRefund = (dto.refundMethod || "إشعار دائن للعميل") === "إشعار دائن للعميل" || (dto.refundMethod || "").includes("دائن") || (dto.refundMethod || "").includes("حساب");

    if (customerId && isCreditRefund) {
      try {
        await this.customerService.recordTransaction({
          customer_id: customerId,
          amount: grandTotal,
          type: "payment", // payment credits customer balance (reduces debt)
          notes: `إشعار دائن مرتجع مبيعات ${returnDoc.return_no || returnDoc.returnNo}`
        });
      } catch (e: any) {
        integrationWarnings.push(`تعذر تخفيض رصيد العميل بالمرتجع: ${e.message}`);
      }
    }

    // 3) Treasury / Safe: If cash refund, record cash withdrawal from safe
    if (!isCreditRefund && grandTotal > 0) {
      try {
        const safes = await this.safeService.getSafes();
        const targetSafe = safes.length > 0 ? safes[0] : null;
        if (targetSafe) {
          await this.safeService.adjustSafeBalance(targetSafe.id, {
            amount: grandTotal,
            type: "out",
            notes: `صرف مردود مبيعات نقدي ${returnDoc.return_no || returnDoc.returnNo} — ${dto.customerName}`
          });
        }
      } catch (e: any) {
        console.warn("Could not record safe withdrawal for return:", e.message);
      }
    }

    // 4) General Ledger auto-posting for sales return
    try {
      await postReturnEntry({
        id: returnDoc.id,
        grand_total: grandTotal,
        refund_method: dto.refundMethod || "إشعار دائن للعميل",
        customer_name: dto.customerName,
        items_total: itemsTotal,
        tax_total: taxTotal,
        branch_id: 1
      });
    } catch (e: any) {
      integrationWarnings.push(`تعذر ترحيل قيد المرتجع المحاسبي: ${e.message}`);
    }

    ERPEventBus.getInstance().emitEvent("SalesReturnCreated", {
      returnId: returnDoc.id,
      returnNo: returnDoc.return_no || returnDoc.returnNo,
      customerName: returnDoc.customer_name || returnDoc.customerName,
      grandTotal,
      timestamp: new Date()
    });

    return { ...returnDoc, integrationWarnings };
  }

  async updateReturn(id: number, dto: UpdateReturnDTO): Promise<any> {
    const found = await this.repository.getById(id);
    if (!found) {
      const err: any = new Error("Return not found");
      err.statusCode = 404;
      throw err;
    }

    if (found.status === "تم التأكيد والمحاسبة") {
      const err: any = new Error("Cannot edit a return that has already been confirmed and posted");
      err.statusCode = 409;
      throw err;
    }

    const returnDoc = await this.repository.update(id, dto);
    ERPCache.delete(LIST_CACHE_KEY);

    ERPEventBus.getInstance().emitEvent("SalesReturnUpdated", {
      returnId: id,
      timestamp: new Date()
    });

    return returnDoc;
  }

  async deleteReturn(id: number): Promise<void> {
    const found = await this.repository.getById(id);
    if (!found) {
      const err: any = new Error("Return not found");
      err.statusCode = 404;
      throw err;
    }

    if (found.status === "تم التأكيد والمحاسبة") {
      const err: any = new Error("Cannot delete a return that has already been confirmed and posted");
      err.statusCode = 409;
      throw err;
    }

    await this.repository.delete(id);
    ERPCache.delete(LIST_CACHE_KEY);

    ERPEventBus.getInstance().emitEvent("SalesReturnDeleted", {
      returnId: id,
      timestamp: new Date()
    });
  }
}
