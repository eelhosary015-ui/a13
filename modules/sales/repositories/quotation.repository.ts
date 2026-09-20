import { erpPool } from "../../../server-erp-core.js";

export class QuotationRepository {
  private static tablesEnsured = false;
  private static ensurePromise: Promise<void> | null = null;

  constructor() {
    this.ensureTablesExist();
  }

  private async ensureTablesExist(): Promise<void> {
    if (QuotationRepository.tablesEnsured) return;
    if (QuotationRepository.ensurePromise) return QuotationRepository.ensurePromise;

    const quoTableDdl = `
      CREATE TABLE IF NOT EXISTS sales_quotations (
        id SERIAL PRIMARY KEY,
        quotation_no VARCHAR(100) UNIQUE NOT NULL,
        customer_name VARCHAR(255) NOT NULL,
        date DATE NOT NULL,
        validity_date DATE,
        sales_rep VARCHAR(100),
        warehouse VARCHAR(100),
        branch VARCHAR(100),
        currency VARCHAR(50),
        payment_method VARCHAR(50),
        notes TEXT,
        status VARCHAR(50) DEFAULT 'مفتوح',
        total_items DECIMAL(12,2) DEFAULT 0,
        total_discount DECIMAL(12,2) DEFAULT 0,
        total_tax DECIMAL(12,2) DEFAULT 0,
        net_amount DECIMAL(12,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    const itemsTableDdl = `
      CREATE TABLE IF NOT EXISTS sales_quotation_items (
        id SERIAL PRIMARY KEY,
        quotation_id INTEGER NOT NULL REFERENCES sales_quotations(id) ON DELETE CASCADE,
        code VARCHAR(50),
        name VARCHAR(255) NOT NULL,
        unit VARCHAR(50),
        qty DECIMAL(12,2) NOT NULL,
        price DECIMAL(12,2) NOT NULL,
        discount_percent DECIMAL(5,2) DEFAULT 0,
        vat_percent DECIMAL(5,2) DEFAULT 14
      )
    `;

    QuotationRepository.ensurePromise = (async () => {
      try {
        await erpPool.query(quoTableDdl);
        await erpPool.query(itemsTableDdl);
        QuotationRepository.tablesEnsured = true;
      } catch (err: any) {
        // Handled via pool
      } finally {
        QuotationRepository.ensurePromise = null;
      }
    })();
    return QuotationRepository.ensurePromise;
  }

  async getAll(): Promise<any[]> {
    await this.ensureTablesExist();

    const query = `
      SELECT q.*, 
             COALESCE(
               json_agg(
                 json_build_object(
                   'id', i.id,
                   'code', i.code,
                   'name', i.name,
                   'unit', i.unit,
                   'qty', i.qty,
                   'price', i.price,
                   'discountPercent', i.discount_percent,
                   'vatPercent', i.vat_percent
                 )
               ) FILTER (WHERE i.id IS NOT NULL), 
               '[]'::json
             ) as items
      FROM sales_quotations q
      LEFT JOIN sales_quotation_items i ON q.id = i.quotation_id
      GROUP BY q.id
      ORDER BY q.created_at DESC
    `;
    const result = await erpPool.query(query);
    return result.rows.map((row: any) => ({
      id: row.id,
      quotationNo: row.quotation_no,
      customerName: row.customer_name,
      date: new Date(row.date).toISOString().split('T')[0],
      validityDate: row.validity_date ? new Date(row.validity_date).toISOString().split('T')[0] : null,
      salesRep: row.sales_rep,
      warehouse: row.warehouse,
      branch: row.branch,
      currency: row.currency,
      paymentMethod: row.payment_method,
      notes: row.notes,
      status: row.status,
      totalItems: parseFloat(row.total_items),
      totalDiscount: parseFloat(row.total_discount),
      totalTax: parseFloat(row.total_tax),
      netAmount: parseFloat(row.net_amount),
      items: row.items
    }));
  }

  async getById(id: number): Promise<any | null> {
    await this.ensureTablesExist();
    const query = `
      SELECT q.*,
             COALESCE(
               json_agg(
                 json_build_object(
                   'id', i.id,
                   'code', i.code,
                   'name', i.name,
                   'unit', i.unit,
                   'qty', i.qty,
                   'price', i.price,
                   'discountPercent', i.discount_percent,
                   'vatPercent', i.vat_percent
                 )
               ) FILTER (WHERE i.id IS NOT NULL),
               '[]'::json
             ) as items
      FROM sales_quotations q
      LEFT JOIN sales_quotation_items i ON q.id = i.quotation_id
      WHERE q.id = $1
      GROUP BY q.id
    `;
    const result = await erpPool.query(query, [id]);
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      quotationNo: row.quotation_no,
      customerName: row.customer_name,
      date: new Date(row.date).toISOString().split('T')[0],
      validityDate: row.validity_date ? new Date(row.validity_date).toISOString().split('T')[0] : null,
      salesRep: row.sales_rep,
      warehouse: row.warehouse,
      branch: row.branch,
      currency: row.currency,
      paymentMethod: row.payment_method,
      notes: row.notes,
      status: row.status,
      totalItems: parseFloat(row.total_items),
      totalDiscount: parseFloat(row.total_discount),
      totalTax: parseFloat(row.total_tax),
      netAmount: parseFloat(row.net_amount),
      items: row.items
    };
  }

  async create(quo: any): Promise<any> {
    await this.ensureTablesExist();
    const client = await erpPool.connect();
    try {
      await client.query("BEGIN");

      // Generate next quotation number if not provided
      let quotationNo = quo.quotationNo;
      if (!quotationNo) {
        const countRes = await client.query("SELECT COUNT(*) as count FROM sales_quotations");
        const nextNum = parseInt(countRes.rows[0].count) + 1;
        quotationNo = `QT-2024-${String(nextNum).padStart(6, '0')}`;
      }

      const insertQuoQuery = `
        INSERT INTO sales_quotations (
          quotation_no, customer_name, date, validity_date, sales_rep, 
          warehouse, branch, currency, payment_method, notes, status, 
          total_items, total_discount, total_tax, net_amount
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        RETURNING *
      `;

      const quoResult = await client.query(insertQuoQuery, [
        quotationNo,
        quo.customerName,
        quo.date || new Date(),
        quo.validityDate || null,
        quo.salesRep || null,
        quo.warehouse || null,
        quo.branch || null,
        quo.currency || null,
        quo.paymentMethod || null,
        quo.notes || null,
        quo.status || 'مفتوح',
        quo.totalItems || 0,
        quo.totalDiscount || 0,
        quo.totalTax || 0,
        quo.netAmount || 0
      ]);

      const insertedQuo = quoResult.rows[0];

      if (quo.items && quo.items.length > 0) {
        for (const item of quo.items) {
          const insertItemQuery = `
            INSERT INTO sales_quotation_items (
              quotation_id, code, name, unit, qty, price, discount_percent, vat_percent
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `;
          await client.query(insertItemQuery, [
            insertedQuo.id,
            item.code || null,
            item.name,
            item.unit || 'قطعة',
            item.qty,
            item.price,
            item.discountPercent || 0,
            item.vatPercent || 14
          ]);
        }
      }

      await client.query("COMMIT");
      return insertedQuo;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async update(id: number, quo: any): Promise<any> {
    await this.ensureTablesExist();
    const client = await erpPool.connect();
    try {
      await client.query("BEGIN");

      const updateQuoQuery = `
        UPDATE sales_quotations
        SET customer_name = $1, date = $2, validity_date = $3, sales_rep = $4, 
            warehouse = $5, branch = $6, currency = $7, payment_method = $8, 
            notes = $9, status = $10, total_items = $11, total_discount = $12, 
            total_tax = $13, net_amount = $14
        WHERE id = $15
        RETURNING *
      `;

      const quoResult = await client.query(updateQuoQuery, [
        quo.customerName,
        quo.date || new Date(),
        quo.validityDate || null,
        quo.salesRep || null,
        quo.warehouse || null,
        quo.branch || null,
        quo.currency || null,
        quo.paymentMethod || null,
        quo.notes || null,
        quo.status || 'مفتوح',
        quo.totalItems || 0,
        quo.totalDiscount || 0,
        quo.totalTax || 0,
        quo.netAmount || 0,
        id
      ]);

      // Delete old items and insert updated ones
      await client.query("DELETE FROM sales_quotation_items WHERE quotation_id = $1", [id]);

      if (quo.items && quo.items.length > 0) {
        for (const item of quo.items) {
          const insertItemQuery = `
            INSERT INTO sales_quotation_items (
              quotation_id, code, name, unit, qty, price, discount_percent, vat_percent
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `;
          await client.query(insertItemQuery, [
            id,
            item.code || null,
            item.name,
            item.unit || 'قطعة',
            item.qty,
            item.price,
            item.discountPercent || 0,
            item.vatPercent || 14
          ]);
        }
      }

      await client.query("COMMIT");
      return quoResult.rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async delete(id: number): Promise<void> {
    await this.ensureTablesExist();
    await erpPool.query("DELETE FROM sales_quotations WHERE id = $1", [id]);
  }
}
