import { erpPool } from "../../../server-erp-core.js";

/**
 * Central cost integration layer.
 *
 * Important accounting rule:
 * - A purchase receipt is an inventory/acquisition cost, not an operating expense.
 * - Production consumption/output is a manufacturing cost, not a second purchase expense.
 * - Operating costs remain in operating_costs and are never duplicated here.
 *
 * cost_transactions is an analytical/valuation ledger used by the Costs module.
 * It is deliberately append-only and idempotent by source + transaction type + line.
 */
export async function ensureCostIntegrationSchema(): Promise<void> {
  await erpPool.query(`
    CREATE TABLE IF NOT EXISTS cost_transactions (
      id SERIAL PRIMARY KEY,
      transaction_no TEXT UNIQUE NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      transaction_type TEXT NOT NULL,
      date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      amount NUMERIC(18,4) NOT NULL DEFAULT 0,
      quantity NUMERIC(18,4) NOT NULL DEFAULT 0,
      unit_cost NUMERIC(18,6) NOT NULL DEFAULT 0,
      ingredient_id INTEGER,
      product_id INTEGER,
      warehouse_id INTEGER,
      supplier_id INTEGER,
      cost_center_id INTEGER,
      notes TEXT,
      line_key TEXT NOT NULL DEFAULT '0',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_cost_tx_source_line
      ON cost_transactions(source_type, source_id, transaction_type, line_key);
    CREATE INDEX IF NOT EXISTS idx_cost_tx_date ON cost_transactions(date);
    CREATE INDEX IF NOT EXISTS idx_cost_tx_ingredient ON cost_transactions(ingredient_id, date);
    CREATE INDEX IF NOT EXISTS idx_cost_tx_product ON cost_transactions(product_id, date);
    CREATE INDEX IF NOT EXISTS idx_cost_tx_warehouse ON cost_transactions(warehouse_id, date);
    CREATE INDEX IF NOT EXISTS idx_cost_tx_supplier ON cost_transactions(supplier_id, date);
  `);
}

async function insertOnce(input: {
  sourceType: string;
  sourceId: string | number;
  transactionType: string;
  amount: number;
  quantity?: number;
  unitCost?: number;
  ingredientId?: number | null;
  productId?: number | null;
  warehouseId?: number | null;
  supplierId?: number | null;
  costCenterId?: number | null;
  date?: any;
  notes?: string;
  metadata?: any;
  lineKey?: string | number;
}) {
  const sourceId = String(input.sourceId);
  const lineKey = String(input.lineKey ?? input.ingredientId ?? input.productId ?? "0");
  const transactionNo = `CST-${input.sourceType}-${sourceId}-${input.transactionType}-${lineKey}`;
  const result = await erpPool.query(`
    INSERT INTO cost_transactions (
      transaction_no, source_type, source_id, transaction_type, date, amount, quantity,
      unit_cost, ingredient_id, product_id, warehouse_id, supplier_id, cost_center_id, notes, line_key, metadata
    )
    VALUES ($1,$2,$3,$4,COALESCE($5,CURRENT_TIMESTAMP),$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    ON CONFLICT (source_type, source_id, transaction_type, line_key)
    DO UPDATE SET
      date=EXCLUDED.date,
      amount=EXCLUDED.amount,
      quantity=EXCLUDED.quantity,
      unit_cost=EXCLUDED.unit_cost,
      warehouse_id=EXCLUDED.warehouse_id,
      supplier_id=EXCLUDED.supplier_id,
      cost_center_id=EXCLUDED.cost_center_id,
      notes=EXCLUDED.notes,
      metadata=EXCLUDED.metadata
    RETURNING *
  `, [
    transactionNo, input.sourceType, sourceId, input.transactionType, input.date || null,
    Number(input.amount || 0), Number(input.quantity || 0), Number(input.unitCost || 0),
    input.ingredientId || null, input.productId || null, input.warehouseId || null,
    input.supplierId || null, input.costCenterId || null, input.notes || null,
    lineKey,
    JSON.stringify(input.metadata || {})
  ]);
  return result.rows[0];
}

export async function recordPurchaseCost(purchaseId: number): Promise<number> {
  await ensureCostIntegrationSchema();

  const purchase = await erpPool.query(`
    SELECT id, supplier_id, warehouse_id, date, total_amount, shipping_amount,
           cost_center_id, purchase_order_id, receipt_id, branch_id
    FROM purchases WHERE id=$1
  `, [purchaseId]);
  if (!purchase.rows[0]) return 0;
  const p = purchase.rows[0];

  // Use the posted GRN valuation because it contains the landed unit cost actually
  // used to update warehouse average cost.
  const lines = await erpPool.query(`
    SELECT
      gri.id AS receipt_item_id,
      gri.ingredient_id,
      gri.accepted_qty,
      gri.landed_unit_cost,
      gri.total_landed_cost,
      COALESCE(gri.unit_cost, gri.unit_price, 0) AS unit_price,
      gri.uom,
      i.name AS ingredient_name
    FROM goods_receipts gr
    JOIN goods_receipt_items gri ON gri.goods_receipt_id=gr.id
    LEFT JOIN ingredients i ON i.id=gri.ingredient_id
    WHERE gr.purchase_id=$1
      AND COALESCE(gri.accepted_qty,0) > 0
    ORDER BY gri.id
  `, [purchaseId]);

  let count = 0;
  for (const line of lines.rows) {
    const qty = Number(line.accepted_qty || 0);
    const unitCost = Number(line.landed_unit_cost || line.unit_cost || 0);
    await insertOnce({
      sourceType: "purchase",
      sourceId: purchaseId,
      transactionType: "inventory_acquisition",
      amount: qty * unitCost,
      quantity: qty,
      unitCost,
      ingredientId: Number(line.ingredient_id) || null,
      warehouseId: Number(p.warehouse_id) || null,
      supplierId: Number(p.supplier_id) || null,
      costCenterId: Number(p.cost_center_id) || null,
      date: p.date,
      notes: `تكلفة اقتناء خامة من فاتورة شراء #${purchaseId} - ${line.ingredient_name || ""}`,
      lineKey: line.receipt_item_id,
      metadata: {
        purchase_id: purchaseId,
        receipt_id: p.receipt_id,
        purchase_order_id: p.purchase_order_id,
        unit: line.uom || null,
        branch_id: p.branch_id || null
      }
    });
    count++;
  }

  // Freight/other landed costs are kept separately so reports can reconcile to
  // the purchase without inflating the material line twice.
  const shipping = Number(p.shipping_amount || 0);
  if (shipping > 0) {
    await insertOnce({
      sourceType: "purchase",
      sourceId: purchaseId,
      transactionType: "landed_overhead",
      lineKey: "shipping",
      amount: shipping,
      warehouseId: Number(p.warehouse_id) || null,
      supplierId: Number(p.supplier_id) || null,
      costCenterId: Number(p.cost_center_id) || null,
      date: p.date,
      notes: `تكلفة شحن/تحميل مرتبطة بفاتورة شراء #${purchaseId}`,
      metadata: { purchase_id: purchaseId, receipt_id: p.receipt_id }
    });
  }

  return count;
}

export async function recordGoodsReceiptCost(receiptId: number): Promise<number> {
  await ensureCostIntegrationSchema();
  const receipt = await erpPool.query(`
    SELECT id, supplier_id, warehouse_id, date, purchase_order_id, total_landed_cost
    FROM goods_receipts
    WHERE id=$1 AND is_posted=true
  `, [receiptId]);
  if (!receipt.rows[0]) return 0;
  const header = receipt.rows[0];
  const lines = await erpPool.query(`
    SELECT gri.id AS receipt_item_id, gri.ingredient_id, gri.accepted_qty,
           gri.landed_unit_cost, gri.total_landed_cost, gri.uom,
           i.name AS ingredient_name
    FROM goods_receipt_items gri
    LEFT JOIN ingredients i ON i.id=gri.ingredient_id
    WHERE gri.goods_receipt_id=$1 AND COALESCE(gri.accepted_qty,0)>0
    ORDER BY gri.id
  `, [receiptId]);

  for (const line of lines.rows) {
    const quantity = Number(line.accepted_qty || 0);
    const unitCost = Number(line.landed_unit_cost || 0);
    await insertOnce({
      sourceType: 'goods_receipt',
      sourceId: receiptId,
      transactionType: 'inventory_acquisition',
      amount: Number(line.total_landed_cost || quantity * unitCost),
      quantity,
      unitCost,
      ingredientId: Number(line.ingredient_id) || null,
      warehouseId: Number(header.warehouse_id) || null,
      supplierId: Number(header.supplier_id) || null,
      date: header.date,
      notes: `تكلفة استلام مخزني #${receiptId} - ${line.ingredient_name || ''}`,
      lineKey: line.receipt_item_id,
      metadata: {
        goods_receipt_id: receiptId,
        purchase_order_id: header.purchase_order_id,
        unit: line.uom || null
      }
    });
  }
  return lines.rowCount || 0;
}

export async function recordProductionCost(orderNumber: string): Promise<boolean> {
  await ensureCostIntegrationSchema();

  const order = await erpPool.query(`
    SELECT id, order_number, product_id, product_name, quantity, total_cost, cost_per_unit,
           raw_warehouse_id, finished_warehouse_id, start_date, end_date, work_center_id
    FROM production_orders
    WHERE order_number=$1
    LIMIT 1
  `, [String(orderNumber)]);
  if (!order.rows[0]) return false;
  const o = order.rows[0];

  const qty = Number(o.quantity || 0);
  const total = Number(o.total_cost || 0);
  const unit = qty > 0 ? Number(o.cost_per_unit || total / qty) : 0;
  const numericProductId = Number(o.product_id);

  await insertOnce({
    sourceType: "production_order",
    sourceId: o.order_number,
    transactionType: "manufacturing_output",
    amount: total,
    quantity: qty,
    unitCost: unit,
    productId: Number.isFinite(numericProductId) && numericProductId > 0 ? numericProductId : null,
    warehouseId: Number(o.finished_warehouse_id) || null,
    date: o.end_date || o.start_date,
    notes: `تكلفة تصنيع وترحيل أمر الإنتاج ${o.order_number}`,
    metadata: {
      production_order_id: o.id,
      raw_warehouse_id: o.raw_warehouse_id,
      finished_warehouse_id: o.finished_warehouse_id,
      work_center_id: o.work_center_id,
      product_name: o.product_name
    }
  });

  return true;
}

export async function getCostIntegrationSummary(filters: {
  from?: string;
  to?: string;
  warehouseId?: number;
  productId?: number;
  supplierId?: number;
}) {
  await ensureCostIntegrationSchema();
  const where: string[] = ["1=1"];
  const params: any[] = [];
  const add = (sql: string, value: any) => { params.push(value); where.push(sql.replace("?", `$${params.length}`)); };

  if (filters.from) add("ct.date >= ?::timestamp", filters.from);
  if (filters.to) add("ct.date < (?::date + INTERVAL '1 day')", filters.to);
  if (filters.warehouseId) add("ct.warehouse_id = ?", filters.warehouseId);
  if (filters.productId) add("ct.product_id = ?", filters.productId);
  if (filters.supplierId) add("ct.supplier_id = ?", filters.supplierId);

  const [summary, bySource, byProduct] = await Promise.all([
    erpPool.query(`
      SELECT COUNT(*)::int AS transactions,
             COALESCE(SUM(amount),0) AS total_amount,
             COALESCE(SUM(CASE WHEN transaction_type='inventory_acquisition' THEN amount ELSE 0 END),0) AS purchases,
             COALESCE(SUM(CASE WHEN transaction_type='landed_overhead' THEN amount ELSE 0 END),0) AS landed_overhead,
             COALESCE(SUM(CASE WHEN transaction_type='manufacturing_output' THEN amount ELSE 0 END),0) AS production
      FROM cost_transactions ct WHERE ${where.join(" AND ")}
    `, params),
    erpPool.query(`
      SELECT source_type, transaction_type, COUNT(*)::int AS transactions, COALESCE(SUM(amount),0) AS amount
      FROM cost_transactions ct WHERE ${where.join(" AND ")}
      GROUP BY source_type, transaction_type
      ORDER BY amount DESC
    `, params),
    erpPool.query(`
      SELECT ct.product_id, COALESCE(p.name, 'غير مرتبط') AS product_name,
             COALESCE(SUM(ct.amount),0) AS amount
      FROM cost_transactions ct
      LEFT JOIN products p ON p.id=ct.product_id
      WHERE ${where.join(" AND ")} AND ct.product_id IS NOT NULL
      GROUP BY ct.product_id, p.name
      ORDER BY amount DESC
      LIMIT 100
    `, params)
  ]);

  return {
    summary: summary.rows[0],
    by_source: bySource.rows,
    by_product: byProduct.rows
  };
}

export async function getCostIntegrationLedger(filters: {
  from?: string;
  to?: string;
  sourceType?: string;
  transactionType?: string;
  limit?: number;
}) {
  await ensureCostIntegrationSchema();
  const where: string[] = ["1=1"];
  const params: any[] = [];
  const add = (sql: string, value: any) => {
    params.push(value);
    where.push(sql.replace("?", `$${params.length}`));
  };

  if (filters.from) add("ct.date >= ?::timestamp", filters.from);
  if (filters.to) add("ct.date < (?::date + INTERVAL '1 day')", filters.to);
  if (filters.sourceType) add("ct.source_type = ?", filters.sourceType);
  if (filters.transactionType) add("ct.transaction_type = ?", filters.transactionType);

  const limit = Math.min(Math.max(Number(filters.limit || 200), 1), 1000);
  params.push(limit);
  const result = await erpPool.query(`
    SELECT ct.*, COALESCE(i.name, p.name) AS item_name,
           s.name AS supplier_name, w.name AS warehouse_name
    FROM cost_transactions ct
    LEFT JOIN ingredients i ON i.id=ct.ingredient_id
    LEFT JOIN products p ON p.id=ct.product_id
    LEFT JOIN suppliers s ON s.id=ct.supplier_id
    LEFT JOIN warehouses w ON w.id=ct.warehouse_id
    WHERE ${where.join(" AND ")}
    ORDER BY ct.date DESC, ct.id DESC
    LIMIT $${params.length}
  `, params);
  return result.rows;
}

export async function rebuildAllCostIntegrations() {
  await ensureCostIntegrationSchema();
  const purchases = await erpPool.query(`
    SELECT DISTINCT p.id
    FROM purchases p
    JOIN goods_receipts gr ON gr.purchase_id=p.id
    WHERE COALESCE(gr.is_posted, false)=true
    ORDER BY p.id
  `);
  const production = await erpPool.query(`
    SELECT order_number
    FROM production_orders
    WHERE status='completed' OR is_executed=true
    ORDER BY id
  `);

  let purchaseTransactions = 0;
  for (const row of purchases.rows) purchaseTransactions += await recordPurchaseCost(Number(row.id));
  let productionOrders = 0;
  for (const row of production.rows) {
    if (await recordProductionCost(String(row.order_number))) productionOrders++;
  }
  return { purchases: purchases.rowCount || 0, purchaseTransactions, productionOrders };
}
