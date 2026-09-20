import { randomUUID } from "crypto";

export type StockField = "quantity" | "reserved" | "in_transit";

export interface StockMoveOptions {
  warehouse_id: number;
  ingredient_id: number;
  delta: number;
  field?: StockField;
  ref_type: string;
  ref_id: number;
  user?: string;
  notes?: string;
}

function finiteNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Single source of truth for inventory balance changes.
 * Must be called inside an already-open DB transaction.
 */
export async function moveStock(client: any, opts: StockMoveOptions) {
  const warehouseId = finiteNumber(opts.warehouse_id);
  const ingredientId = finiteNumber(opts.ingredient_id);
  const delta = finiteNumber(opts.delta);
  const field: StockField = opts.field || "quantity";
  if (!warehouseId || !ingredientId) throw new Error("بيانات المخزن أو الصنف غير صحيحة");
  if (!Number.isFinite(delta) || delta === 0) throw new Error("كمية الحركة غير صحيحة");

  const wh = await client.query(
    `SELECT id, COALESCE(allow_negative_stock,false) AS allow_negative_stock
       FROM warehouses WHERE id=$1 FOR UPDATE`,
    [warehouseId]
  );
  if (!wh.rows.length) throw new Error(`المخزن غير موجود: ${warehouseId}`);

  const item = await client.query(
    `SELECT id, quantity, reserved, in_transit
       FROM inventory_items
      WHERE warehouse_id=$1 AND ingredient_id=$2
      FOR UPDATE`,
    [warehouseId, ingredientId]
  );

  let rowId: number;
  let before = 0;
  if (item.rows.length > 1) {
    // Consolidate duplicate rows for (warehouseId, ingredientId) into item.rows[0]
    let totalQty = 0;
    let totalRes = 0;
    let totalTransit = 0;
    const idsToDelete: number[] = [];
    item.rows.forEach((r: any, idx: number) => {
      totalQty += finiteNumber(r.quantity);
      totalRes += finiteNumber(r.reserved);
      totalTransit += finiteNumber(r.in_transit);
      if (idx > 0) idsToDelete.push(Number(r.id));
    });
    rowId = Number(item.rows[0].id);
    await client.query(
      `UPDATE inventory_items 
       SET quantity=$1, reserved=$2, in_transit=$3, available=GREATEST($1 - $2, 0), updated_at=NOW() 
       WHERE id=$4`,
      [totalQty, totalRes, totalTransit, rowId]
    );
    if (idsToDelete.length > 0) {
      await client.query(`DELETE FROM inventory_items WHERE id = ANY($1::int[])`, [idsToDelete]);
    }
    item.rows[0].quantity = totalQty;
    item.rows[0].reserved = totalRes;
    item.rows[0].in_transit = totalTransit;
    before = field === "quantity" ? totalQty : (field === "reserved" ? totalRes : totalTransit);
  } else if (item.rows.length === 1) {
    rowId = Number(item.rows[0].id);
    before = finiteNumber(item.rows[0][field]);
  } else {
    rowId = 0;
  }

  // Re-check after acquiring the row locks. This closes the race where a retry
  // waits on a lock while the original request commits the ledger event.
  const eventKey = `${opts.ref_type}:${opts.ref_id}:${warehouseId}:${ingredientId}:${field}`;
  const replay = await client.query(`SELECT before_qty, delta, after_qty, id FROM inventory_stock_ledger WHERE event_key=$1`, [eventKey]);
  if (replay.rows.length) {
    const r = replay.rows[0];
    return { inventory_item_id: rowId, warehouse_id: warehouseId, ingredient_id: ingredientId, field, before: finiteNumber(r.before_qty), delta: finiteNumber(r.delta), after: finiteNumber(r.after_qty), replayed: true, ledger_id: Number(r.id) };
  }

  const after = before + delta;
  if (field === "quantity" && delta < 0 && !Boolean(wh.rows[0].allow_negative_stock) && after < 0) {
    throw new Error(`الرصيد غير كافٍ للصنف #${ingredientId}. المتاح: ${before}، المطلوب: ${Math.abs(delta)}`);
  }
  if ((field === "reserved" || field === "in_transit") && after < 0) {
    throw new Error(`الرصيد المحجوز/قيد النقل لا يمكن أن يكون سالباً للصنف #${ingredientId}`);
  }

  if (rowId) {
    await client.query(
      `UPDATE inventory_items
          SET ${field}=$1,
              available=GREATEST(COALESCE(quantity,0)-COALESCE(reserved,0),0),
              updated_at=NOW()
        WHERE id=$2`,
      [after, rowId]
    );
  } else {
    const q = field === "quantity" ? delta : 0;
    const r = field === "reserved" ? delta : 0;
    const t = field === "in_transit" ? delta : 0;
    const ins = await client.query(
      `INSERT INTO inventory_items
        (warehouse_id, ingredient_id, quantity, reserved, in_transit, available, updated_at)
       VALUES ($1,$2,$3,$4,$5,GREATEST($3::numeric-$4::numeric,0::numeric),NOW())
       RETURNING id`,
      [warehouseId, ingredientId, q, r, t]
    );
    rowId = Number(ins.rows[0].id);
  }

  // Keep the legacy item-master aggregate in sync with the authoritative
  // warehouse balances. This is intentionally derived, never used as the
  // source of truth for availability decisions.
  try {
    const totalRes = await client.query(
      `SELECT COALESCE(SUM(quantity),0) AS total FROM inventory_items WHERE ingredient_id=$1`,
      [ingredientId]
    );
    await client.query(
      `UPDATE ingredients SET current_stock=$1 WHERE id=$2`,
      [finiteNumber(totalRes.rows[0]?.total), ingredientId]
    );
  } catch (syncError: any) {
    throw new Error(`تعذر مزامنة إجمالي رصيد الصنف: ${syncError.message}`);
  }

  const movementAfter = after;
  let ledgerId: number;
  try {
    const ledger = await client.query(
      `INSERT INTO inventory_stock_ledger
       (event_key, warehouse_id, ingredient_id, field, before_qty, delta, after_qty, ref_type, ref_id, user_name, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (event_key) DO NOTHING
       RETURNING id`,
      [eventKey, warehouseId, ingredientId, field, before, delta, movementAfter, opts.ref_type, opts.ref_id, opts.user || "system", opts.notes || ""]
    );
    if (!ledger.rows.length) {
      const existing = await client.query(`SELECT before_qty, delta, after_qty, id FROM inventory_stock_ledger WHERE event_key=$1`, [eventKey]);
      if (existing.rows.length) {
        const r = existing.rows[0];
        return { inventory_item_id: rowId, warehouse_id: warehouseId, ingredient_id: ingredientId, field, before: finiteNumber(r.before_qty), delta: finiteNumber(r.delta), after: finiteNumber(r.after_qty), replayed: true, ledger_id: Number(r.id) };
      }
      throw new Error("تعذر تثبيت حركة المخزون بشكل آمن");
    }
    ledgerId = Number(ledger.rows[0].id);
    await client.query(
      `INSERT INTO inventory_movements
       (warehouse_id, ingredient_id, field, before_qty, delta, after_qty, ref_type, ref_id, "user", notes, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())`,
      [warehouseId, ingredientId, field, before, delta, movementAfter, opts.ref_type, opts.ref_id, opts.user || "system", opts.notes || ""]
    );
  } catch (e: any) {
    // If the audit table is unavailable, fail the transaction rather than silently losing stock history.
    throw new Error(`تعذر تسجيل حركة المخزون: ${e.message}`);
  }

  return { inventory_item_id: rowId, warehouse_id: warehouseId, ingredient_id: ingredientId, field, before, delta, after, replayed: false, ledger_id: ledgerId };
}

export async function transferStock(client: any, opts: {
  fromWarehouseId: number;
  toWarehouseId: number;
  ingredientId: number;
  quantity: number;
  refId: number;
  user?: string;
  notes?: string;
}) {
  if (Number(opts.fromWarehouseId) === Number(opts.toWarehouseId)) throw new Error("لا يمكن التحويل لنفس المخزن");
  const qty = finiteNumber(opts.quantity);
  if (qty <= 0) throw new Error("كمية التحويل يجب أن تكون أكبر من صفر");

  const out = await moveStock(client, {
    warehouse_id: Number(opts.fromWarehouseId), ingredient_id: Number(opts.ingredientId), delta: -qty,
    ref_type: "transfer", ref_id: opts.refId, user: opts.user, notes: opts.notes || "تحويل صادر"
  });
  const incoming = await moveStock(client, {
    warehouse_id: Number(opts.toWarehouseId), ingredient_id: Number(opts.ingredientId), delta: qty,
    ref_type: "transfer", ref_id: opts.refId, user: opts.user, notes: opts.notes || "تحويل وارد"
  });
  return { out, incoming, quantity: qty };
}

export function createMovementReference(prefix: string, id: number | string) {
  return `${prefix}-${id}-${randomUUID().slice(0, 8)}`;
}
