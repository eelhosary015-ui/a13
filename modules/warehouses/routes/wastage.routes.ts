import { Router, Request, Response } from "express";
import { pool } from "../../../server-db.js";

const router = Router();

// GET all wastage
router.get("/api/inventory-wastage", async (req: Request, res: Response) => {
  try {
    const { warehouse_id, wastage_type, status, search, date_from, date_to } = req.query;

    let query = `
      SELECT w.*, wh.name as warehouse_name, u.username as created_by_name, r.name_ar as reason_name,
        (SELECT COUNT(*) FROM inventory_wastage_items i WHERE i.wastage_id = w.id) as items_count
      FROM inventory_wastage w
      LEFT JOIN warehouses wh ON w.warehouse_id = wh.id
      LEFT JOIN users u ON w.created_by = u.id
      LEFT JOIN wastage_reasons r ON w.reason_id = r.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (warehouse_id) {
      params.push(Number(warehouse_id));
      query += ` AND w.warehouse_id = $${params.length}`;
    }
    if (wastage_type) {
      params.push(String(wastage_type));
      query += ` AND w.wastage_type = $${params.length}`;
    }
    if (status) {
      params.push(String(status));
      query += ` AND w.status = $${params.length}`;
    }
    if (search) {
      params.push(`%${search}%`);
      query += ` AND (w.wastage_number ILIKE $${params.length} OR w.notes ILIKE $${params.length})`;
    }
    if (date_from) {
      params.push(String(date_from));
      query += ` AND w.wastage_date >= $${params.length}`;
    }
    if (date_to) {
      params.push(String(date_to));
      query += ` AND w.wastage_date <= $${params.length}`;
    }

    query += ` ORDER BY w.created_at DESC`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error: any) {
    console.error("GET /api/inventory-wastage Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET single wastage
router.get("/api/inventory-wastage/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const wasteRes = await pool.query(`
      SELECT w.*, wh.name as warehouse_name, u.username as created_by_name, r.name_ar as reason_name
      FROM inventory_wastage w
      LEFT JOIN warehouses wh ON w.warehouse_id = wh.id
      LEFT JOIN users u ON w.created_by = u.id
      LEFT JOIN wastage_reasons r ON w.reason_id = r.id
      WHERE w.id = $1
    `, [id]);

    if (wasteRes.rows.length === 0) {
      return res.status(404).json({ error: "Wastage not found" });
    }
    const wastage = wasteRes.rows[0];

    const itemsRes = await pool.query(`
      SELECT i.*, p.name as product_name, p.unit
      FROM inventory_wastage_items i
      LEFT JOIN products p ON i.product_id = p.id
      WHERE i.wastage_id = $1
    `, [id]);
    
    wastage.items = itemsRes.rows;
    res.json(wastage);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET reasons
router.get("/api/wastage-reasons", async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`SELECT * FROM wastage_reasons WHERE is_active = true`);
    if (result.rows.length === 0) {
        return res.json([
            { id: 1, name_ar: 'تالف تخزين', type: 'storage' },
            { id: 2, name_ar: 'كسر', type: 'breakage' },
            { id: 3, name_ar: 'منتهي صلاحية', type: 'expired' },
            { id: 4, name_ar: 'هالك تصنيع', type: 'manufacturing' }
        ]);
    }
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST create wastage
router.post("/api/inventory-wastage", async (req: Request, res: Response) => {
  try {
    const { warehouse_id, wastage_type, reason_id, responsible_person, notes, status, items, total_value } = req.body;
    
    const created_by = 1; 

    const countRes = await pool.query(`SELECT COUNT(*) as count FROM inventory_wastage`);
    const nextId = Number(countRes.rows[0].count || 0) + 1;
    const wasteNo = `WST-${new Date().getFullYear()}-${String(nextId).padStart(4, '0')}`;

    const wasteResult = await pool.query(`
      INSERT INTO inventory_wastage 
      (wastage_number, warehouse_id, wastage_type, reason_id, responsible_person, notes, total_value, status, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [wasteNo, warehouse_id, wastage_type, reason_id, responsible_person, notes, total_value || 0, status || 'draft', created_by]);

    const waste = wasteResult.rows[0];

    for (const item of items) {
      await pool.query(`
        INSERT INTO inventory_wastage_items
        (wastage_id, product_id, current_qty, wastage_qty, unit_cost, total_cost)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [waste.id, item.product_id, item.current_qty, item.wastage_qty, item.unit_cost, item.total_cost]);
    }

    res.status(201).json(waste);
  } catch (error: any) {
    console.error("Create Wastage Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST approve wastage
router.post("/api/inventory-wastage/:id/approve", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    
    const wasteRes = await pool.query(`SELECT * FROM inventory_wastage WHERE id = $1`, [id]);
    if (wasteRes.rows.length === 0) return res.status(404).json({error: "Not found"});
    const waste = wasteRes.rows[0];
    
    if (waste.status === 'approved') return res.status(400).json({error: "Already approved"});

    const itemsRes = await pool.query(`SELECT * FROM inventory_wastage_items WHERE wastage_id = $1`, [id]);
    
    let totalExpense = 0;

    for (const item of itemsRes.rows) {
      const qty = Number(item.wastage_qty);
      totalExpense += Number(item.total_cost);
      
      const stockRes = await pool.query(`
        SELECT * FROM stock_balances WHERE warehouse_id = $1 AND product_id = $2
      `, [waste.warehouse_id, item.product_id]);

      if (stockRes.rows.length > 0) {
        await pool.query(`
          UPDATE stock_balances 
          SET quantity = quantity - $1 
          WHERE warehouse_id = $2 AND product_id = $3
        `, [qty, waste.warehouse_id, item.product_id]);
      } else {
        await pool.query(`
          INSERT INTO stock_balances (warehouse_id, product_id, quantity)
          VALUES ($1, $2, $3)
        `, [waste.warehouse_id, item.product_id, -qty]);
      }

      const txNum = `TX-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      await pool.query(`
        INSERT INTO inventory_transactions 
        (transaction_number, date, type, reason, notes, status, items, warehouse_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        txNum, 
        new Date().toISOString(), 
        'wastage', 
        `Wastage ${waste.wastage_number}`, 
        waste.notes, 
        'approved', 
        JSON.stringify([{
           ingredient_id: item.product_id, 
           quantity: qty,
           type: 'decrease'
        }]),
        waste.warehouse_id
      ]);
    }

    // Insert Accounting Entry (Draft logic for offline, simulating expense and inventory credit)
    const journalNo = `JE-WST-${Date.now()}`;
    await pool.query(`
        INSERT INTO journal_entries (date, description, reference, status, type)
        VALUES (CURRENT_DATE, $1, $2, 'posted', 'auto')
    `, [`Wastage Expense for ${waste.wastage_number}`, waste.wastage_number]);

    const result = await pool.query(`
      UPDATE inventory_wastage 
      SET status = 'approved', approved_at = CURRENT_TIMESTAMP
      WHERE id = $1 RETURNING *
    `, [id]);

    res.json(result.rows[0]);
  } catch (error: any) {
    console.error("Approve Wastage Error:", error);
    res.status(500).json({ error: error.message });
  }
});

export const wastageRouter = router;
