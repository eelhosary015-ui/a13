import { Router } from "express";
import { pool } from "../../server-db.js";
import { JWT_SECRET, upload, logAction, isMonthClosed, getSetting, formatArabicLine, buildReceiptRow, printOrderToKitchen, io } from "../../server.js";
import { ERPCache, ERPEventBus, ERPJobQueue, ERPAIAssistant } from "../../server-erp-core.js";
import { authenticateToken } from "../system/system_api.routes.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import path from "path";
import fs from "fs";
import os from "os";
import * as XLSX from "xlsx";
import { moveStock } from "../warehouses/services/inventory.service.js";

const router = Router();

const parseJsonObject = (value: any): Record<string, any> => {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const truthyDb = (value: any, fallback = true) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (value === true || value === 1 || value === "1" || value === "true") return true;
  if (value === false || value === 0 || value === "0" || value === "false") return false;
  return fallback;
};

const pickDb = (value: any, fallback: any) => (value === undefined || value === null || value === "" ? fallback : value);

const enrichCategoryRow = (category: any) => ({
  ...category,
  is_active: truthyDb(category.is_active, true),
  show_in_pos: truthyDb(category.show_in_pos, true),
  color: pickDb(category.color, "#2563eb"),
  icon: pickDb(category.icon, "package"),
  description: pickDb(category.description, ""),
  sort_order: Number(category.sort_order || 0),
  parent_id: category.parent_id ? Number(category.parent_id) : null,
});

const enrichProductRow = (product: any) => {
  const props = parseJsonObject(product.properties);
  return {
    ...product,
    properties: props,
    price: Number(product.price || 0),
    cost: Number(pickDb(product.cost, props.cost || 0)),
    stock: Number(pickDb(product.stock, props.stock || 0)),
    min_stock: Number(pickDb(product.min_stock, props.min_stock || 0)),
    max_stock: Number(pickDb(product.max_stock, props.max_stock || 0)),
    tax_rate: Number(pickDb(product.tax_rate, props.tax_rate || 14)),
    code: pickDb(product.code, props.code || ""),
    barcode: pickDb(product.barcode, props.barcode || ""),
    unit: pickDb(product.unit, props.unit || "قطعة"),
    brand: pickDb(product.brand, props.brand || ""),
    business_profile: pickDb(product.business_profile, props.business_profile || "general"),
    item_type: pickDb(product.item_type, props.item_type || "sale"),
    show_in_pos: truthyDb(pickDb(product.show_in_pos, props.show_in_pos), true),
    is_active: truthyDb(pickDb(product.is_active, props.is_active), true),
    is_favorite: truthyDb(pickDb(product.is_favorite, props.is_favorite), false),
    allow_discount: truthyDb(pickDb(product.allow_discount, props.allow_discount), true),
    track_inventory: truthyDb(pickDb(product.track_inventory, props.track_inventory), true),
    preparation_time: Number(pickDb(product.preparation_time, props.preparation_time || 0)),
    kitchen_station: pickDb(product.kitchen_station, props.kitchen_station || ""),
    size_label: pickDb(product.size_label, props.size_label || ""),
    color: pickDb(product.color, props.color || ""),
    material: pickDb(product.material, props.material || ""),
    supplier: pickDb(product.supplier, props.supplier || ""),
    shelf_life_days: Number(pickDb(product.shelf_life_days, props.shelf_life_days || 0)),
    display_order: Number(pickDb(product.display_order, props.display_order || 0)),
  };
};

const isEnabledForPOS = (row: any) => truthyDb(row.is_active, true) && truthyDb(row.show_in_pos, true);


const collectCategoryDescendantIds = (categories: any[], rootId: number | string) => {
  const normalizedRootId = Number(rootId);
  if (!Number.isFinite(normalizedRootId)) return [];

  const childrenByParent = new Map<number, any[]>();

  for (const category of categories) {
    const parentId = category.parent_id === null || category.parent_id === undefined ? null : Number(category.parent_id);
    if (parentId !== null) {
      const list = childrenByParent.get(parentId) || [];
      list.push(category);
      childrenByParent.set(parentId, list);
    }
  }

  const result = new Set<number>([normalizedRootId]);
  const stack = [...(childrenByParent.get(normalizedRootId) || [])];

  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;

    const id = Number(current.id);
    if (result.has(id)) continue;

    result.add(id);
    stack.push(...(childrenByParent.get(id) || []));
  }

  return Array.from(result);
};

const buildEnabledCategorySet = (categories: any[]) => {
  const byId = new Map<number, any>();
  categories.forEach((category) => byId.set(Number(category.id), category));

  const enabled = new Set<number>();

  const isPathEnabled = (categoryId: any): boolean => {
    const id = Number(categoryId);
    if (!Number.isFinite(id)) return false;
    if (enabled.has(id)) return true;

    const category = byId.get(id);
    if (!category || !isEnabledForPOS(category)) return false;

    if (category.parent_id && !isPathEnabled(category.parent_id)) {
      return false;
    }

    enabled.add(id);
    return true;
  };

  categories.forEach((category) => isPathEnabled(category.id));
  return enabled;
};


  // Print Order Endpoint
  router.post("/api/orders/:id/print", async (req, res) => {
    const { id } = req.params;
    try {
      const orderResult = await pool.query("SELECT * FROM orders WHERE id = $1", [id]);
      const order = orderResult.rows[0];
      if (!order) return res.status(404).json({ error: "Order not found" });

      const itemsResult = await pool.query(`
        SELECT oi.*, p.name 
        FROM order_items oi 
        JOIN products p ON oi.product_id = p.id 
        WHERE oi.order_id = $1
      `, [id]);
      const items = itemsResult.rows;

      await printOrderToKitchen(order.id, items, { 
        order_type: order.order_type, 
        table_number: order.table_number,
        notes: order.notes
      }, order.branch_id);

      res.json({ success: true });
    } catch (error) {
      console.error("Print error:", error);
      res.status(500).json({ error: "Failed to print order" });
    }
  });

  // Public Endpoints for Web Menu
  router.get("/api/public/menu-data", async (req, res) => {
    try {
      const cacheKey = "public:menu-data";
      const cached = ERPCache.get(cacheKey);
      if (cached) {
        return res.json(cached);
      }

      const categoriesResult = await pool.query("SELECT * FROM categories");
      const productsResult = await pool.query("SELECT * FROM products");
      const categories = categoriesResult.rows.map(enrichCategoryRow).filter(isEnabledForPOS);
      const products = productsResult.rows.map(enrichProductRow).filter(isEnabledForPOS);
      
      // Bulk fetch product sizes
      const sizesResult = await pool.query("SELECT * FROM product_sizes");
      const allSizes = sizesResult.rows;

      const sizesMap = new Map<number, any[]>();
      for (const size of allSizes) {
        if (!sizesMap.has(size.product_id)) {
          sizesMap.set(size.product_id, []);
        }
        sizesMap.get(size.product_id)!.push({
          ...size,
          price: parseFloat(size.price) || 0
        });
      }

      const productsWithData = products.map((p: any) => {
        return { 
          ...p, 
          price: parseFloat(p.price) || 0,
          sizes: sizesMap.get(p.id) || []
        };
      });

      const sysNameRes = await pool.query("SELECT value FROM settings WHERE key = 'system_name'");
      const logoRes = await pool.query("SELECT value FROM settings WHERE key = 'customer_menu_logo'");

      const responseData = { 
        categories, 
        products: productsWithData,
        systemName: sysNameRes.rows.length > 0 ? sysNameRes.rows[0].value : 'Remo Pro',
        logo: logoRes.rows.length > 0 ? logoRes.rows[0].value : null
      };

      ERPCache.set(cacheKey, responseData, 60); // Cache for 1 minute

      res.json(responseData);
    } catch (error) {
      console.error("Fetch web menu data error:", error);
      res.status(500).json({ error: "Failed to fetch menu data" });
    }
  });

  router.post("/api/public/call-waiter", async (req, res) => {
    const { branch_id, table_number } = req.body;
    try {
      io.emit("call_waiter", { branch_id, table_number, timestamp: new Date() });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to call waiter" });
    }
  });

  router.post("/api/public/submit-complaint", async (req, res) => {
    const { branch_id, table_number, customer_name, customer_phone, details } = req.body;
    try {
      const tableText = table_number ? ` (طاولة ${table_number})` : '';
      await pool.query(
        "INSERT INTO complaints (customer_name, customer_phone, category, details, branch_id) VALUES ($1, $2, $3, $4, $5)",
        [customer_name || 'عميل في المطعم', customer_phone || '', 'شكوى عميل داخلي' + tableText, details, branch_id]
      );
      io.emit("new_complaint", { branch_id, table_number, details, timestamp: new Date() });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to submit complaint" });
    }
  });

  router.post("/api/public/submit-rating", async (req, res) => {
    const { branch_id, table_number, rating, feedback } = req.body;
    try {
      await pool.query(
        "INSERT INTO customer_ratings (branch_id, table_number, rating, feedback) VALUES ($1, $2, $3, $4)",
        [branch_id, table_number, rating, feedback]
      );
      io.emit("new_rating", { branch_id, table_number, rating, feedback, timestamp: new Date() });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to submit rating" });
    }
  });

  router.post("/api/public/web-orders", async (req, res) => {
    const { branch_id, table_number, items, total, notes } = req.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const orderResult = await client.query(
        "INSERT INTO web_orders (branch_id, table_number, total, notes) VALUES ($1, $2, $3, $4) RETURNING id",
        [branch_id, table_number, total, notes]
      );
      const webOrderId = orderResult.rows[0].id;

      for (const item of items) {
        await client.query(
          "INSERT INTO web_order_items (web_order_id, product_id, size_name, quantity, price, notes) VALUES ($1, $2, $3, $4, $5, $6)",
          [webOrderId, item.product_id, item.size_name, item.quantity, item.price, item.notes]
        );
      }

      await client.query('COMMIT');
      
      // Notify via Socket.io
      io.emit("new-web-order", { id: webOrderId, branch_id, table_number });

      res.json({ success: true, id: webOrderId });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error("Web order error:", error);
      res.status(500).json({ error: "Failed to submit web order" });
    } finally {
      client.release();
    }
  });

  // Web Orders Management Endpoints
  router.get("/api/web-orders", authenticateToken, async (req: any, res: any) => {
    const { branch_id } = req.query;
    try {
      let query = `
        SELECT wo.*, b.name as branch_name 
        FROM web_orders wo
        JOIN branches b ON wo.branch_id = b.id
        WHERE wo.status = 'pending'
      `;
      const params = [];
      if (branch_id) {
        params.push(branch_id);
        query += ` AND wo.branch_id = $1`;
      }
      query += " ORDER BY wo.timestamp DESC";
      
      const result = await pool.query(query, params);
      const orders = result.rows;
      
      const ordersWithItems = await Promise.all(orders.map(async (order: any) => {
        const itemsResult = await pool.query(`
          SELECT woi.*, p.name as product_name
          FROM web_order_items woi
          JOIN products p ON woi.product_id = p.id
          WHERE woi.web_order_id = $1
        `, [order.id]);
        return { ...order, items: itemsResult.rows };
      }));

      res.json(ordersWithItems);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch web orders" });
    }
  });

  router.post("/api/web-orders/:id/confirm", authenticateToken, async (req: any, res: any) => {
    const { id } = req.params;
    const { userId } = req.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Get web order data
      const webOrderRes = await client.query("SELECT * FROM web_orders WHERE id = $1", [id]);
      const webOrder = webOrderRes.rows[0];
      if (!webOrder) throw new Error("Web order not found");

      const itemsRes = await client.query("SELECT * FROM web_order_items WHERE web_order_id = $1", [id]);
      const items = itemsRes.rows;

      // 2. Create the real order (similar to standard POS order logic)
      // Note: We'll assume it's dine_in and use table_number
      
      let daily_number = 1;
      const dailySeqRes = await client.query(`
        SELECT COALESCE(MAX(daily_number), 0) + 1 as next_val 
        FROM orders 
        WHERE branch_id = $1 AND DATE(timestamp) = CURRENT_DATE
      `, [webOrder.branch_id]);
      if (dailySeqRes.rows.length > 0) daily_number = dailySeqRes.rows[0].next_val;

      const orderResult = await client.query(`
        INSERT INTO orders (
          total, branch_id, user_id, table_number, is_paid, 
          notes, order_type, status, daily_number
        ) VALUES ($1, $2, $3, $4, 0, $5, 'dine_in', 'pending', $6)
        RETURNING id
      `, [webOrder.total, webOrder.branch_id, userId, webOrder.table_number, webOrder.notes, daily_number]);
      const newOrderId = orderResult.rows[0].id;

      // 3. Insert items and apply the inventory movement atomically.
      const stockMoves = new Map<string, { warehouseId: number; ingredientId: number; qty: number }>();
      for (const item of items) {
        await client.query(`INSERT INTO order_items (order_id, product_id, size_name, quantity, price, notes) VALUES ($1, $2, $3, $4, $5, $6)`, [newOrderId, item.product_id, item.size_name, item.quantity, item.price, item.notes]);
        const productRes = await client.query("SELECT warehouse_id, track_inventory FROM products WHERE id = $1", [item.product_id]);
        const product = productRes.rows[0];
        if (product?.track_inventory === false) continue;
        let warehouseId = product?.warehouse_id;
        if (!warehouseId) warehouseId = (await client.query("SELECT id FROM warehouses WHERE (branch_id = $1 AND is_kitchen = 1) OR branch_id = $1 OR is_main = true ORDER BY is_kitchen DESC, is_main DESC LIMIT 1", [webOrder.branch_id])).rows[0]?.id;
        if (!warehouseId) throw new Error(`لا يوجد مخزن مرتبط بفرع الطلب للصنف #${item.product_id}`);
        const recipe = await client.query("SELECT ingredient_id, quantity FROM product_ingredients WHERE product_id = $1", [item.product_id]);
        for (const pi of recipe.rows) {
          const qty = Number(pi.quantity || 0) * Number(item.quantity || 1);
          if (qty <= 0) continue;
          const key = `${warehouseId}:${pi.ingredient_id}`;
          const current = stockMoves.get(key);
          if (current) current.qty += qty;
          else stockMoves.set(key, { warehouseId: Number(warehouseId), ingredientId: Number(pi.ingredient_id), qty });
        }
      }
      for (const move of stockMoves.values()) {
        await moveStock(client, { warehouse_id: move.warehouseId, ingredient_id: move.ingredientId, delta: -move.qty, ref_type: "web_order_sale", ref_id: Number(newOrderId), user: String(userId || "system"), notes: `خصم مقادير طلب ويب رقم ${newOrderId}` });
        await client.query("INSERT INTO inventory_transactions (warehouse_id, ingredient_id, quantity, type, reference_id, notes) VALUES ($1, $2, $3, 'out', $4, $5)", [move.warehouseId, move.ingredientId, move.qty, newOrderId, `خصم مقادير طلب ويب رقم ${newOrderId}`]);
      }
      if (stockMoves.size > 0) await client.query("UPDATE orders SET is_deducted = 1 WHERE id = $1", [newOrderId]);

      // 4. Update web order status
      await client.query("UPDATE web_orders SET status = 'confirmed' WHERE id = $1", [id]);

      await client.query('COMMIT');
      
      // 5. Side effects (after commit for data consistency)
      try {
        // Print to kitchen
        const itemsForPrinting = items.map((it: any) => ({
          id: it.product_id,
          name: '', // Will be fetched inside printing function
          price: it.price,
          quantity: it.quantity,
          notes: it.notes
        }));
        
        printOrderToKitchen(newOrderId, itemsForPrinting, { order_type: 'dine_in', table_number: webOrder.table_number, notes: webOrder.notes }, webOrder.branch_id).catch(console.error);

        // Broadcast to kitchen
        const fullOrderRes = await pool.query(`
          SELECT o.*, b.name as branch_name 
          FROM orders o 
          LEFT JOIN branches b ON o.branch_id = b.id 
          WHERE o.id = $1
        `, [newOrderId]);
        const fullOrder = fullOrderRes.rows[0];
        
        const orderItemsRes = await pool.query(`
          SELECT oi.*, p.name as product_name 
          FROM order_items oi 
          JOIN products p ON oi.product_id = p.id 
          WHERE oi.order_id = $1
        `, [newOrderId]);
        const orderItems = orderItemsRes.rows;
        
        io.emit("new_order", { ...fullOrder, items: orderItems });
      } catch (err) {
        console.error("Post-confirmation side effects failed:", err);
      }
      
      res.json({ success: true, orderId: newOrderId });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error("Confirm web order error:", error);
      res.status(500).json({ error: "Failed to confirm web order" });
    } finally {
      client.release();
    }
  });

  router.post("/api/web-orders/:id/reject", authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
      await pool.query("UPDATE web_orders SET status = 'rejected' WHERE id = $1", [id]);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to reject web order" });
    }
  });

  // Centralized cache invalidation helper for products/categories modification
  const invalidateProductCache = () => {
    ERPCache.delete("pos:data");
    ERPCache.delete("public:menu-data");
  };

  // POS Endpoints
  router.get("/api/pos/data", async (req, res) => {
    try {
      const cacheKey = "pos:data";
      const cached = ERPCache.get(cacheKey);
      if (cached) {
        return res.json(cached);
      }

      const categoriesResult = await pool.query("SELECT * FROM categories").catch(() => ({ rows: [] }));
      const allCategories = (categoriesResult.rows || []).map(enrichCategoryRow);
      const enabledCategoryIds = buildEnabledCategorySet(allCategories);
      const categories = allCategories.filter((category: any) => enabledCategoryIds.has(Number(category.id)));
      const productsResult = await pool.query("SELECT * FROM products").catch(() => ({ rows: [] }));
      const products = (productsResult.rows || [])
        .map(enrichProductRow)
        .filter((product: any) => isEnabledForPOS(product) && enabledCategoryIds.has(Number(product.category_id)));

      // Bulk fetch ingredients for all active products
      const ingredientsResult = await pool.query(`
        SELECT pi.*, i.name as ingredient_name, i.unit, i.cost as unit_cost
        FROM product_ingredients pi
        JOIN ingredients i ON pi.ingredient_id = i.id
      `).catch(() => ({ rows: [] }));
      const allIngredients = ingredientsResult.rows || [];

      // Bulk fetch sizes for all active products
      const sizesResult = await pool.query(`
        SELECT * FROM product_sizes
      `).catch(() => ({ rows: [] }));
      const allSizes = sizesResult.rows || [];

      // Index in memory for fast lookup
      const ingredientsMap = new Map<number, any[]>();
      for (const ing of allIngredients) {
        if (!ingredientsMap.has(ing.product_id)) {
          ingredientsMap.set(ing.product_id, []);
        }
        ingredientsMap.get(ing.product_id)!.push({
          ...ing,
          quantity: parseFloat(ing.quantity) || 0,
          unit_cost: parseFloat(ing.unit_cost) || 0
        });
      }

      const sizesMap = new Map<number, any[]>();
      for (const size of allSizes) {
        if (!sizesMap.has(size.product_id)) {
          sizesMap.set(size.product_id, []);
        }
        sizesMap.get(size.product_id)!.push({
          ...size,
          price: parseFloat(size.price) || 0
        });
      }

      // Reconstruct products with standard JSON mapping
      const productsWithData = products.map((p: any) => {
        return {
          ...p,
          price: parseFloat(p.price) || 0,
          ingredients: ingredientsMap.get(p.id) || [],
          sizes: sizesMap.get(p.id) || []
        };
      });

      const responseData = { categories, products: productsWithData };
      ERPCache.set(cacheKey, responseData, 60); // Cache for 1 minute

      res.json(responseData);
    } catch (error) {
      console.warn("Fetch POS data warning:", error);
      res.json({ categories: [], products: [] });
    }
  });

  // Product Management Endpoints
  

  router.get("/api/products/manage-data", async (req, res) => {
    try {
      const categoriesResult = await pool.query("SELECT * FROM categories ORDER BY sort_order ASC");
      const productsResult = await pool.query("SELECT * FROM products ORDER BY id ASC");

      const ingredientsResult = await pool.query(`
        SELECT pi.*, i.name as ingredient_name, i.unit, i.cost as unit_cost
        FROM product_ingredients pi
        JOIN ingredients i ON pi.ingredient_id = i.id
      `);
      const sizesResult = await pool.query("SELECT * FROM product_sizes");

      const ingredientsMap = new Map<number, any[]>();
      for (const ing of ingredientsResult.rows) {
        if (!ingredientsMap.has(ing.product_id)) ingredientsMap.set(ing.product_id, []);
        ingredientsMap.get(ing.product_id)!.push({
          ...ing,
          quantity: parseFloat(ing.quantity) || 0,
          unit_cost: parseFloat(ing.unit_cost) || 0
        });
      }

      const sizesMap = new Map<number, any[]>();
      for (const size of sizesResult.rows) {
        if (!sizesMap.has(size.product_id)) sizesMap.set(size.product_id, []);
        sizesMap.get(size.product_id)!.push({
          ...size,
          price: parseFloat(size.price) || 0
        });
      }

      const categories = categoriesResult.rows.map(enrichCategoryRow);
      const products = productsResult.rows.map((product: any) => ({
        ...enrichProductRow(product),
        ingredients: ingredientsMap.get(product.id) || [],
        sizes: sizesMap.get(product.id) || []
      }));

      res.json({ categories, products });
    } catch (error) {
      console.error("Fetch product management data error:", error);
      res.status(500).json({ error: "Failed to fetch product management data" });
    }
  });

  router.get("/api/uom-conversions", async (req, res) => {
    try {
      const result = await pool.query("SELECT * FROM uom_conversions");
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch UOM conversions" });
    }
  });

  router.post("/api/uom-conversions", async (req, res) => {
    const { category, from_uom, to_uom, value } = req.body;
    try {
      const result = await pool.query(
        "INSERT INTO uom_conversions (category, from_uom, to_uom, value) VALUES ($1, $2, $3, $4) RETURNING id",
        [category, from_uom, to_uom, value]
      );
      res.json({ id: result.rows[0].id });
    } catch (error) {
      res.status(500).json({ error: "Failed to add UOM conversion" });
    }
  });

  router.delete("/api/uom-conversions/:id", async (req, res) => {
    try {
      await pool.query("DELETE FROM uom_conversions WHERE id = $1", [req.params.id]);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete UOM conversion" });
    }
  });

  router.get("/api/ingredients", async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT ing.*, COALESCE(NULLIF(ing.code, ''), ing.item_code) AS code
        FROM ingredients ing
        ORDER BY ing.id
      `);
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch ingredients" });
    }
  });

  // Bulk import item master from Excel (the frontend sends only the validated item names).
  // The database remains the source of truth for item codes: each inserted row receives
  // ITEM-${1000 + id} after its serial ID is allocated, preventing duplicate codes.
  router.post("/api/ingredients/import", async (req, res) => {
    const client = await pool.connect();
    try {
      const rawNames = Array.isArray(req.body?.names) ? req.body.names : [];
      const names: string[] = [];
      const seen = new Set<string>();

      for (const raw of rawNames) {
        const name = String(raw ?? "").replace(/\s+/g, " ").trim();
        const key = name.toLocaleLowerCase("ar-EG");
        if (!name || seen.has(key)) continue;
        seen.add(key);
        names.push(name);
      }

      if (!names.length) {
        return res.status(400).json({ success: false, error: "لا توجد أسماء أصناف صالحة للاستيراد" });
      }
      if (names.length > 10000) {
        return res.status(400).json({ success: false, error: "الحد الأقصى للاستيراد في العملية الواحدة هو 10,000 صنف" });
      }

      await client.query("BEGIN");

      // Lock this bulk operation so two simultaneous imports cannot allocate conflicting
      // serial-derived codes while the transaction is running.
      await client.query("SELECT pg_advisory_xact_lock($1)", [928374651]);

      const existingResult = await client.query(
        `SELECT name FROM ingredients WHERE LOWER(TRIM(name)) = ANY($1::text[])`,
        [names.map(n => n.toLocaleLowerCase("ar-EG"))]
      );
      const existing = new Set(existingResult.rows.map((r: any) => String(r.name).replace(/\s+/g, " ").trim().toLocaleLowerCase("ar-EG")));

      const imported: Array<{ id: number; name: string; code: string }> = [];
      const skipped: string[] = [];

      for (let i = 0; i < names.length; i++) {
        const name = names[i];
        const key = name.toLocaleLowerCase("ar-EG");
        if (existing.has(key)) {
          skipped.push(name);
          continue;
        }

        // Temporary item code is unique to this operation; it is replaced immediately
        // with the final deterministic code based on the newly allocated database ID.
        const tempCode = `IMPORT-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`;
        const insertResult = await client.query(
          `INSERT INTO ingredients (
            name, unit, cost, supplier, min_stock, current_stock, item_group, item_code, code,
            is_fixed_asset, description, barcode, valuation_method, allow_negative_stock,
            allow_sales, allow_purchase
          ) VALUES ($1, 'قطعة', 0, NULL, 0, 0, NULL, $2::text, $3::text, 0, NULL, NULL, 'weighted_average', 0, 1, 1)
          RETURNING id`,
          [name, tempCode, tempCode]
        );

        const id = Number(insertResult.rows[0].id);
        const code = `ITEM-${1000 + id}`;
        await client.query(
          `UPDATE ingredients SET item_code = $1::text, code = $2::text WHERE id = $3`,
          [code, code, id]
        );

        imported.push({ id, name, code });
        existing.add(key);
      }

      await client.query("COMMIT");
      res.json({
        success: true,
        imported_count: imported.length,
        skipped_count: skipped.length,
        imported,
        skipped
      });
    } catch (e: any) {
      await client.query("ROLLBACK");
      console.error("Ingredient bulk import failed:", e);
      res.status(500).json({ success: false, error: e.message || "فشل استيراد الأصناف" });
    } finally {
      client.release();
    }
  });

  router.post("/api/ingredients", async (req, res) => {
    const { 
      name, unit, cost, supplier, min_stock, current_stock,
      item_group, item_code, code, is_fixed_asset, asset_category, description,
      is_zero_rated, is_exempt, brand, shelf_life_in_days, end_of_life,
      default_material_request_type, valuation_method, warranty_period, weight_per_unit,
      allow_negative_stock, barcode, has_variants, parent_item_id, deferred_expense,
      deferred_expense_months, deferred_revenue, deferred_revenue_months, default_income_account,
      default_expense_account, customer, min_order_qty, lead_time_days, safety_stock,
      max_discount, grant_commission, allow_sales, allow_purchase, tax_template,
      inspection_required_before_purchase, inspection_required_before_delivery,
      is_manufactured, is_subcontracted, variant_colors, allow_alternative_item, alternative_items
    } = req.body;

    let finalItemCode = item_code || code;
    if (!finalItemCode || String(finalItemCode).trim() === "" || finalItemCode === "-" || !String(finalItemCode).startsWith("ITEM-")) {
      try {
        const maxIdRes = await pool.query("SELECT MAX(id) as max_id FROM ingredients");
        const nextId = (maxIdRes.rows[0]?.max_id || 0) + 1;
        finalItemCode = `ITEM-${1000 + nextId}`;
      } catch (e) {
        finalItemCode = `ITEM-${Math.floor(100000 + Math.random() * 900000)}`;
      }
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Check if an ingredient with the same name already exists to prevent duplicate entries
      const existingIng = await client.query(
        `SELECT id, name, code, item_code, current_stock FROM ingredients WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) OR (code IS NOT NULL AND code = $2)`,
        [name, finalItemCode]
      );

      if (existingIng.rows.length > 0) {
        const existingId = existingIng.rows[0].id;
        const addStock = Number(current_stock || 0);
        if (addStock > 0) {
          await client.query(
            `UPDATE ingredients SET current_stock = COALESCE(current_stock, 0) + $1, cost = CASE WHEN $2 > 0 THEN $2 ELSE cost END WHERE id = $3`,
            [addStock, Number(cost || 0), existingId]
          );
        }
        await client.query("COMMIT");
        return res.status(200).json({ success: true, id: existingId, item_code: existingIng.rows[0].item_code || existingIng.rows[0].code, message: "تم تحديث الصنف الحالي بنجاح ومنع التكرار" });
      }
      const result = await client.query(
        `INSERT INTO ingredients (
          name, unit, cost, supplier, min_stock, current_stock,
          item_group, item_code, code, is_fixed_asset, asset_category, description,
          is_zero_rated, is_exempt, brand, shelf_life_in_days, end_of_life,
          default_material_request_type, valuation_method, warranty_period, weight_per_unit,
          allow_negative_stock, barcode, has_variants, parent_item_id, deferred_expense,
          deferred_expense_months, deferred_revenue, deferred_revenue_months, default_income_account,
          default_expense_account, customer, min_order_qty, lead_time_days, safety_stock,
          max_discount, grant_commission, allow_sales, allow_purchase, tax_template,
          inspection_required_before_purchase, inspection_required_before_delivery,
          is_manufactured, is_subcontracted, variant_colors, allow_alternative_item
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11, $12,
          $13, $14, $15, $16, $17,
          $18, $19, $20, $21,
          $22, $23, $24, $25, $26,
          $27, $28, $29, $30,
          $31, $32, $33, $34, $35,
          $36, $37, $38, $39, $40,
          $41, $42,
          $43, $44, $45, $46
        ) RETURNING id`,
        [
          name, unit, cost || 0, supplier || null, min_stock || 0, current_stock || 0,
          item_group || null, finalItemCode, finalItemCode, is_fixed_asset ? 1 : 0, asset_category || null, description || null,
          is_zero_rated ? 1 : 0, is_exempt ? 1 : 0, brand || null, shelf_life_in_days || null, end_of_life || null,
          default_material_request_type || null, valuation_method || null, warranty_period || null, weight_per_unit || null,
          allow_negative_stock ? 1 : 0, barcode || null, has_variants ? 1 : 0, parent_item_id || null, deferred_expense ? 1 : 0,
          deferred_expense_months || null, deferred_revenue ? 1 : 0, deferred_revenue_months || null, default_income_account || null,
          default_expense_account || null, customer || null, min_order_qty || null, lead_time_days || null, safety_stock || null,
          max_discount || null, grant_commission ? 1 : 0, allow_sales === false ? 0 : 1, allow_purchase === false ? 0 : 1, tax_template || null,
          inspection_required_before_purchase ? 1 : 0, inspection_required_before_delivery ? 1 : 0,
          is_manufactured ? 1 : 0, is_subcontracted ? 1 : 0, variant_colors || null, allow_alternative_item ? 1 : 0
        ]
      );
      
      const newParentId = result.rows[0].id;
      
      if (allow_alternative_item && alternative_items && alternative_items.length > 0) {
        for (const alt of alternative_items) {
          await client.query(
            "INSERT INTO alternative_items (item_id, alternative_item_id, two_way) VALUES ($1, $2, $3)",
            [newParentId, alt.alternative_item_id, alt.two_way ? 1 : 0]
          );
        }
      }
      
      // Generate variants if has_variants is true and colors are provided
      if (has_variants && variant_colors) {
         const colors = variant_colors.split(',').map((c: string) => c.trim()).filter((c: string) => c);
         for (const color of colors) {
            await client.query(
              `INSERT INTO ingredients (
                name, unit, cost, supplier, min_stock, current_stock,
                item_group, item_code, is_fixed_asset, asset_category, description,
                is_zero_rated, is_exempt, brand, shelf_life_in_days, end_of_life,
                default_material_request_type, valuation_method, warranty_period, weight_per_unit,
                allow_negative_stock, barcode, has_variants, parent_item_id, deferred_expense,
                deferred_expense_months, deferred_revenue, deferred_revenue_months, default_income_account,
                default_expense_account, customer, min_order_qty, lead_time_days, safety_stock,
                max_discount, grant_commission, allow_sales, allow_purchase, tax_template,
                inspection_required_before_purchase, inspection_required_before_delivery,
                is_manufactured, is_subcontracted
              ) VALUES (
                $1, $2, $3, $4, $5, $6,
                $7, $8, $9, $10, $11,
                $12, $13, $14, $15, $16,
                $17, $18, $19, $20,
                $21, $22, $23, $24, $25,
                $26, $27, $28, $29,
                $30, $31, $32, $33, $34,
                $35, $36, $37, $38, $39,
                $40, $41,
                $42, $43
              )`,
              [
                `${name} - ${color}`, unit, cost || 0, supplier || null, min_stock || 0, current_stock || 0,
                item_group || null, `${item_code || 'ITEM'}-${color.substring(0,3).toUpperCase()}`, is_fixed_asset ? 1 : 0, asset_category || null, description || null,
                is_zero_rated ? 1 : 0, is_exempt ? 1 : 0, brand || null, shelf_life_in_days || null, end_of_life || null,
                default_material_request_type || null, valuation_method || null, warranty_period || null, weight_per_unit || null,
                allow_negative_stock ? 1 : 0, barcode ? `${barcode}-${color}` : null, 0, newParentId, deferred_expense ? 1 : 0,
                deferred_expense_months || null, deferred_revenue ? 1 : 0, deferred_revenue_months || null, default_income_account || null,
                default_expense_account || null, customer || null, min_order_qty || null, lead_time_days || null, safety_stock || null,
                max_discount || null, grant_commission ? 1 : 0, allow_sales === false ? 0 : 1, allow_purchase === false ? 0 : 1, tax_template || null,
                inspection_required_before_purchase ? 1 : 0, inspection_required_before_delivery ? 1 : 0,
                is_manufactured ? 1 : 0, is_subcontracted ? 1 : 0
              ]
            );
         }
      }

      await client.query("COMMIT");
      client.release();
      res.json({ id: newParentId });
    } catch (error) {
      await client.query("ROLLBACK");
      client.release();
      console.error(error);
      res.status(500).json({ error: "Failed to add ingredient" });
    }
  });

  router.put("/api/ingredients/:id", async (req, res) => {
    const { id } = req.params;
    const { 
      name, unit, cost, supplier, min_stock, current_stock,
      item_group, item_code, code, is_fixed_asset, asset_category, description,
      is_zero_rated, is_exempt, brand, shelf_life_in_days, end_of_life,
      default_material_request_type, valuation_method, warranty_period, weight_per_unit,
      allow_negative_stock, barcode, has_variants, parent_item_id, deferred_expense,
      deferred_expense_months, deferred_revenue, deferred_revenue_months, default_income_account,
      default_expense_account, customer, min_order_qty, lead_time_days, safety_stock,
      max_discount, grant_commission, allow_sales, allow_purchase, tax_template,
      inspection_required_before_purchase, inspection_required_before_delivery,
      is_manufactured, is_subcontracted, variant_colors
    } = req.body;

    try {
      await pool.query(
        `UPDATE ingredients SET 
          name = $1, unit = $2, cost = $3, supplier = $4, min_stock = $5, current_stock = $6,
          item_group = $7, item_code = $8, code = $9, is_fixed_asset = $10, asset_category = $11, description = $12,
          is_zero_rated = $13, is_exempt = $14, brand = $15, shelf_life_in_days = $16, end_of_life = $17,
          default_material_request_type = $18, valuation_method = $19, warranty_period = $20, weight_per_unit = $21,
          allow_negative_stock = $22, barcode = $23, has_variants = $24, parent_item_id = $25, deferred_expense = $26,
          deferred_expense_months = $27, deferred_revenue = $28, deferred_revenue_months = $29, default_income_account = $30,
          default_expense_account = $31, customer = $32, min_order_qty = $33, lead_time_days = $34, safety_stock = $35,
          max_discount = $36, grant_commission = $37, allow_sales = $38, allow_purchase = $39, tax_template = $40,
          inspection_required_before_purchase = $41, inspection_required_before_delivery = $42,
          is_manufactured = $43, is_subcontracted = $44, variant_colors = $45
        WHERE id = $46`,
        [
          name, unit, cost || 0, supplier || null, min_stock || 0, current_stock || 0,
          item_group || null, item_code || code || null, code || item_code || null, is_fixed_asset ? 1 : 0, asset_category || null, description || null,
          is_zero_rated ? 1 : 0, is_exempt ? 1 : 0, brand || null, shelf_life_in_days || null, end_of_life || null,
          default_material_request_type || null, valuation_method || null, warranty_period || null, weight_per_unit || null,
          allow_negative_stock ? 1 : 0, barcode || null, has_variants ? 1 : 0, parent_item_id || null, deferred_expense ? 1 : 0,
          deferred_expense_months || null, deferred_revenue ? 1 : 0, deferred_revenue_months || null, default_income_account || null,
          default_expense_account || null, customer || null, min_order_qty || null, lead_time_days || null, safety_stock || null,
          max_discount || null, grant_commission ? 1 : 0, allow_sales === false ? 0 : 1, allow_purchase === false ? 0 : 1, tax_template || null,
          inspection_required_before_purchase ? 1 : 0, inspection_required_before_delivery ? 1 : 0,
          is_manufactured ? 1 : 0, is_subcontracted ? 1 : 0, variant_colors || null,
          id
        ]
      );
      res.json({ success: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to update ingredient" });
    }
  });

  router.delete("/api/ingredients/:id", async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM product_ingredients WHERE ingredient_id = $1", [id]);
      await client.query("DELETE FROM waste_logs WHERE ingredient_id = $1", [id]);
      await client.query("DELETE FROM ingredients WHERE id = $1", [id]);
      await client.query("COMMIT");
      res.json({ success: true });
    } catch (error) {
      await client.query("ROLLBACK");
      res.status(500).json({ error: "Failed to delete ingredient" });
    } finally {
      client.release();
    }
  });

  // Waste Logs Endpoints
  router.get("/api/waste-logs", async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT w.*, i.name as ingredient_name, i.unit
        FROM waste_logs w
        JOIN ingredients i ON w.ingredient_id = i.id
        ORDER BY w.date DESC
      `);
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch waste logs" });
    }
  });

  router.post("/api/waste-logs", async (req, res) => {
    const { ingredient_id, quantity, reason, cost } = req.body;

    // Month Lock Check
    const now = new Date();
    if (await isMonthClosed(now.getMonth() + 1, now.getFullYear())) {
      return res.status(403).json({ error: "لا يمكن إضافة هالك في شهر مغلق" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO waste_logs (ingredient_id, quantity, reason, cost) VALUES ($1, $2, $3, $4)",
        [ingredient_id, quantity, reason, cost]
      );
      // Reduce stock
      await client.query("UPDATE ingredients SET current_stock = current_stock - $1 WHERE id = $2", [quantity, ingredient_id]);
      await client.query("COMMIT");
      res.json({ success: true });
    } catch (error) {
      await client.query("ROLLBACK");
      res.status(500).json({ error: "Failed to add waste log" });
    } finally {
      client.release();
    }
  });

  // Cost Reports Endpoints
  router.get("/api/costs/dishes", async (req, res) => {
    try {
      const productsResult = await pool.query("SELECT * FROM products");
      const products = productsResult.rows;
      
      const dishesWithCost = await Promise.all(products.map(async (p: any) => {
        const ingredientsResult = await pool.query(`
          SELECT pi.*, i.name as ingredient_name, i.unit, i.cost as unit_cost
          FROM product_ingredients pi
          JOIN ingredients i ON pi.ingredient_id = i.id
          WHERE pi.product_id = $1
        `, [p.id]);
        const ingredients = ingredientsResult.rows;

        const parsedPrice = parseFloat(p.price) || 0;
        const totalCost = ingredients.reduce((sum: number, ing: any) => sum + ((parseFloat(ing.quantity) || 0) * (parseFloat(ing.unit_cost) || 0)), 0);
        const profit = parsedPrice - totalCost;
        const profitMargin = parsedPrice > 0 ? (profit / parsedPrice) * 100 : 0;

        return {
          ...p,
          price: parsedPrice,
          ingredients,
          totalCost,
          profit,
          profitMargin
        };
      }));

      res.json(dishesWithCost);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch dish costs" });
    }
  });

  router.post("/api/products/:id/ingredients", async (req, res) => {
    const { id } = req.params;
    const { ingredients } = req.body;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM product_ingredients WHERE product_id = $1", [id]);
      if (ingredients && ingredients.length > 0) {
        for (const ing of ingredients) {
          await client.query(
            "INSERT INTO product_ingredients (product_id, ingredient_id, quantity) VALUES ($1, $2, $3)",
            [id, ing.ingredient_id, ing.quantity]
          );
        }
      }
      await client.query("COMMIT");
      invalidateProductCache();
      res.json({ success: true });
    } catch (error) {
      await client.query("ROLLBACK");
      res.status(500).json({ error: "Failed to update product ingredients" });
    } finally {
      client.release();
    }
  });

  router.post("/api/categories", async (req, res) => {
    const {
      name,
      printer_id,
      parent_id,
      color = "#2563eb",
      icon = "package",
      description = "",
      sort_order = 0,
      is_active = true,
      show_in_pos = true
    } = req.body;
    try {
      const result = await pool.query(
        `INSERT INTO categories (
          name, printer_id, parent_id, color, icon, description, sort_order, is_active, show_in_pos
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [name, printer_id || null, parent_id || null, color, icon, description, sort_order || 0, is_active !== false, show_in_pos !== false]
      );
      invalidateProductCache();
      res.json({ id: result.rows[0].id });
    } catch (error) {
      console.error("Add category error:", error);
      res.status(500).json({ error: "Failed to add category", detail: (error as any)?.message || String(error) });
    }
  });

  router.put("/api/categories/:id", async (req, res) => {
    const { id } = req.params;
    const {
      name,
      printer_id,
      parent_id,
      color = "#2563eb",
      icon = "package",
      description = "",
      sort_order = 0,
      is_active = true,
      show_in_pos = true
    } = req.body;
    try {
      await pool.query(
        `UPDATE categories SET
          name = $1,
          printer_id = $2,
          parent_id = $3,
          color = $4,
          icon = $5,
          description = $6,
          sort_order = $7,
          is_active = $8,
          show_in_pos = $9
        WHERE id = $10`,
        [name, printer_id || null, parent_id || null, color, icon, description, sort_order || 0, is_active !== false, show_in_pos !== false, id]
      );
      invalidateProductCache();
      res.json({ success: true });
    } catch (error) {
      console.error("Update category error:", error);
      res.status(500).json({ error: "Failed to update category", detail: (error as any)?.message || String(error) });
    }
  });

  router.delete("/api/categories/:id", async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const allCategoriesResult = await client.query("SELECT id, parent_id FROM categories");
      const categoryIds = collectCategoryDescendantIds(allCategoriesResult.rows, id);

      if (!categoryIds.length) {
        throw new Error("التصنيف غير موجود");
      }

      const orderCheckResult = await client.query(`
        SELECT oi.id
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        WHERE p.category_id = ANY($1::int[])
        LIMIT 1
      `, [categoryIds]);

      const hasOrders = orderCheckResult.rows.length > 0;

      if (hasOrders) {
        await client.query(
          "UPDATE categories SET is_active = false, show_in_pos = false WHERE id = ANY($1::int[])",
          [categoryIds]
        );
        await client.query(
          "UPDATE products SET is_active = false, show_in_pos = false WHERE category_id = ANY($1::int[])",
          [categoryIds]
        );

        await client.query("COMMIT");
        invalidateProductCache();

        return res.json({
          success: true,
          message: `تم إخفاء القسم وكل الأقسام الفرعية (${categoryIds.length}) لوجود سجلات بيع مرتبطة`
        });
      }

      await client.query("DELETE FROM products WHERE category_id = ANY($1::int[])", [categoryIds]);
      const result = await client.query("DELETE FROM categories WHERE id = ANY($1::int[])", [categoryIds]);

      if (result.rowCount === 0) {
        throw new Error("التصنيف غير موجود");
      }

      await client.query("COMMIT");
      invalidateProductCache();

      return res.json({
        success: true,
        message: `تم حذف القسم وكل الأقسام الفرعية (${result.rowCount}) نهائياً`
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Delete category error:", error);
      res.status(500).json({ error: "فشل حذف التصنيف أو الأقسام الفرعية" });
    } finally {
      client.release();
    }
  });

  // Import products from an Excel file. Required column: "الصنف".
  // The file is uploaded directly from the user's device; no navigation/page is used.
  router.post("/api/products/import-excel", authenticateToken, upload.single("file") as any, async (req: any, res: any) => {
    const filePath = req.file?.path;
    try {
      if (!req.file || !filePath) {
        return res.status(400).json({
          success: false,
          error: "MISSING_FILE",
          message: "لم يتم اختيار ملف Excel. اختر ملف .xlsx أو .xls من جهازك ثم حاول مرة أخرى."
        });
      }

      const ext = String(path.extname(req.file.originalname || "")).toLowerCase();
      if (![".xlsx", ".xls"].includes(ext)) {
        return res.status(400).json({
          success: false,
          error: "INVALID_FILE_TYPE",
          message: "نوع الملف غير صحيح. يجب رفع ملف Excel بصيغة .xlsx أو .xls."
        });
      }

      const workbook = XLSX.read(fs.readFileSync(filePath), { type: "buffer" });
      const sheetName = workbook.SheetNames?.[0];
      if (!sheetName) {
        return res.status(400).json({
          success: false,
          error: "EMPTY_WORKBOOK",
          message: "ملف Excel لا يحتوي على أي ورقة عمل قابلة للقراءة."
        });
      }

      const worksheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1, defval: "", raw: false });
      if (!rows.length) {
        return res.status(400).json({
          success: false,
          error: "EMPTY_SHEET",
          message: "ورقة Excel فارغة. أضف صف العناوين وصفوف الأصناف ثم أعد الرفع."
        });
      }

      const normalizeHeader = (value: any) => String(value ?? "")
        .replace(/^\uFEFF/, "")
        .replace(/[\u200E\u200F]/g, "")
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();

      const headers = (rows[0] || []).map((h: any) => String(h ?? "").trim());
      const itemColumnIndex = headers.findIndex((h) => normalizeHeader(h) === "الصنف");

      if (itemColumnIndex === -1) {
        return res.status(400).json({
          success: false,
          error: "MISSING_ITEM_COLUMN",
          message: "خطأ في ملف Excel: العمود المطلوب باسم «الصنف» غير موجود. سبب الخطأ: النظام يعتمد على هذا العمود لمعرفة أسماء الأصناف التي سيتم إنشاؤها.",
          headers,
          details: [
            "تأكد أن أول صف في الشيت يحتوي على عنوان العمود «الصنف» بالضبط.",
            "يمكن أن يحتوي الملف على أعمدة أخرى، لكن وجود «الصنف» إلزامي.",
            "كل صف بعد صف العناوين يجب أن يحتوي على اسم صنف واحد في عمود «الصنف»."
          ]
        });
      }

      const rawNames = rows.slice(1)
        .map((row: any[]) => String(row?.[itemColumnIndex] ?? "").trim())
        .filter(Boolean);

      if (!rawNames.length) {
        return res.status(400).json({
          success: false,
          error: "NO_PRODUCTS",
          message: "تم العثور على عمود «الصنف»، لكن لا توجد أسماء أصناف تحته. أضف اسم صنف في كل صف ثم أعد الرفع."
        });
      }

      const uniqueNames: string[] = [];
      const seen = new Set<string>();
      const duplicateInFile: string[] = [];
      for (const name of rawNames) {
        const key = name.toLocaleLowerCase("ar-EG");
        if (seen.has(key)) {
          duplicateInFile.push(name);
          continue;
        }
        seen.add(key);
        uniqueNames.push(name);
      }

      const client = await pool.connect();
      const created: any[] = [];
      const skipped: any[] = duplicateInFile.map((name) => ({ name, reason: "مكرر داخل ملف Excel" }));
      try {
        await client.query("BEGIN");
        // Serialize imports so generated item codes remain deterministic and unique.
        await client.query("SELECT pg_advisory_xact_lock(81273419)");

        for (const name of uniqueNames) {
          const existing = await client.query(
            "SELECT id, code FROM products WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) LIMIT 1",
            [name]
          );
          if (existing.rows.length) {
            skipped.push({
              name,
              reason: `الصنف موجود بالفعل في النظام (كود: ${existing.rows[0].code || "بدون كود"})`
            });
            continue;
          }

          // Insert first, then derive the item code from the generated primary key.
          const inserted = await client.query(
            `INSERT INTO products (name, price, category_id, image, properties, code, barcode, unit, brand, stock, cost, min_stock, max_stock, tax_rate, business_profile, item_type, is_active, show_in_pos, is_favorite, allow_discount, track_inventory, preparation_time, kitchen_station, size_label, color, material, supplier, shelf_life_days, display_order)
             VALUES ($1, 0, NULL, '', $2, $3, '', 'قطعة', '', 0, 0, 0, 0, 14, 'general', 'sale', true, true, false, true, true, 0, '', '', '', '', '', 0, 0)
             RETURNING id`,
            [name, JSON.stringify({ source: "excel_import", imported_at: new Date().toISOString() }), `__IMPORT_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`]
          );
          const productId = Number(inserted.rows[0].id);
          const code = `ITEM-${String(productId).padStart(6, "0")}`;
          await client.query("UPDATE products SET code = $1, properties = $2 WHERE id = $3", [code, JSON.stringify({ source: "excel_import", imported_at: new Date().toISOString(), code }) , productId]);
          created.push({ id: productId, name, code });
        }

        await client.query("COMMIT");
        invalidateProductCache();

        return res.json({
          success: true,
          title: "تم استيراد الأصناف بنجاح",
          message: `تم إنشاء ${created.length} صنف جديد على السيستم وإنشاء كود صنف تلقائي لكل صنف.`,
          total_rows: rawNames.length,
          created_count: created.length,
          skipped_count: skipped.length,
          created,
          skipped
        });
      } catch (error: any) {
        await client.query("ROLLBACK");
        console.error("Excel products import error:", error);
        return res.status(500).json({
          success: false,
          error: "IMPORT_FAILED",
          message: `فشل حفظ الأصناف في قاعدة البيانات. سبب الخطأ: ${error?.message || "خطأ غير معروف"}`
        });
      } finally {
        client.release();
      }
    } catch (error: any) {
      console.error("Excel products file error:", error);
      return res.status(400).json({
        success: false,
        error: "INVALID_EXCEL",
        message: `تعذر قراءة ملف Excel. سبب الخطأ: ${error?.message || "الملف تالف أو غير صالح"}`
      });
    } finally {
      if (filePath) {
        try { fs.unlinkSync(filePath); } catch {}
      }
    }
  });

  router.get("/api/products", async (req, res) => {
    try {
      const result = await pool.query("SELECT * FROM products ORDER BY id ASC");
      res.json(result.rows.map(enrichProductRow));
    } catch (error: any) {
      console.error("Fetch products error:", error);
      res.status(500).json({ error: "Failed to fetch products" });
    }
  });

  router.post("/api/products", async (req, res) => {
    const {
      name,
      price = 0,
      category_id,
      image = "",
      ingredients,
      sizes,
      warehouse_id,
      properties,
      code = "",
      barcode = "",
      unit = "قطعة",
      brand = "",
      stock = 0,
      cost = 0,
      min_stock = 0,
      max_stock = 0,
      tax_rate = 14,
      business_profile = "general",
      item_type = "sale",
      is_active = true,
      show_in_pos = true,
      is_favorite = false,
      allow_discount = true,
      track_inventory = true,
      preparation_time = 0,
      kitchen_station = "",
      size_label = "",
      color = "",
      material = "",
      supplier = "",
      shelf_life_days = 0,
      display_order = 0
    } = req.body;

    const mergedProperties = {
      ...parseJsonObject(properties),
      code,
      barcode,
      unit,
      brand,
      stock,
      cost,
      min_stock,
      max_stock,
      tax_rate,
      business_profile,
      item_type,
      is_active: is_active !== false,
      show_in_pos: show_in_pos !== false,
      is_favorite: !!is_favorite,
      allow_discount: allow_discount !== false,
      track_inventory: track_inventory !== false,
      preparation_time,
      kitchen_station,
      size_label,
      color,
      material,
      supplier,
      shelf_life_days,
      display_order
    };

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `INSERT INTO products (
          name, price, category_id, image, warehouse_id, properties,
          code, barcode, unit, brand, stock, cost, min_stock, max_stock, tax_rate,
          business_profile, item_type, is_active, show_in_pos, is_favorite,
          allow_discount, track_inventory, preparation_time, kitchen_station,
          size_label, color, material, supplier, shelf_life_days, display_order
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11, $12, $13, $14, $15,
          $16, $17, $18, $19, $20,
          $21, $22, $23, $24,
          $25, $26, $27, $28, $29, $30
        ) RETURNING id`,
        [
          name, price, category_id, image, warehouse_id || null, JSON.stringify(mergedProperties),
          code, barcode, unit, brand, stock || 0, cost || 0, min_stock || 0, max_stock || 0, tax_rate || 0,
          business_profile, item_type, is_active !== false, show_in_pos !== false, !!is_favorite,
          allow_discount !== false, track_inventory !== false, preparation_time || 0, kitchen_station,
          size_label, color, material, supplier, shelf_life_days || 0, display_order || 0
        ]
      );
      const productId = result.rows[0].id;

      if (ingredients && Array.isArray(ingredients)) {
        for (const ing of ingredients.filter((item: any) => item?.ingredient_id)) {
          await client.query(
            "INSERT INTO product_ingredients (product_id, ingredient_id, quantity) VALUES ($1, $2, $3)",
            [productId, ing.ingredient_id, ing.quantity || 0]
          );
        }
      }

      if (sizes && Array.isArray(sizes)) {
        for (const size of sizes.filter((item: any) => item?.name)) {
          await client.query(
            "INSERT INTO product_sizes (product_id, name, price) VALUES ($1, $2, $3)",
            [productId, size.name, size.price || 0]
          );
        }
      }

      await client.query("COMMIT");
      invalidateProductCache();
      res.json({ id: productId });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Add product error:", error);
      res.status(500).json({ error: "Failed to add product", detail: (error as any)?.message || String(error) });
    } finally {
      client.release();
    }
  });

  router.put("/api/products/:id", async (req, res) => {
    const { id } = req.params;
    const {
      name,
      price = 0,
      category_id,
      image = "",
      ingredients,
      sizes,
      warehouse_id,
      properties,
      code = "",
      barcode = "",
      unit = "قطعة",
      brand = "",
      stock = 0,
      cost = 0,
      min_stock = 0,
      max_stock = 0,
      tax_rate = 14,
      business_profile = "general",
      item_type = "sale",
      is_active = true,
      show_in_pos = true,
      is_favorite = false,
      allow_discount = true,
      track_inventory = true,
      preparation_time = 0,
      kitchen_station = "",
      size_label = "",
      color = "",
      material = "",
      supplier = "",
      shelf_life_days = 0,
      display_order = 0
    } = req.body;

    const mergedProperties = {
      ...parseJsonObject(properties),
      code,
      barcode,
      unit,
      brand,
      stock,
      cost,
      min_stock,
      max_stock,
      tax_rate,
      business_profile,
      item_type,
      is_active: is_active !== false,
      show_in_pos: show_in_pos !== false,
      is_favorite: !!is_favorite,
      allow_discount: allow_discount !== false,
      track_inventory: track_inventory !== false,
      preparation_time,
      kitchen_station,
      size_label,
      color,
      material,
      supplier,
      shelf_life_days,
      display_order
    };

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE products SET
          name = $1,
          price = $2,
          category_id = $3,
          image = $4,
          warehouse_id = $5,
          properties = $6,
          code = $7,
          barcode = $8,
          unit = $9,
          brand = $10,
          stock = $11,
          cost = $12,
          min_stock = $13,
          max_stock = $14,
          tax_rate = $15,
          business_profile = $16,
          item_type = $17,
          is_active = $18,
          show_in_pos = $19,
          is_favorite = $20,
          allow_discount = $21,
          track_inventory = $22,
          preparation_time = $23,
          kitchen_station = $24,
          size_label = $25,
          color = $26,
          material = $27,
          supplier = $28,
          shelf_life_days = $29,
          display_order = $30
        WHERE id = $31`,
        [
          name, price, category_id, image, warehouse_id || null, JSON.stringify(mergedProperties),
          code, barcode, unit, brand, stock || 0, cost || 0, min_stock || 0, max_stock || 0, tax_rate || 0,
          business_profile, item_type, is_active !== false, show_in_pos !== false, !!is_favorite,
          allow_discount !== false, track_inventory !== false, preparation_time || 0, kitchen_station,
          size_label, color, material, supplier, shelf_life_days || 0, display_order || 0, id
        ]
      );

      await client.query("DELETE FROM product_ingredients WHERE product_id = $1", [id]);
      if (ingredients && Array.isArray(ingredients)) {
        for (const ing of ingredients.filter((item: any) => item?.ingredient_id)) {
          await client.query(
            "INSERT INTO product_ingredients (product_id, ingredient_id, quantity) VALUES ($1, $2, $3)",
            [id, ing.ingredient_id, ing.quantity || 0]
          );
        }
      }

      await client.query("DELETE FROM product_sizes WHERE product_id = $1", [id]);
      if (sizes && Array.isArray(sizes)) {
        for (const size of sizes.filter((item: any) => item?.name)) {
          await client.query(
            "INSERT INTO product_sizes (product_id, name, price) VALUES ($1, $2, $3)",
            [id, size.name, size.price || 0]
          );
        }
      }

      await client.query("COMMIT");
      invalidateProductCache();
      res.json({ success: true });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Update product error:", error);
      res.status(500).json({ error: "Failed to update product", detail: (error as any)?.message || String(error) });
    } finally {
      client.release();
    }
  });

  router.delete("/api/products/:id", async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      
      // Check for orders first
      const orderCheck = await client.query("SELECT id FROM order_items WHERE product_id = $1 LIMIT 1", [id]);
      const hasOrders = orderCheck.rows.length > 0;

      if (hasOrders) {
        // Soft delete
        await client.query("UPDATE products SET is_active = false WHERE id = $1", [id]);
        await client.query("COMMIT");
        invalidateProductCache();
        return res.json({ success: true, message: "تم الإخفاء لوجود طلبات سابقة" });
      } else {
        // Hard delete
        const result = await client.query("DELETE FROM products WHERE id = $1", [id]);
        if (result.rowCount === 0) throw new Error("الصنف غير موجود");
        
        await client.query("COMMIT");
        invalidateProductCache();
        return res.json({ success: true, message: "تم الحذف نهائياً" });
      }
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Delete product error:", error);
      res.status(500).json({ error: "فشل حذف الصنف" });
    } finally {
      client.release();
    }
  });

  router.post("/api/pos/order", async (req, res) => {
    let { 
      items, 
      total, 
      branch_id, 
      table_number = null, 
      is_paid = 1,
      customer_name = '',
      customer_phone = null,
      customer_phone_2 = null,
      customer_address = null,
      delivery_time = null,
      notes = null,
      order_type = 'dine_in',
      // user_id forced from token below, not from client request
      delivery_fee = 0,
      discount = 0,
      area_id = null,
      payment_method = 'cash',
      invoice_note = null,
      tax_amount = 0,
      service_charge = 0
    } = req.body;

    // Sanitize empty strings to null for database compatibility
    if (delivery_time === '') delivery_time = null;
    if (area_id === '') area_id = null;
    if (table_number === '') table_number = null;
    notes = notes || invoice_note || null;

    // Validate items
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "الطلب يجب أن يحتوي على عنصر واحد على الأقل" });
    }
    for (const item of items) {
      if (!item.product_id && !item.id) {
        return res.status(400).json({ error: "كل عنصر يجب أن يحتوي على معرف منتج" });
      }
      if (!item.quantity || item.quantity <= 0) {
        return res.status(400).json({ error: "الكمية يجب أن تكون أكبر من صفر" });
      }
      if (item.price < 0) {
        return res.status(400).json({ error: "السعر لا يمكن أن يكون سالباً" });
      }
    }

    // Security: Verify total is roughly correct (within 1% of computed)
    const serverTotal = items.reduce((sum: number, item: any) => sum + (item.price || 0) * (item.quantity || 0), 0) - (discount || 0) + (tax_amount || 0) + (service_charge || 0);
    if (Math.abs(total - serverTotal) > serverTotal * 0.01 + 1) {
      console.warn(`POS order total mismatch: client=${total}, server=${serverTotal}`);
    }

    // Month Lock Check
    const now = new Date();
    if (await isMonthClosed(now.getMonth() + 1, now.getFullYear())) {
      return res.status(403).json({ error: "لا يمكن إضافة طلبات في شهر مغلق" });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Handle Customer Record
      if (customer_phone) {
        const existingCustomerRes = await client.query("SELECT id FROM customers WHERE phone = $1", [customer_phone]);
        const existingCustomer = existingCustomerRes.rows[0];
        if (existingCustomer) {
          await client.query(`
            UPDATE customers SET 
              name = $1, 
              phone_2 = $2, 
              address = $3, 
              last_order_date = CURRENT_TIMESTAMP,
              total_orders = total_orders + 1,
              total_spent = total_spent + $4
            WHERE id = $5
          `, [customer_name, customer_phone_2, customer_address, total, existingCustomer.id]);
        } else {
          await client.query(`
            INSERT INTO customers (name, phone, phone_2, address, last_order_date, total_orders, total_spent)
            VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, 1, $5)
          `, [customer_name, customer_phone, customer_phone_2, customer_address, total]);
        }
      }

      // Calculate daily unique number
      let daily_number = 1;
      const dailySeqRes = await client.query(`
        SELECT COALESCE(MAX(daily_number), 0) + 1 as next_val 
        FROM orders 
        WHERE branch_id = $1 AND DATE(timestamp) = CURRENT_DATE
      `, [branch_id]);
      if (dailySeqRes.rows.length > 0) {
        daily_number = dailySeqRes.rows[0].next_val;
      }

      const orderResult = await client.query(`
        INSERT INTO orders (
          total, branch_id, user_id, table_number, is_paid, 
          customer_name, customer_phone, customer_phone_2, 
          customer_address, delivery_time, notes, order_type,
          status, delivery_fee, discount, area_id, daily_number, payment_method,
          tax_amount, service_charge
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
        RETURNING id
      `, [
        total, branch_id, (req as any).user?.id || null, table_number, is_paid, 
        customer_name, customer_phone, customer_phone_2, 
        customer_address, delivery_time, notes, order_type,
        req.body.status || 'pending', delivery_fee, discount, area_id, daily_number, payment_method,
        tax_amount, service_charge
      ]);
      const orderId = orderResult.rows[0].id;
      
      // Skip side effects if it's a pending call center order
      if (req.body.status === 'call_center_pending') {
        await client.query('COMMIT');
        return res.json({ success: true, orderId });
      }

      // Update Safe if paid
      if (is_paid) {
        const safeRes = await client.query("SELECT * FROM safes WHERE branch_id = $1", [branch_id]);
        const safe = safeRes.rows[0];
        if (safe) {
          const methodNames: Record<string, string> = {
            cash: 'كاش',
            wallet: 'محفظة إلكترونية',
            instapay: 'إنستا باي',
            visa: 'فيزا / بطاقة',
            mastercard: 'ماستر كارد',
            credit: 'آجل / حساب عميل',
            mixed: 'دفع مختلط'
          };
          const methodNameAr = methodNames[payment_method] || 'كاش';
          
          await client.query("UPDATE safes SET balance = balance + $1 WHERE id = $2", [total, safe.id]);
          await client.query("INSERT INTO safe_transactions (safe_id, amount, type, notes, user_id, payment_method) VALUES ($1, $2, 'sale', $3, $4, $5)",
            [safe.id, total, `تحصيل أوردر رقم ${orderId} (${methodNameAr})`, (req as any).user?.id || null, payment_method]);
        }
      }
      
      // Handle Customer Transaction
      if (customer_phone) {
        const customerRes = await client.query("SELECT id FROM customers WHERE phone = $1", [customer_phone]);
        const customer = customerRes.rows[0];
        if (customer) {
          await client.query("INSERT INTO customer_transactions (customer_id, type, amount, notes, order_id) VALUES ($1, 'invoice', $2, $3, $4)",
            [customer.id, total, `فاتورة طلب رقم ${orderId}`, orderId]);
          
          if (is_paid) {
            await client.query("INSERT INTO customer_transactions (customer_id, type, amount, notes, order_id) VALUES ($1, 'payment', $2, $3, $4)",
              [customer.id, total, `سداد فاتورة طلب رقم ${orderId}`, orderId]);
          }
        }
      }
      
      // Central inventory deduction: one canonical movement per POS order.
      const stockMoves = new Map<string, { warehouseId: number; ingredientId: number; qty: number }>();
      for (const item of items) {
        const productId = item.id || item.product_id;
        if (!productId) continue;
        const prodRes = await client.query("SELECT warehouse_id, track_inventory FROM products WHERE id = $1", [productId]);
        const product = prodRes.rows[0];
        if (product?.track_inventory === false) continue;
        let targetWarehouseId = product?.warehouse_id;
        if (!targetWarehouseId) {
          const whRes = await client.query("SELECT id FROM warehouses WHERE (branch_id = $1 AND is_kitchen = 1) OR branch_id = $1 OR is_main = true ORDER BY is_kitchen DESC, is_main DESC LIMIT 1", [branch_id]);
          targetWarehouseId = whRes.rows[0]?.id;
        }
        if (!targetWarehouseId) throw new Error(`لا يوجد مخزن مرتبط بفرع الطلب للصنف #${productId}`);
        const recipe = await client.query("SELECT ingredient_id, quantity FROM product_ingredients WHERE product_id = $1", [productId]);
        for (const pi of recipe.rows) {
          const qty = Number(pi.quantity || 0) * Number(item.quantity || 1);
          if (qty <= 0) continue;
          const key = `${targetWarehouseId}:${pi.ingredient_id}`;
          const current = stockMoves.get(key);
          if (current) current.qty += qty;
          else stockMoves.set(key, { warehouseId: Number(targetWarehouseId), ingredientId: Number(pi.ingredient_id), qty });
        }
      }
      for (const move of stockMoves.values()) {
        await moveStock(client, { warehouse_id: move.warehouseId, ingredient_id: move.ingredientId, delta: -move.qty, ref_type: "pos_sale", ref_id: Number(orderId), user: String((req as any).user?.id || "system"), notes: `خصم مقادير بيع POS رقم ${orderId}` });
        await client.query("INSERT INTO inventory_transactions (warehouse_id, ingredient_id, quantity, type, reference_id, notes) VALUES ($1, $2, $3, 'out', $4, $5)", [move.warehouseId, move.ingredientId, move.qty, orderId, `سحب مقادير - بيع طلب رقم ${orderId}`]);
      }
      if (stockMoves.size > 0) await client.query("UPDATE orders SET is_deducted = 1 WHERE id = $1", [orderId]);


      await client.query('COMMIT');
      
      // Print to specific kitchen printers
      printOrderToKitchen(orderId, items, { order_type, table_number, notes }, branch_id).catch(console.error);

      // Broadcast new order to kitchen
      const fullOrderRes = await pool.query(`
        SELECT o.*, b.name as branch_name 
        FROM orders o 
        LEFT JOIN branches b ON o.branch_id = b.id 
        WHERE o.id = $1
      `, [orderId]);
      const fullOrder = fullOrderRes.rows[0];
      
      const orderItemsRes = await pool.query(`
        SELECT oi.*, p.name as product_name 
        FROM order_items oi 
        JOIN products p ON oi.product_id = p.id 
        WHERE oi.order_id = $1
      `, [orderId]);
      const orderItems = orderItemsRes.rows;
      
      io.emit("new_order", { ...fullOrder, items: orderItems });

      res.json({ success: true, orderId, dailyNumber: daily_number });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error("Order creation error:", error);
      res.status(500).json({ error: "Failed to save order", details: error instanceof Error ? error.message : String(error) });
    } finally {
      client.release();
    }
  });

  router.get("/api/call-center/pending-orders", authenticateToken, async (req, res) => {
    try {
      const ordersRes = await pool.query(`
        SELECT o.*, b.name as branch_name 
        FROM orders o 
        LEFT JOIN branches b ON o.branch_id = b.id 
        WHERE o.status = 'call_center_pending'
        ORDER BY o.timestamp DESC
      `);
      const orders = ordersRes.rows;

      const ordersWithItems = await Promise.all(orders.map(async (order: any) => {
        const itemsRes = await pool.query(`
          SELECT oi.*, p.name as product_name 
          FROM order_items oi 
          JOIN products p ON oi.product_id = p.id 
          WHERE oi.order_id = $1
        `, [order.id]);
        return { ...order, items: itemsRes.rows };
      }));

      res.json(ordersWithItems);
    } catch (error) {
      console.error("Failed to fetch pending orders:", error);
      res.status(500).json({ error: "Failed to fetch pending orders" });
    }
  });

  router.post("/api/call-center/confirm-order/:id", authenticateToken, async (req: any, res) => {
    const { id } = req.params;
    const orderId = parseInt(id);
    const { branch_id } = req.body; // Allow changing branch at confirmation if needed
    
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const orderResult = await client.query("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [orderId]);
      const order = orderResult.rows[0];
      if (!order) throw new Error("Order not found");
      if (order.status !== 'call_center_pending') throw new Error("Order is not pending");

      const itemsResult = await client.query(`
        SELECT oi.*, p.name 
        FROM order_items oi 
        JOIN products p ON oi.product_id = p.id 
        WHERE oi.order_id = $1
      `, [orderId]);
      const items = itemsResult.rows;

      // Update order status and branch
      const finalBranchId = branch_id || order.branch_id;
      await client.query("UPDATE orders SET status = 'pending', branch_id = $1 WHERE id = $2", [finalBranchId, orderId]);

      // Now trigger all the side effects that were skipped
      const total = order.total;
      const is_paid = order.is_paid;
      const customer_phone = order.customer_phone;
      const user_id = req.user.id;

      // Update Customer Stats
      // Only update total_orders/total_spent if not already counted at creation
      // (call_center_pending orders have stats incremented during order creation, before the early return)
      if (customer_phone && order.status !== 'call_center_pending') {
        await client.query(`
          UPDATE customers SET 
            last_order_date = CURRENT_TIMESTAMP,
            total_orders = total_orders + 1,
            total_spent = total_spent + $1
          WHERE phone = $2
        `, [total, customer_phone]);
      }

      // Record customer transactions (invoice + optional payment) — always, even for confirmed call center orders
      if (customer_phone) {
        const customerResult = await client.query("SELECT id FROM customers WHERE phone = $1", [customer_phone]);
        const customer = customerResult.rows[0];
        if (customer) {
          await client.query(
            "INSERT INTO customer_transactions (customer_id, type, amount, notes, order_id) VALUES ($1, 'invoice', $2, $3, $4)",
            [customer.id, total, `فاتورة طلب رقم ${orderId}`, orderId]
          );
          
          if (is_paid) {
            await client.query(
              "INSERT INTO customer_transactions (customer_id, type, amount, notes, order_id) VALUES ($1, 'payment', $2, $3, $4)",
              [customer.id, total, `سداد فاتورة طلب رقم ${orderId}`, orderId]
            );
          }
        }
      }

      // Update Safe if paid
      if (is_paid) {
        const safeResult = await client.query("SELECT * FROM safes WHERE branch_id = $1", [finalBranchId]);
        const safe = safeResult.rows[0];
        if (safe) {
          const pm = order.payment_method || 'cash';
          const methodNames: Record<string, string> = {
            cash: 'كاش',
            wallet: 'محفظة إلكترونية',
            instapay: 'إنستا باي',
            visa: 'فيزا / بطاقة',
            mastercard: 'ماستر كارد',
            credit: 'آجل / حساب عميل',
            mixed: 'دفع مختلط'
          };
          const methodNameAr = methodNames[pm] || 'كاش';
          
          await client.query("UPDATE safes SET balance = balance + $1 WHERE id = $2", [total, safe.id]);
          await client.query(
            "INSERT INTO safe_transactions (safe_id, amount, type, notes, user_id, payment_method) VALUES ($1, $2, 'sale', $3, $4, $5)",
            [safe.id, total, `تحصيل أوردر رقم ${orderId} (${methodNameAr})`, user_id, pm]
          );
        }
      }

      // Central inventory deduction for confirmed call-center orders.
      const callCenterMoves = new Map<string, { warehouseId: number; ingredientId: number; qty: number }>();
      for (const item of items) {
        const productRes = await client.query("SELECT warehouse_id, track_inventory FROM products WHERE id = $1", [item.product_id]);
        const product = productRes.rows[0];
        if (product?.track_inventory === false) continue;
        let warehouseId = product?.warehouse_id;
        if (!warehouseId) warehouseId = (await client.query("SELECT id FROM warehouses WHERE (branch_id = $1 AND is_kitchen = 1) OR branch_id = $1 OR is_main = true ORDER BY is_kitchen DESC, is_main DESC LIMIT 1", [finalBranchId])).rows[0]?.id;
        if (!warehouseId) throw new Error(`لا يوجد مخزن مرتبط بفرع الطلب للصنف #${item.product_id}`);
        const recipe = (await client.query("SELECT ingredient_id, quantity FROM product_ingredients WHERE product_id = $1", [item.product_id])).rows;
        for (const pi of recipe) {
          const qty = Number(pi.quantity || 0) * Number(item.quantity || 1);
          if (qty <= 0) continue;
          const key = `${warehouseId}:${pi.ingredient_id}`;
          const current = callCenterMoves.get(key);
          if (current) current.qty += qty;
          else callCenterMoves.set(key, { warehouseId: Number(warehouseId), ingredientId: Number(pi.ingredient_id), qty });
        }
      }
      for (const move of callCenterMoves.values()) {
        await moveStock(client, { warehouse_id: move.warehouseId, ingredient_id: move.ingredientId, delta: -move.qty, ref_type: "call_center_sale", ref_id: orderId, user: String(user_id || "system"), notes: `خصم مقادير مركز الاتصال رقم ${orderId}` });
        await client.query("INSERT INTO inventory_transactions (warehouse_id, ingredient_id, quantity, type, reference_id, notes) VALUES ($1, $2, $3, 'out', $4, $5)", [move.warehouseId, move.ingredientId, move.qty, orderId, `خصم مقادير مركز الاتصال رقم ${orderId}`]);
      }
      if (callCenterMoves.size > 0) await client.query("UPDATE orders SET is_deducted = 1 WHERE id = $1", [orderId]);

      await client.query("COMMIT");

      // Print to kitchen
      printOrderToKitchen(orderId, items, { 
        order_type: order.order_type, 
        table_number: order.table_number, 
        notes: order.notes 
      }, finalBranchId);

      // Broadcast to kitchen
      const fullOrderResult = await pool.query(`
        SELECT o.*, b.name as branch_name 
        FROM orders o 
        LEFT JOIN branches b ON o.branch_id = b.id 
        WHERE o.id = $1
      `, [id]);
      const fullOrder = fullOrderResult.rows[0];
      
      const orderItemsResult = await pool.query(`
        SELECT oi.*, p.name as product_name 
        FROM order_items oi 
        JOIN products p ON oi.product_id = p.id 
        WHERE oi.order_id = $1
      `, [id]);
      const orderItems = orderItemsResult.rows;
      
      io.emit("new_order", { ...fullOrder, items: orderItems });

      res.json({ success: true });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Order confirmation error:", error);
      res.status(500).json({ error: "Failed to confirm order", details: error instanceof Error ? error.message : String(error) });
    } finally {
      client.release();
    }
  });

  // Kitchen Endpoints
  router.get("/api/kitchen/orders", async (req, res) => {
    const { branchId } = req.query;
    try {
      console.log(`Fetching kitchen orders for branch: ${branchId || 'all'}...`);
      let query = `
        SELECT o.*, b.name as branch_name 
        FROM orders o 
        LEFT JOIN branches b ON o.branch_id = b.id 
        WHERE (o.status = 'pending' OR o.status = 'preparing')
      `;
      const params: any[] = [];
      if (branchId && branchId !== 'all' && branchId !== 'undefined' && branchId !== 'null') {
        params.push(branchId);
        query += ` AND o.branch_id = $${params.length}`;
      }
      query += " ORDER BY o.timestamp ASC";
      
      const result = await pool.query(query, params);
      const orders = result.rows;
      console.log(`Found ${orders.length} orders`);

      const ordersWithItems = await Promise.all(orders.map(async (order: any) => {
        try {
          const itemsResult = await pool.query(`
            SELECT oi.*, p.name as product_name 
            FROM order_items oi 
            JOIN products p ON oi.product_id = p.id 
            WHERE oi.order_id = $1
          `, [order.id]);
          return { ...order, items: itemsResult.rows };
        } catch (itemError) {
          console.error(`Error fetching items for order ${order.id}:`, itemError);
          return { ...order, items: [] };
        }
      }));

      res.json(ordersWithItems);
    } catch (error) {
      console.error("Kitchen orders fetch error:", error);
      res.status(500).json({ error: `Failed to fetch kitchen orders: ${error instanceof Error ? error.message : String(error)}` });
    }
  });

  router.post("/api/kitchen/orders/:id/status", async (req, res) => {
    const { id } = req.params;
    const { status, delivery_driver_id } = req.body;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const orderResult = await client.query("SELECT * FROM orders WHERE id = $1", [id]);
      const order = orderResult.rows[0];
      if (!order) throw new Error("Order not found");

      if (delivery_driver_id) {
         await client.query("UPDATE orders SET status = $1, delivery_driver_id = $2 WHERE id = $3", [status, delivery_driver_id, id]);
      } else {
         await client.query("UPDATE orders SET status = $1 WHERE id = $2", [status, id]);
      }

      if (status === 'preparing' && !order.is_deducted) {
        let branchWarehouse = (await client.query("SELECT id FROM warehouses WHERE branch_id = $1 AND is_kitchen = 1 LIMIT 1", [order.branch_id])).rows[0];
        if (!branchWarehouse) branchWarehouse = (await client.query("SELECT id FROM warehouses WHERE branch_id = $1 LIMIT 1", [order.branch_id])).rows[0];
        if (!branchWarehouse) throw new Error("لا يوجد مخزن للفرع لتنفيذ خصم الطلب");
        const itemsResult = await client.query("SELECT * FROM order_items WHERE order_id = $1", [id]);
        const stockMoves = new Map<string, number>();
        for (const item of itemsResult.rows) {
          const recipe = await client.query("SELECT ingredient_id, quantity FROM product_ingredients WHERE product_id = $1", [item.product_id]);
          for (const pi of recipe.rows) {
            const qty = Number(pi.quantity || 0) * Number(item.quantity || 1);
            if (qty <= 0) continue;
            const key = String(pi.ingredient_id);
            stockMoves.set(key, (stockMoves.get(key) || 0) + qty);
          }
        }
        for (const [ingredientId, qty] of stockMoves) {
          await moveStock(client, { warehouse_id: Number(branchWarehouse.id), ingredient_id: Number(ingredientId), delta: -qty, ref_type: "pos_sale", ref_id: Number(id), user: String((req as any).user?.id || "system"), notes: `خصم مقادير أوردر رقم ${id}` });
          await client.query("INSERT INTO inventory_transactions (warehouse_id, ingredient_id, quantity, type, reference_id, notes) VALUES ($1, $2, $3, 'out', $4, $5)", [branchWarehouse.id, ingredientId, qty, id, `خصم مقادير أوردر رقم ${id}`]);
        }
        await client.query("UPDATE orders SET is_deducted = 1 WHERE id = $1", [id]);
      }

      await client.query("COMMIT");
      
      let driver_name = null;
      if (delivery_driver_id) {
         const empRes = await client.query("SELECT name FROM employees WHERE id = $1", [delivery_driver_id]);
         if (empRes.rows.length > 0) driver_name = empRes.rows[0].name;
      }
      
      io.emit("order_status_updated", { id, status, delivery_driver_id, driver_name });
      res.json({ success: true });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Failed to update order status", error);
      res.status(500).json({ error: "Failed to update order status" });
    } finally {
      client.release();
    }
  });

  // Branch Reports Endpoints
  router.get("/api/reports/branch/tables", authenticateToken, async (req: any, res: any) => {
    const { startDate, endDate, tableNumber } = req.query;
    const user = req.user;
    
    try {
      let query = `
        SELECT 
          ts.id as "رقم الجلسة",
          ts.table_id as "رقم الطاولة",
          ts.start_time as "وقت البداية",
          ts.end_time as "وقت النهاية",
          ts.status as "حالة الجلسة",
          ts.guest_count as "عدد الضيوف",
          ts.notes as "ملاحظات",
          o.id as "رقم الطلب",
          o.daily_number as "رقم الفاتورة",
          o.total as "الإجمالي",
          o.status as "حالة الطلب"
        FROM table_sessions ts
        LEFT JOIN orders o ON o.table_id = ts.table_id AND (o.created_at >= ts.start_time AND (o.created_at <= ts.end_time OR ts.end_time IS NULL))
        WHERE 1=1
      `;
      const params: any[] = [];
      
      if (user.role !== 'admin' && user.branch_id) {
        params.push(user.branch_id);
        // Wait, table_sessions doesn't have branch_id. tables does. So we need to join table.
        // Let's replace query to join tables.
        query = `
          SELECT 
            ts.id as "رقم الجلسة",
            t.table_number as "رقم الطاولة",
            b.name as "الفرع",
            ts.start_time as "وقت البداية",
            ts.end_time as "وقت النهاية",
            CASE ts.status WHEN 'active' THEN 'مفتوحة' WHEN 'closed' THEN 'مغلقة' ELSE ts.status END as "حالة الجلسة",
            ts.guest_count as "عدد الضيوف",
            o.daily_number as "رقم الفاتورة",
            o.total as "الإجمالي",
            CASE o.status WHEN 'completed' THEN 'مكتمل' WHEN 'cancelled' THEN 'ملغي' ELSE 'تحت التجهيز' END as "حالة الطلب"
          FROM table_sessions ts
          JOIN tables t ON ts.table_id = t.id
          LEFT JOIN branches b ON t.branch_id = b.id
          LEFT JOIN orders o ON o.session_id = ts.id
          WHERE 1=1
        `;
        query += ` AND t.branch_id = $${params.length}`;
      } else {
        query = `
          SELECT 
            ts.id as "رقم الجلسة",
            t.table_number as "رقم الطاولة",
            b.name as "الفرع",
            ts.start_time as "وقت البداية",
            ts.end_time as "وقت النهاية",
            CASE ts.status WHEN 'active' THEN 'مفتوحة' WHEN 'closed' THEN 'مغلقة' ELSE ts.status END as "حالة الجلسة",
            ts.guest_count as "عدد الضيوف",
            o.daily_number as "رقم الفاتورة",
            o.total as "الإجمالي",
            CASE o.status WHEN 'completed' THEN 'مكتمل' WHEN 'cancelled' THEN 'ملغي' ELSE 'تحت التجهيز' END as "حالة الطلب"
          FROM table_sessions ts
          JOIN tables t ON ts.table_id = t.id
          LEFT JOIN branches b ON t.branch_id = b.id
          LEFT JOIN orders o ON o.session_id = ts.id
          WHERE 1=1
        `;
      }
      
      if (startDate) {
        params.push(startDate);
        query += ` AND DATE(ts.start_time) >= $${params.length}`;
      }
      if (endDate) {
        params.push(endDate);
        query += ` AND DATE(ts.start_time) <= $${params.length}`;
      }
      if (tableNumber) {
        params.push(tableNumber);
        query += ` AND t.table_number::text = $${params.length}`;
      }
      
      query += ` ORDER BY ts.start_time DESC`;
      
      const result = await pool.query(query, params);
      res.json(result.rows);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to generate tables report" });
    }
  });

  router.get("/api/reports/branch/reservations", authenticateToken, async (req: any, res: any) => {
    const { startDate, endDate } = req.query;
    const user = req.user;
    
    try {
      let query = `
        SELECT 
          r.id as "رقم الحجز",
          b.name as "الفرع",
          r.customer_name as "اسم العميل",
          r.customer_phone as "رقم الهاتف",
          r.reservation_date as "تاريخ الحجز",
          r.reservation_time as "وقت الحجز",
          r.guests_count as "عدد الضيوف",
          t.table_number as "رقم الطاولة",
          CASE r.status 
            WHEN 'pending' THEN 'قيد الانتظار' 
            WHEN 'confirmed' THEN 'مؤكد' 
            WHEN 'cancelled' THEN 'ملغي' 
            WHEN 'completed' THEN 'مكتمل' 
            ELSE r.status 
          END as "الحالة",
          r.notes as "ملاحظات"
        FROM reservations r
        LEFT JOIN branches b ON r.branch_id = b.id
        LEFT JOIN tables t ON r.table_id = t.id
        WHERE 1=1
      `;
      const params: any[] = [];
      
      if (user.role !== 'admin' && user.branch_id) {
        params.push(user.branch_id);
        query += ` AND r.branch_id = $${params.length}`;
      }
      
      if (startDate) {
        params.push(startDate);
        query += ` AND r.reservation_date >= $${params.length}`;
      }
      if (endDate) {
        params.push(endDate);
        query += ` AND r.reservation_date <= $${params.length}`;
      }
      
      query += ` ORDER BY r.reservation_date DESC, r.reservation_time DESC`;
      
      const result = await pool.query(query, params);
      res.json(result.rows);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to generate reservations report" });
    }
  });

  router.get("/api/reports/branch/sales", authenticateToken, async (req: any, res: any) => {
    const { startDate, endDate, branchId, userId, orderType, status } = req.query;
    const user = req.user;
    
    try {
      let query = `
        SELECT 
          o.id as "رقم الطلب",
          o.daily_number as "رقم الطلب اليومي",
          b.name as "الفرع",
          u.username as "الكاشير",
          COALESCE(o.customer_name, 'عميل نقدي') as "العميل",
          COALESCE(o.customer_phone, '-') as "هاتف العميل",
          CASE o.order_type 
            WHEN 'dine_in' THEN 'صالة / طاولة'
            WHEN 'takeaway' THEN 'تيك أواي'
            WHEN 'delivery' THEN 'دليفري'
            WHEN 'walk_in' THEN 'بيع مباشر'
            WHEN 'pick_up' THEN 'استلام من الفرع'
            WHEN 'membership' THEN 'عضوية'
            WHEN 'exchange' THEN 'استبدال'
            ELSE COALESCE(o.order_type, '-')
          END as "نوع الطلب",
          CASE o.payment_method
            WHEN 'cash' THEN 'كاش'
            WHEN 'wallet' THEN 'محفظة'
            WHEN 'visa' THEN 'فيزا'
            WHEN 'mastercard' THEN 'ماستر كارد'
            WHEN 'instapay' THEN 'إنستا باي'
            WHEN 'credit' THEN 'آجل'
            WHEN 'mixed' THEN 'دفع مختلط'
            ELSE COALESCE(o.payment_method, 'كاش')
          END as "طريقة الدفع",
          COALESCE(o.subtotal, o.total) as "المبلغ قبل الخصم",
          COALESCE(o.discount_amount, 0) as "الخصم",
          COALESCE(o.tax_amount, 0) as "الضريبة",
          COALESCE(o.service_charge, 0) as "رسوم الخدمة",
          o.total as "الصافي",
          COALESCE(o.paid_amount, o.total) as "المدفوع",
          CASE 
            WHEN o.status = 'completed' OR o.status = 'delivered' THEN 'مكتمل'
            WHEN o.status = 'pending' THEN 'قيد الانتظار'
            WHEN o.status = 'preparing' THEN 'جاري التحضير'
            WHEN o.status = 'ready' THEN 'جاهز'
            WHEN o.status = 'cancelled' THEN 'ملغي'
            WHEN o.status = 'hold' THEN 'معلق'
            ELSE COALESCE(o.status, '-')
          END as "الحالة",
          COALESCE(o.table_id::text, '-') as "رقم الطاولة",
          CASE o.source
            WHEN 'pos' THEN 'نقطة البيع'
            WHEN 'call_center' THEN 'كول سنتر'
            WHEN 'web' THEN 'أون لاين'
            ELSE COALESCE(o.source, 'نقطة البيع')
          END as "مصدر الطلب",
          COALESCE(
            (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id), 0
          ) as "عدد الأصناف",
          TO_CHAR(o.timestamp, 'YYYY-MM-DD') as "التاريخ",
          TO_CHAR(o.timestamp, 'HH:MI AM') as "الوقت",
          COALESCE(o.notes, '-') as "ملاحظات"
        FROM orders o
        LEFT JOIN branches b ON o.branch_id = b.id
        LEFT JOIN users u ON o.user_id = u.id
        WHERE o.timestamp >= $1::timestamp AND o.timestamp < ($2::date + interval '1 day')::timestamp
      `;
      const params: any[] = [startDate, endDate];

      if (status && status !== 'all') {
        params.push(status);
        query += ` AND o.status = $${params.length}`;
      } else {
        query += ` AND o.status != 'cancelled'`;
      }
      
      if (user.role !== 'admin' && user.branch_id) {
        params.push(user.branch_id);
        query += ` AND o.branch_id = $${params.length}`;
      } else if (branchId && branchId !== 'all' && branchId !== 'undefined' && branchId !== 'null') {
        params.push(branchId);
        query += ` AND o.branch_id = $${params.length}`;
      }

      if (userId && userId !== 'all' && userId !== 'undefined' && userId !== 'null') {
        params.push(userId);
        query += ` AND o.user_id = $${params.length}`;
      }

      if (orderType && orderType !== 'all') {
        params.push(orderType);
        query += ` AND o.order_type = $${params.length}`;
      }
      
      query += " ORDER BY o.timestamp DESC";
      
      const data = (await pool.query(query, params)).rows;
      res.json(data);
    } catch (error) {
      console.error("Failed to fetch sales report:", error);
      res.status(500).json({ error: String(error) });
    }
  });

  router.get("/api/test-sales", async (req, res) => {
    res.json({ db: process.env.DATABASE_URL });
  });

  router.get("/api/reports/branch/call-center", authenticateToken, async (req: any, res: any) => {
    const { startDate, endDate, branchId, userId } = req.query;
    const user = req.user;
    try {
      let query = `
        SELECT 
          o.id as "رقم الطلب",
          o.daily_number as "رقم الطلب اليومي",
          o.customer_name as "اسم العميل",
          o.customer_phone as "رقم الهاتف",
          o.customer_address as "العنوان",
          b.name as "الفرع الموجه إليه",
          CASE o.order_type 
            WHEN 'takeaway' THEN 'تيك أواي'
            WHEN 'delivery' THEN 'توصيل'
            ELSE o.order_type
          END as "نوع الطلب",
          CASE o.payment_method
            WHEN 'cash' THEN 'كاش'
            WHEN 'wallet' THEN 'محفظة موبايل'
            WHEN 'visa' THEN 'فيزا'
            WHEN 'mastercard' THEN 'ماستر كارد'
            WHEN 'instapay' THEN 'إنستا باي'
            WHEN 'credit' THEN 'آجل'
            WHEN 'mixed' THEN 'دفع مختلط'
            ELSE COALESCE(o.payment_method, 'كاش')
          END as "طريقة الدفع",
          o.total as "الإجمالي (ج.م)",
          u.username as "الموظف",
          TO_CHAR(o.timestamp, 'YYYY-MM-DD') as "التاريخ",
          TO_CHAR(o.timestamp, 'HH:MI AM') as "الوقت"
        FROM orders o
        LEFT JOIN branches b ON o.branch_id = b.id
        LEFT JOIN users u ON o.user_id = u.id
        WHERE o.timestamp >= $1::timestamp AND o.timestamp < ($2::date + interval '1 day')::timestamp AND o.status != 'cancelled'
        AND o.customer_phone IS NOT NULL AND o.customer_phone != ''
      `;
      const params: any[] = [startDate, endDate];
      
      // Branch filtering
      if (user.role !== 'admin' && user.branch_id) {
        params.push(user.branch_id);
        query += ` AND o.branch_id = $${params.length}`;
      } else if (branchId && branchId !== 'all' && branchId !== 'undefined' && branchId !== 'null') {
        params.push(branchId);
        query += ` AND o.branch_id = $${params.length}`;
      }

      // User filtering
      if (userId && userId !== 'all' && userId !== 'undefined' && userId !== 'null') {
        params.push(userId);
        query += ` AND o.user_id = $${params.length}`;
      }
      
      query += " ORDER BY o.timestamp DESC";
      
      const data = (await pool.query(query, params)).rows;
      res.json(data);
    } catch (error) {
      console.error("Failed to fetch call center report:", error);
      res.status(500).json({ error: "Failed to fetch call center report" });
    }
  });

  router.get("/api/reports/branch/warehouse", authenticateToken, async (req: any, res: any) => {
    const { startDate, endDate, branchId } = req.query;
    const user = req.user;
    try {
      // Get transfers
      let transfersQuery = `
        SELECT 
          'تحويل مخزني' as "نوع العملية",
          r.id as "رقم المرجع",
          fw.name as "من مخزن",
          tw.name as "إلى مخزن",
          CASE r.status
            WHEN 'pending' THEN 'قيد الانتظار'
            WHEN 'approved' THEN 'مقبول'
            WHEN 'shipped' THEN 'تم الشحن'
            WHEN 'received' THEN 'تم الاستلام'
            WHEN 'rejected' THEN 'مرفوض'
            ELSE r.status
          END as "الحالة",
          TO_CHAR(r.created_at, 'YYYY-MM-DD') as "التاريخ"
        FROM inventory_requests r
        LEFT JOIN warehouses fw ON r.from_warehouse_id = fw.id
        LEFT JOIN warehouses tw ON r.to_warehouse_id = tw.id
        WHERE r.created_at::date BETWEEN $1 AND $2
      `;
      const transfersParams: any[] = [startDate, endDate];
      
      // Branch filtering for transfers
      if (user.role !== 'admin' && user.branch_id) {
        transfersParams.push(user.branch_id, user.branch_id);
        transfersQuery += ` AND (fw.branch_id = $${transfersParams.length - 1} OR tw.branch_id = $${transfersParams.length})`;
      } else if (branchId && branchId !== 'all' && branchId !== 'undefined' && branchId !== 'null') {
        transfersParams.push(branchId, branchId);
        transfersQuery += ` AND (fw.branch_id = $${transfersParams.length - 1} OR tw.branch_id = $${transfersParams.length})`;
      }
      
      const transfers = (await pool.query(transfersQuery, transfersParams)).rows;

      // Get withdrawals for production (out transactions not related to transfers)
      let withdrawalsQuery = `
        SELECT 
          'سحب للإنتاج' as "نوع العملية",
          t.id as "رقم المرجع",
          w.name as "من مخزن",
          i.name as "إلى مخزن", -- Using 'إلى مخزن' column for ingredient name to match structure
          t.quantity || ' ' || i.unit as "الحالة", -- Using 'الحالة' column for quantity to match structure
          TO_CHAR(t.created_at, 'YYYY-MM-DD') as "التاريخ"
        FROM inventory_transactions t
        JOIN warehouses w ON t.warehouse_id = w.id
        JOIN ingredients i ON t.ingredient_id = i.id
        WHERE t.type = 'out' AND t.created_at::date BETWEEN $1 AND $2
      `;
      const withdrawalsParams: any[] = [startDate, endDate];
      
      // Branch filtering for withdrawals
      if (user.role !== 'admin' && user.branch_id) {
        withdrawalsParams.push(user.branch_id);
        withdrawalsQuery += ` AND w.branch_id = $${withdrawalsParams.length}`;
      } else if (branchId && branchId !== 'all' && branchId !== 'undefined' && branchId !== 'null') {
        withdrawalsParams.push(branchId);
        withdrawalsQuery += ` AND w.branch_id = $${withdrawalsParams.length}`;
      }
      
      const withdrawals = (await pool.query(withdrawalsQuery, withdrawalsParams)).rows;

      res.json([...transfers, ...withdrawals].sort((a: any, b: any) => new Date(b["التاريخ"]).getTime() - new Date(a["التاريخ"]).getTime()));
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch warehouse report" });
    }
  });

  router.get("/api/reports/main-warehouse", async (req, res) => {
    try {
      const data = (await pool.query(`
        SELECT 
          ing.name as "الصنف",
          ing.category as "التصنيف",
          i.quantity as "الكمية المتاحة",
          ing.unit as "الوحدة",
          i.min_quantity as "الحد الأدنى",
          CASE 
            WHEN i.quantity <= i.min_quantity THEN 'يحتاج إعادة طلب'
            ELSE 'متوفر'
          END as "الحالة"
        FROM inventory_items i
        JOIN ingredients ing ON i.ingredient_id = ing.id
        JOIN warehouses w ON i.warehouse_id = w.id
        WHERE w.type = 'main'
        ORDER BY ing.category, ing.name
      `)).rows;
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch main warehouse report" });
    }
  });

  router.get("/api/reports/warehouse-transactions", authenticateToken, async (req: any, res: any) => {
    const { startDate, endDate, warehouseId } = req.query;
    const user = req.user;
    const start = startDate || '1970-01-01';
    const end = endDate || '9999-12-31';

    try {
      let query = `
        SELECT 
          t.id,
          t.created_at as date,
          t.type,
          w.name as warehouse_name,
          i.name as ingredient_name,
          t.quantity,
          i.unit,
          i.cost,
          t.notes,
          CASE 
            WHEN t.type IN ('in', 'transfer_in', 'purchase', 'adjustment') THEN t.quantity * i.cost
            ELSE -1 * t.quantity * i.cost
          END as total_value
        FROM inventory_transactions t
        JOIN ingredients i ON t.ingredient_id = i.id
        JOIN warehouses w ON t.warehouse_id = w.id
        WHERE t.created_at::date BETWEEN $1 AND $2
      `;
      
      const params: any[] = [start, end];

      // Branch filtering
      if (user.role !== 'admin' && user.branch_id) {
        params.push(user.branch_id);
        query += ` AND w.branch_id = $${params.length}`;
      }

      if (warehouseId && warehouseId !== 'all') {
        params.push(warehouseId);
        query += ` AND t.warehouse_id = $${params.length}`;
      }

      query += ` ORDER BY t.created_at DESC`;

      const transactions = (await pool.query(query, params)).rows;
      
      // Calculate summary
      let totalIn = 0;
      let totalOut = 0;

      transactions.forEach((t: any) => {
        const val = parseFloat(t.total_value);
        if (val > 0) {
          totalIn += val;
        } else {
          totalOut += Math.abs(val);
        }
      });

      res.json({
        transactions,
        summary: {
          total_in: totalIn,
          total_out: totalOut,
          net_value: totalIn - totalOut
        }
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch warehouse transactions report" });
    }
  });

  router.get("/api/reports/general-ledger", async (req, res) => {
    const { startDate, endDate, accountId, costCenterId } = req.query;
    const start = startDate || '1970-01-01';
    const end = endDate || '9999-12-31';

    try {
      let query = `
        SELECT 
          je.id as entry_id,
          je.date,
          je.description,
          je.reference,
          a.code as account_code,
          a.name as account_name,
          ji.debit,
          ji.credit,
          cc.name as cost_center_name,
          ji.notes
        FROM journal_items ji
        JOIN journal_entries je ON ji.journal_entry_id = je.id
        JOIN accounts a ON ji.account_id = a.id
        LEFT JOIN cost_centers cc ON ji.cost_center_id = cc.id
        WHERE je.date::date BETWEEN $1 AND $2
      `;
      
      const params: any[] = [start, end];

      if (accountId && accountId !== 'all') {
        params.push(accountId);
        query += ` AND ji.account_id = $${params.length}`;
      }

      if (costCenterId && costCenterId !== 'all') {
        params.push(costCenterId);
        query += ` AND ji.cost_center_id = $${params.length}`;
      }

      query += ` ORDER BY je.date DESC, je.id DESC`;

      const transactions = (await pool.query(query, params)).rows;
      
      // Calculate summary
      let totalDebit = 0;
      let totalCredit = 0;

      transactions.forEach((t: any) => {
        totalDebit += parseFloat(t.debit) || 0;
        totalCredit += parseFloat(t.credit) || 0;
      });

      res.json({
        transactions,
        summary: {
          total_debit: totalDebit,
          total_credit: totalCredit,
          net_balance: totalDebit - totalCredit
        }
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch general ledger report" });
    }
  });

  router.get("/api/reports/branch/delivery", authenticateToken, async (req: any, res: any) => {
    const { startDate, endDate, branchId } = req.query;
    const user = req.user;
    try {
      let query = `
        SELECT 
          o.id as "رقم الطلب",
          o.daily_number as "رقم الطلب اليومي",
          o.customer_name as "اسم العميل",
          o.customer_phone as "رقم الهاتف",
          o.customer_address as "العنوان",
          b.name as "الفرع",
          o.total as "الإجمالي (ج.م)",
          o.status as "حالة الطلب",
          TO_CHAR(o.timestamp, 'YYYY-MM-DD') as "التاريخ",
          TO_CHAR(o.timestamp, 'HH:MI AM') as "الوقت"
        FROM orders o
        LEFT JOIN branches b ON o.branch_id = b.id
        WHERE o.order_type = 'delivery' AND o.timestamp >= $1::timestamp AND o.timestamp < ($2::date + interval '1 day')::timestamp AND o.status != 'cancelled'
      `;
      const params: any[] = [startDate, endDate];
      
      // Branch filtering
      if (user.role !== 'admin' && user.branch_id) {
        params.push(user.branch_id);
        query += ` AND o.branch_id = $${params.length}`;
      } else if (branchId && branchId !== 'all' && branchId !== 'undefined' && branchId !== 'null') {
        params.push(branchId);
        query += ` AND o.branch_id = $${params.length}`;
      }
      
      query += " ORDER BY o.timestamp DESC";
      
      const data = (await pool.query(query, params)).rows;
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch delivery report" });
    }
  });


  router.get("/api/reports/branch/delivery-drivers", authenticateToken, async (req: any, res: any) => {
    const { startDate, endDate, branchId } = req.query;
    const user = req.user;
    try {
      let query = `
        SELECT
          COALESCE(e.name, 'بدون مندوب') as "اسم المندوب",
          COALESCE(b.name, 'غير محدد') as "الفرع",
          COUNT(o.id)::int as "عدد الطلبات",
          COALESCE(SUM(o.total), 0)::numeric(10,2) as "إجمالي المبيعات",
          COALESCE(AVG(o.total), 0)::numeric(10,2) as "متوسط الطلب",
          SUM(CASE WHEN o.status = 'completed' THEN 1 ELSE 0 END)::int as "طلبات مكتملة",
          SUM(CASE WHEN o.status = 'cancelled' THEN 1 ELSE 0 END)::int as "طلبات ملغاة",
          MIN(o.timestamp) as "أول طلب",
          MAX(o.timestamp) as "آخر طلب"
        FROM orders o
        LEFT JOIN branches b ON o.branch_id = b.id
        LEFT JOIN employees e ON o.delivery_driver_id = e.id
        WHERE o.order_type = 'delivery'
          AND o.timestamp >= COALESCE($1::timestamp, date_trunc('month', CURRENT_DATE))
          AND o.timestamp < (COALESCE($2::date, CURRENT_DATE) + interval '1 day')::timestamp
      `;
      const params: any[] = [startDate || null, endDate || null];

      if (user.role !== 'admin' && user.branch_id) {
        params.push(user.branch_id);
        query += ` AND o.branch_id = $${params.length}`;
      } else if (branchId && branchId !== 'all' && branchId !== 'undefined' && branchId !== 'null') {
        params.push(branchId);
        query += ` AND o.branch_id = $${params.length}`;
      }

      query += `
        GROUP BY COALESCE(e.name, 'بدون مندوب'), COALESCE(b.name, 'غير محدد')
        ORDER BY "إجمالي المبيعات" DESC, "عدد الطلبات" DESC
      `;

      const data = (await pool.query(query, params)).rows;
      res.json(data);
    } catch (error) {
      console.error("Failed to fetch delivery drivers report", error);
      res.status(500).json({ error: "Failed to fetch delivery drivers report" });
    }
  });

  router.get("/api/reports/branch/kitchen", authenticateToken, async (req: any, res: any) => {
    const { startDate, endDate, branchId } = req.query;
    const user = req.user;
    try {
      let query = `
        SELECT 
          o.id as "رقم الطلب",
          o.daily_number as "رقم الطلب اليومي",
          b.name as "الفرع",
          CASE o.order_type 
            WHEN 'dine_in' THEN 'صالة'
            WHEN 'takeaway' THEN 'تيك أواي'
            WHEN 'delivery' THEN 'توصيل'
            ELSE o.order_type
          END as "نوع الطلب",
          STRING_AGG(p.name || ' (x' || oi.quantity || ')', '، ') as "الأصناف",
          o.status as "حالة الطلب",
          TO_CHAR(o.timestamp, 'YYYY-MM-DD') as "التاريخ",
          TO_CHAR(o.timestamp, 'HH:MI AM') as "الوقت"
        FROM orders o
        LEFT JOIN branches b ON o.branch_id = b.id
        LEFT JOIN order_items oi ON o.id = oi.order_id
        LEFT JOIN products p ON oi.product_id = p.id
        WHERE o.timestamp >= $1::timestamp AND o.timestamp < ($2::date + interval '1 day')::timestamp AND o.status != 'cancelled'
      `;
      const params: any[] = [startDate, endDate];
      
      // Branch filtering
      if (user.role !== 'admin' && user.branch_id) {
        params.push(user.branch_id);
        query += ` AND o.branch_id = $${params.length}`;
      } else if (branchId && branchId !== 'all' && branchId !== 'undefined' && branchId !== 'null') {
        params.push(branchId);
        query += ` AND o.branch_id = $${params.length}`;
      }
      
      query += " GROUP BY o.id, b.name, o.daily_number ORDER BY o.timestamp DESC";
      
      const data = (await pool.query(query, params)).rows;
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch kitchen report" });
    }
  });

  router.get("/api/reports/branch/web-orders", authenticateToken, async (req: any, res: any) => {
    const { startDate, endDate, branchId } = req.query;
    const user = req.user;
    try {
      let query = `
        SELECT 
          wo.id as "رقم الطلب",
          b.name as "الفرع",
          wo.table_number as "رقم الطاولة",
          wo.total as "الإجمالي (ج.م)",
          CASE wo.status 
            WHEN 'pending' THEN 'قيد الانتظار'
            WHEN 'confirmed' THEN 'تم التأكيد'
            WHEN 'rejected' THEN 'مرفوض'
            ELSE wo.status
          END as "الحالة",
          STRING_AGG(p.name || ' (x' || woi.quantity || ')', '، ') as "الأصناف",
          wo.notes as "ملاحظات العميل",
          TO_CHAR(wo.timestamp, 'YYYY-MM-DD') as "التاريخ",
          TO_CHAR(wo.timestamp, 'HH:MI AM') as "الوقت"
        FROM web_orders wo
        LEFT JOIN branches b ON wo.branch_id = b.id
        LEFT JOIN web_order_items woi ON wo.id = woi.web_order_id
        LEFT JOIN products p ON woi.product_id = p.id
        WHERE wo.timestamp >= $1::timestamp AND wo.timestamp < ($2::date + interval '1 day')::timestamp
      `;
      const params: any[] = [startDate, endDate];
      
      // Branch filtering
      if (user.role !== 'admin' && user.branch_id) {
        params.push(user.branch_id);
        query += ` AND wo.branch_id = $${params.length}`;
      } else if (branchId && branchId !== 'all' && branchId !== 'undefined' && branchId !== 'null') {
        params.push(branchId);
        query += ` AND wo.branch_id = $${params.length}`;
      }
      
      query += " GROUP BY wo.id, b.name ORDER BY wo.timestamp DESC";
      
      const data = (await pool.query(query, params)).rows;
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch web orders report" });
    }
  });

  // End of Branch Reports Endpoints

  // Reservations Endpoints
  router.get("/api/reservations", async (req, res) => {
    const { branchId, date } = req.query;
    try {
      let query = "SELECT * FROM reservations WHERE 1=1";
      const params: any[] = [];
      
      if (branchId) {
        params.push(branchId);
        query += ` AND branch_id = $${params.length}`;
      }
      if (date) {
        params.push(date);
        query += ` AND reservation_date = $${params.length}`;
      }
      
      query += " ORDER BY reservation_date ASC, reservation_time ASC";
      
      const reservations = (await pool.query(query, params)).rows;
      res.json(reservations);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch reservations" });
    }
  });

  router.post("/api/reservations", async (req, res) => {
    const { branch_id, customer_name, customer_phone, reservation_date, reservation_time, guests_count, table_number, notes } = req.body;

    // Month Lock Check
    const resDate = reservation_date ? new Date(reservation_date) : new Date();
    if (await isMonthClosed(resDate.getMonth() + 1, resDate.getFullYear())) {
      return res.status(403).json({ error: "لا يمكن إضافة حجوزات في شهر مغلق" });
    }

    try {
      const result = await pool.query(`
        INSERT INTO reservations (branch_id, customer_name, customer_phone, reservation_date, reservation_time, guests_count, table_number, notes)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
      `, [branch_id, customer_name, customer_phone, reservation_date, reservation_time, guests_count, table_number, notes]);
      res.json({ id: result.rows[0].id });
    } catch (error) {
      res.status(500).json({ error: "Failed to create reservation" });
    }
  });

  router.put("/api/reservations/:id/status", async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    // Month Lock Check
    const now = new Date();
    if (await isMonthClosed(now.getMonth() + 1, now.getFullYear())) {
      return res.status(403).json({ error: "لا يمكن تحديث حالة الحجز في شهر مغلق" });
    }

    try {
      await pool.query("UPDATE reservations SET status = $1 WHERE id = $2", [status, id]);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to update reservation status" });
    }
  });

  router.put("/api/reservations/:id", async (req, res) => {
    const { id } = req.params;
    const { customer_name, customer_phone, reservation_date, reservation_time, guests_count, table_number, notes } = req.body;

    // Month Lock Check
    const resDate = reservation_date ? new Date(reservation_date) : new Date();
    if (await isMonthClosed(resDate.getMonth() + 1, resDate.getFullYear())) {
      return res.status(403).json({ error: "لا يمكن تحديث الحجز في شهر مغلق" });
    }

    try {
      await pool.query(`
        UPDATE reservations 
        SET customer_name = $1, customer_phone = $2, reservation_date = $3, reservation_time = $4, guests_count = $5, table_number = $6, notes = $7
        WHERE id = $8
      `, [customer_name, customer_phone, reservation_date, reservation_time, guests_count, table_number, notes, id]);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to update reservation" });
    }
  });

  router.delete("/api/reservations/:id", async (req, res) => {
    const { id } = req.params;
    try {
      await pool.query("DELETE FROM reservations WHERE id = $1", [id]);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete reservation" });
    }
  });

  router.get("/api/customers", async (req, res) => {
    const { startDate, endDate } = req.query;
    try {
      let query = "SELECT * FROM customers WHERE 1=1";
      const params: any[] = [];
      
      if (startDate) {
        params.push(startDate);
        query += ` AND last_order_date >= $${params.length}`;
      }
      if (endDate) {
        params.push(endDate);
        query += ` AND last_order_date <= $${params.length}`;
      }
      query += " ORDER BY last_order_date DESC";
      
      const customers = (await pool.query(query, params)).rows;
      res.json(customers);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch customers" });
    }
  });

  router.post("/api/customers", async (req, res) => {
    try {
      const { name, phone, phone_2, email, address, notes, tax_number } = req.body;
      if (!name || !name.trim()) return res.status(400).json({ error: "اسم العميل مطلوب" });
      const { rows } = await pool.query(
        `INSERT INTO customers (name, phone, phone_2, email, address, notes, tax_number, total_orders, total_spent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 0) RETURNING *`,
        [name.trim(), phone || null, phone_2 || null, email || null, address || null, notes || null, tax_number || null]
      );
      res.status(201).json(rows[0]);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "فشل إضافة العميل" });
    }
  });

  router.get("/api/customers/search", async (req, res) => {
    const { phone } = req.query;
    try {
      const customer = (await pool.query("SELECT * FROM customers WHERE phone = $1", [phone])).rows[0];
      res.json(customer || null);
    } catch (error) {
      res.status(500).json({ error: "Failed to search customer" });
    }
  });

  router.get("/api/customers/accounts", async (req, res) => {
    try {
      const accounts = (await pool.query(`
        SELECT c.id, c.name, c.phone,
               COALESCE((SELECT SUM(amount) FROM customer_transactions WHERE customer_id = c.id AND type = 'invoice'), 0) -
               COALESCE((SELECT SUM(amount) FROM customer_transactions WHERE customer_id = c.id AND type = 'payment'), 0) +
               COALESCE((SELECT SUM(CASE WHEN type = 'adjustment' THEN amount ELSE 0 END) FROM customer_transactions WHERE customer_id = c.id), 0) as balance,
               (SELECT MAX(date) FROM customer_transactions WHERE customer_id = c.id) as last_transaction_date
        FROM customers c
        ORDER BY c.name ASC
      `)).rows;
      res.json(accounts);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch customer accounts" });
    }
  });

  router.get("/api/customers/:id/transactions", async (req, res) => {
    const { id } = req.params;
    try {
      const transactions = (await pool.query("SELECT *, timestamp as date FROM customer_transactions WHERE customer_id = $1 ORDER BY timestamp DESC", [id])).rows;
      res.json(transactions);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch transactions" });
    }
  });

  router.post("/api/customers/transactions", async (req, res) => {
    const { customer_id, type, amount, notes, order_id } = req.body;

    // Month Lock Check
    const now = new Date();
    if (await isMonthClosed(now.getMonth() + 1, now.getFullYear())) {
      return res.status(403).json({ error: "لا يمكن إضافة حركات عملاء في شهر مغلق" });
    }

    try {
      const result = await pool.query("INSERT INTO customer_transactions (customer_id, type, amount, notes, order_id) VALUES ($1, $2, $3, $4, $5) RETURNING id", [customer_id, type, amount, notes, order_id || null]);
      await pool.query(
        `UPDATE customers SET total_orders = COALESCE(total_orders, 0) + 1, 
         total_spent = COALESCE(total_spent, 0) + $1 
         WHERE id = $2`,
        [amount, customer_id]
      );
      res.json({ id: result.rows[0].id });
    } catch (error) {
      res.status(500).json({ error: "Failed to create transaction" });
    }
  });

  // Edit customer
  router.put('/api/customers/:id', authenticateToken, async (req, res) => {
    try {
      const { name, phone, email, address, notes, tax_number } = req.body;
      const { rows } = await pool.query(
        `UPDATE customers SET name=COALESCE($1,name), phone=COALESCE($2,phone), email=COALESCE($3,email),
         address=COALESCE($4,address), notes=COALESCE($5,notes), tax_number=COALESCE($6,tax_number), updated_at=CURRENT_TIMESTAMP
         WHERE id=$7 RETURNING *`,
        [name, phone, email, address, notes, tax_number, req.params.id]
      );
      if (!rows[0]) return res.status(404).json({ error: 'العميل غير موجود' });
      res.json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete customer
  router.delete('/api/customers/:id', authenticateToken, async (req, res) => {
    try {
      const { rows } = await pool.query('DELETE FROM customers WHERE id=$1 RETURNING id', [req.params.id]);
      if (!rows[0]) return res.status(404).json({ error: 'العميل غير موجود' });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delivery Endpoints
  
  router.get("/api/delivery/drivers", async (req, res) => {
    try {
      const { branchId } = req.query;
      let query = `
        SELECT e.id, e.name, e.branch_id, d.name as dept_name, e.job_title
        FROM employees e
        LEFT JOIN hr_departments d ON e.department_id = d.id
        WHERE (d.name LIKE '%دليفر%' 
           OR d.name LIKE '%دلفري%'
           OR d.name LIKE '%دلفر%'
           OR d.name LIKE '%توصيل%' 
           OR e.job_title LIKE '%طيار%'
           OR e.job_title LIKE '%دليفر%'
           OR e.job_title LIKE '%دلفري%'
           OR e.job_title LIKE '%سائق%'
           OR d.name ILIKE '%deliver%')
      `;
      let params: any[] = [];
      
      if (branchId && branchId !== 'all') {
        params.push(branchId);
        query += ` AND (e.branch_id = $${params.length} OR e.branch_id IS NULL)`;
      }
      
      const result = await pool.query(query, params);
      
      // Fallback: If no drivers matched the string patterns, but there are employees in exactly a department named exactly what they might have typed, let's just return all employees for that branch as a last resort if result is 0?
      // No, let's keep it strictly to what the query matches.
      
      res.json(result.rows);
    } catch (error) {
      console.error("Failed to fetch drivers:", error);
      res.status(500).json({ error: "Failed to fetch drivers" });
    }
  });

  router.get("/api/delivery/orders", async (req, res) => {
    try {
      const { branchId } = req.query;
      let query = `
        SELECT o.*, b.name as branch_name, e.name as driver_name 
        FROM orders o 
        LEFT JOIN branches b ON o.branch_id = b.id 
        LEFT JOIN employees e ON o.delivery_driver_id = e.id
        WHERE o.order_type = 'delivery'
      `;
      let params: any[] = [];
      
      if (branchId && branchId !== 'all') {
        query += ` AND o.branch_id = $1`;
        params.push(branchId);
      }
      
      query += ` ORDER BY o.timestamp DESC`;
      
      const orders = (await pool.query(query, params)).rows;

      const ordersWithItems = await Promise.all(orders.map(async (order: any) => {
        const items = (await pool.query(`
          SELECT oi.*, p.name as product_name 
          FROM order_items oi 
          JOIN products p ON oi.product_id = p.id 
          WHERE oi.order_id = $1
        `, [order.id])).rows;
        return { ...order, items };
      }));

      res.json(ordersWithItems);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch delivery orders" });
    }
  });

  // Table Management Endpoints
  router.get("/api/branches/:branchId/tables-status", async (req, res) => {
    const { branchId } = req.params;
    try {
      const openOrders = (await pool.query("SELECT table_number, id as order_id, total FROM orders WHERE branch_id = $1 AND is_paid = 0 AND status != 'cancelled'", [branchId])).rows;
      res.json(openOrders);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch tables status" });
    }
  });

  router.get("/api/orders/:id", async (req, res) => {
    const { id } = req.params;
    try {
      const order = (await pool.query("SELECT * FROM orders WHERE id = $1", [id])).rows[0];
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }
      res.json(order);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch order" });
    }
  });

  router.put("/api/orders/:id", async (req, res) => {
    const { id } = req.params;
    const { items, total, notes } = req.body;

    // Month Lock Check
    const now = new Date();
    if (await isMonthClosed(now.getMonth() + 1, now.getFullYear())) {
      return res.status(403).json({ error: "لا يمكن تحديث الطلب في شهر مغلق" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      
      const oldOrder = (await client.query("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [id])).rows[0];
      if (!oldOrder) throw new Error("Order not found");

      let branchWarehouse = (await client.query("SELECT * FROM warehouses WHERE branch_id = $1 AND is_kitchen = 1 LIMIT 1", [oldOrder.branch_id])).rows[0];
      if (!branchWarehouse) {
        branchWarehouse = (await client.query("SELECT * FROM warehouses WHERE branch_id = $1 LIMIT 1", [oldOrder.branch_id])).rows[0];
      }
      
      const modificationDetails = items.map((i: any) => `${i.name || i.id} (x${i.quantity})`).join(', ');
      const modificationRes = await client.query(
        "INSERT INTO order_modifications (order_id, type, old_total, new_total, notes, details) VALUES ($1, 'modification', $2, $3, $4, $5) RETURNING id",
        [id, oldOrder.total, total, notes || "تعديل الطلب", modificationDetails]
      );
      const modificationId = Number(modificationRes.rows[0].id);
      
      // Reverse the old deduction through the central engine.
      if (oldOrder.is_deducted && branchWarehouse) {
        const oldItems = (await client.query("SELECT * FROM order_items WHERE order_id = $1", [id])).rows;
        const moves = new Map<string, number>();
        for (const item of oldItems) {
          const recipe = (await client.query("SELECT ingredient_id, quantity FROM product_ingredients WHERE product_id = $1", [item.product_id])).rows;
          for (const pi of recipe) {
            const qty = Number(pi.quantity || 0) * Number(item.quantity || 1);
            moves.set(String(pi.ingredient_id), (moves.get(String(pi.ingredient_id)) || 0) + qty);
          }
        }
        for (const [ingredientId, qty] of moves) {
          await moveStock(client, { warehouse_id: Number(branchWarehouse.id), ingredient_id: Number(ingredientId), delta: qty, ref_type: "pos_order_edit_reverse", ref_id: modificationId, user: String((req as any).user?.id || "system"), notes: `عكس مخزون تعديل أوردر رقم ${id}` });
          await client.query("INSERT INTO inventory_transactions (warehouse_id, ingredient_id, quantity, type, reference_id, notes) VALUES ($1, $2, $3, 'in', $4, $5)", [branchWarehouse.id, ingredientId, qty, id, `عكس مخزون تعديل أوردر رقم ${id}`]);
        }
      }

      // Delete existing items
      await client.query("DELETE FROM order_items WHERE order_id = $1", [id]);
      
      // Insert new items
      for (const item of items) {
        await client.query("INSERT INTO order_items (order_id, product_id, size_name, quantity, price) VALUES ($1, $2, $3, $4, $5)", [id, item.id, item.selectedSize?.name || null, item.quantity, item.price]);
      }
      
      // Apply the replacement deduction through the central engine.
      if (oldOrder.is_deducted && branchWarehouse) {
        const moves = new Map<string, number>();
        for (const item of items) {
          const recipe = (await client.query("SELECT ingredient_id, quantity FROM product_ingredients WHERE product_id = $1", [item.id])).rows;
          for (const pi of recipe) {
            const qty = Number(pi.quantity || 0) * Number(item.quantity || 1);
            moves.set(String(pi.ingredient_id), (moves.get(String(pi.ingredient_id)) || 0) + qty);
          }
        }
        for (const [ingredientId, qty] of moves) {
          await moveStock(client, { warehouse_id: Number(branchWarehouse.id), ingredient_id: Number(ingredientId), delta: -qty, ref_type: "pos_order_edit_apply", ref_id: modificationId, user: String((req as any).user?.id || "system"), notes: `خصم مخزون تعديل أوردر رقم ${id}` });
          await client.query("INSERT INTO inventory_transactions (warehouse_id, ingredient_id, quantity, type, reference_id, notes) VALUES ($1, $2, $3, 'out', $4, $5)", [branchWarehouse.id, ingredientId, qty, id, `خصم مخزون تعديل أوردر رقم ${id}`]);
        }
      }

      // Update order total and notes
      await client.query("UPDATE orders SET total = $1, notes = $2 WHERE id = $3", [total, notes, id]);
      
      // Update Safe balance (difference)
      if (oldOrder.is_paid) {
        const diff = total - oldOrder.total;
        const safe = (await client.query("SELECT * FROM safes WHERE branch_id = $1", [oldOrder.branch_id])).rows[0];
        if (safe) {
          await client.query("UPDATE safes SET balance = balance + $1 WHERE id = $2", [diff, safe.id]);
          await client.query(
            "INSERT INTO safe_transactions (safe_id, amount, type, notes) VALUES ($1, $2, $3, $4)",
            [safe.id, Math.abs(diff), diff >= 0 ? 'in' : 'out', `تعديل أوردر رقم ${id}`]
          );
        }
      }

      await client.query("COMMIT");

      const fullOrder = (await pool.query(`
        SELECT o.*, b.name as branch_name 
        FROM orders o 
        LEFT JOIN branches b ON o.branch_id = b.id 
        WHERE o.id = $1
      `, [id])).rows[0];
      
      const orderItems = (await pool.query(`
        SELECT oi.*, p.name as product_name 
        FROM order_items oi 
        JOIN products p ON oi.product_id = p.id 
        WHERE oi.order_id = $1
      `, [id])).rows;
      
      io.emit("order_updated", { ...fullOrder, items: orderItems });

      res.json({ success: true });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Failed to update order", error);
      res.status(500).json({ error: "Failed to update order" });
    } finally {
      client.release();
    }
  });

  router.get("/api/orders/:orderId/items", async (req, res) => {
    const { orderId } = req.params;
    try {
      const items = (await pool.query(`
        SELECT oi.*, p.name, p.image 
        FROM order_items oi 
        JOIN products p ON oi.product_id = p.id 
        WHERE oi.order_id = $1
      `, [orderId])).rows;
      res.json(items);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch order items" });
    }
  });

  router.post("/api/orders/:orderId/add-items", async (req, res) => {
    const { orderId } = req.params;
    const { items, additionalTotal, notes, additionalDiscount } = req.body;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      
      const order = (await client.query("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [orderId])).rows[0];
      if (!order) throw new Error("Order not found");

      const additionDetails = items.map((i: any) => `${i.name || i.id} (x${i.quantity})`).join(', ');
      const additionRes = await client.query(
        "INSERT INTO order_modifications (order_id, type, old_total, new_total, notes, details) VALUES ($1, 'addition', $2, $3, $4, $5) RETURNING id",
        [orderId, order.total, order.total + Math.max(0, Number(additionalTotal) - Number(additionalDiscount || 0)), notes || "إضافة عناصر", additionDetails]
      );
      const additionId = Number(additionRes.rows[0].id);

      for (const item of items) {
        await client.query("INSERT INTO order_items (order_id, product_id, size_name, quantity, price) VALUES ($1, $2, $3, $4, $5)", [orderId, item.id, item.selectedSize?.name || null, item.quantity, item.price]);
      }
      
      const adjustedTotalInput = Math.max(0, Number(additionalTotal) - Number(additionalDiscount || 0));
      let updateQuery = "UPDATE orders SET total = total + $1, discount = COALESCE(discount, 0) + $2";
      const updateParams: any[] = [adjustedTotalInput, additionalDiscount || 0];
      
      if (notes) {
        updateQuery += ", notes = CASE WHEN notes IS NULL OR notes = '' THEN $3 ELSE notes || '\n' || $4 END";
        updateParams.push(notes, notes);
      }
      
      updateQuery += ` WHERE id = $${updateParams.length + 1}`;
      updateParams.push(orderId);
      
      await client.query(updateQuery, updateParams);

      if (order.is_deducted) {
        let branchWarehouse = (await client.query("SELECT id FROM warehouses WHERE branch_id = $1 AND is_kitchen = 1 LIMIT 1", [order.branch_id])).rows[0];
        if (!branchWarehouse) branchWarehouse = (await client.query("SELECT id FROM warehouses WHERE branch_id = $1 LIMIT 1", [order.branch_id])).rows[0];
        if (!branchWarehouse) throw new Error("لا يوجد مخزن للفرع لتنفيذ الإضافة");
        const moves = new Map<string, number>();
        for (const item of items) {
          const recipe = (await client.query("SELECT ingredient_id, quantity FROM product_ingredients WHERE product_id = $1", [item.id])).rows;
          for (const pi of recipe) {
            const qty = Number(pi.quantity || 0) * Number(item.quantity || 1);
            moves.set(String(pi.ingredient_id), (moves.get(String(pi.ingredient_id)) || 0) + qty);
          }
        }
        for (const [ingredientId, qty] of moves) {
          await moveStock(client, { warehouse_id: Number(branchWarehouse.id), ingredient_id: Number(ingredientId), delta: -qty, ref_type: "pos_order_add", ref_id: additionId, user: String((req as any).user?.id || "system"), notes: `خصم مقادير إضافية لأوردر رقم ${orderId}` });
          await client.query("INSERT INTO inventory_transactions (warehouse_id, ingredient_id, quantity, type, reference_id, notes) VALUES ($1, $2, $3, 'out', $4, $5)", [branchWarehouse.id, ingredientId, qty, orderId, `خصم مقادير إضافية لأوردر رقم ${orderId}`]);
        }
      }
      
      await client.query("COMMIT");
      
      const numericOrderId = parseInt(orderId);
      
      // Print added items to kitchen
      printOrderToKitchen(numericOrderId, items, { order_type: order.order_type, table_number: order.table_number, notes: notes ? `إضافة: ${notes}` : 'إضافة عناصر' }, order.branch_id);
      
      const fullOrder = (await pool.query(`
        SELECT o.*, b.name as branch_name 
        FROM orders o 
        LEFT JOIN branches b ON o.branch_id = b.id 
        WHERE o.id = $1
      `, [orderId])).rows[0];
      
      const orderItems = (await pool.query(`
        SELECT oi.*, p.name as product_name 
        FROM order_items oi 
        JOIN products p ON oi.product_id = p.id 
        WHERE oi.order_id = $1
      `, [orderId])).rows;
      
      io.emit("order_updated", { ...fullOrder, items: orderItems });

      res.json({ success: true, dailyNumber: fullOrder.daily_number || parseInt(orderId) });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Failed to add items to order", error);
      res.status(500).json({ error: "Failed to add items to order" });
    } finally {
      client.release();
    }
  });

  router.post("/api/orders/:orderId/checkout", async (req, res) => {
    const { orderId } = req.params;
    const { user_id, payment_method = 'cash' } = req.body || {};

    // Month Lock Check
    const now = new Date();
    if (await isMonthClosed(now.getMonth() + 1, now.getFullYear())) {
      return res.status(403).json({ error: "لا يمكن إتمام الطلب في شهر مغلق" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      
      const order = (await client.query("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [orderId])).rows[0];
      if (!order) throw new Error("Order not found");
      
      if (Boolean(order.is_paid)) { await client.query("COMMIT"); return res.json({ success: true, alreadyPaid: true }); }

      await client.query("UPDATE orders SET is_paid = 1, payment_method = $2 WHERE id = $1", [orderId, payment_method]);
      
      // Update Safe
      const safe = (await client.query("SELECT * FROM safes WHERE branch_id = $1", [order.branch_id])).rows[0];
      if (safe) {
        const methodNames: Record<string, string> = {
          cash: 'كاش',
          wallet: 'محفظة إلكترونية',
          instapay: 'إنستا باي',
          visa: 'فيزا / بطاقة',
          mastercard: 'ماستر كارد',
          credit: 'آجل / حساب عميل',
          mixed: 'دفع مختلط'
        };
        const methodNameAr = methodNames[payment_method] || 'كاش';

        await client.query("UPDATE safes SET balance = balance + $1 WHERE id = $2", [order.total, safe.id]);
        await client.query(
          "INSERT INTO safe_transactions (safe_id, amount, type, notes, user_id, payment_method) VALUES ($1, $2, 'sale', $3, $4, $5)",
          [safe.id, order.total, `تحصيل أوردر رقم ${orderId} (${methodNameAr})`, user_id || null, payment_method]
        );
      }

      await client.query("COMMIT");
      res.json({ success: true });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Checkout error:", error);
      res.status(500).json({ error: "Failed to checkout order" });
    } finally {
      client.release();
    }
  });

  router.post("/api/orders/:id/cancel", async (req, res) => {
    const { id } = req.params;
    const { notes } = req.body;

    // Month Lock Check
    const now = new Date();
    if (await isMonthClosed(now.getMonth() + 1, now.getFullYear())) {
      return res.status(403).json({ error: "لا يمكن إلغاء الطلب في شهر مغلق" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      
      const order = (await client.query("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [id])).rows[0];
      if (!order) throw new Error("Order not found");
      if (order.status === 'cancelled') { await client.query("COMMIT"); return res.json({ success: true, alreadyCancelled: true }); }
      
      // 1. Update order status
      await client.query("UPDATE orders SET status = 'cancelled' WHERE id = $1", [id]);
      
      // 2. Record modification
      await client.query(
        "INSERT INTO order_modifications (order_id, type, old_total, notes) VALUES ($1, 'cancellation', $2, $3)",
        [id, order.total, notes]
      );
      
      // 3. Update Safe balance (subtract)
      if (order.is_paid) {
        const safe = (await client.query("SELECT * FROM safes WHERE branch_id = $1", [order.branch_id])).rows[0];
        if (safe) {
          await client.query("UPDATE safes SET balance = balance - $1 WHERE id = $2", [order.total, safe.id]);
          await client.query(
            "INSERT INTO safe_transactions (safe_id, amount, type, notes) VALUES ($1, $2, 'out', $3)",
            [safe.id, order.total, `إلغاء أوردر رقم ${id}`]
          );
        }
      }

      // 4. Reverse inventory deduction exactly once via the central engine.
      if (order.is_deducted) {
        let branchWarehouse = (await client.query("SELECT id FROM warehouses WHERE branch_id = $1 AND is_kitchen = 1 LIMIT 1", [order.branch_id])).rows[0];
        if (!branchWarehouse) branchWarehouse = (await client.query("SELECT id FROM warehouses WHERE branch_id = $1 LIMIT 1", [order.branch_id])).rows[0];
        if (!branchWarehouse) throw new Error("لا يوجد مخزن للفرع لعكس حركة المخزون");
        const items = (await client.query("SELECT * FROM order_items WHERE order_id = $1", [id])).rows;
        const stockMoves = new Map<string, number>();
        for (const item of items) {
          const recipe = await client.query("SELECT ingredient_id, quantity FROM product_ingredients WHERE product_id = $1", [item.product_id]);
          for (const pi of recipe.rows) {
            const qty = Number(pi.quantity || 0) * Number(item.quantity || 1);
            if (qty <= 0) continue;
            const key = String(pi.ingredient_id);
            stockMoves.set(key, (stockMoves.get(key) || 0) + qty);
          }
        }
        for (const [ingredientId, qty] of stockMoves) {
          await moveStock(client, { warehouse_id: Number(branchWarehouse.id), ingredient_id: Number(ingredientId), delta: qty, ref_type: "pos_sale_cancel", ref_id: Number(id), user: String((req as any).user?.id || "system"), notes: `استرجاع مقادير أوردر ملغي رقم ${id}` });
          await client.query("INSERT INTO inventory_transactions (warehouse_id, ingredient_id, quantity, type, reference_id, notes) VALUES ($1, $2, $3, 'in', $4, $5)", [branchWarehouse.id, ingredientId, qty, id, `استرجاع مقادير أوردر ملغي رقم ${id}`]);
        }
        await client.query("UPDATE orders SET is_deducted = 0 WHERE id = $1", [id]);
      }

      await client.query("COMMIT");
      res.json({ success: true });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Cancel order error:", error);
      res.status(500).json({ error: "Failed to cancel order" });
    } finally {
      client.release();
    }
  });

  // Branch Management Endpoints
  router.get("/api/branches", async (req, res) => {
    try {
      const branches = (await pool.query("SELECT * FROM branches")).rows;
      res.json(branches);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch branches" });
    }
  });

  // Delivery Areas Endpoints
  router.get("/api/delivery-areas", async (req, res) => {
    const { branch_id } = req.query;
    try {
      let query = "SELECT * FROM delivery_areas";
      let params: any[] = [];
      if (branch_id) {
        query += " WHERE branch_id = $1";
        params.push(branch_id);
      }
      const areas = (await pool.query(query, params)).rows;
      res.json(areas);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch delivery areas" });
    }
  });

  router.post("/api/delivery-areas", authenticateToken, async (req, res) => {
    const { id, branch_id, name, price, is_active } = req.body;
    try {
      await pool.query(
        "INSERT INTO delivery_areas (id, branch_id, name, price, is_active) VALUES ($1, $2, $3, $4, $5)",
        [id, branch_id, name, price || 0, is_active !== false]
      );
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to add delivery area" });
    }
  });

  router.put("/api/delivery-areas/:id", authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { name, price, is_active } = req.body;
    try {
      await pool.query(
        "UPDATE delivery_areas SET name = $1, price = $2, is_active = $3 WHERE id = $4",
        [name, price || 0, is_active !== false, id]
      );
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to update delivery area" });
    }
  });

  router.delete("/api/delivery-areas/:id", authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
      await pool.query("DELETE FROM delivery_areas WHERE id = $1", [id]);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete delivery area" });
    }
  });

  // Printers Endpoints
  router.get("/api/printers", async (req, res) => {
    const { branch_id } = req.query;
    try {
      let query = "SELECT * FROM printers";
      let params: any[] = [];
      if (branch_id) {
        query += " WHERE branch_id = $1";
        params.push(branch_id);
      }
      const printers = (await pool.query(query, params)).rows;
      const formattedPrinters = printers.map((p: any) => ({
        ...p,
        category_ids: p.category_ids ? (typeof p.category_ids === 'string' ? JSON.parse(p.category_ids) : p.category_ids) : []
      }));
      res.json(formattedPrinters);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch printers" });
    }
  });

  router.post("/api/printers", async (req, res) => {
    const { name, ip_address, port, is_active, branch_id, category_ids, connection_type, system_printer_name } = req.body;
    try {
      const result = await pool.query(
        "INSERT INTO printers (name, ip_address, port, is_active, branch_id, category_ids, connection_type, system_printer_name) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
        [name, ip_address || '', port || 9100, is_active === undefined ? 1 : is_active, branch_id || null, category_ids ? JSON.stringify(category_ids) : null, connection_type || 'ip', system_printer_name || null]
      );
      res.json({ id: result.rows[0].id });
    } catch (error) {
      res.status(500).json({ error: "Failed to add printer" });
    }
  });

  router.put("/api/printers/:id", async (req, res) => {
    const { id } = req.params;
    const { name, ip_address, port, is_active, branch_id, category_ids, connection_type, system_printer_name } = req.body;
    try {
      await pool.query(
        "UPDATE printers SET name = $1, ip_address = $2, port = $3, is_active = $4, branch_id = $5, category_ids = $6, connection_type = $7, system_printer_name = $8 WHERE id = $9",
        [name, ip_address || '', port || 9100, is_active === undefined ? 1 : is_active, branch_id || null, category_ids ? JSON.stringify(category_ids) : null, connection_type || 'ip', system_printer_name || null, id]
      );
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to update printer" });
    }
  });

  router.get("/api/system-printers", async (req, res) => {
    try {
      const { exec } = await import('child_process');
      exec('powershell "Get-Printer | Select-Object Name | ConvertTo-Json"', (err: any, stdout: string) => {
        if (err) {
          res.json([]);
          return;
        }
        try {
          const parsed = JSON.parse(stdout);
          const list = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
          res.json(list.map(p => p.Name).filter(Boolean));
        } catch (e) {
          res.json([]);
        }
      });
    } catch (error) {
      res.json([]);
    }
  });

  router.delete("/api/printers/:id", async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE categories SET printer_id = NULL WHERE printer_id = $1", [id]);
      await client.query("DELETE FROM printers WHERE id = $1", [id]);
      await client.query("COMMIT");
      res.json({ success: true });
    } catch (error) {
      await client.query("ROLLBACK");
      res.status(500).json({ error: "Failed to delete printer" });
    } finally {
      client.release();
    }
  });

  router.get("/api/reports/orders/modifications", authenticateToken, async (req: any, res: any) => {
    const user = req.user;
    try {
      let query = `
        SELECT 
          om.id as "م",
          om.order_id as "رقم الطلب",
          o.daily_number as "رقم الطلب اليومي",
          CASE WHEN om.type = 'cancellation' THEN 'إلغاء' ELSE 'تعديل' END as "نوع العملية",
          om.old_total as "الإجمالي القديم",
          om.new_total as "الإجمالي الجديد",
          om.notes as "ملاحظات",
          TO_CHAR(om.date, 'YYYY-MM-DD HH24:MI:SS') as "التاريخ",
          b.name as "الفرع",
          om.details as "تفاصيل التعديل"
        FROM order_modifications om
        JOIN orders o ON om.order_id = o.id
        JOIN branches b ON o.branch_id = b.id
        WHERE 1=1
      `;
      const params: any[] = [];

      // Branch filtering
      if (user.role !== 'admin' && user.branch_id) {
        params.push(user.branch_id);
        query += ` AND o.branch_id = $${params.length}`;
      }

      // Date filtering
      const { startDate, endDate, from, to } = req.query;
      const start = startDate || from;
      const end = endDate || to;
      if (start) {
        params.push(start);
        query += ` AND om.date >= $${params.length}::timestamp`;
      }
      if (end) {
        params.push(`${end} 23:59:59`);
        query += ` AND om.date <= $${params.length}::timestamp`;
      }

      query += " ORDER BY om.date DESC";
      
      const modifications = (await pool.query(query, params)).rows;
      res.json(modifications);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch modifications" });
    }
  });

  router.post("/api/branches", async (req, res) => {
    const { name, tables_count } = req.body;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        "INSERT INTO branches (name, tables_count) VALUES ($1, $2) RETURNING id",
        [name, tables_count]
      );
      const branchId = result.rows[0].id;
      
      // Automatically create a warehouse for the new branch
      await client.query("INSERT INTO warehouses (name, type, branch_id) VALUES ($1, 'branch', $2)", [`مخزن ${name}`, branchId]);
      
      // Automatically create a kitchen warehouse for the new branch
      await client.query("INSERT INTO warehouses (name, type, branch_id, is_kitchen) VALUES ($1, 'branch', $2, 1)", [`المخزن التشغيلي - ${name}`, branchId]);
      
      // Automatically create a safe for the new branch
      await client.query("INSERT INTO safes (name, branch_id, balance) VALUES ($1, $2, 0)", [`خزينة ${name}`, branchId]);
      
      await client.query("COMMIT");
      res.json({ id: branchId });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Failed to add branch:", error);
      res.status(500).json({ error: "Failed to add branch" });
    } finally {
      client.release();
    }
  });

  router.put("/api/branches/:id", async (req, res) => {
    const { id } = req.params;
    const { name, tables_count } = req.body;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE branches SET name = $1, tables_count = $2 WHERE id = $3", [name, tables_count, id]);
      
      // Update the corresponding warehouse name
      await client.query("UPDATE warehouses SET name = $1 WHERE branch_id = $2 AND is_kitchen = 0", [`مخزن ${name}`, id]);
      await client.query("UPDATE warehouses SET name = $1 WHERE branch_id = $2 AND is_kitchen = 1", [`المخزن التشغيلي - ${name}`, id]);
      
      // Update the corresponding safe name
      await client.query("UPDATE safes SET name = $1 WHERE branch_id = $2", [`خزينة ${name}`, id]);
      
      await client.query("COMMIT");
      res.json({ success: true });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Failed to update branch:", error);
      res.status(500).json({ error: "Failed to update branch" });
    } finally {
      client.release();
    }
  });

  router.delete("/api/branches/:id", async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const inOrdersResult = await client.query("SELECT COUNT(*) as count FROM orders WHERE branch_id = $1", [id]);
      if (parseInt(inOrdersResult.rows[0].count) > 0) {
        throw new Error("Cannot delete branch because it has orders");
      }

      // Delete warehouse transactions
      const warehouses = (await client.query("SELECT id FROM warehouses WHERE branch_id = $1", [id])).rows;
      for (const warehouse of warehouses) {
        await client.query("DELETE FROM inventory_transactions WHERE warehouse_id = $1", [warehouse.id]);
        await client.query("DELETE FROM inventory_items WHERE warehouse_id = $1", [warehouse.id]);
      }
      await client.query("DELETE FROM warehouses WHERE branch_id = $1", [id]);
      
      // Delete safe transactions
      const safe = (await client.query("SELECT id FROM safes WHERE branch_id = $1", [id])).rows[0];
      if (safe) {
        await client.query("DELETE FROM safe_transactions WHERE safe_id = $1", [safe.id]);
      }
      await client.query("DELETE FROM safes WHERE branch_id = $1", [id]);
      
      // Delete the branch
      await client.query("DELETE FROM branches WHERE id = $1", [id]);
      
      await client.query("COMMIT");
      res.json({ success: true });
    } catch (error: any) {
      await client.query("ROLLBACK");
      console.error("Failed to delete branch:", error);
      res.status(500).json({ error: error.message || "Failed to delete branch" });
    } finally {
      client.release();
    }
  });

export default router;
