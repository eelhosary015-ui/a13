import { erpPool, ERPEventBus } from "../../../server-erp-core.js";

export class InvoiceRepository {
  private static tablesEnsured = false;
  private static ensurePromise: Promise<void> | null = null;

  constructor() {
    this.ensureTablesExist();
  }

  private async ensureTablesExist(): Promise<void> {
    if (InvoiceRepository.tablesEnsured) return;
    if (InvoiceRepository.ensurePromise) return InvoiceRepository.ensurePromise;

    const invoiceTableDdl = `
      CREATE TABLE IF NOT EXISTS sales_invoices (
        id SERIAL PRIMARY KEY,
        invoice_no VARCHAR(100) UNIQUE NOT NULL,
        order_id INTEGER,
        customer_id INTEGER,
        customer_name VARCHAR(255) NOT NULL,
        date DATE NOT NULL,
        due_date DATE,
        sales_rep VARCHAR(100),
        branch VARCHAR(100),
        warehouse_id INTEGER,
        warehouse VARCHAR(100),
        currency VARCHAR(50),
        payment_method VARCHAR(50),
        notes TEXT,
        status VARCHAR(50) DEFAULT 'غير مدفوعة',
        subtotal DECIMAL(12,2) DEFAULT 0,
        discount_total DECIMAL(12,2) DEFAULT 0,
        tax_total DECIMAL(12,2) DEFAULT 0,
        net_amount DECIMAL(12,2) DEFAULT 0,
        paid_amount DECIMAL(12,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    const itemsTableDdl = `
      CREATE TABLE IF NOT EXISTS sales_invoice_items (
        id SERIAL PRIMARY KEY,
        invoice_id INTEGER NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
        ingredient_id INTEGER,
        code VARCHAR(50),
        name VARCHAR(255) NOT NULL,
        unit VARCHAR(50) DEFAULT 'قطعة',
        qty DECIMAL(12,2) NOT NULL,
        price DECIMAL(12,2) NOT NULL,
        discount_percent DECIMAL(5,2) DEFAULT 0,
        vat_percent DECIMAL(5,2) DEFAULT 14,
        total DECIMAL(12,2) NOT NULL
      )
    `;

    const paymentsTableDdl = `
      CREATE TABLE IF NOT EXISTS sales_invoice_payments (
        id SERIAL PRIMARY KEY,
        invoice_id INTEGER NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
        amount DECIMAL(12,2) NOT NULL,
        method VARCHAR(50),
        notes TEXT,
        paid_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    InvoiceRepository.ensurePromise = (async () => {
      try {
        await erpPool.query(invoiceTableDdl);
        await erpPool.query(itemsTableDdl);
        await erpPool.query(paymentsTableDdl);
        InvoiceRepository.tablesEnsured = true;
      } catch (err: any) {
        // Handled via pool
      } finally {
        InvoiceRepository.ensurePromise = null;
      }
    })();
    return InvoiceRepository.ensurePromise;
  }

  private mapRow(row: any): any {
    return {
      id: row.id,
      invoiceNo: row.invoice_no,
      orderId: row.order_id,
      customerId: row.customer_id,
      customerName: row.customer_name,
      date: new Date(row.date).toISOString().split('T')[0],
      dueDate: row.due_date ? new Date(row.due_date).toISOString().split('T')[0] : null,
      salesRep: row.sales_rep,
      branch: row.branch,
      warehouseId: row.warehouse_id,
      warehouse: row.warehouse,
      currency: row.currency,
      paymentMethod: row.payment_method,
      notes: row.notes,
      status: row.status,
      subtotal: parseFloat(row.subtotal),
      discountTotal: parseFloat(row.discount_total),
      taxTotal: parseFloat(row.tax_total),
      netAmount: parseFloat(row.net_amount),
      paidAmount: parseFloat(row.paid_amount),
      items: row.items
    };
  }

  async getAll(): Promise<any[]> {
    await this.ensureTablesExist();
    const query = `
      SELECT i.*,
             COALESCE(
               json_agg(
                 json_build_object(
                   'id', it.id,
                   'ingredientId', it.ingredient_id,
                   'code', it.code,
                   'name', it.name,
                   'unit', it.unit,
                   'qty', it.qty,
                   'price', it.price,
                   'discountPercent', it.discount_percent,
                   'vatPercent', it.vat_percent,
                   'total', it.total
                 )
               ) FILTER (WHERE it.id IS NOT NULL),
               '[]'::json
             ) as items
      FROM sales_invoices i
      LEFT JOIN sales_invoice_items it ON i.id = it.invoice_id
      GROUP BY i.id
      ORDER BY i.created_at DESC
    `;
    const result = await erpPool.query(query);
    return result.rows.map((row: any) => this.mapRow(row));
  }

  async getById(id: number): Promise<any | null> {
    await this.ensureTablesExist();
    const query = `
      SELECT i.*,
             COALESCE(
               json_agg(
                 json_build_object(
                   'id', it.id,
                   'ingredientId', it.ingredient_id,
                   'code', it.code,
                   'name', it.name,
                   'unit', it.unit,
                   'qty', it.qty,
                   'price', it.price,
                   'discountPercent', it.discount_percent,
                   'vatPercent', it.vat_percent,
                   'total', it.total
                 )
               ) FILTER (WHERE it.id IS NOT NULL),
               '[]'::json
             ) as items
      FROM sales_invoices i
      LEFT JOIN sales_invoice_items it ON i.id = it.invoice_id
      WHERE i.id = $1
      GROUP BY i.id
    `;
    const result = await erpPool.query(query, [id]);
    if (result.rows.length === 0) return null;
    return this.mapRow(result.rows[0]);
  }

  async create(inv: any): Promise<any> {
    await this.ensureTablesExist();
    const client = await erpPool.connect();
    try {
      await client.query("BEGIN");

      let invoiceNo = inv.invoiceNo;
      if (!invoiceNo) {
        const countRes = await client.query("SELECT COUNT(*) as count FROM sales_invoices");
        const nextNum = parseInt(countRes.rows[0].count) + 1;
        const year = new Date(inv.date || new Date()).getFullYear();
        invoiceNo = `INV-${year}-${String(nextNum).padStart(6, '0')}`;
      }

      const insertInvQuery = `
        INSERT INTO sales_invoices (
          invoice_no, order_id, customer_id, customer_name, date, due_date,
          sales_rep, branch, warehouse_id, warehouse, currency, payment_method,
          notes, status, subtotal, discount_total, tax_total, net_amount, paid_amount
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
        RETURNING *
      `;

      const invResult = await client.query(insertInvQuery, [
        invoiceNo,
        inv.orderId || null,
        inv.customerId || null,
        inv.customerName,
        inv.date || new Date(),
        inv.dueDate || null,
        inv.salesRep || null,
        inv.branch || null,
        inv.warehouseId || null,
        inv.warehouse || null,
        inv.currency || null,
        inv.paymentMethod || null,
        inv.notes || null,
        inv.status || 'غير مدفوعة',
        inv.subtotal || 0,
        inv.discountTotal || 0,
        inv.taxTotal || 0,
        inv.netAmount || 0,
        inv.paidAmount || 0
      ]);

      const insertedInv = invResult.rows[0];

      if (inv.items && inv.items.length > 0) {
        for (const item of inv.items) {
          const insertItemQuery = `
            INSERT INTO sales_invoice_items (
              invoice_id, ingredient_id, code, name, unit, qty, price, discount_percent, vat_percent, total
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          `;
          await client.query(insertItemQuery, [
            insertedInv.id,
            item.ingredientId || null,
            item.code || null,
            item.name,
            item.unit || 'قطعة',
            item.qty,
            item.price,
            item.discountPercent || 0,
            item.vatPercent || 14,
            item.total
          ]);
        }
      }

      await client.query("COMMIT");

      try {
        ERPEventBus.getInstance().emitEvent("SalesInvoiceCreated", {
          invoiceId: insertedInv.id,
          invoice: insertedInv,
          total: insertedInv.net_amount || insertedInv.total,
          customerId: insertedInv.customer_id,
          customerName: insertedInv.customer_name,
          branchId: insertedInv.branch_id || insertedInv.branch,
          timestamp: new Date()
        });
      } catch (evtErr: any) {
        console.warn("[InvoiceRepository] Failed to emit SalesInvoiceCreated event:", evtErr.message);
      }

      return insertedInv;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async update(id: number, inv: any): Promise<any> {
    await this.ensureTablesExist();
    const client = await erpPool.connect();
    try {
      await client.query("BEGIN");

      const updateInvQuery = `
        UPDATE sales_invoices
        SET customer_id = $1, customer_name = $2, date = $3, due_date = $4,
            sales_rep = $5, branch = $6, warehouse_id = $7, warehouse = $8,
            currency = $9, payment_method = $10, notes = $11, status = $12,
            subtotal = $13, discount_total = $14, tax_total = $15, net_amount = $16
        WHERE id = $17
        RETURNING *
      `;

      const invResult = await client.query(updateInvQuery, [
        inv.customerId || null,
        inv.customerName,
        inv.date || new Date(),
        inv.dueDate || null,
        inv.salesRep || null,
        inv.branch || null,
        inv.warehouseId || null,
        inv.warehouse || null,
        inv.currency || null,
        inv.paymentMethod || null,
        inv.notes || null,
        inv.status || 'غير مدفوعة',
        inv.subtotal || 0,
        inv.discountTotal || 0,
        inv.taxTotal || 0,
        inv.netAmount || 0,
        id
      ]);

      await client.query("DELETE FROM sales_invoice_items WHERE invoice_id = $1", [id]);

      if (inv.items && inv.items.length > 0) {
        for (const item of inv.items) {
          const insertItemQuery = `
            INSERT INTO sales_invoice_items (
              invoice_id, ingredient_id, code, name, unit, qty, price, discount_percent, vat_percent, total
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          `;
          await client.query(insertItemQuery, [
            id,
            item.ingredientId || null,
            item.code || null,
            item.name,
            item.unit || 'قطعة',
            item.qty,
            item.price,
            item.discountPercent || 0,
            item.vatPercent || 14,
            item.total
          ]);
        }
      }

      await client.query("COMMIT");
      return invResult.rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async delete(id: number): Promise<void> {
    await this.ensureTablesExist();
    await erpPool.query("DELETE FROM sales_invoices WHERE id = $1", [id]);
  }

  async recordPayment(invoiceId: number, amount: number, method?: string, notes?: string): Promise<any> {
    await this.ensureTablesExist();
    const client = await erpPool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `INSERT INTO sales_invoice_payments (invoice_id, amount, method, notes) VALUES ($1, $2, $3, $4)`,
        [invoiceId, amount, method || null, notes || null]
      );

      const updateResult = await client.query(
        `UPDATE sales_invoices
         SET paid_amount = paid_amount + $1,
             status = CASE
               WHEN paid_amount + $1 >= net_amount THEN 'مدفوعة'
               WHEN paid_amount + $1 > 0 THEN 'مدفوعة جزئياً'
               ELSE status
             END
         WHERE id = $2
         RETURNING *`,
        [amount, invoiceId]
      );

      await client.query("COMMIT");
      return updateResult.rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
