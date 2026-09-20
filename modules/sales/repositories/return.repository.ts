import { erpPool } from "../../../server-erp-core.js";

export class ReturnRepository {
  private static tablesEnsured = false;
  private static ensurePromise: Promise<void> | null = null;

  constructor() {
    this.ensureTablesExist();
  }

  private async ensureTablesExist(): Promise<void> {
    if (ReturnRepository.tablesEnsured) return;
    if (ReturnRepository.ensurePromise) return ReturnRepository.ensurePromise;

    const returnTableDdl = `
      CREATE TABLE IF NOT EXISTS sales_returns (
        id SERIAL PRIMARY KEY,
        return_no TEXT UNIQUE NOT NULL,
        invoice_id TEXT,
        customer_name TEXT NOT NULL,
        date DATE NOT NULL,
        reason TEXT,
        return_type TEXT,
        refund_method TEXT,
        sales_rep TEXT,
        warehouse TEXT,
        notes TEXT,
        status TEXT DEFAULT 'مسودة',
        items_total DECIMAL(10,2) DEFAULT 0.00,
        discount_total DECIMAL(10,2) DEFAULT 0.00,
        tax_total DECIMAL(10,2) DEFAULT 0.00,
        expenses DECIMAL(10,2) DEFAULT 0.00,
        grand_total DECIMAL(10,2) DEFAULT 0.00,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    const itemsTableDdl = `
      CREATE TABLE IF NOT EXISTS sales_return_items (
        id SERIAL PRIMARY KEY,
        return_id INTEGER NOT NULL REFERENCES sales_returns(id) ON DELETE CASCADE,
        item_code TEXT NOT NULL,
        item_name TEXT NOT NULL,
        unit TEXT,
        qty_invoiced DECIMAL(10,2) NOT NULL,
        qty_returned DECIMAL(10,2) NOT NULL,
        discount DECIMAL(10,2) DEFAULT 0.00,
        tax_rate DECIMAL(10,2) DEFAULT 0.00,
        price DECIMAL(10,2) NOT NULL,
        total DECIMAL(10,2) NOT NULL
      )
    `;

    ReturnRepository.ensurePromise = (async () => {
      try {
        await erpPool.query(returnTableDdl);
        await erpPool.query(itemsTableDdl);
        ReturnRepository.tablesEnsured = true;
      } catch (err: any) {
        // Handled via pool
      } finally {
        ReturnRepository.ensurePromise = null;
      }
    })();
    return ReturnRepository.ensurePromise;
  }

  async getAll(): Promise<any[]> {
    await this.ensureTablesExist();

    const query = `
      SELECT r.*, 
             COALESCE(
               json_agg(
                 json_build_object(
                   'id', i.id,
                   'itemCode', i.item_code,
                   'itemName', i.item_name,
                   'unit', i.unit,
                   'qtyInvoiced', i.qty_invoiced,
                   'qtyReturned', i.qty_returned,
                   'discount', i.discount,
                   'taxRate', i.tax_rate,
                   'price', i.price,
                   'total', i.total
                 )
               ) FILTER (WHERE i.id IS NOT NULL), 
               '[]'::json
             ) as items
      FROM sales_returns r
      LEFT JOIN sales_return_items i ON r.id = i.return_id
      GROUP BY r.id
      ORDER BY r.created_at DESC
    `;
    const result = await erpPool.query(query);
    return result.rows.map((row: any) => ({
      id: row.id,
      returnNo: row.return_no,
      invoiceId: row.invoice_id,
      customerName: row.customer_name,
      date: new Date(row.date).toISOString().split('T')[0],
      reason: row.reason,
      returnType: row.return_type,
      refundMethod: row.refund_method,
      salesRep: row.sales_rep,
      warehouse: row.warehouse,
      notes: row.notes,
      status: row.status,
      itemsTotal: parseFloat(row.items_total),
      discountTotal: parseFloat(row.discount_total),
      taxTotal: parseFloat(row.tax_total),
      expenses: parseFloat(row.expenses),
      grandTotal: parseFloat(row.grand_total),
      items: row.items
    }));
  }

  async getById(id: number): Promise<any | null> {
    await this.ensureTablesExist();
    const query = `
      SELECT r.*,
             COALESCE(
               json_agg(
                 json_build_object(
                   'id', i.id,
                   'itemCode', i.item_code,
                   'itemName', i.item_name,
                   'unit', i.unit,
                   'qtyInvoiced', i.qty_invoiced,
                   'qtyReturned', i.qty_returned,
                   'discount', i.discount,
                   'taxRate', i.tax_rate,
                   'price', i.price,
                   'total', i.total
                 )
               ) FILTER (WHERE i.id IS NOT NULL),
               '[]'::json
             ) as items
      FROM sales_returns r
      LEFT JOIN sales_return_items i ON r.id = i.return_id
      WHERE r.id = $1
      GROUP BY r.id
    `;
    const result = await erpPool.query(query, [id]);
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      returnNo: row.return_no,
      invoiceId: row.invoice_id,
      customerName: row.customer_name,
      date: new Date(row.date).toISOString().split('T')[0],
      reason: row.reason,
      returnType: row.return_type,
      refundMethod: row.refund_method,
      salesRep: row.sales_rep,
      warehouse: row.warehouse,
      notes: row.notes,
      status: row.status,
      itemsTotal: parseFloat(row.items_total),
      discountTotal: parseFloat(row.discount_total),
      taxTotal: parseFloat(row.tax_total),
      expenses: parseFloat(row.expenses),
      grandTotal: parseFloat(row.grand_total),
      items: row.items
    };
  }

  async create(ret: any): Promise<any> {
    await this.ensureTablesExist();
    const client = await erpPool.connect();
    try {
      await client.query("BEGIN");

      // Generate next return number if not provided
      let returnNo = ret.returnNo;
      if (!returnNo) {
        const countRes = await client.query("SELECT COUNT(*) as count FROM sales_returns");
        const nextNum = parseInt(countRes.rows[0].count) + 501;
        returnNo = `SR-2024-${String(nextNum).padStart(6, '0')}`;
      }

      const insertRetQuery = `
        INSERT INTO sales_returns (
          return_no, invoice_id, customer_name, date, reason, 
          return_type, refund_method, sales_rep, warehouse, notes, status, 
          items_total, discount_total, tax_total, expenses, grand_total
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        RETURNING *
      `;

      const retResult = await client.query(insertRetQuery, [
        returnNo,
        ret.invoiceId || null,
        ret.customerName,
        ret.date || new Date(),
        ret.reason || null,
        ret.returnType || null,
        ret.refundMethod || null,
        ret.salesRep || null,
        ret.warehouse || null,
        ret.notes || null,
        ret.status || 'مسودة',
        ret.itemsTotal || 0,
        ret.discountTotal || 0,
        ret.taxTotal || 0,
        ret.expenses || 0,
        ret.grandTotal || 0
      ]);

      const insertedRet = retResult.rows[0];

      if (ret.items && ret.items.length > 0) {
        for (const item of ret.items) {
          const insertItemQuery = `
            INSERT INTO sales_return_items (
              return_id, item_code, item_name, unit, qty_invoiced, qty_returned, discount, tax_rate, price, total
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          `;
          await client.query(insertItemQuery, [
            insertedRet.id,
            item.itemCode,
            item.itemName,
            item.unit || 'قطعة',
            item.qtyInvoiced,
            item.qtyReturned,
            item.discount || 0,
            item.taxRate || 0,
            item.price,
            item.total
          ]);
        }
      }

      await client.query("COMMIT");
      return insertedRet;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async update(id: number, ret: any): Promise<any> {
    await this.ensureTablesExist();
    const client = await erpPool.connect();
    try {
      await client.query("BEGIN");

      const updateRetQuery = `
        UPDATE sales_returns
        SET invoice_id = $1, customer_name = $2, date = $3, reason = $4, 
            return_type = $5, refund_method = $6, sales_rep = $7, warehouse = $8, 
            notes = $9, status = $10, items_total = $11, discount_total = $12, 
            tax_total = $13, expenses = $14, grand_total = $15
        WHERE id = $16
        RETURNING *
      `;

      const retResult = await client.query(updateRetQuery, [
        ret.invoiceId || null,
        ret.customerName,
        ret.date || new Date(),
        ret.reason || null,
        ret.returnType || null,
        ret.refundMethod || null,
        ret.salesRep || null,
        ret.warehouse || null,
        ret.notes || null,
        ret.status || 'مسودة',
        ret.itemsTotal || 0,
        ret.discountTotal || 0,
        ret.taxTotal || 0,
        ret.expenses || 0,
        ret.grandTotal || 0,
        id
      ]);

      // Delete old items and insert updated ones
      await client.query("DELETE FROM sales_return_items WHERE return_id = $1", [id]);

      if (ret.items && ret.items.length > 0) {
        for (const item of ret.items) {
          const insertItemQuery = `
            INSERT INTO sales_return_items (
              return_id, item_code, item_name, unit, qty_invoiced, qty_returned, discount, tax_rate, price, total
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          `;
          await client.query(insertItemQuery, [
            id,
            item.itemCode,
            item.itemName,
            item.unit || 'قطعة',
            item.qtyInvoiced,
            item.qtyReturned,
            item.discount || 0,
            item.taxRate || 0,
            item.price,
            item.total
          ]);
        }
      }

      await client.query("COMMIT");
      return retResult.rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async delete(id: number): Promise<void> {
    await this.ensureTablesExist();
    await erpPool.query("DELETE FROM sales_returns WHERE id = $1", [id]);
  }
}
