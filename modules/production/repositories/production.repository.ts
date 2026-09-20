import { erpPool } from "../../../server-erp-core.js";
import { 
  CreateProductionRunDTO, 
  ExecuteProductionOrderDTO, 
  CheckAvailabilityResponse, 
  CheckAvailabilityItemResult 
} from "../dto/production.dto.js";
import { applyStockMovement } from "../../warehouses/warehouses_api.routes.js";
import { UnitConversionService } from "../../common/services/unit_conversion.service.js";

export class ProductionRepository {
  private static initialized: boolean = false;
  private static initPromise: Promise<void> | null = null;

  constructor() {
    this.ensureTableExists();
  }

  private async ensureTableExists(): Promise<void> {
    if (ProductionRepository.initialized) return;
    if (ProductionRepository.initPromise) return ProductionRepository.initPromise;

    ProductionRepository.initPromise = (async () => {
      try {
        // 1. Production Runs Table
      await erpPool.query(`
        CREATE TABLE IF NOT EXISTS production_runs (
          id SERIAL PRIMARY KEY,
          order_number VARCHAR(100),
          product_id INTEGER,
          warehouse_id INTEGER,
          finished_warehouse_id INTEGER,
          quantity DECIMAL(12,2) NOT NULL,
          status TEXT DEFAULT 'completed',
          total_cost DECIMAL(12,2) DEFAULT 0,
          unit_cost DECIMAL(12,2) DEFAULT 0,
          bom_id TEXT,
          bom_snapshot TEXT,
          notes TEXT,
          executed_by TEXT,
          executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // 2. Production Orders Table
      await erpPool.query(`
        CREATE TABLE IF NOT EXISTS production_orders (
          id SERIAL PRIMARY KEY,
          order_number VARCHAR(100) UNIQUE NOT NULL,
          product_id VARCHAR(100) NOT NULL,
          product_name VARCHAR(255),
          quantity DECIMAL(12,2) NOT NULL DEFAULT 1,
          bom_id VARCHAR(100),
          raw_warehouse_id INTEGER,
          finished_warehouse_id INTEGER,
          start_date VARCHAR(50),
          end_date VARCHAR(50),
          priority VARCHAR(50) DEFAULT 'normal',
          status VARCHAR(50) DEFAULT 'planned',
          progress INTEGER DEFAULT 0,
          sales_reference VARCHAR(100),
          work_center_id VARCHAR(100),
          supervisor VARCHAR(100),
          notes TEXT,
          bom_snapshot TEXT,
          total_cost DECIMAL(12,2) DEFAULT 0,
          cost_per_unit DECIMAL(12,2) DEFAULT 0,
          executed_by VARCHAR(100),
          executed_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // 3. Production BOMs Table
      await erpPool.query(`
        CREATE TABLE IF NOT EXISTS production_boms (
          id VARCHAR(100) PRIMARY KEY,
          product_id VARCHAR(100) NOT NULL,
          name VARCHAR(255) NOT NULL,
          version VARCHAR(50) DEFAULT 'v1.0',
          scrap_percentage DECIMAL(5,2) DEFAULT 0,
          items_json TEXT NOT NULL,
          routings_json TEXT,
          total_cost DECIMAL(12,2) DEFAULT 0,
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Alter columns safely if they were created earlier
      try {
        await erpPool.query("ALTER TABLE production_runs ADD COLUMN IF NOT EXISTS order_number VARCHAR(100)");
        await erpPool.query("ALTER TABLE production_runs ADD COLUMN IF NOT EXISTS finished_warehouse_id INTEGER");
        await erpPool.query("ALTER TABLE production_runs ADD COLUMN IF NOT EXISTS total_cost DECIMAL(12,2) DEFAULT 0");
        await erpPool.query("ALTER TABLE production_runs ADD COLUMN IF NOT EXISTS unit_cost DECIMAL(12,2) DEFAULT 0");
        await erpPool.query("ALTER TABLE production_runs ADD COLUMN IF NOT EXISTS bom_id TEXT");
        await erpPool.query("ALTER TABLE production_runs ADD COLUMN IF NOT EXISTS bom_snapshot TEXT");
        await erpPool.query("ALTER TABLE production_runs ADD COLUMN IF NOT EXISTS executed_by TEXT");
        await erpPool.query("ALTER TABLE production_runs ADD COLUMN IF NOT EXISTS executed_at TIMESTAMP");
        await erpPool.query("ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS is_executed BOOLEAN DEFAULT false");
        await erpPool.query("ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS executed_by VARCHAR(100)");
        await erpPool.query("ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS executed_at TIMESTAMP");
        try {
          // Legacy databases may keep both BOM identifiers as INTEGER while the
          // production service accepts stable string IDs. Drop and restore the
          // FK around the coordinated type conversion.
          await erpPool.query("ALTER TABLE bom_items DROP CONSTRAINT IF EXISTS bom_items_bom_id_fkey");
          await erpPool.query("ALTER TABLE production_boms ALTER COLUMN id TYPE TEXT USING id::text");
          await erpPool.query("ALTER TABLE production_boms ALTER COLUMN version TYPE TEXT USING version::text");
          await erpPool.query("ALTER TABLE bom_items ALTER COLUMN bom_id TYPE TEXT USING bom_id::text");
          await erpPool.query("ALTER TABLE bom_items ADD CONSTRAINT bom_items_bom_id_fkey FOREIGN KEY (bom_id) REFERENCES production_boms(id) ON DELETE CASCADE");
        } catch (bomSchemaError: any) {
          console.error("[Production Schema] BOM identifier migration failed:", bomSchemaError?.message || bomSchemaError);
          throw bomSchemaError;
        }
        await erpPool.query("ALTER TABLE production_boms ADD COLUMN IF NOT EXISTS items_json TEXT");
        await erpPool.query("ALTER TABLE production_boms ADD COLUMN IF NOT EXISTS routings_json TEXT");
        try { await erpPool.query("ALTER TABLE bom_items ALTER COLUMN bom_id TYPE TEXT"); } catch (_) {}
        await erpPool.query("ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS reserved DECIMAL(14,4) DEFAULT 0");
        await erpPool.query("ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS in_transit DECIMAL(14,4) DEFAULT 0");
        await erpPool.query("ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS available DECIMAL(14,4) DEFAULT 0");
        await erpPool.query("UPDATE inventory_items SET available = GREATEST(COALESCE(quantity,0) - COALESCE(reserved,0), 0)");
        
        await erpPool.query("ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS code TEXT");
        await erpPool.query("ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS item_code TEXT");
        await erpPool.query("ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS category TEXT");
        await erpPool.query("ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS avg_cost DECIMAL(14,4) DEFAULT 0");
        await erpPool.query("ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS last_purchase_price DECIMAL(14,4) DEFAULT 0");
        await erpPool.query("ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS current_stock DECIMAL(14,4) DEFAULT 0");
        await erpPool.query("ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS min_stock DECIMAL(12,3) DEFAULT 0");
        await erpPool.query("ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS is_manufactured INTEGER DEFAULT 0");
        await erpPool.query("ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS avg_cost DECIMAL(14,4) DEFAULT 0");
        await erpPool.query("ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS cost DECIMAL(14,4) DEFAULT 0");
        // The production sync must use the actual products schema. Some older
        // databases have neither `active` nor `is_active`; create the canonical
        // column once and never write to the obsolete `active` column.
        try { await erpPool.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true"); } catch (_) {}

        // IMPORTANT: repair legacy INTEGER cost/quantity columns instead of merely
        // adding missing columns. PostgreSQL error 22P02 occurs when a decimal such
        // as 10.15 is sent to an INTEGER column. The helper also removes an old
        // incompatible default before changing the type, then restores a numeric
        // default. Each column is repaired independently so one legacy column cannot
        // prevent the remaining production schema repairs from running.
        const repairDecimalColumn = async (table: string, column: string, precision: string, defaultValue = '0') => {
          try {
            await erpPool.query(`ALTER TABLE ${table} ALTER COLUMN ${column} DROP DEFAULT`);
          } catch (_) {}
          try {
            await erpPool.query(
              `ALTER TABLE ${table} ALTER COLUMN ${column} TYPE NUMERIC(${precision}) USING COALESCE(NULLIF(TRIM(${column}::text), ''), '0')::numeric`
            );
          } catch (err: any) {
            console.error(`[Production Schema] Failed to convert ${table}.${column} to NUMERIC:`, err?.message || err);
            throw err;
          }
          try {
            await erpPool.query(`ALTER TABLE ${table} ALTER COLUMN ${column} SET DEFAULT ${defaultValue}`);
          } catch (_) {}
        };

        for (const [table, column, precision] of [
          ['ingredients', 'cost', '14,4'],
          ['ingredients', 'avg_cost', '14,4'],
          ['ingredients', 'last_purchase_price', '14,4'],
          ['ingredients', 'current_stock', '14,4'],
          ['ingredients', 'min_stock', '12,3'],
          ['inventory_items', 'quantity', '14,4'],
          ['inventory_items', 'min_quantity', '14,4'],
          ['inventory_items', 'reserved', '14,4'],
          ['inventory_items', 'in_transit', '14,4'],
          ['inventory_items', 'available', '14,4'],
          ['inventory_items', 'avg_cost', '14,4'],
          ['inventory_items', 'cost', '14,4']
        ] as const) {
          // Repair each legacy column independently. One optional legacy column
          // must never prevent the remaining production schema from being fixed.
          try { await repairDecimalColumn(table, column, precision); } catch (err: any) {
            console.warn(`[Production Schema] Skipped ${table}.${column}:`, err?.message || err);
          }
        }
      } catch (_) {}

      ProductionRepository.initialized = true;
    } catch (err: any) {
      console.error("Failed to ensure production tables exist:", err.message);
    } finally {
      ProductionRepository.initPromise = null;
    }
    })();
    return ProductionRepository.initPromise;
  }

  // ─────────────────────────────────────────────────────────────
  // PRODUCTION RUNS
  // ─────────────────────────────────────────────────────────────
  async getAll(): Promise<any[]> {
    await this.ensureTableExists();
    const query = `
      SELECT pr.*, p.name as product_name, w.name as warehouse_name, fw.name as finished_warehouse_name
      FROM production_runs pr
      LEFT JOIN products p ON pr.product_id = p.id
      LEFT JOIN warehouses w ON pr.warehouse_id = w.id
      LEFT JOIN warehouses fw ON pr.finished_warehouse_id = fw.id
      ORDER BY pr.created_at DESC
    `;
    const result = await erpPool.query(query);
    return result.rows;
  }

  async findById(id: number): Promise<any> {
    await this.ensureTableExists();
    const query = `
      SELECT pr.*, p.name as product_name, w.name as warehouse_name, fw.name as finished_warehouse_name
      FROM production_runs pr
      LEFT JOIN products p ON pr.product_id = p.id
      LEFT JOIN warehouses w ON pr.warehouse_id = w.id
      LEFT JOIN warehouses fw ON pr.finished_warehouse_id = fw.id
      WHERE pr.id = $1
    `;
    const result = await erpPool.query(query, [id]);
    return result.rows.length > 0 ? result.rows[0] : null;
  }

  // ─────────────────────────────────────────────────────────────
  // BOM / RECIPES REPOSITORY
  // ─────────────────────────────────────────────────────────────
  async getBOMs(): Promise<any[]> {
    await this.ensureTableExists();
    try {
      const res = await erpPool.query("SELECT * FROM production_boms ORDER BY created_at DESC");
      if (res.rows.length > 0) {
        return res.rows.map((row: any) => ({
          id: row.id,
          productId: row.product_id,
          name: row.name,
          version: row.version,
          scrapPercentage: parseFloat(row.scrap_percentage) || 0,
          totalCost: parseFloat(row.total_cost) || 0,
          items: typeof row.items_json === 'string' ? JSON.parse(row.items_json || '[]') : (row.items_json || []),
          routings: typeof row.routings_json === 'string' ? JSON.parse(row.routings_json || '[]') : (row.routings_json || [])
        }));
      }
    } catch (e) {
      console.warn("Failed to query production_boms from database, using fallback:", e);
    }
    return [];
  }

  async saveBOM(bom: any): Promise<any> {
    await this.ensureTableExists();
    const bomId = bom.id || `bom-${Date.now()}`;
    const itemsJson = JSON.stringify(bom.items || []);
    const routingsJson = JSON.stringify(bom.routings || []);
    const scrap = Number(bom.scrapPercentage) || 0;
    const totalCost = Number(bom.totalCost) || 0;

    const query = `
      INSERT INTO production_boms (id, product_id, product_name, name, version, scrap_percentage, items_json, routings_json, total_cost)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (id)
      DO UPDATE SET
        product_id = EXCLUDED.product_id,
        product_name = EXCLUDED.product_name,
        name = EXCLUDED.name,
        version = EXCLUDED.version,
        scrap_percentage = EXCLUDED.scrap_percentage,
        items_json = EXCLUDED.items_json,
        routings_json = EXCLUDED.routings_json,
        total_cost = EXCLUDED.total_cost,
        updated_at = NOW()
      RETURNING *
    `;

    const res = await erpPool.query(query, [
      bomId,
      String(bom.productId || ''),
      bom.productName || bom.name || 'منتج تصنيع',
      bom.name || 'وصفة تصنيع',
      bom.version || 'v1.0',
      scrap,
      itemsJson,
      routingsJson,
      totalCost
    ]);

    // Also sync the legacy bom_items table so the costing engine and other modules can count ingredients
    try {
      await erpPool.query("DELETE FROM bom_items WHERE bom_id = $1", [bomId]);
      let sortOrder = 1;
      for (const item of (bom.items || [])) {
        const materialId = parseInt(String(item.materialId).replace(/[^0-9]/g, ''));
        if (!isNaN(materialId) && materialId > 0) {
          await erpPool.query(
            `INSERT INTO bom_items (bom_id, ingredient_id, quantity, unit, unit_cost, total_cost, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              bomId,
              materialId,
              Number(item.quantity) || 0,
              item.unit || 'وحدة',
              Number(item.unitCost) || 0,
              Number(item.totalCost) || 0,
              sortOrder++
            ]
          );
        }
      }
    } catch (e) {
      console.warn("Failed to sync bom_items:", e);
    }

    // Also sync with product_ingredients for backward compatibility with restaurant/recipes module
    const numericProdId = parseInt(String(bom.productId).replace(/[^0-9]/g, ''));
    if (!isNaN(numericProdId) && numericProdId > 0 && Array.isArray(bom.items)) {
      try {
        await erpPool.query("DELETE FROM product_ingredients WHERE product_id = $1", [numericProdId]);
        for (const it of bom.items) {
          const ingId = parseInt(String(it.materialId).replace(/[^0-9]/g, ''));
          if (!isNaN(ingId) && ingId > 0) {
            await erpPool.query(
              "INSERT INTO product_ingredients (product_id, ingredient_id, quantity, waste_percent, size_name) VALUES ($1, $2, $3, $4, $5)",
              [numericProdId, ingId, Number(it.quantity) || 1, scrap, '']
            );
          }
        }
      } catch (err) {
        console.warn("Could not sync product_ingredients:", err);
      }
    }

    return res.rows[0] || bom;
  }

  // ─────────────────────────────────────────────────────────────
  // PRODUCTION ORDERS REPOSITORY
  // ─────────────────────────────────────────────────────────────
  async getOrders(): Promise<any[]> {
    await this.ensureTableExists();
    try {
      const res = await erpPool.query("SELECT * FROM production_orders ORDER BY created_at DESC");
      if (res.rows.length > 0) {
        return res.rows.map((row: any) => ({
          id: String(row.id),
          orderNumber: row.order_number,
          productId: row.product_id,
          productName: row.product_name,
          quantity: parseFloat(row.quantity) || 0,
          bomId: row.bom_id,
          rawWarehouseId: row.raw_warehouse_id,
          finishedWarehouseId: row.finished_warehouse_id,
          startDate: row.start_date,
          endDate: row.end_date,
          priority: row.priority,
          status: row.status,
          progress: parseInt(row.progress) || 0,
          salesReference: row.sales_reference,
          workCenterId: row.work_center_id,
          supervisor: row.supervisor,
          notes: row.notes,
          bomSnapshot: typeof row.bom_snapshot === 'string' ? JSON.parse(row.bom_snapshot || '{}') : (row.bom_snapshot || {}),
          totalCost: parseFloat(row.total_cost) || 0,
          costPerUnit: parseFloat(row.cost_per_unit) || 0,
          executedBy: row.executed_by,
          executedAt: row.executed_at,
          createdAt: row.created_at
        }));
      }
    } catch (e) {
      console.warn("Failed to load production_orders from database, checking settings:", e);
    }
    return [];
  }

  async saveOrder(order: any): Promise<any> {
    await this.ensureTableExists();
    const orderNumber = order.orderNumber || `PRD-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`;
    const snapshotStr = JSON.stringify(order.bomSnapshot || {});
    const qty = Number(order.quantity) || 1;
    const totalCost = Number(order.totalCost) || 0;
    const costPerUnit = qty > 0 ? totalCost / qty : 0;

    const query = `
      INSERT INTO production_orders (
        order_number, product_id, product_name, quantity, bom_id,
        raw_warehouse_id, finished_warehouse_id, start_date, end_date,
        priority, status, progress, sales_reference, work_center_id,
        supervisor, notes, bom_snapshot, total_cost, cost_per_unit
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      ON CONFLICT (order_number)
      DO UPDATE SET
        product_id = EXCLUDED.product_id,
        product_name = EXCLUDED.product_name,
        quantity = EXCLUDED.quantity,
        bom_id = EXCLUDED.bom_id,
        raw_warehouse_id = EXCLUDED.raw_warehouse_id,
        finished_warehouse_id = EXCLUDED.finished_warehouse_id,
        start_date = EXCLUDED.start_date,
        end_date = EXCLUDED.end_date,
        priority = EXCLUDED.priority,
        status = EXCLUDED.status,
        progress = EXCLUDED.progress,
        sales_reference = EXCLUDED.sales_reference,
        work_center_id = EXCLUDED.work_center_id,
        supervisor = EXCLUDED.supervisor,
        notes = EXCLUDED.notes,
        bom_snapshot = EXCLUDED.bom_snapshot,
        total_cost = EXCLUDED.total_cost,
        cost_per_unit = EXCLUDED.cost_per_unit,
        updated_at = NOW()
      RETURNING *
    `;

    const res = await erpPool.query(query, [
      orderNumber,
      String(order.productId || ''),
      order.productName || '',
      qty,
      order.bomId || '',
      order.rawWarehouseId || null,
      order.finishedWarehouseId || null,
      order.startDate || '',
      order.endDate || '',
      order.priority || 'normal',
      order.status || 'planned',
      order.progress || 0,
      order.salesReference || '',
      order.workCenterId || '',
      order.supervisor || '',
      order.notes || '',
      snapshotStr,
      totalCost,
      costPerUnit
    ]);

    return res.rows[0];
  }

  // ─────────────────────────────────────────────────────────────
  // CHECK MATERIAL AVAILABILITY IN REAL-TIME
  // ─────────────────────────────────────────────────────────────
  async checkAvailability(
    productId: string | number,
    bomId: string | undefined,
    quantity: number,
    rawWarehouseId: number
  ): Promise<CheckAvailabilityResponse> {
    await this.ensureTableExists();
    const qty = Math.max(1, Number(quantity) || 1);

    // 1. Get warehouse name
    const whRes = await erpPool.query("SELECT name FROM warehouses WHERE id = $1", [rawWarehouseId]);
    const rawWarehouseName = whRes.rows[0]?.name || `مخزن #${rawWarehouseId}`;

    // 2. Resolve Product Details
    let productName = `منتج #${productId}`;
    const prodRes = await erpPool.query(
      "SELECT id, name, code, unit, cost, price FROM products WHERE id::text = $1::text OR code::text = $1::text",
      [String(productId)]
    );
    if (prodRes.rows.length > 0) {
      productName = prodRes.rows[0].name;
    }

    // 3. Resolve BOM and items
    let bomItems: Array<{ materialId: any; quantity: number }> = [];
    let scrapPercentage = 0;

    if (bomId) {
      const bomRes = await erpPool.query("SELECT * FROM production_boms WHERE id::text = $1::text", [String(bomId)]);
      if (bomRes.rows.length > 0) {
        const b = bomRes.rows[0];
        scrapPercentage = parseFloat(b.scrap_percentage) || 0;
        if (b.items_json) {
          try { bomItems = typeof b.items_json === 'string' ? JSON.parse(b.items_json) : (b.items_json || []); } catch (_) { bomItems = []; }
        }
        // Legacy/enterprise schema stores BOM lines in bom_items instead of items_json.
        if (!Array.isArray(bomItems) || bomItems.length === 0) {
          const biRes = await erpPool.query(
            `SELECT bi.ingredient_id, bi.quantity, bi.unit, bi.unit_cost, i.name AS ingredient_name,
                    i.code AS ingredient_code
             FROM bom_items bi
             LEFT JOIN ingredients i ON i.id = bi.ingredient_id
             WHERE bi.bom_id::text = $1::text
             ORDER BY bi.sort_order, bi.id`,
            [String(b.id)]
          );
          bomItems = biRes.rows.map((r: any) => ({
            materialId: r.ingredient_id,
            ingredientId: r.ingredient_id,
            materialName: r.ingredient_name,
            code: r.ingredient_code,
            quantity: Number(r.quantity) || 0,
            quantityPerUnit: Number(r.quantity) || 0,
            unit: r.unit,
            unitCost: Number(r.unit_cost) || 0
          }));
        }
      }
    }

    // If no BOM items found yet, check by product_id
    if (bomItems.length === 0) {
      const bomByProd = await erpPool.query("SELECT * FROM production_boms WHERE product_id::text = $1::text LIMIT 1", [String(productId)]);
      if (bomByProd.rows.length > 0) {
        const b = bomByProd.rows[0];
        scrapPercentage = parseFloat(b.scrap_percentage) || 0;
        if (b.items_json) {
          try { bomItems = typeof b.items_json === 'string' ? JSON.parse(b.items_json) : (b.items_json || []); } catch (_) { bomItems = []; }
        }
        if (!Array.isArray(bomItems) || bomItems.length === 0) {
          const biRes = await erpPool.query(
            `SELECT bi.ingredient_id, bi.quantity, bi.unit, bi.unit_cost, i.name AS ingredient_name,
                    i.code AS ingredient_code
             FROM bom_items bi
             LEFT JOIN ingredients i ON i.id = bi.ingredient_id
             WHERE bi.bom_id::text = $1::text
             ORDER BY bi.sort_order, bi.id`,
            [String(b.id)]
          );
          bomItems = biRes.rows.map((r: any) => ({
            materialId: r.ingredient_id,
            ingredientId: r.ingredient_id,
            materialName: r.ingredient_name,
            code: r.ingredient_code,
            quantity: Number(r.quantity) || 0,
            quantityPerUnit: Number(r.quantity) || 0,
            unit: r.unit,
            unitCost: Number(r.unit_cost) || 0
          }));
        }
      }
    }

    // If still no items, fallback to product_ingredients
    if (bomItems.length === 0 && prodRes.rows.length > 0) {
      const numProdId = prodRes.rows[0].id;
      const piRes = await erpPool.query("SELECT ingredient_id, quantity, waste_percent FROM product_ingredients WHERE product_id::text = $1::text", [String(numProdId)]);
      if (piRes.rows.length > 0) {
        bomItems = piRes.rows.map((r: any) => ({
          materialId: r.ingredient_id,
          quantity: parseFloat(r.quantity) || 1
        }));
        scrapPercentage = parseFloat(piRes.rows[0].waste_percent) || 0;
      }
    }

    // 4. Fetch all ingredients to cross-reference
    const allIngredientsRes = await erpPool.query("SELECT id, name, code, item_code, unit, cost, avg_cost, last_purchase_price FROM ingredients");
    const ingredientsList = allIngredientsRes.rows;

    // 5. Fetch current stock in the rawWarehouseId (aggregating across all locations/rows in warehouse)
    const stockRes = await erpPool.query(`
      SELECT 
        ingredient_id, 
        COALESCE(SUM(quantity), 0) AS total_quantity, 
        COALESCE(SUM(reserved), 0) AS total_reserved,
        COALESCE(SUM(GREATEST(COALESCE(quantity, 0) - COALESCE(reserved, 0), 0)), 0) AS total_available
      FROM inventory_items 
      WHERE warehouse_id = $1 
      GROUP BY ingredient_id
    `, [rawWarehouseId]);
    const stockMap: Record<number, number> = {};
    stockRes.rows.forEach((row: any) => {
      const ingId = Number(row.ingredient_id);
      const quantityInWarehouse = Number(row.total_quantity) || 0;
      const reserved = Number(row.total_reserved) || 0;
      const totalAvailable = Number(row.total_available);
      const effectiveAvail = Number.isFinite(totalAvailable) && totalAvailable > 0
        ? totalAvailable
        : Math.max(quantityInWarehouse - reserved, 0);
      stockMap[ingId] = (stockMap[ingId] || 0) + effectiveAvail;
    });

    // 6. Calculate requirements and availability for each raw material
    const itemsResult: CheckAvailabilityItemResult[] = [];
    let totalMaterialCost = 0;
    let missingCount = 0;

    for (const item of bomItems) {
      // Find matching ingredient by specific fields (prioritize ingredientId / materialId / code / name)
      // NEVER use BOM item row index 'id' as an ingredient id.
      const explicitIngId = (item as any).ingredient_id ?? (item as any).ingredientId;
      const matIdRef = (item as any).material_id ?? (item as any).materialId ?? (item as any).materialCode ?? '';
      const itemCodeRef = String((item as any).code ?? (item as any).ingredientCode ?? (item as any).item_code ?? matIdRef ?? '').trim();
      const itemNameRef = String((item as any).materialName ?? (item as any).ingredientName ?? (item as any).name ?? '').trim();

      const normalizedName = itemNameRef.toLowerCase().replace(/\s+/g, ' ');
      const normalizedCode = itemCodeRef.toLowerCase();
      const cleanCode = normalizedCode.replace(/^item-/, '');

      const ing = ingredientsList.find((g: any) => {
        if (explicitIngId != null && Number(g.id) === Number(explicitIngId)) return true;
        const gName = String(g.name || '').trim().toLowerCase().replace(/\s+/g, ' ');
        const gCode = String(g.code || '').trim().toLowerCase();
        const gItemCode = String(g.item_code || '').trim().toLowerCase();
        const gCleanCode = gCode.replace(/^item-/, '') || gItemCode.replace(/^item-/, '');
        
        if (normalizedCode && (gCode === normalizedCode || gItemCode === normalizedCode || (cleanCode && gCleanCode === cleanCode))) {
          return true;
        }
        if (matIdRef && (String(g.id) === String(matIdRef) || gCode === String(matIdRef).toLowerCase())) {
          return true;
        }
        if (normalizedName && gName === normalizedName) {
          return true;
        }
        return false;
      });

      const ingredientId = ing ? Number(ing.id) : (Number(explicitIngId) || 0);
      const ingredientName = ing?.name || itemNameRef || `خامة #${ingredientId || itemCodeRef || '-'}`;
      const ingredientCode = ing ? (ing.code || ing.item_code || `ITEM-${ingredientId}`) : (itemCodeRef || `ITEM-${ingredientId}`);
      const recipeUnit = (item as any).unit || (item as any).recipe_unit || ing?.unit || 'وحدة';
      const baseUnit = ing?.unit || recipeUnit;
      const baseUnitCost = ing ? (parseFloat(ing.avg_cost) || parseFloat(ing.cost) || parseFloat(ing.last_purchase_price) || 0) : 0;

      const qtyPerUnit = Number(item.quantity ?? (item as any).quantityPerUnit ?? (item as any).requiredPerUnit ?? 0) || 0;
      // Deduct and require the exact recipe quantity without any scrap markup
      const totalRequiredRecipeQty = Math.round(qtyPerUnit * qty * 1000000) / 1000000;

      // ── UNIVERSAL UNIT CONVERSION TO WAREHOUSE BASE UNIT ──
      const conversion = await UnitConversionService.convertItemQuantity(erpPool, {
        ingredientId,
        quantity: totalRequiredRecipeQty,
        fromUnit: recipeUnit,
        toUnit: baseUnit,
        context: 'consumption'
      });

      const totalRequiredBaseQty = conversion.success ? conversion.toQuantity : totalRequiredRecipeQty;
      const recipeUnitCost = Math.round((baseUnitCost / (conversion.factor || 1)) * 10000) / 10000;
      const itemCost = Math.round(totalRequiredBaseQty * baseUnitCost * 100) / 100;

      // IMPORTANT: production availability is warehouse-specific.
      // Stock is stored in baseUnit in the warehouse.
      let currentStock = stockMap[ingredientId];
      if (currentStock === undefined || currentStock === null || Number.isNaN(Number(currentStock))) {
        currentStock = 0;
      }

      const remainingStock = Math.round((currentStock - totalRequiredBaseQty) * 10000) / 10000;
      const isAvailable = currentStock >= totalRequiredBaseQty;
      const shortage = isAvailable ? 0 : Math.round((totalRequiredBaseQty - currentStock) * 10000) / 10000;

      totalMaterialCost += itemCost;
      if (!isAvailable) missingCount++;

      itemsResult.push({
        ingredientId,
        ingredientCode,
        ingredientName,
        unit: recipeUnit,
        recipeUnit,
        baseUnit,
        quantityPerUnit: qtyPerUnit,
        totalRequiredQty: totalRequiredRecipeQty,
        totalRequiredBaseQty,
        currentStock,
        remainingStock,
        unitCost: recipeUnitCost,
        baseUnitCost,
        totalCost: itemCost,
        isAvailable,
        shortage,
        conversionFactor: conversion.factor,
        conversionEquation: conversion.explanation,
        rawWarehouseId,
        rawWarehouseName
      });
    }

    totalMaterialCost = Math.round(totalMaterialCost * 100) / 100;
    const costPerUnit = qty > 0 ? Math.round((totalMaterialCost / qty) * 100) / 100 : 0;

    return {
      canProduce: missingCount === 0,
      productId,
      productName,
      quantity: qty,
      rawWarehouseId,
      rawWarehouseName,
      totalMaterialCost,
      costPerUnit,
      // Return the canonical fields plus legacy aliases consumed by older
      // production-sheet builds. Keeping both prevents a valid warehouse
      // balance from being rendered as 0 or the material id as its name.
      items: itemsResult.map((it: any) => ({
        ...it,
        materialId: it.ingredientId,
        materialName: it.ingredientName,
        code: it.ingredientCode,
        requiredPerUnit: it.quantityPerUnit,
        totalQuantityWithScrap: it.totalRequiredQty,
        currentStock: it.currentStock,
        unitCost: it.unitCost,
        totalItemCost: it.totalCost
      })),
      missingCount
    };
  }

  // ─────────────────────────────────────────────────────────────
  // EXECUTE PRODUCTION ORDER (SINGLE ATOMIC TRANSACTION)
  // ─────────────────────────────────────────────────────────────
  async executeProductionOrder(dto: ExecuteProductionOrderDTO): Promise<any> {
    await this.ensureTableExists();

    const client = await erpPool.connect();
    try {
      await client.query("BEGIN");

      // 1. Fetch Order Record
      let order: any = null;
      if (dto.orderId) {
        const ordRes = await client.query("SELECT * FROM production_orders WHERE id::text = $1::text OR order_number::text = $1::text LIMIT 1", [String(dto.orderId)]);
        if (ordRes.rows.length > 0) order = ordRes.rows[0];
      } else if (dto.orderNumber) {
        const ordRes = await client.query("SELECT * FROM production_orders WHERE order_number = $1 LIMIT 1", [dto.orderNumber]);
        if (ordRes.rows.length > 0) order = ordRes.rows[0];
      }

      // The production order MUST exist in the relational database before any
      // inventory movement is posted. Older builds could keep the order only
      // in localStorage/settings, which made execution non-deterministic.
      // If the client has supplied a complete order payload, persist it now;
      // otherwise fail before touching inventory.
      if (!order) {
        const orderNumber = String(dto.orderNumber || '').trim();
        const productId = String(dto.productId || '').trim();
        const quantity = Number(dto.quantity);
        if (!orderNumber || !productId || !Number.isFinite(quantity) || quantity <= 0) {
          throw new Error(`أمر الإنتاج غير محفوظ في قاعدة البيانات، ولا يمكن ترحيله بدون رقم أمر ومنتج وكمية صحيحة.`);
        }

        const upsertRes = await client.query(
          `INSERT INTO production_orders (
             order_number, product_id, product_name, quantity, bom_id,
             raw_warehouse_id, finished_warehouse_id, status, progress,
             notes, bom_snapshot
           )
           VALUES ($1,$2,$3,$4,$5,$6,$7,'planned',0,$8,$9)
           ON CONFLICT (order_number) DO UPDATE SET
             product_id = EXCLUDED.product_id,
             product_name = COALESCE(NULLIF(EXCLUDED.product_name,''), production_orders.product_name),
             quantity = EXCLUDED.quantity,
             raw_warehouse_id = COALESCE(EXCLUDED.raw_warehouse_id, production_orders.raw_warehouse_id),
             finished_warehouse_id = COALESCE(EXCLUDED.finished_warehouse_id, production_orders.finished_warehouse_id),
             notes = COALESCE(EXCLUDED.notes, production_orders.notes),
             bom_snapshot = CASE
               WHEN EXCLUDED.bom_snapshot IS NOT NULL AND EXCLUDED.bom_snapshot <> '{}' THEN EXCLUDED.bom_snapshot
               ELSE production_orders.bom_snapshot
             END,
             updated_at = NOW()
           RETURNING *`,
          [
            orderNumber,
            productId,
            String(dto.productName || ''),
            quantity,
            '',
            Number(dto.rawWarehouseId) || null,
            Number(dto.finishedWarehouseId) || null,
            dto.notes || '',
            '{}'
          ]
        );
        order = upsertRes.rows[0] || null;
      }

      if (!order) {
        throw new Error(`تعذر حفظ أمر الإنتاج [${dto.orderNumber || dto.orderId}] في قاعدة البيانات.`);
      }

      // Serialize execution attempts for the same production order, then lock the actual DB row.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [String(order.order_number)]);
      const lockedOrderRes = await client.query(
        "SELECT * FROM production_orders WHERE order_number = $1 FOR UPDATE",
        [String(order.order_number)]
      );
      if (lockedOrderRes.rows.length > 0) order = lockedOrderRes.rows[0];

      // 2. IDEMPOTENCY CHECK - Prevent Double Execution
      if (order.status === 'completed' || order.is_executed || order.isExecuted) {
        throw new Error(`أمر الإنتاج رقم [${order.order_number}] مكتمل ومرحل بالفعل إلى المخازن مسبقاً، لا يمكن إعادة تنفيذه أو بدء تشغيله مرة أخرى منعاً لتكرار الصرف وازدواجية القيود.`);
      }

      // Also check production_runs table if a run for this orderNumber already exists
      const existingRun = await client.query(
        "SELECT id, created_at FROM production_runs WHERE order_number = $1 LIMIT 1",
        [order.order_number]
      );
      if (existingRun.rows.length > 0) {
        throw new Error(`أمر الإنتاج رقم [${order.order_number}] تم ترحيله مسبقاً (سند تشغيل رقم: ${existingRun.rows[0].id}). لا يمكن إعادة الترحيل.`);
      }

      const orderNumber = order.order_number;
      const parsedOrderReference = parseInt(orderNumber.replace(/[^0-9]/g, ''), 10);
      const orderNumericRef = Number(order.id) > 0
        ? Number(order.id)
        : (Number.isFinite(parsedOrderReference) ? parsedOrderReference % 2147483647 : 0);

      // The production order is permanently linked to its issue warehouse.
      // Never silently switch the source warehouse at execution time.
      const storedRawWarehouseId = Number(order.raw_warehouse_id || 0);
      const requestedRawWarehouseId = Number(dto.rawWarehouseId || 0);
      if (storedRawWarehouseId > 0 && requestedRawWarehouseId > 0 && storedRawWarehouseId !== requestedRawWarehouseId) {
        throw new Error(`مخزن صرف الخامات لأمر الإنتاج [${orderNumber}] هو المخزن رقم ${storedRawWarehouseId}، ولا يمكن تنفيذ الأمر من مخزن صرف مختلف.`);
      }
      const rawWarehouseId = storedRawWarehouseId || requestedRawWarehouseId;
      const finishedWarehouseId = Number(order.finished_warehouse_id || dto.finishedWarehouseId || rawWarehouseId);
      const producedQty = parseFloat(order.quantity) || 1;
      const user = dto.user || "مسؤول الإنتاج";

      if (!rawWarehouseId || !finishedWarehouseId) {
        throw new Error("يجب تحديد كل من مخزن صرف المواد الخام ومخزن استلام المنتج النهائي.");
      }

      const warehouseRes = await client.query(
        "SELECT id, name FROM warehouses WHERE id = ANY($1::int[])",
        [[rawWarehouseId, finishedWarehouseId]]
      );
      const warehouseIdsFound = new Set(warehouseRes.rows.map((r: any) => Number(r.id)));
      if (!warehouseIdsFound.has(rawWarehouseId)) {
        throw new Error(`مخزن صرف المواد الخام رقم ${rawWarehouseId} غير موجود.`);
      }
      if (!warehouseIdsFound.has(finishedWarehouseId)) {
        throw new Error(`مخزن استلام المنتج النهائي رقم ${finishedWarehouseId} غير موجود.`);
      }

      // 3. Resolve BOM and Snapshot Materials
      let snapshotItems: any[] = [];
      let scrapPercentage = 0;

      if (order.bom_snapshot) {
        try {
          const snap = typeof order.bom_snapshot === 'string' ? JSON.parse(order.bom_snapshot) : order.bom_snapshot;
          if (Array.isArray(snap.items) && snap.items.length > 0) {
            snapshotItems = snap.items;
            scrapPercentage = snap.scrapPercentage || 0;
          }
        } catch (e) {}
      }

      // Fallback: check availability engine to compute current BOM items
      if (snapshotItems.length === 0) {
        const avail = await this.checkAvailability(order.product_id, order.bom_id, producedQty, rawWarehouseId);
        snapshotItems = avail.items.map(it => ({
          materialId: it.ingredientId,
          ingredientId: it.ingredientId,
          materialName: it.ingredientName,
          quantityPerUnit: it.quantityPerUnit,
          totalRequiredQty: it.totalRequiredQty,
          unit: it.unit,
          unitCost: it.unitCost,
          totalCost: it.totalCost
        }));
      }

      // Pre-resolve all snapshot items to actual database ingredients in warehouse
      const allIngredientsRes = await client.query("SELECT id, name, code, item_code, unit, cost, avg_cost, last_purchase_price, current_stock FROM ingredients");
      const ingredientsList = allIngredientsRes.rows;

      const resolvedItems: any[] = [];
      for (const item of snapshotItems) {
        const matIdStr = String(item.materialId || item.ingredientId || '').trim();
        const matName = String(item.materialName || item.name || '').trim();
        const matCode = String(item.code || item.ingredientCode || item.item_code || '').trim();

        let ing = ingredientsList.find((g: any) => {
          const gIdStr = String(g.id || '').trim();
          const gCode = String(g.code || g.item_code || '').trim().toLowerCase();
          const gName = String(g.name || '').trim().toLowerCase();

          if (item.ingredientId && Number(g.id) === Number(item.ingredientId)) return true;
          if (matIdStr && gIdStr === matIdStr) return true;
          if (matCode && gCode && gCode === matCode.toLowerCase()) return true;
          if (matIdStr && gCode && gCode === matIdStr.toLowerCase()) return true;
          if (matName && gName && gName === matName.toLowerCase()) return true;
          if (matName && gName && (gName.includes(matName.toLowerCase()) || matName.toLowerCase().includes(gName))) return true;
          return false;
        });

        // A production execution must never invent a new raw material. A missing
        // master-data link is a configuration error and must be reported before
        // inventory is touched.
        const ingId = ing ? Number(ing.id) : (parseInt(matIdStr.replace(/[^0-9]/g, '')) || 0);
        const name = item.materialName || item.name || (ing ? ing.name : `خامة #${matIdStr}`);
        const recipeUnit = item.unit || (item as any).recipe_unit || (ing ? ing.unit : 'وحدة') || 'وحدة';
        const baseUnit = (ing ? ing.unit : recipeUnit) || recipeUnit;
        const baseUnitCost = ing ? (parseFloat(ing.avg_cost) || parseFloat(ing.cost) || parseFloat(ing.last_purchase_price) || 0) : (Number(item.unitCost) || 0);

        const perUnitQty = Number(item.quantityPerUnit ?? item.requiredPerUnit ?? item.quantity ?? 0);
        const exactRecipeQty = Math.round(perUnitQty * producedQty * 1000000) / 1000000;
        // The user strictly wants to deduct from warehouse the exact value in the recipe converted to base unit
        const reqRecipeQty = (perUnitQty > 0 && producedQty > 0)
          ? exactRecipeQty
          : (Number(item.totalRequiredQty ?? item.totalQuantityWithScrap ?? 0) || exactRecipeQty);

        if (!ing || ingId <= 0 || !Number.isFinite(reqRecipeQty) || reqRecipeQty <= 0) {
          throw new Error(
            `تعذر ربط خامة أمر الإنتاج [${orderNumber}] بالمادة الخام في دليل الأصناف. ` +
            `راجع وصفة التصنيع وتأكد أن كل خامة مرتبطة بصنف خام صحيح.`
          );
        }

        // Convert recipe quantity to warehouse base unit
        const conversion = await UnitConversionService.convertItemQuantity(client, {
          ingredientId: ingId,
          quantity: reqRecipeQty,
          fromUnit: recipeUnit,
          toUnit: baseUnit,
          context: 'consumption'
        });

        const reqBaseQty = conversion.success ? conversion.toQuantity : reqRecipeQty;
        const recipeUnitCost = Math.round((baseUnitCost / (conversion.factor || 1)) * 10000) / 10000;
        const itemTotalCost = Math.round(reqBaseQty * baseUnitCost * 100) / 100;

        resolvedItems.push({
          ...item,
          ingredientId: ingId,
          materialId: ingId,
          materialName: name,
          unit: recipeUnit,
          recipeUnit,
          baseUnit,
          unitCost: recipeUnitCost,
          baseUnitCost,
          reqQty: reqRecipeQty,
          reqBaseQty,
          itemTotalCost,
          conversionFactor: conversion.factor,
          conversionEquation: conversion.explanation
        });
      }

      // 4. Validate stock availability if allowNegativeStock is false
      if (!dto.allowNegativeStock) {
        const missingItems: string[] = [];
        for (const item of resolvedItems) {
          const ingId = item.ingredientId;
          const reqBaseQty = item.reqBaseQty;

          let currentStock = 0;
          if (ingId > 0) {
            const stockCheck = await client.query(
              "SELECT available, quantity, reserved FROM inventory_items WHERE warehouse_id = $1 AND ingredient_id = $2 FOR UPDATE",
              [rawWarehouseId, ingId]
            );

            if (stockCheck.rows.length > 0) {
              let totalQty = 0;
              let totalReserved = 0;
              for (const r of stockCheck.rows) {
                totalQty += Number(r.quantity || 0);
                totalReserved += Number(r.reserved || 0);
              }
              currentStock = Math.max(totalQty - totalReserved, 0);
            }
          }

          if (currentStock < reqBaseQty) {
            const equationNote = item.unit !== item.baseUnit ? ` (${item.reqQty} ${item.unit} = ${reqBaseQty} ${item.baseUnit})` : '';
            missingItems.push(`[${item.materialName}]: المتوفر بالمخزن ${currentStock} ${item.baseUnit} والمطلوب ${reqBaseQty} ${item.baseUnit}${equationNote}`);
          }
        }

        if (missingItems.length > 0) {
          throw new Error(`رصيد المواد الخام غير كافٍ في المخزن المحدد:\n` + missingItems.join("\n"));
        }
      }

      // 5. STEP A: Deduct consumed raw materials from warehouse (Movement ref_type: "production_consumption")
      const deductedItems: any[] = [];
      let calculatedTotalCost = 0;

      for (const item of resolvedItems) {
        const ingId = item.ingredientId;
        const reqRecipeQty = item.reqQty;
        const reqBaseQty = item.reqBaseQty;
        const itemTotalCost = item.itemTotalCost;
        calculatedTotalCost += itemTotalCost;

        if (ingId > 0) {
          const movementNotes = item.unit !== item.baseUnit
            ? `صرف واستهلاك مواد خام من المخزن لأمر إنتاج رقم ${orderNumber} - خامة: ${item.materialName} (الوصفة: ${reqRecipeQty} ${item.unit} = ${reqBaseQty} ${item.baseUnit} من المخزن)`
            : `صرف واستهلاك مواد خام من المخزن لأمر إنتاج رقم ${orderNumber} - خامة: ${item.materialName} (${reqBaseQty} ${item.baseUnit})`;

          await applyStockMovement(client, {
            warehouse_id: rawWarehouseId,
            ingredient_id: ingId,
            delta: -reqBaseQty, // Deduct the exact converted base quantity (e.g. -0.250 KG)
            field: "quantity",
            ref_type: "production_consumption",
            ref_id: orderNumericRef,
            user: user,
            notes: movementNotes,
            unit_cost: item.baseUnitCost,
            ingredient_name: item.materialName
          });

          const sumRes = await client.query(
            "SELECT COALESCE(SUM(quantity), 0) as total FROM inventory_items WHERE ingredient_id = $1",
            [ingId]
          );
          const totalStock = Number(sumRes.rows[0]?.total || 0);
          await client.query(
            "UPDATE ingredients SET current_stock = $1 WHERE id = $2",
            [totalStock, ingId]
          );
        }

        deductedItems.push({
          ingredientId: ingId,
          name: item.materialName,
          quantity: reqRecipeQty,
          unit: item.unit,
          baseQuantity: reqBaseQty,
          baseUnit: item.baseUnit,
          unitCost: item.unitCost,
          baseUnitCost: item.baseUnitCost,
          totalCost: itemTotalCost,
          conversionEquation: item.conversionEquation
        });
      }

      // 6. STEP B: Add finished goods produced to Finished Warehouse (Movement ref_type: "production_receipt")
      // Resolve or insert matching ingredient for finished product
      let finishedProductName = dto.productName || order.product_name;
      let finishedUnit = 'وحدة';
      let finishedCost = producedQty > 0 ? (calculatedTotalCost / producedQty) : 0;
      let finishedProductCode = String(dto.productId || order.product_id || '');

      const prodRes = await client.query(
        "SELECT id, name, code, barcode, unit, cost, price, category_id FROM products WHERE id::text = $1::text OR code::text = $1::text OR barcode::text = $1::text OR name::text = $1::text",
        [String(dto.productId || order.product_id)]
      );
      if (prodRes.rows.length > 0) {
        const p = prodRes.rows[0];
        if (!finishedProductName || finishedProductName.startsWith('منتج #')) {
          finishedProductName = p.name;
        }
        finishedUnit = p.unit || finishedUnit;
        finishedProductCode = p.code || p.barcode || finishedProductCode;
        if (finishedCost <= 0) finishedCost = Number(p.cost) || Number(p.price) || 0;
      }

      // Check settings/remo_production_products if name is still placeholder
      if (!finishedProductName || finishedProductName.startsWith('منتج #')) {
        try {
          const settingsRes = await client.query("SELECT value FROM settings WHERE key = 'remo_production_products'");
          if (settingsRes.rows.length > 0) {
            const list = JSON.parse(settingsRes.rows[0].value || '[]');
            const found = list.find((p: any) => p.id === order.product_id || p.code === order.product_id || p.name === order.product_id);
            if (found) {
              finishedProductName = found.name;
              finishedUnit = found.unit || finishedUnit;
              finishedProductCode = found.code || finishedProductCode;
            }
          }
        } catch (e) {}
      }

      if (!finishedProductName || finishedProductName.startsWith('منتج #')) {
        finishedProductName = finishedProductCode ? `منتج تام (${finishedProductCode})` : `منتج أمر الإنتاج ${orderNumber}`;
      }

      // Thorough lookup to prevent duplicates (by name, normalized name, code, barcode, or product id)
      const allIngsRes = await client.query("SELECT id, name, code, item_code, barcode, current_stock FROM ingredients");
      const normFinishedName = (finishedProductName || '').trim().toLowerCase().replace(/\s+/g, ' ');
      
      let matchedIng = allIngsRes.rows.find((ing: any) => {
        const ingName = (ing.name || '').trim().toLowerCase().replace(/\s+/g, ' ');
        if (ingName && normFinishedName && (ingName === normFinishedName || ingName.includes(normFinishedName) || normFinishedName.includes(ingName))) return true;
        if (finishedProductCode && (ing.code === finishedProductCode || ing.item_code === finishedProductCode || ing.barcode === finishedProductCode)) return true;
        return false;
      });

      let finishedIngredientId = matchedIng?.id;

      if (!finishedIngredientId) {
        // Auto-create ingredient record with standard warehouse ITEM-XXXX code
        const maxIdRes = await client.query("SELECT MAX(id) as max_id FROM ingredients");
        const nextId = (maxIdRes.rows[0]?.max_id || 0) + 1;
        const codeToUse = `ITEM-${1000 + nextId}`;
        const newIng = await client.query(
          `INSERT INTO ingredients (
            name, code, item_code, barcode, unit, cost, avg_cost, last_purchase_price,
            item_group, category, allow_sales, allow_purchase, current_stock, is_manufactured
          )
          VALUES ($1::text, $2::text, $3::text, $4::text, $5::text, $6::numeric, $6::numeric, $6::numeric, 'منتجات تامة الصنع', 'منتجات تامة الصنع', 1, 0, 0, 1)
          RETURNING id`,
          [finishedProductName, codeToUse, codeToUse, finishedProductCode || null, finishedUnit, finishedCost]
        );
        finishedIngredientId = newIng.rows[0]?.id;
      } else {
        // Cost is decimal by contract. Use a schema-aware fallback for databases
        // that were created with legacy INTEGER columns and could not be migrated
        // yet; this keeps posting functional while the startup repair fixes the schema.
        const costTypeRes = await client.query(
          `SELECT data_type FROM information_schema.columns
           WHERE table_schema = current_schema() AND table_name = 'ingredients' AND column_name = 'cost'`
        );
        const avgCostTypeRes = await client.query(
          `SELECT data_type FROM information_schema.columns
           WHERE table_schema = current_schema() AND table_name = 'ingredients' AND column_name = 'avg_cost'`
        );
        const costIsInteger = ['integer', 'bigint', 'smallint'].includes(String(costTypeRes.rows[0]?.data_type || '').toLowerCase());
        const avgCostIsInteger = ['integer', 'bigint', 'smallint'].includes(String(avgCostTypeRes.rows[0]?.data_type || '').toLowerCase());

        if (costIsInteger || avgCostIsInteger) {
          await client.query(
            `UPDATE ingredients
             SET cost = CASE WHEN $1::numeric > 0 THEN ROUND($1::numeric) ELSE cost END,
                 avg_cost = CASE WHEN $1::numeric > 0 THEN ROUND($1::numeric) ELSE avg_cost END,
                 is_manufactured = 1
             WHERE id = $2::integer`,
            [finishedCost, finishedIngredientId]
          );
        } else {
          await client.query(
            `UPDATE ingredients
             SET cost = CASE WHEN $1::numeric > 0 THEN $1::numeric ELSE cost END,
                 avg_cost = CASE WHEN $1::numeric > 0 THEN $1::numeric ELSE avg_cost END,
                 is_manufactured = 1
             WHERE id = $2::integer`,
            [finishedCost, finishedIngredientId]
          );
        }
      }

      // Apply movement to inventory_items
      await applyStockMovement(client, {
        warehouse_id: finishedWarehouseId,
        ingredient_id: finishedIngredientId,
        delta: producedQty,
        field: "quantity",
        ref_type: "production_receipt",
        ref_id: orderNumericRef,
        user: user,
        notes: `استلام منتج تام الصنع من أمر إنتاج رقم ${orderNumber} - كمية: ${producedQty} ${finishedUnit}`,
        unit_cost: finishedCost,
        ingredient_name: finishedProductName
      });

      // Update total current_stock in ingredients table
      const finSumRes = await client.query(
        "SELECT COALESCE(SUM(quantity), 0) as total FROM inventory_items WHERE ingredient_id = $1",
        [finishedIngredientId]
      );
      const finTotalStock = Number(finSumRes.rows[0]?.total || 0);
      await client.query(
        "UPDATE ingredients SET current_stock = $1 WHERE id = $2",
        [finTotalStock, finishedIngredientId]
      );

      for (const item of resolvedItems) {
        if (item.ingredientId > 0) {
          const itemSumRes = await client.query(
            "SELECT COALESCE(SUM(quantity), 0) as total FROM inventory_items WHERE ingredient_id = $1",
            [item.ingredientId]
          );
          const itemTotal = Number(itemSumRes.rows[0]?.total || 0);
          await client.query(
            "UPDATE ingredients SET current_stock = $1 WHERE id = $2",
            [itemTotal, item.ingredientId]
          );
        }
      }

      // Official Inventory Transactions Logging (non-blocking audit mirror).
      // Savepoints prevent a legacy audit-table schema from aborting production.
      await client.query("ALTER TABLE inventory_transactions ALTER COLUMN quantity DROP NOT NULL").catch(() => {});
      await client.query("ALTER TABLE inventory_transactions ALTER COLUMN quantity SET DEFAULT 0").catch(() => {});
      await client.query("SAVEPOINT production_inventory_logs");
      try {
        const rcTxNumber = `TXN-PRD-REC-${orderNumericRef}`;
        await client.query(
          `INSERT INTO inventory_transactions (
            transaction_number, date, warehouse_id, ingredient_id, quantity, unit_cost, total_cost, type, reason, reference, "user", status, notes, items
          )
          VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, 'receive', 'استلام إنتاج تام', $7, $8, 'approved', $9, $10)
          ON CONFLICT DO NOTHING`,
          [
            rcTxNumber,
            finishedWarehouseId,
            finishedIngredientId || null,
            Number(producedQty) || 0,
            Number(finishedCost) || 0,
            Math.round((Number(producedQty) || 0) * (Number(finishedCost) || 0) * 100) / 100,
            orderNumber,
            user,
            `استلام وتوريد منتج تام الصنع [${finishedProductName}] من أمر إنتاج رقم ${orderNumber}`,
            JSON.stringify([{
              ingredient_id: finishedIngredientId,
              name: finishedProductName,
              unit: finishedUnit,
              quantity: producedQty,
              price: finishedCost,
              total: Math.round((Number(producedQty) || 0) * (Number(finishedCost) || 0) * 100) / 100
            }])
          ]
        );
      } catch (txErr) {
        try { await client.query("ROLLBACK TO SAVEPOINT production_inventory_logs"); } catch (_) {}
        console.warn("Receipt transaction logging warning:", txErr);
      }

      try {
        if (deductedItems.length > 0) {
          const isTxNumber = `TXN-PRD-ISS-${orderNumericRef}`;
          const totalIssueQty = deductedItems.reduce((acc, d) => acc + (Number(d.quantity) || 0), 0);
          const totalIssueCost = deductedItems.reduce((acc, d) => acc + (Number(d.totalCost) || 0), 0);
          const singleIngredientId = deductedItems.length === 1 ? deductedItems[0].ingredientId : null;
          await client.query(
            `INSERT INTO inventory_transactions (
              transaction_number, date, warehouse_id, ingredient_id, quantity, total_cost, type, reason, reference, "user", status, notes, items
            )
            VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, 'issue', 'صرف خامات لأمر إنتاج', $6, $7, 'approved', $8, $9)
            ON CONFLICT DO NOTHING`,
            [
              isTxNumber,
              rawWarehouseId,
              singleIngredientId,
              totalIssueQty,
              totalIssueCost,
              orderNumber,
              user,
              `صرف واستهلاك خامات ومكونات لتشغيل أمر الإنتاج رقم ${orderNumber}`,
              JSON.stringify(deductedItems.map(d => ({
                ingredient_id: d.ingredientId,
                name: d.name,
                unit: d.unit,
                quantity: d.quantity,
                price: d.unitCost,
                total: d.totalCost
              })))
            ]
          );
        }
      } catch (txErr) {
        try { await client.query("ROLLBACK TO SAVEPOINT production_inventory_logs"); } catch (_) {}
        console.warn("Issue transaction logging warning:", txErr);
      }
      try {
        await client.query("RELEASE SAVEPOINT production_inventory_logs");
      } catch (_) {}

      // Sync Products Table (for POS and Sales catalog). This is secondary to
      // the warehouse receipt, so isolate it with a savepoint: an old products
      // schema can never abort the main production transaction.
      await client.query("SAVEPOINT production_products_sync");
      try {
        // Ensure the canonical active flag exists on legacy databases.
        await client.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true");
        const prodCheck = await client.query(
          "SELECT id FROM products WHERE id::text = $1::text OR code::text = $1::text OR name::text = $2::text",
          [String(order.product_id), finishedProductName]
        );
        if (prodCheck.rows.length === 0) {
          await client.query(
            `INSERT INTO products (name, code, barcode, unit, cost, price, is_active)
             VALUES ($1, $2, $2, $3, $4, $5, true)
             ON CONFLICT DO NOTHING`,
            [
              finishedProductName,
              finishedProductCode || `PROD-${order.product_id}`,
              finishedUnit,
              finishedCost,
              Math.round(finishedCost * 1.25 * 100) / 100
            ]
          );
        }
        await client.query("RELEASE SAVEPOINT production_products_sync");
      } catch (prodErr) {
        await client.query("ROLLBACK TO SAVEPOINT production_products_sync");
        await client.query("RELEASE SAVEPOINT production_products_sync");
        console.warn("Products sync warning (non-blocking):", prodErr);
      }

      // 7. Insert official record into production_runs
      const runRes = await client.query(
        `INSERT INTO production_runs (
          order_number, product_id, warehouse_id, finished_warehouse_id,
          quantity, status, total_cost, unit_cost, bom_id, bom_snapshot,
          notes, executed_by, executed_at
        )
        VALUES ($1, $2, $3, $4, $5, 'completed', $6, $7, $8, $9, $10, $11, NOW())
        RETURNING *`,
        [
          orderNumber,
          prodRes.rows[0]?.id || parseInt(String(order.product_id).replace(/[^0-9]/g, '')) || 1,
          rawWarehouseId,
          finishedWarehouseId,
          producedQty,
          calculatedTotalCost,
          finishedCost,
          order.bom_id || '',
          JSON.stringify(snapshotItems),
          dto.notes || `تنفيذ وترحيل أمر الإنتاج رقم ${orderNumber} بنجاح`,
          user
        ]
      );
      const newRun = runRes.rows[0];

      // 8. Update Order status in database
      await client.query(
        `UPDATE production_orders 
         SET status = 'completed', progress = 100, is_executed = true, executed_by = $1, executed_at = NOW(),
             raw_warehouse_id = $2, finished_warehouse_id = $3, total_cost = $4, cost_per_unit = $5
         WHERE order_number = $6`,
        [user, rawWarehouseId, finishedWarehouseId, calculatedTotalCost, finishedCost, orderNumber]
      );

      // 9. Sync with remo_production_orders in settings table for frontend/other components
      try {
        const curSettings = await client.query("SELECT value FROM settings WHERE key = 'remo_production_orders'");
        if (curSettings.rows.length > 0) {
          const list = JSON.parse(curSettings.rows[0].value || '[]');
          const updatedList = list.map((o: any) => {
            if (o.orderNumber === orderNumber || o.id === order.id) {
              return {
                ...o,
                status: 'completed',
                progress: 100,
                is_executed: true,
                isExecuted: true,
                executedBy: user,
                executedAt: new Date().toISOString(),
                rawWarehouseId,
                finishedWarehouseId,
                totalCost: calculatedTotalCost,
                costPerUnit: finishedCost
              };
            }
            return o;
          });
          await client.query("UPDATE settings SET value = $1 WHERE key = 'remo_production_orders'", [JSON.stringify(updatedList)]);
        }
      } catch (syncErr) {
        console.warn("Could not sync remo_production_orders settings:", syncErr);
      }

      await client.query("COMMIT");

      return {
        success: true,
        orderNumber,
        status: 'completed',
        producedQuantity: producedQty,
        productName: finishedProductName,
        rawWarehouseId,
        finishedWarehouseId,
        deductedMaterialsCount: deductedItems.length,
        deductedItems,
        totalMaterialCost: calculatedTotalCost,
        costPerUnit: finishedCost,
        runId: newRun?.id,
        executedAt: new Date().toISOString(),
        executedBy: user,
        message: `تم تنفيذ وترحيل أمر الإنتاج [${orderNumber}] بنجاح، وخصم المواد الخام، وإضافة المنتج التام للمخازن.`
      };

    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteOrder(id: string): Promise<boolean> {
    await this.ensureTableExists();
    try {
      await erpPool.query("DELETE FROM production_orders WHERE id::text = $1::text OR order_number::text = $1::text", [id]);
      return true;
    } catch (e) {
      console.error("Error deleting production order:", e);
      return false;
    }
  }

  async clearOrders(): Promise<boolean> {
    await this.ensureTableExists();
    try {
      await erpPool.query("DELETE FROM production_orders");
      await erpPool.query("DELETE FROM production_runs");
      return true;
    } catch (e) {
      console.error("Error clearing production orders:", e);
      return false;
    }
  }

  async deleteBOM(id: string): Promise<boolean> {
    await this.ensureTableExists();
    try {
      await erpPool.query("DELETE FROM production_boms WHERE id = $1", [id]);
      return true;
    } catch (e) {
      console.error("Error deleting BOM:", e);
      return false;
    }
  }

  async clearBOMs(): Promise<boolean> {
    await this.ensureTableExists();
    try {
      await erpPool.query("DELETE FROM production_boms");
      return true;
    } catch (e) {
      console.error("Error clearing BOMs:", e);
      return false;
    }
  }

  // Legacy fallback for simple production run record
  async create(run: CreateProductionRunDTO): Promise<any> {
    return this.executeProductionOrder({
      orderNumber: `RUN-${Date.now()}`,
      rawWarehouseId: run.warehouse_id,
      finishedWarehouseId: run.finished_warehouse_id || run.warehouse_id,
      allowNegativeStock: true,
      notes: run.notes
    });
  }
}
