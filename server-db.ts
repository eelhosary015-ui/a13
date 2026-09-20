import pg from "pg";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

const { Pool } = pg;

const dbFilePath = path.join(process.cwd(), "backups", "offline-db.json");

// Ensure backups dir exists
if (!fs.existsSync(path.dirname(dbFilePath))) {
  fs.mkdirSync(path.dirname(dbFilePath), { recursive: true });
}

// In-memory DB state
let dbState: Record<string, any[]> = {};

function loadDb() {
  try {
    if (fs.existsSync(dbFilePath)) {
      const raw = fs.readFileSync(dbFilePath, "utf8").trim();
      if (raw) {
        try {
          dbState = JSON.parse(raw);
        } catch (parseError) {
          console.error("SyntaxError parsing offline-db.json, attempting to recover or reset:", parseError);
          try {
            // Replace raw unescaped control characters except tabs and newlines
            const sanitized = raw.replace(/[\x00-\x08\x0b-\x0c\x0e-\x1f]/g, "");
            dbState = JSON.parse(sanitized);
            console.log("Successfully recovered offline-db.json after sanitizing control characters.");
          } catch (e) {
            console.error("Failed to parse even after sanitizing. Initializing empty database state:", e);
            dbState = {};
            // Auto-overwrite the corrupt file with a valid empty JSON so this error never repeats
            try {
              fs.writeFileSync(dbFilePath, "{}", "utf8");
              console.log("Auto-repaired backups/offline-db.json with fresh state {}");
            } catch (errWrite) {
              console.error("Could not write clean db file:", errWrite);
            }
          }
        }
      }
    }
    
    // Ensure cost_centers array exists without forced mock items
    if (!dbState["cost_centers"]) {
      dbState["cost_centers"] = [];
    }

    // Ensure cost_items array exists without forced mock items
    if (!dbState["cost_items"]) {
      dbState["cost_items"] = [];
    }

    // Ensure operating_costs array exists without dummy data
    if (!dbState["operating_costs"]) {
      dbState["operating_costs"] = [];
    }

    // Ensure suppliers array exists
    if (!dbState["suppliers"]) {
      dbState["suppliers"] = [];
    }

    if (!dbState["inventory_movements"]) {
      dbState["inventory_movements"] = [];
    }

    if (!dbState["production_orders"]) {
      dbState["production_orders"] = [];
    }

    if (!dbState["production_runs"]) {
      dbState["production_runs"] = [];
    }

    if (!dbState["production_boms"]) {
      dbState["production_boms"] = [];
    }

    if (!dbState["stock_batches"]) {
      dbState["stock_batches"] = [];
    }

    if (!dbState["inventory_notifications"]) {
      dbState["inventory_notifications"] = [];
    }

    if (!dbState["fingerprint_devices"]) {
      dbState["fingerprint_devices"] = [];
    }

    // Supplier ratings
    if (!dbState["supplier_ratings"]) {
      dbState["supplier_ratings"] = [];
    }

    if (!dbState["material_requests"]) {
      dbState["material_requests"] = [];
    }

    if (!dbState["material_request_items"]) {
      dbState["material_request_items"] = [];
    }

    // Seed Treasury Custody Types if empty
    if (!dbState["treasury_custody_types"] || dbState["treasury_custody_types"].length === 0) {
      dbState["treasury_custody_types"] = [
        { id: 1, code: 'CUST-CASH', name_ar: 'عهدة نقدية / مشتريات ونثريات', name_en: 'Cash Custody / Petty Cash', category: 'cash', requires_asset: false, requires_inventory: false, requires_treasury: true, max_limit: 50000, default_duration_days: 30, is_active: true, description: 'عهدة مالية نقدية للمشتريات العاجلة والمصروفات اليومية والنثريات' },
        { id: 2, code: 'CUST-ASSET', name_ar: 'عهدة أصول ثابتة', name_en: 'Fixed Asset Custody', category: 'asset', requires_asset: true, requires_inventory: false, requires_treasury: false, max_limit: 0, default_duration_days: 365, is_active: true, description: 'تسليم أصول ثابتة مسجلة بسجل الأصول (مكاتب، أجهزة، معدات ثقيلة) للموظف' },
        { id: 3, code: 'CUST-EQUIP', name_ar: 'عهدة أجهزة ومعدات إلكترونية', name_en: 'Equipment & Hardware Custody', category: 'equipment', requires_asset: true, requires_inventory: false, requires_treasury: false, max_limit: 0, default_duration_days: 180, is_active: true, description: 'تسليم لابتوبات، هواتف، أجهزة كاشير، طابعات وشاشات للموظف للعمل' },
        { id: 4, code: 'CUST-TOOLS', name_ar: 'عهدة أدوات ومعدات تشغيل', name_en: 'Tools & Operations Custody', category: 'tools', requires_asset: false, requires_inventory: false, requires_treasury: false, max_limit: 0, default_duration_days: 90, is_active: true, description: 'أدوات الصيانة والمطبخ والتشغيل الفندقي والعدد اليدوية' },
        { id: 5, code: 'CUST-INV', name_ar: 'عهدة أصناف ومواد من المخزن', name_en: 'Warehouse Inventory Custody', category: 'inventory', requires_asset: false, requires_inventory: true, requires_treasury: false, max_limit: 0, default_duration_days: 30, is_active: true, description: 'صرف مواد وخامات من المخزن تحت عهدة المشرف للاستهلاك والتشغيل' },
        { id: 6, code: 'CUST-VEHICLE', name_ar: 'عهدة سيارة أو مركبة أو دراجة', name_en: 'Vehicle / Fleet Custody', category: 'vehicle', requires_asset: true, requires_inventory: false, requires_treasury: false, max_limit: 0, default_duration_days: 365, is_active: true, description: 'تسليم مركبات التوصيل أو سيارات الشركة لسائق أو مندوب محدد' },
        { id: 7, code: 'CUST-KEYS', name_ar: 'عهدة مفاتيح وكروت وتصاريح أمنية', name_en: 'Keys, Badges & Permits Custody', category: 'keys_permits', requires_asset: false, requires_inventory: false, requires_treasury: false, max_limit: 0, default_duration_days: 365, is_active: true, description: 'مفاتيح الخزائن، كروت الدخول الذكية، تصاريح البوابات والأختام' },
        { id: 8, code: 'CUST-TEMP', name_ar: 'عهدة نقدية مؤقتة لمهمة محددة', name_en: 'Temporary Project Custody', category: 'temporary', requires_asset: false, requires_inventory: false, requires_treasury: true, max_limit: 20000, default_duration_days: 15, is_active: true, description: 'عهدة تصرف لمهمة مؤقتة أو مشروع خارجي محدد المدة بحد أقصى 15 يوماً' },
        { id: 9, code: 'CUST-PERM', name_ar: 'عهدة تشغيلية مستديمة (Imprest)', name_en: 'Permanent Operational Custody', category: 'permanent', requires_asset: false, requires_inventory: false, requires_treasury: true, max_limit: 100000, default_duration_days: 365, is_active: true, description: 'عهدة دائمة متجددة للمشرفين يتم استعاضتها دورياً بناءً على فواتير التسوية' }
      ];
    }

    // Seed Treasury Settings if empty
    if (!dbState["treasury_settings"] || dbState["treasury_settings"].length === 0) {
      dbState["treasury_settings"] = [
        { key: 'custody_approval_tier1_limit', value: '5000', description: 'حد موافقة مدير القسم / الفرع للعهدة (ج.م)' },
        { key: 'custody_approval_tier2_limit', value: '20000', description: 'حد موافقة المدير المالي للعهدة (ج.م)' },
        { key: 'custody_approval_tier3_limit', value: '50000', description: 'حد موافقة الإدارة العليا / المدير العام (ج.م)' },
        { key: 'custody_default_due_days', value: '30', description: 'المدة الافتراضية للعهدة المؤقتة بالأيام' },
        { key: 'custody_auto_journal_posting', value: 'true', description: 'إنشاء القيود اليومية التلقائية عند الصرف والتسوية' },
        { key: 'custody_allow_partial_settlement', value: 'true', description: 'السماح بالتسوية الجزئية للعهدة' },
        { key: 'custody_overdue_warning_days', value: '3', description: 'عدد أيام التنبيه قبل موعد استحقاق العهدة' },
        { key: 'transfer_approval_tier1_limit', value: '5000', description: 'حد اعتماد مدير الفرع للتحويل المالي (ج.م)' },
        { key: 'transfer_approval_tier2_limit', value: '20000', description: 'حد اعتماد المدير المالي للتحويل المالي (ج.م)' },
        { key: 'transfer_approval_tier3_limit', value: '100000', description: 'حد اعتماد الإدارة العليا للتحويل المالي (ج.م)' },
        { key: 'transfer_auto_journal_posting', value: 'true', description: 'إنشاء وترحيل القيود المحاسبية للتحويل آلياً' },
        { key: 'transfer_require_receipt_for_all', value: 'true', description: 'اشتراط تأكيد الاستلام الفعلي من الخزينة المستهدفة' },
        { key: 'transfer_allow_negative_source', value: 'false', description: 'السماح بالتحويل بالسالب (غير موصى به)' }
      ];
    } else {
      // Ensure transfer settings exist
      const existingKeys = dbState["treasury_settings"].map((s: any) => s.key);
      const defaults = [
        { key: 'transfer_approval_tier1_limit', value: '5000', description: 'حد اعتماد مدير الفرع للتحويل المالي (ج.م)' },
        { key: 'transfer_approval_tier2_limit', value: '20000', description: 'حد اعتماد المدير المالي للتحويل المالي (ج.م)' },
        { key: 'transfer_approval_tier3_limit', value: '100000', description: 'حد اعتماد الإدارة العليا للتحويل المالي (ج.م)' },
        { key: 'transfer_auto_journal_posting', value: 'true', description: 'إنشاء وترحيل القيود المحاسبية للتحويل آلياً' },
        { key: 'transfer_require_receipt_for_all', value: 'true', description: 'اشتراط تأكيد الاستلام الفعلي من الخزينة المستهدفة' },
        { key: 'transfer_allow_negative_source', value: 'false', description: 'السماح بالتحويل بالسالب (غير موصى به)' }
      ];
      defaults.forEach(d => {
        if (!existingKeys.includes(d.key)) {
          dbState["treasury_settings"].push(d);
        }
      });
    }

    // Seed Treasury Transfer Types if empty
    if (!dbState["treasury_transfer_types"] || dbState["treasury_transfer_types"].length === 0) {
      dbState["treasury_transfer_types"] = [
        { id: 1, code: 'TRF-SAFE-SAFE', name_ar: 'تحويل بين الخزائن النقدية', name_en: 'Safe to Safe Transfer', source_type: 'safe', destination_type: 'safe', requires_receipt_confirmation: true, requires_approval: true, max_limit: 100000, is_active: true, description: 'نقل ونقل عهدة نقدية بين خزينة وأخرى في نفس الفرع أو فرع آخر' },
        { id: 2, code: 'TRF-SAFE-BANK', name_ar: 'إيداع نقدي من خزينة إلى بنك', name_en: 'Safe to Bank Deposit', source_type: 'safe', destination_type: 'bank', requires_receipt_confirmation: true, requires_approval: true, max_limit: 500000, is_active: true, description: 'إيداع إيرادات أو سيولة نقدية من الخزينة إلى الحساب البنكي' },
        { id: 3, code: 'TRF-BANK-SAFE', name_ar: 'سحب بنكي لتغذية الخزينة', name_en: 'Bank Withdrawal to Safe', source_type: 'bank', destination_type: 'safe', requires_receipt_confirmation: true, requires_approval: true, max_limit: 300000, is_active: true, description: 'صرف شيك أو سحب إلكتروني من البنك لتغذية سيولة الخزينة' },
        { id: 4, code: 'TRF-BANK-BANK', name_ar: 'تحويل بنكي بين الحسابات المصرفية', name_en: 'Bank to Bank Transfer', source_type: 'bank', destination_type: 'bank', requires_receipt_confirmation: false, requires_approval: true, max_limit: 1000000, is_active: true, description: 'تحويل مصرفي مباشر بين حسابات الشركة البنكية المختلفة' },
        { id: 5, code: 'TRF-BRANCH', name_ar: 'تحويل مالي بين الفروع', name_en: 'Inter-Branch Transfer', source_type: 'any', destination_type: 'any', requires_receipt_confirmation: true, requires_approval: true, max_limit: 250000, is_active: true, description: 'تحويل عهدة وسيولة مالية بين فروع الشركة' },
        { id: 6, code: 'TRF-COSTCENTER', name_ar: 'تحويل بين مراكز التكلفة', name_en: 'Cost Center Transfer', source_type: 'any', destination_type: 'any', requires_receipt_confirmation: false, requires_approval: true, max_limit: 150000, is_active: true, description: 'مناقلة مالية بين مراكز التكلفة والمشاريع' }
      ];
    }

    // Ensure treasury operational arrays exist without mock data
    if (!dbState["treasury_transfers"]) dbState["treasury_transfers"] = [];
    if (!dbState["treasury_transfer_audit_logs"]) dbState["treasury_transfer_audit_logs"] = [];
    if (!dbState["treasury_transfer_attachments"]) dbState["treasury_transfer_attachments"] = [];
    if (!dbState["treasury_custodies"]) dbState["treasury_custodies"] = [];
    if (!dbState["treasury_custody_expenses"]) dbState["treasury_custody_expenses"] = [];
    if (!dbState["treasury_custody_items"]) dbState["treasury_custody_items"] = [];
    if (!dbState["treasury_custody_settlements"]) dbState["treasury_custody_settlements"] = [];
    if (!dbState["treasury_custody_audit_logs"]) dbState["treasury_custody_audit_logs"] = [];
    if (!dbState["treasury_closings"]) dbState["treasury_closings"] = [];

    // Ensure ingredients, inventory_items, products and product_ingredients exist without forced dummy data
    if (!dbState["ingredients"]) {
      dbState["ingredients"] = [];
    }
    if (!dbState["inventory_items"]) {
      dbState["inventory_items"] = [];
    } else if (Array.isArray(dbState["inventory_items"])) {
      // Consolidate any duplicate inventory_items rows per (warehouse_id, ingredient_id)
      const consolidatedMap = new Map<string, any>();
      for (const item of dbState["inventory_items"]) {
        const key = `${Number(item.warehouse_id)}:${Number(item.ingredient_id)}`;
        if (!consolidatedMap.has(key)) {
          consolidatedMap.set(key, { ...item });
        } else {
          const existing = consolidatedMap.get(key);
          existing.quantity = (Number(existing.quantity) || 0) + (Number(item.quantity) || 0);
          existing.reserved = (Number(existing.reserved) || 0) + (Number(item.reserved) || 0);
          existing.in_transit = (Number(existing.in_transit) || 0) + (Number(item.in_transit) || 0);
          existing.available = Math.max((Number(existing.quantity) || 0) - (Number(existing.reserved) || 0), 0);
        }
      }
      dbState["inventory_items"] = Array.from(consolidatedMap.values());
    }
    if (!dbState["products"]) {
      dbState["products"] = [];
    }
    if (!dbState["product_ingredients"]) {
      dbState["product_ingredients"] = [];
    }

    saveDb();
  } catch (error) {
    console.error("Failed to load local fallback DB:", error);
  }
}

function saveDb() {
  try {
    fs.writeFileSync(dbFilePath, JSON.stringify(dbState, null, 2), "utf8");
  } catch (error) {
    console.error("Failed to save local fallback DB:", error);
  }
}

loadDb();

function handleFallbackQuery(sql: string, params: any[] = []): { rows: any[]; rowCount: number } {
  const normalizedSql = sql.replace(/\s+/g, " ").trim();
  const lowerSql = normalizedSql.toLowerCase();

  // 1. CREATE TABLE
  if (lowerSql.startsWith("create table")) {
    const match = normalizedSql.match(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-zA-Z0-9_]+)/i);
    if (match) {
      const tableName = match[1];
      if (!dbState[tableName]) {
        dbState[tableName] = [];
        saveDb();
      }
    }
    return { rows: [], rowCount: 0 };
  }

  // 2. ALTER TABLE / CREATE INDEX / COMMIT / BEGIN / ROLLBACK
  if (
    lowerSql.startsWith("alter table") ||
    lowerSql.startsWith("create index") ||
    lowerSql.startsWith("create unique index") ||
    lowerSql === "begin" ||
    lowerSql === "commit" ||
    lowerSql === "rollback" ||
    lowerSql === "select now()"
  ) {
    if (lowerSql === "select now()") {
      return { rows: [{ now: new Date() }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  // 3. SELECT
  if (lowerSql.startsWith("select")) {
    if (lowerSql.includes("to_regclass")) {
      const rawParam = params[0] ? String(params[0]).replace("public.", "").replace(/["']/g, "") : "";
      const exists = Boolean(dbState[rawParam] !== undefined || dbState[rawParam.toLowerCase()] !== undefined);
      return { rows: [{ table_name: exists ? rawParam : null }], rowCount: 1 };
    }

    if (lowerSql.includes("information_schema.tables")) {
      if (lowerSql.includes("exists")) {
        const rawParam = params[0] ? String(params[0]).replace("public.", "").replace(/["']/g, "") : "";
        const exists = Boolean(dbState[rawParam] !== undefined || dbState[rawParam.toLowerCase()] !== undefined);
        return { rows: [{ exists }], rowCount: 1 };
      }
      const tableRows = Object.keys(dbState).map(t => ({ table_name: t }));
      return { rows: tableRows, rowCount: tableRows.length };
    }
    // Intercept join query for ingredients and inventory_items / recipe costing
    if (lowerSql.includes("from ingredients") && (lowerSql.includes("inventory_items") || lowerSql.includes("unit_cost") || lowerSql.includes("available_stock"))) {
      let targetWarehouseId: any = null;
      const warehouseIdMatch = lowerSql.match(/warehouse_id\s*=\s*\$(\d+)/i) || normalizedSql.match(/warehouse_id\s*=\s*\$(\d+)/i);
      if (warehouseIdMatch && params) {
        const paramIndex = parseInt(warehouseIdMatch[1]) - 1;
        targetWarehouseId = params[paramIndex];
      } else {
        const directMatch = normalizedSql.match(/warehouse_id\s*=\s*(\d+)/i);
        if (directMatch) {
          targetWarehouseId = directMatch[1];
        }
      }
      if (params && params.length > 0 && (targetWarehouseId === null || targetWarehouseId === undefined)) {
        targetWarehouseId = params[0];
      }

      const ingredientsList = dbState["ingredients"] || [];
      const inventoryItemsList = dbState["inventory_items"] || [];
      const warehousesList = dbState["warehouses"] || [];
      const warehouseSectionsList = dbState["warehouse_sections"] || [];

      const formatCleanCode = (raw: any, id: any) => {
        if (!raw || raw === "NULL" || raw === "null" || raw === "undefined") return `ITEM-${1000 + Number(id)}`;
        const s = String(raw).trim();
        if (s.startsWith("ITEM-")) return s;
        if (s.startsWith("-")) return `ITEM-${s.replace("-", "")}`;
        if (!isNaN(Number(s))) return `ITEM-${Number(s) >= 1000 ? s : (1000 + Number(s))}`;
        return `ITEM-${1000 + Number(id)}`;
      };

      const formatCleanStr = (raw: any, fallback: string | null = null) => {
        if (!raw || raw === "NULL" || raw === "null" || raw === "undefined") return fallback;
        const s = String(raw).trim();
        return s || fallback;
      };

      const matchedWarehouse = warehousesList.find(
        (w) => String(w.id) === String(targetWarehouseId) || Number(w.id) === Number(targetWarehouseId)
      );

      const joinedRows = ingredientsList.map((ing) => {
        let invItem = null;
        if (targetWarehouseId && targetWarehouseId !== "all" && targetWarehouseId !== "undefined") {
          invItem = inventoryItemsList.find(
            (ii) => (Number(ii.ingredient_id) === Number(ing.id) || String(ii.ingredient_id) === String(ing.id)) &&
                    (Number(ii.warehouse_id) === Number(targetWarehouseId) || String(ii.warehouse_id) === String(targetWarehouseId))
          );
        } else {
          invItem = inventoryItemsList.find(
            (ii) => Number(ii.ingredient_id) === Number(ing.id) || String(ii.ingredient_id) === String(ing.id)
          );
        }

        const secId = invItem ? invItem.section_id : null;
        const section = secId ? warehouseSectionsList.find((s) => Number(s.id) === Number(secId)) : null;
        const cleanCode = formatCleanCode(ing.code || ing.item_code, ing.id);
        const availableStock = invItem ? (Number(invItem.quantity) || Number(invItem.available) || 0) : (Number(ing.current_stock) || 50);
        const avgCost = Number(invItem?.avg_cost || ing.avg_cost || ing.cost || 0);
        const stdCost = Number(invItem?.cost || ing.cost || avgCost || 0);
        const lastCost = Number(invItem?.last_cost || ing.last_purchase_price || avgCost || 0);
        const unitCost = avgCost > 0 ? avgCost : (stdCost > 0 ? stdCost : (lastCost > 0 ? lastCost : Number(ing.cost) || 0));

        return {
          id: ing.id,
          product_id: ing.id,
          name: ing.name || ing.ingredient_name,
          ingredient_name: ing.name || ing.ingredient_name,
          inventory_id: invItem ? invItem.id : null,
          quantity: availableStock,
          book_quantity: availableStock,
          available_stock: availableStock,
          current_stock: availableStock,
          min_stock: Number(ing.min_stock) || (invItem ? Number(invItem.min_quantity) : 0) || 0,
          min_quantity: Number(ing.min_stock) || (invItem ? Number(invItem.min_quantity) : 0) || 0,
          ingredient_id: ing.id,
          unit: ing.unit || "قطعة",
          unit_cost: unitCost,
          cost_price: unitCost,
          cost_per_unit: unitCost,
          cost: stdCost || unitCost,
          standard_cost: stdCost || unitCost,
          avg_cost: avgCost || unitCost,
          last_cost: lastCost || unitCost,
          last_purchase_price: lastCost || unitCost,
          item_code: cleanCode,
          code: cleanCode,
          item_group: formatCleanStr(ing.item_group || ing.category, "خامات عامة"),
          category: formatCleanStr(ing.category || ing.item_group, "خامات عامة"),
          barcode: formatCleanStr(ing.barcode, ""),
          section_id: secId ? Number(secId) : null,
          section_name: section ? section.name : null,
          warehouse_id: matchedWarehouse ? matchedWarehouse.id : (targetWarehouseId && targetWarehouseId !== "all" ? Number(targetWarehouseId) : (warehousesList[0]?.id || 1)),
          warehouse_name: matchedWarehouse ? matchedWarehouse.name : (targetWarehouseId && targetWarehouseId !== "all" ? (warehousesList.find(w => Number(w.id) === Number(targetWarehouseId))?.name || "المخزن الرئيسي") : "جميع المخازن")
        };
      });

      let resultRows = joinedRows;
      const whereMatch = normalizedSql.match(/\s+where\s+(.+?)(?:\s+order\s+by|\s+limit|\s+group\s+by|$)/i);
      if (whereMatch) {
        resultRows = resultRows.filter(r => evaluateConditions(r, whereMatch[1].trim(), params));
      }

      return { rows: resultRows, rowCount: resultRows.length };
    }

    // ─── Warehouse module: stock-intelligence query ───
    if (lowerSql.includes("from inventory_items ii") && lowerSql.includes("join ingredients ing") && lowerSql.includes("join warehouses w")) {
      const invItemsList = dbState["inventory_items"] || [];
      const ingredientsList = dbState["ingredients"] || [];
      const warehousesList = dbState["warehouses"] || [];

      const formatCleanCode = (raw: any, id: any) => {
        if (!raw || raw === "NULL" || raw === "null" || raw === "undefined") return `ITEM-${1000 + Number(id)}`;
        const s = String(raw).trim();
        if (s.startsWith("ITEM-")) return s;
        if (s.startsWith("-")) return `ITEM-${s.replace("-", "")}`;
        if (!isNaN(Number(s))) return `ITEM-${Number(s) >= 1000 ? s : (1000 + Number(s))}`;
        return `ITEM-${1000 + Number(id)}`;
      };

      const formatCleanStr = (raw: any, fallback: string | null = null) => {
        if (!raw || raw === "NULL" || raw === "null" || raw === "undefined") return fallback;
        const s = String(raw).trim();
        return s || fallback;
      };

      let targetWarehouseId: number | null = null;
      const whParamMatch = lowerSql.match(/ii\.warehouse_id\s*=\s*\$(\d+)/i) || lowerSql.match(/warehouse_id\s*=\s*\$(\d+)/i);
      if (whParamMatch) {
        const idx = parseInt(whParamMatch[1]) - 1;
        if (params && params[idx] !== undefined && params[idx] !== null && params[idx] !== "all") {
          targetWarehouseId = Number(params[idx]);
        }
      } else {
        const directWhMatch = lowerSql.match(/ii\.warehouse_id\s*=\s*(\d+)/i) || lowerSql.match(/warehouse_id\s*=\s*(\d+)/i);
        if (directWhMatch) {
          targetWarehouseId = Number(directWhMatch[1]);
        }
      }

      const activeWarehouses = targetWarehouseId
        ? warehousesList.filter((wh: any) => Number(wh.id) === targetWarehouseId)
        : warehousesList;

      let joinedRows: any[] = [];
      for (const wh of activeWarehouses) {
        for (const ing of ingredientsList) {
          const invItem = invItemsList.find((ii: any) => Number(ii.ingredient_id) === Number(ing.id) && Number(ii.warehouse_id) === Number(wh.id));
          const qty = invItem ? Number(invItem.quantity) || 0 : 0;
          const res = invItem ? Number(invItem.reserved) || 0 : 0;
          const inTr = invItem ? Number(invItem.in_transit) || 0 : 0;
          const cost = Number(ing.cost) || Number(ing.avg_cost) || 0;
          const avgCost = invItem ? (Number(invItem.avg_cost) || cost) : cost;
          const cleanCode = formatCleanCode(ing.code || ing.item_code, ing.id);

          joinedRows.push({
            item_id: invItem ? invItem.id : (ing.id * 1000 + wh.id),
            ingredient_id: ing.id,
            warehouse_id: wh.id,
            quantity: qty,
            reserved: res,
            in_transit: inTr,
            available: qty - res,
            location_id: invItem?.location_id || null,
            last_count_date: invItem?.last_count_date || null,
            item_specific_cost: avgCost,

            ingredient_name: ing.name,
            ingredient_code: cleanCode,
            item_code: cleanCode,
            code: cleanCode,
            barcode: formatCleanStr(ing.barcode, ""),
            category: formatCleanStr(ing.category || ing.item_group, null),
            subcategory: formatCleanStr(ing.subcategory, ""),
            brand: formatCleanStr(ing.brand, ""),
            manufacturer: formatCleanStr(ing.manufacturer, ""),
            model: formatCleanStr(ing.model, ""),
            item_type: ing.item_type || "raw_material",
            tracking_type: ing.tracking_type || "none",
            ingredient_unit: ing.unit || "قطعة",
            purchase_unit: ing.purchase_unit || ing.unit || "قطعة",
            sales_unit: ing.sales_unit || ing.unit || "قطعة",
            conversion_factor: 1,
            min_stock: Number(ing.min_stock) || 0,
            max_stock: Number(ing.max_stock) || 0,
            reorder_point: Number(ing.reorder_point) || Number(ing.min_stock) || 0,
            safety_stock: Number(ing.safety_stock) || 0,
            lead_time_days: Number(ing.lead_time_days) || 7,
            cost: cost,
            avg_cost: avgCost,
            last_purchase_price: Number(ing.last_purchase_price) || cost,
            standard_cost: cost,
            valuation_method: ing.valuation_method || "weighted_average",

            warehouse_name: wh.name,
            warehouse_code: wh.code || `WH-${wh.id}`,
            warehouse_type: wh.type || "main",
            supplier_name: null,

            location_code: null,
            location_name: null,
            location_type: null,
            location_zone: null,
            location_rack: null,
            location_shelf: null,
            location_bin: null,

            batch_count: 0,
            earliest_expiry_date: null,
            serial_count: 0,
            reservation_count: 0,
            last_movement: null,
            avg_daily_consumption: 0,
          });
        }
      }

      // Search filter
      const searchMatch = lowerSql.match(/ing\.name ilike \$(\d+)/i);
      if (searchMatch) {
        const idx = parseInt(searchMatch[1]) - 1;
        const sVal = String(params[idx] || "").replace(/%/g, "").toLowerCase();
        if (sVal) {
          joinedRows = joinedRows.filter((r: any) => 
            (r.ingredient_name && r.ingredient_name.toLowerCase().includes(sVal)) ||
            (r.ingredient_code && String(r.ingredient_code).toLowerCase().includes(sVal)) ||
            (r.barcode && String(r.barcode).toLowerCase().includes(sVal)) ||
            (r.warehouse_name && r.warehouse_name.toLowerCase().includes(sVal))
          );
        }
      }

      // Category filter
      const catMatch = lowerSql.match(/ing\.category\s*=\s*\$(\d+)/i);
      if (catMatch) {
        const idx = parseInt(catMatch[1]) - 1;
        const cVal = params[idx];
        if (cVal && cVal !== "all") {
          joinedRows = joinedRows.filter((r: any) => r.category === cVal);
        }
      }

      joinedRows.sort((a: any, b: any) => (a.ingredient_name || "").localeCompare(b.ingredient_name || "", "ar"));
      return { rows: joinedRows, rowCount: joinedRows.length };
    }

    // ─── Grouped inventory by warehouse and ingredient (used by Production checkAvailability) ───
    if (lowerSql.includes("from inventory_items") && lowerSql.includes("group by ingredient_id")) {
      const invItemsList = dbState["inventory_items"] || [];
      let filtered = invItemsList;
      const whIdMatch = lowerSql.match(/warehouse_id\s*=\s*\$(\d+)/i);
      if (whIdMatch) {
        const pIdx = parseInt(whIdMatch[1]) - 1;
        const targetWhId = Number(params[pIdx]);
        filtered = filtered.filter((i: any) => Number(i.warehouse_id) === targetWhId);
      }
      const grouped = new Map<number, any>();
      for (const item of filtered) {
        const ingId = Number(item.ingredient_id);
        if (!grouped.has(ingId)) {
          grouped.set(ingId, {
            ingredient_id: ingId,
            total_quantity: 0,
            total_reserved: 0,
            total_available: 0
          });
        }
        const g = grouped.get(ingId)!;
        const qty = Number(item.quantity) || 0;
        const res = Number(item.reserved) || 0;
        const avail = Number.isFinite(Number(item.available)) ? Number(item.available) : Math.max(qty - res, 0);
        g.total_quantity += qty;
        g.total_reserved += res;
        g.total_available += avail;
      }
      return { rows: Array.from(grouped.values()), rowCount: grouped.size };
    }

    // Intercept SUM(quantity) on inventory_items
    if (lowerSql.includes("from inventory_items") && (lowerSql.includes("sum(quantity)") || lowerSql.includes("sum(i.quantity)"))) {
      const invItemsList = dbState["inventory_items"] || [];
      let filtered = invItemsList;
      const ingIdMatch = lowerSql.match(/ingredient_id\s*=\s*\$(\d+)/i);
      if (ingIdMatch) {
        const pIdx = parseInt(ingIdMatch[1]) - 1;
        const targetIngId = Number(params[pIdx]);
        filtered = filtered.filter((i: any) => Number(i.ingredient_id) === targetIngId);
      }
      const whIdMatch = lowerSql.match(/warehouse_id\s*=\s*\$(\d+)/i);
      if (whIdMatch) {
        const pIdx = parseInt(whIdMatch[1]) - 1;
        const targetWhId = Number(params[pIdx]);
        filtered = filtered.filter((i: any) => Number(i.warehouse_id) === targetWhId);
      }
      const total = filtered.reduce((s: number, i: any) => s + (Number(i.quantity) || 0), 0);
      return { rows: [{ total: total, sum: total, total_qty: total, total_stock: total }], rowCount: 1 };
    }

    // Intercept report join query for inventory_items, ingredients, warehouses, sections
    if (lowerSql.includes("from inventory_items i") && lowerSql.includes("join ingredients ing") && !lowerSql.includes("from warehouses") && !lowerSql.includes("from warehouses w") && !lowerSql.includes("left join warehouses w on w.id = i.warehouse_id") && !lowerSql.includes("join warehouses w on w.id = i.warehouse_id") && !lowerSql.includes("group by ing.name, ing.code, ing.unit") && !lowerSql.startsWith("select coalesce(sum(") && !lowerSql.startsWith("select count")) {
      const ingredientsList = dbState["ingredients"] || [];
      const inventoryItemsList = dbState["inventory_items"] || [];
      const warehousesList = dbState["warehouses"] || [];
      const warehouseSectionsList = dbState["warehouse_sections"] || [];

      const formatCleanCode = (raw: any, id: any) => {
        if (!raw || raw === "NULL" || raw === "null" || raw === "undefined") return `ITEM-${1000 + Number(id)}`;
        const s = String(raw).trim();
        if (s.startsWith("ITEM-")) return s;
        if (s.startsWith("-")) return `ITEM-${s.replace("-", "")}`;
        if (!isNaN(Number(s))) return `ITEM-${Number(s) >= 1000 ? s : (1000 + Number(s))}`;
        return `ITEM-${1000 + Number(id)}`;
      };

      const formatCleanStr = (raw: any, fallback: string | null = null) => {
        if (!raw || raw === "NULL" || raw === "null" || raw === "undefined") return fallback;
        const s = String(raw).trim();
        return s || fallback;
      };

      const joinedRows = inventoryItemsList.map((i) => {
        const ing = ingredientsList.find((g) => Number(g.id) === Number(i.ingredient_id));
        const w = warehousesList.find((wh) => Number(wh.id) === Number(i.warehouse_id));
        const s = i.section_id ? warehouseSectionsList.find((sec) => Number(sec.id) === Number(i.section_id)) : null;

        if (!ing || !w) return null;
        const cleanCode = formatCleanCode(ing.code || ing.item_code, ing.id);

        return {
          inventory_id: i.id,
          quantity: Number(i.quantity) || 0,
          min_quantity: Number(i.min_quantity) || 0,
          ingredient_id: ing.id,
          ingredient_name: ing.name,
          category: formatCleanStr(ing.category || ing.item_group, "عام"),
          unit: ing.unit || "قطعة",
          cost: Number(ing.cost) || 0,
          item_code: cleanCode,
          code: cleanCode,
          item_group: formatCleanStr(ing.item_group || ing.category, "عام"),
          barcode: formatCleanStr(ing.barcode, null),
          section_id: i.section_id ? Number(i.section_id) : null,
          section_name: s ? s.name : null,
          warehouse_id: w.id,
          warehouse_name: w.name,
        };
      }).filter(Boolean);

      joinedRows.sort((a: any, b: any) => {
        const wComp = a.warehouse_name.localeCompare(b.warehouse_name, "ar");
        if (wComp !== 0) return wComp;
        return a.ingredient_name.localeCompare(b.ingredient_name, "ar");
      });

      return { rows: joinedRows, rowCount: joinedRows.length };
    }

    // ─── Warehouse module: warehouses with stock summary (subquery) ───
    if (lowerSql.includes("from warehouses w") && lowerSql.includes("item_count") && lowerSql.includes("stock_value")) {
      const warehousesList = dbState["warehouses"] || [];
      const invItemsList = dbState["inventory_items"] || [];
      const ingredientsList = dbState["ingredients"] || [];
      const joinedRows = warehousesList.map((w: any) => {
        const items = invItemsList.filter((i: any) => Number(i.warehouse_id) === Number(w.id));
        const stockValue = items.reduce((sum: number, i: any) => {
          const ing = ingredientsList.find((g: any) => Number(g.id) === Number(i.ingredient_id));
          return sum + (Number(i.quantity || 0) * Number(ing?.avg_cost || ing?.cost || 0));
        }, 0);
        return { 
          ...w, 
          status: w.status || "active",
          linked_module: w.linked_module || "general",
          code: w.code || String(w.id),
          item_count: items.length, 
          stock_value: stockValue 
        };
      });
      return { rows: joinedRows, rowCount: joinedRows.length };
    }

    // ─── Warehouse module: ingredients with stock summary ───
    if (lowerSql.includes("from ingredients ing") && lowerSql.includes("total_stock") && lowerSql.includes("total_reserved")) {
      const ingredientsList = dbState["ingredients"] || [];
      const invItemsList = dbState["inventory_items"] || [];
      const withStock = lowerSql.includes("exists (select 1 from inventory_items i where i.ingredient_id = ing.id and i.quantity > 0)");
      
      const formatCleanCode = (raw: any, id: any) => {
        if (!raw || raw === "NULL" || raw === "null" || raw === "undefined") return `ITEM-${1000 + Number(id)}`;
        const s = String(raw).trim();
        if (s.startsWith("ITEM-")) return s;
        if (s.startsWith("-")) return `ITEM-${s.replace("-", "")}`;
        if (!isNaN(Number(s))) return `ITEM-${Number(s) >= 1000 ? s : (1000 + Number(s))}`;
        return `ITEM-${1000 + Number(id)}`;
      };

      const formatCleanStr = (raw: any, fallback: string | null = null) => {
        if (!raw || raw === "NULL" || raw === "null" || raw === "undefined") return fallback;
        const s = String(raw).trim();
        return s || fallback;
      };

      let joinedRows = ingredientsList.map((ing: any) => {
        const items = invItemsList.filter((i: any) => Number(i.ingredient_id) === Number(ing.id));
        const totalStock = items.reduce((s: number, i: any) => s + Number(i.quantity || 0), 0);
        const totalReserved = items.reduce((s: number, i: any) => s + Number(i.reserved || 0), 0);
        const whCount = items.filter((i: any) => Number(i.quantity || 0) > 0).length;
        const cleanCode = formatCleanCode(ing.code || ing.item_code, ing.id);
        return {
          ...ing,
          code: cleanCode,
          item_code: cleanCode,
          category: formatCleanStr(ing.category || ing.item_group, null),
          barcode: formatCleanStr(ing.barcode, null),
          total_stock: totalStock,
          total_reserved: totalReserved,
          warehouses_count: whCount
        };
      });
      if (withStock) {
        joinedRows = joinedRows.filter((r: any) => r.total_stock > 0);
      }
      return { rows: joinedRows, rowCount: joinedRows.length };
    }

    // ─── Warehouse module: inventory_items with ingredients + warehouses JOIN ───
    if (lowerSql.includes("from inventory_items i") && lowerSql.includes("left join ingredients ing on ing.id = i.ingredient_id") && lowerSql.includes("left join warehouses w on w.id = i.warehouse_id")) {
      const invItemsList = dbState["inventory_items"] || [];
      const ingredientsList = dbState["ingredients"] || [];
      const warehousesList = dbState["warehouses"] || [];
      let joinedRows = invItemsList.map((i: any) => {
        const ing = ingredientsList.find((g: any) => Number(g.id) === Number(i.ingredient_id));
        const w = warehousesList.find((wh: any) => Number(wh.id) === Number(i.warehouse_id));
        if (!ing || !w) return null;
        return {
          ...i,
          ingredient_name: ing.name, ingredient_code: ing.code, ingredient_unit: ing.unit,
          barcode: ing.barcode, category: ing.category, min_stock: ing.min_stock, max_stock: ing.max_stock,
          reorder_point: ing.reorder_point, last_purchase_price: ing.last_purchase_price, avg_cost: ing.avg_cost,
          warehouse_name: w.name, warehouse_code: w.code,
        };
      }).filter(Boolean);
      // WHERE filters
      const whMatch = lowerSql.match(/i\.warehouse_id\s*=\s*\$(\d+)/i);
      if (whMatch) {
        const idx = parseInt(whMatch[1]) - 1;
        const wId = Number(params[idx]);
        joinedRows = joinedRows.filter((r: any) => Number(r.warehouse_id) === wId);
      }
      if (lowerSql.includes("ing.min_stock > 0 and i.quantity <= ing.min_stock")) {
        joinedRows = joinedRows.filter((r: any) => Number(r.min_stock) > 0 && Number(r.quantity) <= Number(r.min_stock));
      }
      // ORDER BY ing.name
      joinedRows.sort((a: any, b: any) => (a.ingredient_name || "").localeCompare(b.ingredient_name || "", "ar"));
      return { rows: joinedRows, rowCount: joinedRows.length };
    }

    // ─── Warehouse module: inventory_transactions JOIN warehouse + item count ───
    if (lowerSql.includes("from inventory_transactions t") && lowerSql.includes("left join warehouses w on w.id = t.warehouse_id") && lowerSql.includes("items_count")) {
      const txList = dbState["inventory_transactions"] || [];
      const warehousesList = dbState["warehouses"] || [];
      let joinedRows = txList.map((t: any) => {
        const w = warehousesList.find((wh: any) => Number(wh.id) === Number(t.warehouse_id));
        let items: any[] = [];
        try { items = typeof t.items === "string" ? JSON.parse(t.items) : (t.items || []); } catch { items = []; }
        const hasItemsArray = Array.isArray(items);
        const itemsCount = hasItemsArray && items.length > 0 ? items.length : 1;
        const jsonValue = hasItemsArray ? items.reduce((s: number, it: any) => s + (Number(it.quantity || 0) * Number(it.price || 0)), 0) : 0;
        const legacyValue = Number(t.total_cost || 0) || (Number(t.quantity || 0) * Number(t.unit_cost || 0));
        const totalValue = jsonValue || legacyValue || 0;
        return {
          ...t, warehouse_name: w?.name || null, warehouse_code: w?.code || null,
          transaction_date: t.date || t.created_at || null,
          items_count: itemsCount, total_value: totalValue,
        };
      });
      // Filters
      const whMatch = lowerSql.match(/t\.warehouse_id\s*=\s*\$(\d+)/i);
      if (whMatch) {
        const idx = parseInt(whMatch[1]) - 1;
        const wId = Number(params[idx]);
        joinedRows = joinedRows.filter((r: any) => Number(r.warehouse_id) === wId);
      }
      const typeMatch = lowerSql.match(/t\.type\s*=\s*\$(\d+)/i);
      if (typeMatch) {
        const idx = parseInt(typeMatch[1]) - 1;
        const tType = params[idx];
        joinedRows = joinedRows.filter((r: any) => r.type === tType);
      }
      const statusMatch = lowerSql.match(/t\.status\s*=\s*\$(\d+)/i);
      if (statusMatch) {
        const idx = parseInt(statusMatch[1]) - 1;
        const sVal = params[idx];
        joinedRows = joinedRows.filter((r: any) => r.status === sVal);
      }
      const fromDateMatch = lowerSql.match(/t\.date\s*>=\s*\$(\d+)/i);
      if (fromDateMatch) {
        const idx = parseInt(fromDateMatch[1]) - 1;
        const d = params[idx];
        joinedRows = joinedRows.filter((r: any) => (r.date || "") >= d);
      }
      const toDateMatch = lowerSql.match(/t\.date\s*<=\s*\$(\d+)/i);
      if (toDateMatch) {
        const idx = parseInt(toDateMatch[1]) - 1;
        const d = params[idx];
        joinedRows = joinedRows.filter((r: any) => (r.date || "") <= d);
      }
      joinedRows.sort((a: any, b: any) => {
        const dComp = (b.date || "").localeCompare(a.date || "");
        if (dComp !== 0) return dComp;
        return Number(b.id) - Number(a.id);
      });
      return { rows: joinedRows, rowCount: joinedRows.length };
    }

    // ─── Treasury & Custody Module: treasury_custodies JOIN employees + accounts + types ───
    if (lowerSql.includes("from treasury_custodies")) {
      const custodiesList = dbState["treasury_custodies"] || [];
      const employeesList = dbState["employees"] || [];
      const accountsList = dbState["treasury_accounts"] || [];
      const typesList = dbState["treasury_custody_types"] || [];
      const branchesList = dbState["branches"] || [];
      const costCentersList = dbState["cost_centers"] || [];
      const expensesList = dbState["treasury_custody_expenses"] || [];
      const itemsList = dbState["treasury_custody_items"] || [];
      const settlementsList = dbState["treasury_custody_settlements"] || [];

      let joinedRows = custodiesList.map((c: any) => {
        const emp = employeesList.find((e: any) => Number(e.id) === Number(c.employee_id));
        const acc = accountsList.find((a: any) => Number(a.id) === Number(c.account_id));
        const ctype = typesList.find((t: any) => Number(t.id) === Number(c.custody_type_id) || t.category === c.custody_type);
        const branch = branchesList.find((b: any) => Number(b.id) === Number(c.branch_id));
        const cc = costCentersList.find((cntr: any) => Number(cntr.id) === Number(c.cost_center_id));
        
        const cExpenses = expensesList.filter((e: any) => Number(e.custody_id) === Number(c.id));
        const cItems = itemsList.filter((it: any) => Number(it.custody_id) === Number(c.id));
        const cSettlements = settlementsList.filter((s: any) => Number(s.custody_id) === Number(c.id));
        
        const totalExpenses = cExpenses.reduce((sum: number, exp: any) => sum + (parseFloat(exp.amount) || 0), 0);
        const spentAmt = Number(c.spent_amount) > 0 ? Number(c.spent_amount) : totalExpenses;
        const origAmt = parseFloat(c.amount) || 0;
        const remAmt = Math.max(0, origAmt - spentAmt - (parseFloat(c.returned_amount) || 0));
        
        const now = new Date();
        const dueDate = c.due_date ? new Date(c.due_date) : null;
        const isOverdue = Boolean(dueDate && dueDate < now && (c.status === 'active' || c.status === 'issued' || c.status === 'pending_settlement'));
        const overdueDays = isOverdue && dueDate ? Math.max(0, Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24))) : 0;

        return {
          ...c,
          employee_name: emp ? emp.name : (c.employee_name || "موظف"),
          employee_code: emp ? (emp.code || emp.employee_code || `EMP-${emp.id}`) : (c.employee_code || "EMP-000"),
          employee_phone: emp ? (emp.phone || emp.mobile || "") : "",
          employee_department: emp ? (emp.department || emp.department_name || "") : (c.department || ""),
          account_name: acc ? acc.name : (c.account_name || "-"),
          custody_type_name: ctype ? ctype.name_ar : (c.custody_type || "عهدة نقدية"),
          custody_type_code: ctype ? ctype.code : "CUST",
          custody_category: ctype ? ctype.category : (c.custody_type || "cash"),
          branch_name: branch ? branch.name : (c.branch_name || "الفرع الرئيسي"),
          cost_center_name: cc ? cc.name : (c.cost_center_name || "-"),
          expenses_count: cExpenses.length,
          items_count: cItems.length,
          settlements_count: cSettlements.length,
          total_expenses: totalExpenses,
          is_overdue: isOverdue,
          overdue_days: overdueDays,
          calculated_remaining: remAmt
        };
      });

      // Filter by ID if present
      const idMatch = lowerSql.match(/where\s+(?:c\.)?id\s*=\s*\$(\d+)/i) || lowerSql.match(/where\s+(?:c\.)?id\s*=\s*(\d+)/i);
      if (idMatch) {
        const idVal = idMatch[1].startsWith("$") ? Number(params[parseInt(idMatch[1].slice(1)) - 1]) : Number(idMatch[1]);
        joinedRows = joinedRows.filter((r: any) => Number(r.id) === idVal);
      }

      // Filter by status if query specifies
      if (lowerSql.includes("status = 'overdue'") || lowerSql.includes("is_overdue = true")) {
        joinedRows = joinedRows.filter((r: any) => r.is_overdue || r.status === 'overdue');
      }

      joinedRows.sort((a: any, b: any) => (Number(b.id) || 0) - (Number(a.id) || 0));
      return { rows: joinedRows, rowCount: joinedRows.length };
    }

    // ─── Treasury & Financial Transfers Module: treasury_transfers JOIN accounts, branches, types & stats ───
    if (lowerSql.includes("from treasury_transfers") && (lowerSql.includes("count(case when status") || lowerSql.includes("sum(case when") || lowerSql.includes("count(*) as total"))) {
      const trfList = dbState["treasury_transfers"] || [];
      const todayStr = new Date().toISOString().slice(0, 10);
      const todayList = trfList.filter((r: any) => (r.transfer_date || r.created_at || "").startsWith(todayStr));
      const stats = {
        total_transfers_count: trfList.length,
        today_count: todayList.length,
        today_amount: todayList.reduce((s: number, r: any) => s + (parseFloat(r.amount) || 0), 0),
        draft_count: trfList.filter((r: any) => r.status === "draft").length,
        pending_approval_count: trfList.filter((r: any) => r.status === "pending_approval").length,
        approved_count: trfList.filter((r: any) => r.status === "approved").length,
        executed_in_transit_count: trfList.filter((r: any) => ["executed", "in_transit", "pending_receipt"].includes(r.status)).length,
        pending_receipt_count: trfList.filter((r: any) => r.status === "pending_receipt").length,
        completed_posted_count: trfList.filter((r: any) => ["completed", "posted", "received"].includes(r.status)).length,
        cancelled_count: trfList.filter((r: any) => r.status === "cancelled").length,
        reversed_count: trfList.filter((r: any) => r.status === "reversed").length,
        total_transferred_amount: trfList.filter((r: any) => ["completed", "posted", "received", "executed", "pending_receipt"].includes(r.status)).reduce((s: number, r: any) => s + (parseFloat(r.amount) || 0), 0),
        total_fees_amount: trfList.reduce((s: number, r: any) => s + (parseFloat(r.transfer_fee) || 0), 0)
      };
      return { rows: [stats], rowCount: 1 };
    }

    if (lowerSql.includes("from treasury_transfers")) {
      const trfList = dbState["treasury_transfers"] || [];
      const accountsList = dbState["treasury_accounts"] || [];
      const typesList = dbState["treasury_transfer_types"] || [];
      const branchesList = dbState["branches"] || [];
      const costCentersList = dbState["cost_centers"] || [];
      const usersList = dbState["users"] || [];
      const attList = dbState["treasury_transfer_attachments"] || [];
      const logsList = dbState["treasury_transfer_audit_logs"] || [];

      let joinedRows = trfList.map((t: any) => {
        const srcAcc = accountsList.find((a: any) => Number(a.id) === Number(t.source_account_id));
        const dstAcc = accountsList.find((a: any) => Number(a.id) === Number(t.destination_account_id));
        const tType = typesList.find((tp: any) => Number(tp.id) === Number(t.transfer_type_id) || tp.code === t.transfer_type);
        const srcBranch = branchesList.find((b: any) => Number(b.id) === Number(t.source_branch_id));
        const dstBranch = branchesList.find((b: any) => Number(b.id) === Number(t.destination_branch_id));
        const srcCC = costCentersList.find((c: any) => Number(c.id) === Number(t.source_cost_center_id));
        const dstCC = costCentersList.find((c: any) => Number(c.id) === Number(t.destination_cost_center_id));
        
        const creator = usersList.find((u: any) => Number(u.id) === Number(t.created_by));
        const approver = usersList.find((u: any) => Number(u.id) === Number(t.approved_by));
        const executor = usersList.find((u: any) => Number(u.id) === Number(t.executed_by));
        const receiver = usersList.find((u: any) => Number(u.id) === Number(t.received_by));
        const reverser = usersList.find((u: any) => Number(u.id) === Number(t.reversed_by));

        const attachments = attList.filter((a: any) => Number(a.transfer_id) === Number(t.id));
        const auditLogs = logsList.filter((l: any) => Number(l.transfer_id) === Number(t.id));

        return {
          ...t,
          source_account_name: srcAcc ? srcAcc.name : (t.source_account_name || "خزينة المصدر"),
          source_account_type: srcAcc ? srcAcc.type : "cash",
          source_account_code: srcAcc ? (srcAcc.code || `ACC-${srcAcc.id}`) : "-",
          destination_account_name: dstAcc ? dstAcc.name : (t.destination_account_name || "الخزينة المستهدفة"),
          destination_account_type: dstAcc ? dstAcc.type : "cash",
          destination_account_code: dstAcc ? (dstAcc.code || `ACC-${dstAcc.id}`) : "-",
          transfer_type_name: tType ? tType.name_ar : (t.transfer_type || "تحويل مالي"),
          source_branch_name: srcBranch ? srcBranch.name : (t.source_branch_name || "الفرع الرئيسي"),
          destination_branch_name: dstBranch ? dstBranch.name : (t.destination_branch_name || "الفرع الرئيسي"),
          source_cost_center_name: srcCC ? srcCC.name : (t.source_cost_center_name || "-"),
          destination_cost_center_name: dstCC ? dstCC.name : (t.destination_cost_center_name || "-"),
          created_by_name: creator ? (creator.name || creator.username) : "مدير النظام",
          approved_by_name: approver ? (approver.name || approver.username) : null,
          executed_by_name: executor ? (executor.name || executor.username) : null,
          received_by_name: receiver ? (receiver.name || receiver.username) : null,
          reversed_by_name: reverser ? (reverser.name || reverser.username) : null,
          attachments: attachments,
          audit_logs: auditLogs
        };
      });

      // Filter by ID if query has where t.id = $1
      const idMatch = lowerSql.match(/where\s+(?:t\.)?id\s*=\s*\$(\d+)/i) || lowerSql.match(/where\s+(?:t\.)?id\s*=\s*(\d+)/i);
      if (idMatch) {
        const idVal = idMatch[1].startsWith("$") ? Number(params[parseInt(idMatch[1].slice(1)) - 1]) : Number(idMatch[1]);
        joinedRows = joinedRows.filter((r: any) => Number(r.id) === idVal);
      }

      // Filter by status if specified in query
      const statusParamMatch = lowerSql.match(/status\s*=\s*\$(\d+)/i);
      if (statusParamMatch) {
        const idx = parseInt(statusParamMatch[1]) - 1;
        const sVal = params[idx];
        if (sVal && sVal !== "all") joinedRows = joinedRows.filter((r: any) => r.status === sVal);
      }

      joinedRows.sort((a: any, b: any) => (Number(b.id) || 0) - (Number(a.id) || 0));
      return { rows: joinedRows, rowCount: joinedRows.length };
    }

    // ─── Warehouse module: warehouse_transfers JOIN from/to warehouses & stats ───
    if (lowerSql.includes("from warehouse_transfers") && lowerSql.includes("count(case when status")) {
      const trfList = dbState["warehouse_transfers"] || [];
      const stats = {
        total: trfList.length,
        pending_count: trfList.filter((r: any) => ["draft", "requested", "pending"].includes(r.status)).length,
        approved_count: trfList.filter((r: any) => ["approved", "picking"].includes(r.status)).length,
        in_transit_count: trfList.filter((r: any) => ["in_transit", "dispatched"].includes(r.status)).length,
        receiving_count: trfList.filter((r: any) => ["receiving", "qc_inspection", "received_partially"].includes(r.status)).length,
        completed_count: trfList.filter((r: any) => ["received", "completed"].includes(r.status)).length,
        cancelled_count: trfList.filter((r: any) => ["cancelled", "rejected"].includes(r.status)).length
      };
      return { rows: [stats], rowCount: 1 };
    }

    if (lowerSql.includes("from warehouse_transfers t") && lowerSql.includes("left join warehouses fw") && lowerSql.includes("left join warehouses tw")) {
      const trfList = dbState["warehouse_transfers"] || [];
      const warehousesList = dbState["warehouses"] || [];
      let joinedRows = trfList.map((t: any) => {
        const fw = warehousesList.find((w: any) => Number(w.id) === Number(t.from_warehouse_id));
        const tw = warehousesList.find((w: any) => Number(w.id) === Number(t.to_warehouse_id));
        let items: any[] = [];
        try { items = typeof t.items === "string" ? JSON.parse(t.items) : (t.items || []); } catch { items = []; }
        const itemsCount = items.length;
        const totalQty = items.reduce((s: number, it: any) => s + Number(it.requested_qty || it.quantity || 0), 0);
        const totalValue = items.reduce((s: number, it: any) => s + (Number(it.dispatched_qty || it.quantity || 0) * Number(it.unit_cost || it.price || 0)), 0);
        return {
          ...t,
          from_warehouse_name: fw?.name || null, from_warehouse_code: fw?.code || null,
          to_warehouse_name: tw?.name || null, to_warehouse_code: tw?.code || null,
          items_count: itemsCount, total_qty: totalQty, total_value: totalValue
        };
      });

      // Filter handling
      if (lowerSql.includes("t.status in ('draft', 'requested', 'pending')")) {
        joinedRows = joinedRows.filter((r: any) => ["draft", "requested", "pending"].includes(r.status));
      } else if (lowerSql.includes("t.status in ('approved', 'picking', 'dispatched', 'in_transit')")) {
        joinedRows = joinedRows.filter((r: any) => ["approved", "picking", "dispatched", "in_transit"].includes(r.status));
      } else if (lowerSql.includes("t.status in ('receiving', 'qc_inspection', 'received_partially')")) {
        joinedRows = joinedRows.filter((r: any) => ["receiving", "qc_inspection", "received_partially"].includes(r.status));
      } else if (lowerSql.includes("t.status in ('received', 'completed')")) {
        joinedRows = joinedRows.filter((r: any) => ["received", "completed"].includes(r.status));
      } else if (lowerSql.includes("t.status in ('cancelled', 'rejected')")) {
        joinedRows = joinedRows.filter((r: any) => ["cancelled", "rejected"].includes(r.status));
      }

      const statusMatch = lowerSql.match(/t\.status\s*=\s*\$(\d+)/i);
      if (statusMatch) {
        const idx = parseInt(statusMatch[1]) - 1;
        const sVal = params[idx];
        if (sVal && sVal !== "all") joinedRows = joinedRows.filter((r: any) => r.status === sVal);
      }

      const fromWhMatch = lowerSql.match(/t\.from_warehouse_id\s*=\s*\$(\d+)/i);
      if (fromWhMatch) {
        const idx = parseInt(fromWhMatch[1]) - 1;
        const fwId = Number(params[idx]);
        joinedRows = joinedRows.filter((r: any) => Number(r.from_warehouse_id) === fwId);
      }

      const toWhMatch = lowerSql.match(/t\.to_warehouse_id\s*=\s*\$(\d+)/i);
      if (toWhMatch) {
        const idx = parseInt(toWhMatch[1]) - 1;
        const twId = Number(params[idx]);
        joinedRows = joinedRows.filter((r: any) => Number(r.to_warehouse_id) === twId);
      }

      const searchMatch = lowerSql.match(/ilike\s+\$(\d+)/i);
      if (searchMatch) {
        const idx = parseInt(searchMatch[1]) - 1;
        const searchVal = String(params[idx] || "").replace(/%/g, "").toLowerCase();
        if (searchVal) {
          joinedRows = joinedRows.filter((r: any) =>
            (r.transfer_number || "").toLowerCase().includes(searchVal) ||
            (r.notes || "").toLowerCase().includes(searchVal) ||
            (r.driver_name || "").toLowerCase().includes(searchVal) ||
            (r.from_warehouse_name || "").toLowerCase().includes(searchVal) ||
            (r.to_warehouse_name || "").toLowerCase().includes(searchVal)
          );
        }
      }

      // Check if this is a count query
      if (lowerSql.includes("select count(*)::int as total from (select t.*")) {
        return { rows: [{ total: joinedRows.length }], rowCount: 1 };
      }

      joinedRows.sort((a: any, b: any) => {
        const dComp = (b.date || "").localeCompare(a.date || "");
        if (dComp !== 0) return dComp;
        return Number(b.id) - Number(a.id);
      });

      return { rows: joinedRows, rowCount: joinedRows.length };
    }

    // ─── Source stock for transfers ───
    if (lowerSql.includes("from inventory_items inv") && lowerSql.includes("join ingredients ing on ing.id = inv.ingredient_id") && lowerSql.includes("inv.warehouse_id = $1")) {
      const invList = dbState["inventory_items"] || [];
      const ingList = dbState["ingredients"] || [];
      const whId = Number(params[0]);
      const matched = invList
        .filter((inv: any) => Number(inv.warehouse_id) === whId && Number(inv.quantity || 0) > 0)
        .map((inv: any) => {
          const ing = ingList.find((g: any) => Number(g.id) === Number(inv.ingredient_id)) || {};
          return {
            inventory_item_id: inv.id,
            ingredient_id: inv.ingredient_id,
            ingredient_name: ing.name || "صنف",
            ingredient_code: ing.code || "",
            ingredient_unit: ing.unit || "قطعة",
            ingredient_barcode: ing.barcode || "",
            ingredient_category: ing.category || "",
            avg_cost: ing.avg_cost || 0,
            last_purchase_price: ing.last_purchase_price || 0,
            quantity: inv.quantity || 0,
            reserved: inv.reserved || 0,
            available: inv.available !== undefined ? inv.available : Math.max(0, Number(inv.quantity || 0) - Number(inv.reserved || 0)),
            in_transit: inv.in_transit || 0
          };
        });
      return { rows: matched, rowCount: matched.length };
    }

    // ─── Warehouse module: inventory_movements JOIN ingredient + warehouse ───
    if (lowerSql.includes("from inventory_movements m") && lowerSql.includes("left join ingredients ing on ing.id = m.ingredient_id") && lowerSql.includes("left join warehouses w on w.id = m.warehouse_id")) {
      const movList = dbState["inventory_movements"] || [];
      const ingredientsList = dbState["ingredients"] || [];
      const warehousesList = dbState["warehouses"] || [];
      let joinedRows = movList.map((m: any) => {
        const ing = ingredientsList.find((g: any) => Number(g.id) === Number(m.ingredient_id));
        const w = warehousesList.find((wh: any) => Number(wh.id) === Number(m.warehouse_id));
        return {
          ...m,
          ingredient_name: ing?.name || null, ingredient_code: ing?.code || null, unit: ing?.unit || null,
          warehouse_name: w?.name || null, warehouse_code: w?.code || null,
        };
      });
      const whMatch = lowerSql.match(/m\.warehouse_id\s*=\s*\$(\d+)/i);
      if (whMatch) {
        const idx = parseInt(whMatch[1]) - 1;
        const wId = Number(params[idx]);
        joinedRows = joinedRows.filter((r: any) => Number(r.warehouse_id) === wId);
      }
      const ingMatch = lowerSql.match(/m\.ingredient_id\s*=\s*\$(\d+)/i);
      if (ingMatch) {
        const idx = parseInt(ingMatch[1]) - 1;
        const iId = Number(params[idx]);
        joinedRows = joinedRows.filter((r: any) => Number(r.ingredient_id) === iId);
      }
      const refTypeMatch = lowerSql.match(/m\.ref_type\s*=\s*\$(\d+)/i);
      if (refTypeMatch) {
        const idx = parseInt(refTypeMatch[1]) - 1;
        const v = params[idx];
        joinedRows = joinedRows.filter((r: any) => r.ref_type === v);
      }
      joinedRows.sort((a: any, b: any) => {
        const dComp = (b.created_at || "").localeCompare(a.created_at || "");
        if (dComp !== 0) return dComp;
        return Number(b.id) - Number(a.id);
      });
      const limitMatch = lowerSql.match(/limit\s+\$(\d+)/i);
      if (limitMatch) {
        const idx = parseInt(limitMatch[1]) - 1;
        const lim = Number(params[idx]);
        joinedRows = joinedRows.slice(0, lim);
      }
      return { rows: joinedRows, rowCount: joinedRows.length };
    }

    // ─── Warehouse module: low stock JOIN ───
    if (lowerSql.includes("from inventory_items i") && lowerSql.includes("join ingredients ing on ing.id = i.ingredient_id") && lowerSql.includes("join warehouses w on w.id = i.warehouse_id") && lowerSql.includes("i.quantity <= ing.min_stock")) {
      const invItemsList = dbState["inventory_items"] || [];
      const ingredientsList = dbState["ingredients"] || [];
      const warehousesList = dbState["warehouses"] || [];
      let joinedRows = invItemsList.map((i: any) => {
        const ing = ingredientsList.find((g: any) => Number(g.id) === Number(i.ingredient_id));
        const w = warehousesList.find((wh: any) => Number(wh.id) === Number(i.warehouse_id));
        if (!ing || !w) return null;
        return {
          ...i,
          ingredient_name: ing.name, ingredient_code: ing.code, unit: ing.unit,
          min_stock: ing.min_stock, reorder_point: ing.reorder_point,
          avg_cost: ing.avg_cost, last_purchase_price: ing.last_purchase_price,
          warehouse_name: w.name,
        };
      }).filter(Boolean);
      joinedRows = joinedRows.filter((r: any) => Number(r.min_stock) > 0 && Number(r.quantity) <= Number(r.min_stock));
      joinedRows.sort((a: any, b: any) => {
        const aRatio = Number(a.quantity) / Math.max(1, Number(a.min_stock));
        const bRatio = Number(b.quantity) / Math.max(1, Number(b.min_stock));
        return aRatio - bRatio;
      });
      return { rows: joinedRows, rowCount: joinedRows.length };
    }

    // ─── Warehouse module: valuation JOIN ───
    if (lowerSql.includes("from inventory_items i") && lowerSql.includes("join ingredients ing on ing.id = i.ingredient_id") && lowerSql.includes("join warehouses w on w.id = i.warehouse_id") && lowerSql.includes("total_value")) {
      const invItemsList = dbState["inventory_items"] || [];
      const ingredientsList = dbState["ingredients"] || [];
      const warehousesList = dbState["warehouses"] || [];
      let joinedRows = invItemsList.map((i: any) => {
        const ing = ingredientsList.find((g: any) => Number(g.id) === Number(i.ingredient_id));
        const w = warehousesList.find((wh: any) => Number(wh.id) === Number(i.warehouse_id));
        if (!ing || !w) return null;
        const qty = Number(i.quantity) || 0;
        const avgCost = Number(ing.avg_cost) || 0;
        return {
          warehouse_id: w.id, warehouse_name: w.name, warehouse_code: w.code,
          ingredient_id: ing.id, name: ing.name, code: ing.code, unit: ing.unit,
          quantity: qty, avg_cost: avgCost, last_purchase_price: ing.last_purchase_price || 0,
          total_value: qty * avgCost,
        };
      }).filter(Boolean);
      joinedRows = joinedRows.filter((r: any) => Number(r.quantity) > 0);
      joinedRows.sort((a: any, b: any) => {
        const wComp = (a.warehouse_name || "").localeCompare(b.warehouse_name || "", "ar");
        if (wComp !== 0) return wComp;
        return (a.name || "").localeCompare(b.name || "", "ar");
      });
      return { rows: joinedRows, rowCount: joinedRows.length };
    }

    // ─── Warehouse module: ABC analysis (LEFT JOIN + GROUP BY ingredients) ───
    if (lowerSql.includes("from ingredients ing") && lowerSql.includes("left join inventory_items i on i.ingredient_id = ing.id") && lowerSql.includes("group by ing.id")) {
      const ingredientsList = dbState["ingredients"] || [];
      const invItemsList = dbState["inventory_items"] || [];
      let joinedRows = ingredientsList.map((ing: any) => {
        const items = invItemsList.filter((i: any) => Number(i.ingredient_id) === Number(ing.id));
        const qty = items.reduce((s: number, i: any) => s + Number(i.quantity || 0), 0);
        const value = qty * (Number(ing.avg_cost) || 0);
        return {
          id: ing.id, name: ing.name, code: ing.code, unit: ing.unit, avg_cost: ing.avg_cost,
          qty, value,
        };
      });
      joinedRows.sort((a: any, b: any) => Number(b.value) - Number(a.value));
      return { rows: joinedRows, rowCount: joinedRows.length };
    }

    // ─── Warehouse module: top items by value (GROUP BY + SUM) ───
    if (lowerSql.includes("from inventory_items i") && lowerSql.includes("join ingredients ing on ing.id = i.ingredient_id") && lowerSql.includes("group by ing.name, ing.code, ing.unit") && lowerSql.includes("limit 5")) {
      const invItemsList = dbState["inventory_items"] || [];
      const ingredientsList = dbState["ingredients"] || [];
      const grouped = new Map<string, any>();
      for (const i of invItemsList) {
        const ing = ingredientsList.find((g: any) => Number(g.id) === Number(i.ingredient_id));
        if (!ing) continue;
        const key = `${ing.name}|||${ing.code}|||${ing.unit}`;
        if (!grouped.has(key)) {
          grouped.set(key, { name: ing.name, code: ing.code, unit: ing.unit, qty: 0, value: 0 });
        }
        const entry = grouped.get(key);
        entry.qty += Number(i.quantity || 0);
        entry.value += Number(i.quantity || 0) * Number(ing.avg_cost || 0);
      }
      let rows = Array.from(grouped.values());
      rows.sort((a: any, b: any) => Number(b.value) - Number(a.value));
      rows = rows.slice(0, 5);
      return { rows, rowCount: rows.length };
    }

    // ─── Warehouse module: stock value by warehouse ───
    if (lowerSql.includes("from warehouses w") && lowerSql.includes("left join inventory_items i on i.warehouse_id = w.id") && lowerSql.includes("left join ingredients ing on ing.id = i.ingredient_id") && lowerSql.includes("group by w.name")) {
      const warehousesList = dbState["warehouses"] || [];
      const invItemsList = dbState["inventory_items"] || [];
      const ingredientsList = dbState["ingredients"] || [];
      let rows = warehousesList.map((w: any) => {
        const items = invItemsList.filter((i: any) => Number(i.warehouse_id) === Number(w.id));
        const value = items.reduce((s: number, i: any) => {
          const ing = ingredientsList.find((g: any) => Number(g.id) === Number(i.ingredient_id));
          return s + (Number(i.quantity || 0) * Number(ing?.avg_cost || 0));
        }, 0);
        return { name: w.name, value, items_count: items.length };
      });
      rows.sort((a: any, b: any) => Number(b.value) - Number(a.value));
      return { rows, rowCount: rows.length };
    }

    // ─── Warehouse module: movements trend (generate_series) ───
    if (lowerSql.includes("generate_series") && lowerSql.includes("current_date - interval '6 days'")) {
      const movList = dbState["inventory_movements"] || [];
      const txList = dbState["inventory_transactions"] || [];
      const today = new Date();
      const rows = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const dStr = d.toISOString().split("T")[0];
        const movCount = movList.filter((m: any) => (m.created_at || "").startsWith(dStr)).length;
        const txCount = txList.filter((t: any) => (t.date || "").startsWith(dStr)).length;
        rows.push({ date: dStr, movements: movCount, transactions: txCount });
      }
      return { rows, rowCount: rows.length };
    }

    // ─── Suppliers module: Dashboard metrics ───
    if (lowerSql.includes("from suppliers") && (lowerSql.includes("total_suppliers") || lowerSql.includes("active_suppliers"))) {
      const suppliersList = dbState["suppliers"] || [];
      const purchasesList = dbState["purchases"] || [];
      const txList = dbState["supplier_transactions"] || [];
      const poList = dbState["purchase_orders"] || [];

      const total_suppliers = suppliersList.length;
      const active_suppliers = suppliersList.filter((s: any) => (s.status || "active") === "active").length;
      const total_payable = suppliersList.reduce((sum: number, s: any) => sum + Math.max(Number(s.balance || 0), 0), 0);

      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const thirtyDaysStr = thirtyDaysAgo.toISOString().split("T")[0];

      const purchases_30d = purchasesList
        .filter((p: any) => String(p.date || "").split("T")[0] >= thirtyDaysStr)
        .reduce((sum: number, p: any) => sum + Number(p.total_amount || 0), 0);

      const payments_30d = txList
        .filter((t: any) => t.type === "payment" && String(t.timestamp || "").split("T")[0] >= thirtyDaysStr)
        .reduce((sum: number, t: any) => sum + Number(t.amount || 0), 0);

      const pending_orders = poList
        .filter((po: any) => ["draft", "pending", "approved", "partially_received"].includes(po.status))
        .length;

      return {
        rows: [{
          total_suppliers,
          active_suppliers,
          total_payable,
          purchases_30d,
          payments_30d,
          pending_orders
        }],
        rowCount: 1
      };
    }

    // Suppliers dashboard overdue purchases
    if (lowerSql.includes("from purchases p") && lowerSql.includes("overdue_payable")) {
      const purchasesList = dbState["purchases"] || [];
      const today = new Date().toISOString().split("T")[0];
      let overdue = 0;
      for (const p of purchasesList) {
        const d = String(p.due_date || p.date || "").split("T")[0];
        const tot = Number(p.total_amount || 0);
        const paid = Number(p.paid_amount || 0);
        if (d && d < today && tot > paid) {
          overdue += Math.max(tot - paid, 0);
        }
      }
      return { rows: [{ overdue_payable: overdue }], rowCount: 1 };
    }

    // ─── Suppliers duplicate check ───
    if (lowerSql.includes("from suppliers") && (lowerSql.includes("lower(trim(name))") || lowerSql.includes("lower(trim($1))"))) {
      const suppliersList = dbState["suppliers"] || [];
      const targetName = String(params[0] || "").trim().toLowerCase();
      const targetTax = String(params[1] || "").trim();

      const dup = suppliersList.find((s: any) => {
        const sName = String(s.name || "").trim().toLowerCase();
        const nameMatch = targetName && sName === targetName;
        const taxMatch = targetTax && s.tax_number && String(s.tax_number).trim() === targetTax;
        return nameMatch || taxMatch;
      });

      return { rows: dup ? [{ id: dup.id }] : [], rowCount: dup ? 1 : 0 };
    }

    // ─── Suppliers statement current & calculated balance ───
    if (lowerSql.includes("from suppliers s left join supplier_transactions st") && lowerSql.includes("calculated_balance")) {
      const idMatch = lowerSql.match(/s\.id\s*=\s*\$(\d+)/i) || lowerSql.match(/s\.id\s*=\s*(\d+)/i);
      const supId = idMatch ? (idMatch[1].startsWith("$") ? Number(params[parseInt(idMatch[1].substring(1)) - 1]) : Number(idMatch[1])) : Number(params[0]);
      const s = (dbState["suppliers"] || []).find((x: any) => Number(x.id) === supId);
      const current_balance = Number(s?.balance || 0);
      const opening_balance = Number(s?.opening_balance || 0);
      const stList = (dbState["supplier_transactions"] || []).filter((st: any) => Number(st.supplier_id) === supId);
      let delta = 0;
      for (const st of stList) {
        if (st.reference_type === "opening_balance") continue;
        if (st.type === "purchase" || st.type === "adjustment") delta += Number(st.amount || 0);
        else if (st.type === "payment" || st.type === "return") delta -= Number(st.amount || 0);
      }
      const calculated_balance = opening_balance + delta;
      return { rows: [{ current_balance, calculated_balance }], rowCount: 1 };
    }

    // ─── Suppliers module: suppliers list with computed financial stats (supplierSelect) ───
    if (lowerSql.includes("from suppliers s") && (lowerSql.includes("total_purchases") || lowerSql.includes("credit_utilization") || lowerSql.includes("tx_count"))) {
      const suppliersList = dbState["suppliers"] || [];
      const purchasesList = dbState["purchases"] || [];
      const txList = dbState["supplier_transactions"] || [];
      const invTxList = dbState["inventory_transactions"] || [];

      let enriched = suppliersList.map((s: any) => {
        const sPurchases = purchasesList.filter((p: any) => Number(p.supplier_id) === Number(s.id));
        const sTxs = txList.filter((t: any) => Number(t.supplier_id) === Number(s.id));
        const sInvTxs = invTxList.filter((t: any) => Number(t.supplier_id) === Number(s.id));

        let total_purchases = sPurchases.reduce((sum: number, p: any) => sum + Number(p.total_amount || 0), 0);
        if (total_purchases === 0 && sInvTxs.length > 0) {
          for (const t of sInvTxs) {
            if (t.type !== "receive") continue;
            let items: any[] = [];
            try { items = typeof t.items === "string" ? JSON.parse(t.items) : (t.items || []); } catch { items = []; }
            total_purchases += items.reduce((sum: number, it: any) => sum + (Number(it.quantity || 0) * Number(it.price || 0)), 0);
          }
        }

        const total_paid = sPurchases.reduce((sum: number, p: any) => sum + Number(p.paid_amount || 0), 0);
        const total_payments = sTxs.filter((t: any) => t.type === "payment").reduce((sum: number, t: any) => sum + Number(t.amount || 0), 0);
        const total_returns = sTxs.filter((t: any) => t.type === "return").reduce((sum: number, t: any) => sum + Number(t.amount || 0), 0);
        const purchase_count = sPurchases.length;
        const creditLimit = Number(s.credit_limit || 0);
        const balance = Number(s.balance || 0);
        const credit_utilization = creditLimit > 0 ? Math.round((Math.max(balance, 0) / creditLimit) * 100 * 100) / 100 : 0;
        const supplier_code = s.supplier_code && s.supplier_code !== "0" && s.supplier_code !== 0 ? s.supplier_code : `SUP-${String(s.id).padStart(6, "0")}`;

        return {
          ...s,
          supplier_code,
          total_purchases,
          total_paid,
          total_payments,
          total_returns,
          purchase_count,
          tx_count: sInvTxs.length,
          credit_utilization
        };
      });

      // Filter by s.id = $1 or literal id if single supplier query
      const paramIdMatch = lowerSql.match(/s\.id\s*=\s*\$(\d+)/i);
      const literalIdMatch = lowerSql.match(/s\.id\s*=\s*(\d+)/i);
      if (paramIdMatch) {
        const targetId = Number(params[parseInt(paramIdMatch[1], 10) - 1]);
        enriched = enriched.filter((s: any) => Number(s.id) === targetId);
        return { rows: enriched, rowCount: enriched.length };
      } else if (literalIdMatch) {
        const targetId = Number(literalIdMatch[1]);
        enriched = enriched.filter((s: any) => Number(s.id) === targetId);
        return { rows: enriched, rowCount: enriched.length };
      }

      // Filter by status if requested: s.status = $...
      const statusMatch = lowerSql.match(/s\.status\s*=\s*\$(\d+)/i);
      if (statusMatch) {
        const statusVal = params[parseInt(statusMatch[1]) - 1];
        if (statusVal) enriched = enriched.filter((s: any) => s.status === statusVal);
      }

      // Filter by group_name if requested: s.group_name = $...
      const groupMatch = lowerSql.match(/s\.group_name\s*=\s*\$(\d+)/i);
      if (groupMatch) {
        const groupVal = params[parseInt(groupMatch[1]) - 1];
        if (groupVal) enriched = enriched.filter((s: any) => s.group_name === groupVal);
      }

      // Filter by approval_status if requested: s.approval_status = $...
      const approvalMatch = lowerSql.match(/s\.approval_status\s*=\s*\$(\d+)/i);
      if (approvalMatch) {
        const approvalVal = params[parseInt(approvalMatch[1]) - 1];
        if (approvalVal) enriched = enriched.filter((s: any) => s.approval_status === approvalVal);
      }

      // Filter by search term if requested (ILIKE)
      const searchMatch = lowerSql.match(/s\.name\s+ilike\s+\$(\d+)/i);
      if (searchMatch) {
        const rawSearch = String(params[parseInt(searchMatch[1]) - 1] || "").replace(/%/g, "").trim().toLowerCase();
        if (rawSearch) {
          enriched = enriched.filter((s: any) => {
            return (
              String(s.name || "").toLowerCase().includes(rawSearch) ||
              String(s.name_en || "").toLowerCase().includes(rawSearch) ||
              String(s.supplier_code || "").toLowerCase().includes(rawSearch) ||
              String(s.phone || "").toLowerCase().includes(rawSearch) ||
              String(s.tax_number || "").toLowerCase().includes(rawSearch) ||
              String(s.email || "").toLowerCase().includes(rawSearch)
            );
          });
        }
      }

      // Order by created_at DESC, id DESC
      enriched.sort((a: any, b: any) => {
        const timeA = new Date(a.created_at || 0).getTime();
        const timeB = new Date(b.created_at || 0).getTime();
        if (timeA !== timeB) return timeB - timeA;
        return Number(b.id || 0) - Number(a.id || 0);
      });

      return { rows: enriched, rowCount: enriched.length };
    }

    // ─── Supplier transactions with calculated effect ───
    if (lowerSql.includes("from supplier_transactions") && !lowerSql.includes("from suppliers s")) {
      const txList = dbState["supplier_transactions"] || [];
      let rows = txList.map((st: any) => {
        let effect = 0;
        if (st.type === "purchase" || st.type === "adjustment") effect = Number(st.amount || 0);
        else if (st.type === "payment" || st.type === "return") effect = -Number(st.amount || 0);
        return { ...st, effect };
      });
      const supMatch = lowerSql.match(/supplier_id\s*=\s*\$(\d+)/i);
      if (supMatch) {
        const supId = Number(params[parseInt(supMatch[1]) - 1]);
        rows = rows.filter((r: any) => Number(r.supplier_id) === supId);
      }
      if (lowerSql.includes("reference_type") && lowerSql.includes("<> 'opening_balance'")) {
        rows = rows.filter((r: any) => (r.reference_type || "") !== "opening_balance");
      }
      if (lowerSql.includes("select coalesce(sum(")) {
        const sumEffect = rows.reduce((s: number, r: any) => s + (r.effect || 0), 0);
        return { rows: [{ balance: sumEffect }], rowCount: 1 };
      }
      if (lowerSql.includes("order by st.timestamp asc") || lowerSql.includes("order by timestamp asc")) {
        rows.sort((a: any, b: any) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime() || a.id - b.id);
      } else {
        rows.sort((a: any, b: any) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime() || b.id - a.id);
      }
      return { rows, rowCount: rows.length };
    }

    // Intercept purchases join query
    if (lowerSql.includes("from purchases p") && lowerSql.includes("join suppliers s")) {
      const purchasesList = dbState["purchases"] || [];
      const suppliersList = dbState["suppliers"] || [];
      const warehousesList = dbState["warehouses"] || [];
      const purchaseItemsList = dbState["purchase_items"] || [];
      const ingredientsList = dbState["ingredients"] || [];

      let joinedRows = purchasesList.map((p) => {
        const s = suppliersList.find((sup) => Number(sup.id) === Number(p.supplier_id));
        const w = warehousesList.find((wh) => Number(wh.id) === Number(p.warehouse_id));
        
        const pItems = purchaseItemsList.filter((pi) => Number(pi.purchase_id) === Number(p.id));
        const itemNames = pItems.map((pi) => {
           const ing = ingredientsList.find((i) => Number(i.id) === Number(pi.ingredient_id));
           return ing ? ing.name : '';
        }).filter(Boolean).join(" - ");

        return {
          ...p,
          supplier_name: s ? s.name : "غير محدد",
          warehouse_name: w ? w.name : "غير محدد",
          item_names: itemNames,
          date: p.date || new Date().toISOString(),
        };
      });
      
      joinedRows.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());

      // Optional id filter
      const idMatch = lowerSql.match(/p\.id\s*=\s*\$(\d+)/i);
      if (idMatch) {
        const pIdx = parseInt(idMatch[1]) - 1;
        joinedRows = joinedRows.filter(r => Number(r.id) === Number(params[pIdx]));
      }

      return { rows: joinedRows, rowCount: joinedRows.length };
    }

    // Intercept purchase_orders queries
    if (lowerSql.includes("from purchase_orders")) {
      const ordersList = dbState["purchase_orders"] || [];
      const suppliersList = dbState["suppliers"] || [];

      let joinedRows = ordersList.map((o) => {
        const s = suppliersList.find((sup) => Number(sup.id) === Number(o.supplier_id));
        return {
          ...o,
          supplier_name: s ? s.name : "غير محدد",
          date: o.date || new Date().toISOString(),
        };
      });

      joinedRows.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());

      // Optional id filter (details query)
      const poIdMatch = lowerSql.match(/po\.id\s*=\s*\$(\d+)/i) || lowerSql.match(/po\.id\s*=\s*(\d+)/i);
      if (poIdMatch) {
        const idMatchVal = poIdMatch[1];
        const isParamRef = idMatchVal.startsWith("$") || !isNaN(Number(idMatchVal));
        const targetId = idMatchVal.startsWith("$") 
          ? Number(params[parseInt(idMatchVal.substring(1)) - 1])
          : Number(idMatchVal);
        joinedRows = joinedRows.filter(r => Number(r.id) === targetId);
      }

      return { rows: joinedRows, rowCount: joinedRows.length };
    }

    // Intercept payroll attendance aggregate query (no JOIN, uses GROUP BY)
    // Query: SELECT employee_id, COUNT(*) as days_attended, SUM(work_hours) as total_hours, json_agg(...) as records FROM attendance WHERE date::text LIKE $1 AND status = 'present' GROUP BY employee_id
    if (lowerSql.includes("from attendance") && lowerSql.includes("group by employee_id") && !lowerSql.includes("join employees")) {
      const attList = dbState["attendance"] || [];
      const pattern = params[0] as string;
      const regexStr = pattern.replace(/%/g, ".*");
      const regex = new RegExp(`^${regexStr}$`, "i");

      // Filter by date pattern
      const filtered = attList.filter((r: any) => {
        const dateMatch = regex.test(String(r.date || ""));
        return dateMatch;
      });

      // Group by employee_id and date
      const empMap = new Map<number, Map<string, any>>();
      for (const rec of filtered) {
        const empId = Number(rec.employee_id);
        const dStr = String(rec.date || "").split("T")[0].split(" ")[0];
        if (!empMap.has(empId)) empMap.set(empId, new Map<string, any>());
        const dateMap = empMap.get(empId)!;

        const times = [rec.check_in, rec.check_out, rec.punch_time].filter(Boolean).map(t => String(t).trim());

        if (!dateMap.has(dStr)) {
          dateMap.set(dStr, {
            date: dStr,
            check_in: rec.check_in || undefined,
            check_out: rec.check_out || undefined,
            work_hours: Number(rec.work_hours) || 0,
            times: times
          });
        } else {
          const existing = dateMap.get(dStr);
          existing.times.push(...times);
          if (Number(rec.work_hours) > existing.work_hours) {
            existing.work_hours = Number(rec.work_hours);
          }
        }
      }

      const rows = [];
      for (const [empId, dateMap] of empMap.entries()) {
        const records = [];
        let totalHours = 0;

        for (const [dStr, dayObj] of dateMap.entries()) {
          const uniqueTimes = Array.from(new Set(dayObj.times)).filter(Boolean);
          if (uniqueTimes.length > 0) {
            uniqueTimes.sort((a, b) => new Date(a as any).getTime() - new Date(b as any).getTime());
            const earliest = uniqueTimes[0];
            const latest = uniqueTimes[uniqueTimes.length - 1];
            dayObj.check_in = earliest;
            if (new Date(latest as any).getTime() > new Date(earliest as any).getTime()) {
              dayObj.check_out = latest;
              const diffHours = (new Date(latest as any).getTime() - new Date(earliest as any).getTime()) / 3600000;
              dayObj.work_hours = Math.round(diffHours * 100) / 100;
            }
          }
          delete dayObj.times;
          records.push(dayObj);
          totalHours += dayObj.work_hours || 0;
        }

        rows.push({
          employee_id: empId,
          days_attended: records.length,
          days: records.length,
          total_hours: totalHours,
          records: records
        });
      }

      return { rows, rowCount: rows.length };
    }

    // Intercept attendance JOIN employees query (used by /api/attendance endpoint)
    // MUST come before the shift subquery interceptor because the attendance SQL
    // contains an inline COALESCE((SELECT ... FROM employee_shifts es JOIN hr_shifts s ...)) subquery.
    if (lowerSql.includes("from attendance a") && lowerSql.includes("join employees e")) {
      const attendanceList = dbState["attendance"] || [];
      const employeesList = dbState["employees"] || [];
      const deptsList = dbState["hr_departments"] || [];
      const branchesList = dbState["branches"] || [];
      const shiftsList = dbState["hr_shifts"] || dbState["employee_shifts"] || [];
      const empShiftsList = dbState["employee_shifts"] || [];

      let joinedRows = attendanceList.map((a: any) => {
        const emp = employeesList.find((e: any) => Number(e.id) === Number(a.employee_id) || (e.fingerprint_code && String(e.fingerprint_code) === String(a.employee_id)));
        const dept = deptsList.find((d: any) => Number(d.id) === Number(emp?.department_id || a.department_id));
        const branch = branchesList.find((b: any) => Number(b.id) === Number(emp?.branch_id || a.branch_id));
        // Find the employee's shift
        const empShift = empShiftsList.find((es: any) => Number(es.employee_id) === Number(a.employee_id) || Number(es.employee_id) === Number(emp?.id));
        const shift = shiftsList.find((s: any) => Number(s.id) === Number(empShift?.shift_id || a.shift_id));
        // Calculate total_hours from start_time/end_time if missing
        let shift_total_hours = shift?.total_hours;
        if (shift_total_hours === undefined && shift?.start_time && shift?.end_time) {
          const [sh, sm] = String(shift.start_time).split(":").map(Number);
          const [eh, em] = String(shift.end_time).split(":").map(Number);
          let diff = (eh * 60 + em) - (sh * 60 + sm);
          if (diff < 0) diff += 24 * 60; // overnight
          shift_total_hours = diff / 60;
        }
        return {
          ...a,
          employee_name: emp?.name || a.employee_name || "موظف مجهول",
          fingerprint_code: emp?.fingerprint_code || a.fingerprint_code || "",
          department_id: emp?.department_id ?? a.department_id ?? null,
          branch_id: emp?.branch_id ?? a.branch_id ?? null,
          department_name: dept?.name || a.department_name || "—",
          branch_name: branch?.name || a.branch_name || "—",
          basic_salary: emp?.basic_salary || emp?.salary || 0,
          work_days: emp?.work_days || 0,
          exempt_from_penalties: emp?.exempt_from_penalties || false,
          shift_name: shift?.name || a.shift_name || "بصمة مجهولة",
          shift_total_hours,
        };
      });

      // Apply WHERE filters (year/month/branch)
      const yearMonthMatch = lowerSql.match(/a\.date::text\s+like\s+\$(\d+)/i) || lowerSql.match(/a\.date\s+like\s+\$(\d+)/i);
      if (yearMonthMatch) {
        const pIdx = parseInt(yearMonthMatch[1]) - 1;
        const pattern = params[pIdx] as string;
        const regexStr = pattern.replace(/%/g, ".*");
        const regex = new RegExp(`^${regexStr}$`, "i");
        joinedRows = joinedRows.filter(r => regex.test(String(r.date || "")));
      }
      const sdMatch = lowerSql.match(/a\.date\s*>=\s*\$(\d+)/i);
      const edMatch = lowerSql.match(/a\.date\s*<=\s*\$(\d+)/i);
      if (sdMatch) {
        const v = params[parseInt(sdMatch[1]) - 1];
        joinedRows = joinedRows.filter(r => String(r.date || "") >= String(v));
      }
      if (edMatch) {
        const v = params[parseInt(edMatch[1]) - 1];
        joinedRows = joinedRows.filter(r => String(r.date || "") <= String(v));
      }
      const branchMatch = lowerSql.match(/e\.branch_id\s*=\s*\$(\d+)/i);
      if (branchMatch) {
        const v = params[parseInt(branchMatch[1]) - 1];
        joinedRows = joinedRows.filter(r => Number(r.branch_id) === Number(v));
      }

      // ORDER BY a.date DESC, a.check_in DESC
      joinedRows.sort((a: any, b: any) => {
        const d1 = String(a.date || "");
        const d2 = String(b.date || "");
        if (d1 !== d2) return d1 < d2 ? 1 : -1;
        const t1 = String(a.check_in || "");
        const t2 = String(b.check_in || "");
        return t1 < t2 ? 1 : t1 > t2 ? -1 : 0;
      });

      return { rows: joinedRows, rowCount: joinedRows.length };
    }

    // Intercept payroll_deductions JOIN employees query (used by /api/payroll/deductions endpoint)
    if (lowerSql.includes("from payroll_deductions d") && lowerSql.includes("join employees e")) {
      const deductionsList = dbState["payroll_deductions"] || [];
      const employeesList = dbState["employees"] || [];

      let joinedRows = deductionsList.map((d: any) => {
        const emp = employeesList.find((e: any) => Number(e.id) === Number(d.employee_id));
        return {
          ...d,
          employee_name: emp?.name || "موظف مجهول",
          fingerprint_code: emp?.fingerprint_code || "",
          basic_salary: emp?.basic_salary || emp?.salary || 0,
          department_id: emp?.department_id || null,
        };
      });

      // Apply WHERE filters (year/month, employee_id, type IN (...))
      const yearMonthMatch = lowerSql.match(/d\.date::text\s+like\s+\$(\d+)/i) || lowerSql.match(/d\.date\s+like\s+\$(\d+)/i);
      if (yearMonthMatch) {
        const pIdx = parseInt(yearMonthMatch[1]) - 1;
        const pattern = params[pIdx] as string;
        const regexStr = pattern.replace(/%/g, ".*");
        const regex = new RegExp(`^${regexStr}$`, "i");
        joinedRows = joinedRows.filter(r => regex.test(String(r.date || "")));
      }
      const empIdMatch = lowerSql.match(/d\.employee_id\s*=\s*\$(\d+)/i);
      if (empIdMatch) {
        const v = params[parseInt(empIdMatch[1]) - 1];
        joinedRows = joinedRows.filter(r => Number(r.employee_id) === Number(v));
      }
      // type = 'penalty' OR type = 'delay' OR ... → filter by type if present
      const typeOrMatch = lowerSql.match(/d\.type\s*=\s*'([^']+)'/g);
      if (typeOrMatch) {
        const allowedTypes = typeOrMatch.map((m: string) => m.match(/'([^']+)'/)?.[1]).filter(Boolean);
        joinedRows = joinedRows.filter(r => allowedTypes.includes(r.type));
      }

      // If the query has GROUP BY, aggregate (used by /api/payroll/deductions totals query)
      if (lowerSql.includes("group by")) {
        const groupCols = ["employee_id", "employee_name"];
        const groupedMap = new Map<string, any>();
        for (const row of joinedRows) {
          const key = groupCols.map(c => String(row[c])).join("|||");
          if (!groupedMap.has(key)) {
            groupedMap.set(key, { employee_id: row.employee_id, employee_name: row.employee_name, penalty_count: 0, total_amount: 0 });
          }
          const g = groupedMap.get(key);
          g.penalty_count += 1;
          g.total_amount += Number(row.amount) || 0;
        }
        return { rows: Array.from(groupedMap.values()), rowCount: groupedMap.size };
      }

      // ORDER BY d.date DESC
      joinedRows.sort((a: any, b: any) => {
        const d1 = String(a.date || "");
        const d2 = String(b.date || "");
        return d1 < d2 ? 1 : d1 > d2 ? -1 : 0;
      });

      return { rows: joinedRows, rowCount: joinedRows.length };
    }

    // Intercept employee_custody JOIN employees query (used by /api/hr/custody endpoint)
    if (lowerSql.includes("from employee_custody c") && lowerSql.includes("join employees e")) {
      const custodyList = dbState["employee_custody"] || [];
      const employeesList = dbState["employees"] || [];
      const departmentsList = dbState["hr_departments"] || [];

      let joinedRows = custodyList.map((c: any) => {
        const emp = employeesList.find((e: any) => Number(e.id) === Number(c.employee_id));
        const dept = emp ? departmentsList.find((d: any) => Number(d.id) === Number(emp.department_id)) : null;
        return {
          ...c,
          employee_name: emp?.name || "موظف مجهول",
          department_name: dept?.name || null,
        };
      });

      // Optional employee_id filter
      const empIdMatch = lowerSql.match(/c\.employee_id\s*=\s*\$(\d+)/i) || lowerSql.match(/employee_id\s*=\s*\$(\d+)/i);
      if (empIdMatch) {
        const v = params[parseInt(empIdMatch[1]) - 1];
        joinedRows = joinedRows.filter(r => Number(r.employee_id) === Number(v));
      }

      // ORDER BY c.id DESC
      joinedRows.sort((a: any, b: any) => Number(b.id) - Number(a.id));

      return { rows: joinedRows, rowCount: joinedRows.length };
    }

    // Intercept hr_departments query with employee_count subquery
    // Query: SELECT d.*, (SELECT COUNT(*) FROM employees WHERE department_id = d.id) as employee_count FROM hr_departments d
    if (lowerSql.includes("from hr_departments d") && lowerSql.includes("select count(*)")) {
      const deptsList = dbState["hr_departments"] || [];
      const employeesList = dbState["employees"] || [];

      const rows = deptsList.map((d: any) => {
        const employee_count = employeesList.filter((e: any) => Number(e.department_id) === Number(d.id)).length;
        return { ...d, employee_count };
      });

      return { rows, rowCount: rows.length };
    }

    // Intercept hr_employee_documents JOIN employees query
    // The original query uses CASE WHEN and INTERVAL which the offline DB can't parse,
    // so we replicate the logic in JS.
    if (lowerSql.includes("from hr_employee_documents doc") && lowerSql.includes("join employees e")) {
      const docsList = dbState["hr_employee_documents"] || [];
      const employeesList = dbState["employees"] || [];
      const now = new Date();
      const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      let rows = docsList.map((doc: any) => {
        const emp = employeesList.find((e: any) => Number(e.id) === Number(doc.employee_id));
        // Compute status based on expiry_date
        let status = doc.status || "valid";
        if (doc.expiry_date) {
          const exp = new Date(doc.expiry_date);
          if (exp < now) status = "expired";
          else if (exp <= thirtyDaysLater) status = "pending";
        }
        return {
          ...doc,
          employee_name: emp?.name || "موظف مجهول",
          job_title: emp?.job_title || null,
          status,
        };
      });

      // Apply employee_id filter if present
      const empIdMatch = lowerSql.match(/doc\.employee_id\s*=\s*\$(\d+)/i);
      if (empIdMatch) {
        const v = params[parseInt(empIdMatch[1]) - 1];
        rows = rows.filter(r => Number(r.employee_id) === Number(v));
      }

      return { rows, rowCount: rows.length };
    }

    // Intercept standalone shift subquery
    if (
      !lowerSql.includes("from attendance") &&
      lowerSql.includes("from employee_shifts es") &&
      lowerSql.includes("join hr_shifts s")
    ) {
      const empShiftsList = dbState["employee_shifts"] || [];
      const shiftsList = dbState["hr_shifts"] || [];
      const empIdMatch = lowerSql.match(/es\.employee_id\s*=\s*\$(\d+)/i);
      let rows: any[] = [];
      if (empIdMatch) {
        const empId = Number(params[parseInt(empIdMatch[1]) - 1]);
        const es = empShiftsList.find((x: any) => Number(x.employee_id) === empId);
        if (es) {
          const s = shiftsList.find((sh: any) => Number(sh.id) === Number(es.shift_id));
          if (s) {
            let total_hours = s.total_hours;
            if (total_hours === undefined && s.start_time && s.end_time) {
              const [sh, sm] = String(s.start_time).split(":").map(Number);
              const [eh, em] = String(s.end_time).split(":").map(Number);
              let diff = (eh * 60 + em) - (sh * 60 + sm);
              if (diff < 0) diff += 24 * 60;
              total_hours = diff / 60;
            }
            rows = [{ total_hours, ...s }];
          }
        }
      }
      return { rows, rowCount: rows.length };
    }

    // ─── Recipe Costing & Products Interceptor ───
    if (lowerSql.includes("from products") && (lowerSql.includes("product_ingredients") || lowerSql.includes("recipe") || lowerSql.includes("count(pi.") || lowerSql.includes("yield_portions"))) {
      const productsList = dbState["products"] || [];
      const productIngredientsList = dbState["product_ingredients"] || [];
      const categoriesList = dbState["categories"] || [];

      let rows = productsList.map((p: any) => {
        const cat = categoriesList.find((c: any) => Number(c.id) === Number(p.category_id));
        const pIngredients = productIngredientsList.filter((pi: any) => String(pi.product_id) === String(p.id) || String(pi.product_id) === String(p.name));
        return {
          id: p.id,
          name: p.name,
          category: p.category || cat?.name || "عام",
          item_code: p.item_code || p.code || `PROD-${p.id}`,
          code: p.code || p.item_code || `PROD-${p.id}`,
          barcode: p.barcode || "",
          sku: p.sku || "",
          selling_price: Number(p.price) || Number(p.selling_price) || 0,
          price: Number(p.price) || Number(p.selling_price) || 0,
          cost_price: Number(p.cost_price) || Number(p.cost) || 0,
          cost: Number(p.cost_price) || Number(p.cost) || 0,
          unit: p.unit || "وجبة",
          yield_portions: Number(p.yield_portions) || 1,
          show_in_pos: p.show_in_pos !== undefined ? Boolean(p.show_in_pos) : true,
          is_active: p.is_active !== undefined ? Boolean(p.is_active) : true,
          ingredients_count: pIngredients.length,
          description: p.description || ""
        };
      });

      // Filter by ID if single product query
      const idMatch = lowerSql.match(/where\s+(?:p\.)?id\s*=\s*\$(\d+)/i) || lowerSql.match(/where\s+(?:p\.)?id\s*=\s*['"]?([^'"\s]+)['"]?/i);
      if (idMatch) {
        const targetVal = idMatch[1].startsWith("$") ? params[parseInt(idMatch[1].substring(1)) - 1] : idMatch[1];
        rows = rows.filter((r: any) => String(r.id) === String(targetVal) || String(r.name) === String(targetVal));
      }

      rows.sort((a: any, b: any) => (a.name || "").localeCompare(b.name || "", "ar"));
      return { rows, rowCount: rows.length };
    }

    // Intercept product_ingredients query for recipe calculation
    if (lowerSql.includes("from product_ingredients pi") && lowerSql.includes("join ingredients i")) {
      const productIngredientsList = dbState["product_ingredients"] || [];
      const ingredientsList = dbState["ingredients"] || [];
      const inventoryItemsList = dbState["inventory_items"] || [];

      let rows = productIngredientsList.map((pi: any) => {
        const ing = ingredientsList.find((i: any) => Number(i.id) === Number(pi.ingredient_id));
        if (!ing) return null;
        const ingCost = Number(ing.cost) || Number(ing.avg_cost) || Number(ing.last_purchase_price) || 0;
        return {
          ingredient_id: Number(pi.ingredient_id),
          recipe_quantity: Number(pi.quantity) || 0,
          recipe_unit: pi.unit || ing.unit || "كجم",
          waste_percent: Number(pi.waste_percent) || 0,
          ingredient_name: ing.name,
          cost_unit: ing.unit || "كجم",
          standard_cost: ingCost,
          avg_cost: Number(ing.avg_cost) || ingCost,
          last_purchase_price: Number(ing.last_purchase_price) || ingCost,
          ingredient_category: ing.item_group || ing.category || "خامات أساسية",
          product_id: String(pi.product_id)
        };
      }).filter(Boolean);

      const prodMatch = lowerSql.match(/pi\.product_id\s*=\s*\$(\d+)/i);
      if (prodMatch) {
        const pId = String(params[parseInt(prodMatch[1]) - 1]);
        rows = rows.filter((r: any) => String(r.product_id) === pId);
      }

      return { rows, rowCount: rows.length };
    }

    // Intercept purchase_order_items queries
    if (lowerSql.includes("from purchase_order_items")) {
      const orderItemsList = dbState["purchase_order_items"] || [];
      const ingredientsList = dbState["ingredients"] || [];
      const productsList = dbState["products"] || [];

      let joinedRows = orderItemsList.map((poi) => {
        let name = "صنف غير معروف";
        let unit = "قطعة";
        let item_code = "-";
        
        const ingIdStr = String(poi.ingredient_id);
        if (ingIdStr.startsWith("p_")) {
          const prodId = Number(ingIdStr.replace("p_", ""));
          const prod = productsList.find((p) => Number(p.id) === prodId);
          if (prod) {
            name = prod.name;
            item_code = prod.barcode || "-";
          }
        } else {
          const ing = ingredientsList.find((i) => Number(i.id) === Number(poi.ingredient_id));
          if (ing) {
            name = ing.name;
            unit = ing.unit;
            item_code = ing.item_code || "-";
          }
        }

        return {
          ...poi,
          ingredient_name: name,
          unit,
          item_code
        };
      });

      // Optional purchase_order_id filter
      const poIdMatch = lowerSql.match(/purchase_order_id\s*=\s*\$(\d+)/i) || lowerSql.match(/purchase_order_id\s*=\s*(\d+)/i);
      if (poIdMatch) {
        const idMatchVal = poIdMatch[1];
        const targetId = idMatchVal.startsWith("$")
          ? Number(params[parseInt(idMatchVal.substring(1)) - 1])
          : Number(idMatchVal);
        joinedRows = joinedRows.filter(r => Number(r.purchase_order_id) === targetId);
      }

      return { rows: joinedRows, rowCount: joinedRows.length };
    }

    // Intercept purchase_requests queries
    if (lowerSql.includes("from purchase_requests")) {
      const requestsList = dbState["purchase_requests"] || [];
      const requestItemsList = dbState["purchase_request_items"] || [];

      let joinedRows = requestsList.map((pr) => {
        const items = requestItemsList.filter((ri) => Number(ri.purchase_request_id) === Number(pr.id));
        return {
          ...pr,
          items_count: items.length,
          date: pr.date || new Date().toISOString(),
        };
      });

      joinedRows.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());

      // Optional id filter
      const prIdMatch = lowerSql.match(/id\s*=\s*\$(\d+)/i) || lowerSql.match(/id\s*=\s*(\d+)/i);
      if (prIdMatch) {
        const idMatchVal = prIdMatch[1];
        const targetId = idMatchVal.startsWith("$")
          ? Number(params[parseInt(idMatchVal.substring(1)) - 1])
          : Number(idMatchVal);
        joinedRows = joinedRows.filter(r => Number(r.id) === targetId);
      }

      return { rows: joinedRows, rowCount: joinedRows.length };
    }

    // Intercept purchase_request_items queries
    if (lowerSql.includes("from purchase_request_items")) {
      const requestItemsList = dbState["purchase_request_items"] || [];
      const ingredientsList = dbState["ingredients"] || [];
      const productsList = dbState["products"] || [];

      let joinedRows = requestItemsList.map((pri) => {
        let name = pri.name || "صنف غير معروف";
        let unit = pri.unit || "قطعة";
        let item_code = "-";
        
        const ingIdStr = String(pri.ingredient_id);
        if (ingIdStr.startsWith("p_")) {
          const prodId = Number(ingIdStr.replace("p_", ""));
          const prod = productsList.find((p) => Number(p.id) === prodId);
          if (prod) {
            name = prod.name;
            item_code = prod.barcode || "-";
          }
        } else {
          const ing = ingredientsList.find((i) => Number(i.id) === Number(pri.ingredient_id));
          if (ing) {
            name = ing.name;
            unit = ing.unit;
            item_code = ing.item_code || "-";
          }
        }

        return {
          ...pri,
          ingredient_name: name,
          unit,
          item_code
        };
      });

      // Optional purchase_request_id filter
      const prIdMatch = lowerSql.match(/purchase_request_id\s*=\s*\$(\d+)/i) || lowerSql.match(/purchase_request_id\s*=\s*(\d+)/i);
      if (prIdMatch) {
        const idMatchVal = prIdMatch[1];
        const targetId = idMatchVal.startsWith("$")
          ? Number(params[parseInt(idMatchVal.substring(1)) - 1])
          : Number(idMatchVal);
        joinedRows = joinedRows.filter(r => Number(r.purchase_request_id) === targetId);
      }

      return { rows: joinedRows, rowCount: joinedRows.length };
    }

    // Intercept operating_costs queries to resolve cost center and cost item names
    if (lowerSql.includes("from operating_costs")) {
      const costsList = dbState["operating_costs"] || [];
      const centersList = dbState["cost_centers"] || [];
      const itemsList = dbState["cost_items"] || [];

      let joinedRows = costsList.map((oc) => {
        const cc = centersList.find((c) => Number(c.id) === Number(oc.cost_center_id));
        const ci = itemsList.find((i) => Number(i.id) === Number(oc.cost_item_id));
        return {
          ...oc,
          cost_center_name: cc ? cc.name : "غير محدد",
          cost_item_name: ci ? ci.name : "غير محدد",
          cost_type: ci ? ci.cost_type : "غير محدد",
          date: oc.date || new Date().toISOString()
        };
      });

      // Filter by ID if requested
      const idMatch = lowerSql.match(/id\s*=\s*\$(\d+)/i) || lowerSql.match(/id\s*=\s*(\d+)/i);
      if (idMatch) {
        const idMatchVal = idMatch[1];
        const isParam = idMatch[0].includes("$");
        const targetId = isParam
          ? Number(params[parseInt(idMatchVal) - 1])
          : Number(idMatchVal);
        joinedRows = joinedRows.filter(r => Number(r.id) === targetId);
      }

      // Sort by date DESC
      joinedRows.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());

      return { rows: joinedRows, rowCount: joinedRows.length };
    }

    // Intercept cost_centers queries to aggregate total costs
    if (lowerSql.includes("from cost_centers")) {
      const centersList = dbState["cost_centers"] || [];
      const costsList = dbState["operating_costs"] || [];

      let joinedRows = centersList.map((cc) => {
        const total = costsList
          .filter((oc) => Number(oc.cost_center_id) === Number(cc.id))
          .reduce((sum, oc) => sum + Number(oc.amount || 0), 0);
        return {
          ...cc,
          total_cost: total
        };
      });

      // Filter by ID if requested
      const idMatch = lowerSql.match(/id\s*=\s*\$(\d+)/i) || lowerSql.match(/id\s*=\s*(\d+)/i);
      if (idMatch) {
        const idMatchVal = idMatch[1];
        const isParam = idMatch[0].includes("$");
        const targetId = isParam
          ? Number(params[parseInt(idMatchVal) - 1])
          : Number(idMatchVal);
        joinedRows = joinedRows.filter(r => Number(r.id) === targetId);
      }

      return { rows: joinedRows, rowCount: joinedRows.length };
    }

    // Intercept cost_items queries
    if (lowerSql.includes("from cost_items")) {
      let joinedRows = dbState["cost_items"] || [];

      // Filter by ID if requested
      const idMatch = lowerSql.match(/id\s*=\s*\$(\d+)/i) || lowerSql.match(/id\s*=\s*(\d+)/i);
      if (idMatch) {
        const idMatchVal = idMatch[1];
        const isParam = idMatch[0].includes("$");
        const targetId = isParam
          ? Number(params[parseInt(idMatchVal) - 1])
          : Number(idMatchVal);
        joinedRows = joinedRows.filter(r => Number(r.id) === targetId);
      }

      return { rows: joinedRows, rowCount: joinedRows.length };
    }

    // Intercept hr_job_postings with application counts
    if (lowerSql.includes("from hr_job_postings") && lowerSql.includes("applications_count")) {
      const jpList = dbState["hr_job_postings"] || [];
      const appsList = dbState["hr_job_applications"] || [];
      
      let rows = jpList.map((jp: any) => {
        const apps = appsList.filter((a: any) => Number(a.job_posting_id) === Number(jp.id));
        return {
          ...jp,
          applications_count: apps.length,
          rejected_count: apps.filter((a: any) => a.status === 'rejected').length,
          hired_count: apps.filter((a: any) => a.status === 'hired').length
        };
      });
      
      rows.sort((a: any, b: any) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
      return { rows, rowCount: rows.length };
    }

    // Determine the main table name (at depth 0 to avoid subqueries in SELECT projection)
    let tableName: string | null = null;
    let mainFromIndex = -1;

    let scanDepth = 0;
    let scanInQuote = false;
    for (let i = 0; i < normalizedSql.length; i++) {
      const ch = normalizedSql[i];
      if (ch === "'" || ch === '"') { scanInQuote = !scanInQuote; continue; }
      if (scanInQuote) continue;
      if (ch === "(") scanDepth++;
      else if (ch === ")") scanDepth = Math.max(0, scanDepth - 1);
      else if (scanDepth === 0) {
        const sub = normalizedSql.substring(i);
        const m = sub.match(/^[\s\n]+from[\s\n]+([a-zA-Z0-9_]+)/i);
        if (m) {
          tableName = m[1];
          mainFromIndex = i + m[0].length;
          break;
        }
      }
    }

    if (!tableName) {
      const fromMatch = normalizedSql.match(/from\s+([a-zA-Z0-9_]+)/i);
      if (fromMatch) {
        tableName = fromMatch[1];
      } else {
        if (lowerSql.includes("select count(*)")) {
          return { rows: [{ count: 0 }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
    }

    if (tableName === "attendances") {
      tableName = "attendance";
    }
    let data = dbState[tableName] || [];

    // Ensure ingredient names and auto-generated codes exist when directly querying ingredients
    if (tableName === "ingredients") {
      data = data.map((ing) => ({
        ...ing,
        ingredient_name: ing.name, // alias support
        item_code: ing.item_code || `ITEM-${1000 + ing.id}`,
      }));
    }

    // Check if SELECT COUNT
    const isCount = lowerSql.startsWith("select count");

    // WHERE clause (at depth 0 after the main FROM)
    let whereClause: string | null = null;
    if (mainFromIndex !== -1) {
      const afterFrom = normalizedSql.substring(mainFromIndex);
      let d = 0;
      let q = false;
      for (let i = 0; i < afterFrom.length; i++) {
        const ch = afterFrom[i];
        if (ch === "'" || ch === '"') { q = !q; continue; }
        if (q) continue;
        if (ch === "(") d++;
        else if (ch === ")") d = Math.max(0, d - 1);
        else if (d === 0) {
          const sub = afterFrom.substring(i);
          const wm = sub.match(/^[\s\n]+where[\s\n]+(.+?)(?:[\s\n]+order[\s\n]+by|[\s\n]+group[\s\n]+by|[\s\n]+limit|[\s\n]+offset|$)/i);
          if (wm) {
            whereClause = wm[1].trim();
            break;
          }
        }
      }
    } else {
      const whereMatch = normalizedSql.match(/where\s+(.+?)(?:\s+order\s+by|\s+group\s+by|\s+limit|\s+offset|$)/i);
      if (whereMatch) whereClause = whereMatch[1].trim();
    }

    if (whereClause) {
      data = filterData(data, whereClause, params);
    }

    // GROUP BY - aggregate rows by the specified columns, applying SUM() to other selected columns
    // Supports: SELECT col1, col2, SUM(col3) as alias FROM ... GROUP BY col1, col2
    const groupByMatch = normalizedSql.match(/group\s+by\s+([a-zA-Z0-9_,\s]+?)(?:\s+order\s+by|\s+limit|\s+offset|$)/i);
    if (groupByMatch) {
      const groupCols = groupByMatch[1].split(",").map((c: string) => c.trim());
      // Parse the SELECT clause to find SUM(col) aggregates
      const selectPart = normalizedSql.match(/select\s+(.+?)\s+from/i)?.[1] || "";
      const aggregates: { col: string; alias: string; fn: string }[] = [];
      const aggRegex = /(\w+)\s*\(\s*([a-zA-Z0-9_]+)\s*\)\s*(?:as\s+([a-zA-Z0-9_]+))?/gi;
      let aggMatch;
      while ((aggMatch = aggRegex.exec(selectPart)) !== null) {
        const fn = aggMatch[1].toLowerCase();
        if (fn === "sum" || fn === "count" || fn === "avg" || fn === "max" || fn === "min") {
          aggregates.push({ fn, col: aggMatch[2], alias: aggMatch[3] || aggMatch[2] });
        }
      }

      // Group the data
      const groupedMap = new Map<string, any>();
      for (const row of data) {
        const key = groupCols.map((c: string) => String(row[c])).join("|||");
        if (!groupedMap.has(key)) {
          const grouped: any = {};
          groupCols.forEach((c: string) => { grouped[c] = row[c]; });
          aggregates.forEach(a => {
            grouped[a.alias] = 0;
            (grouped as any).__count = 0;
          });
          groupedMap.set(key, grouped);
        }
        const g = groupedMap.get(key);
        aggregates.forEach(a => {
          const val = Number(row[a.col]) || 0;
          if (a.fn === "sum") g[a.alias] = (g[a.alias] || 0) + val;
          else if (a.fn === "count") g[a.alias] = (g[a.alias] || 0) + 1;
          else if (a.fn === "avg") g[a.alias] = (g[a.alias] || 0) + val;
          else if (a.fn === "max") g[a.alias] = Math.max(g[a.alias] || -Infinity, val);
          else if (a.fn === "min") g[a.alias] = Math.min(g[a.alias] || Infinity, val);
        });
        g.__count = (g.__count || 0) + 1;
      }
      // Finalize averages
      if (aggregates.some(a => a.fn === "avg")) {
        for (const g of groupedMap.values()) {
          aggregates.filter(a => a.fn === "avg").forEach(a => {
            g[a.alias] = g.__count > 0 ? g[a.alias] / g.__count : 0;
          });
        }
      }
      data = Array.from(groupedMap.values()).map((g: any) => {
        const { __count, ...rest } = g;
        return rest;
      });
    }

    // ORDER BY
    const orderByMatch = normalizedSql.match(/order\s+by\s+([a-zA-Z0-9_]+)(?:\s+(asc|desc))?/i);
    if (orderByMatch) {
      const col = orderByMatch[1];
      const dir = (orderByMatch[2] || "asc").toLowerCase();
      data = [...data].sort((a, b) => {
        let valA = a[col];
        let valB = b[col];
        if (valA === valB) return 0;
        if (valA === undefined) return 1;
        if (valB === undefined) return -1;
        if (dir === "desc") {
          return valA < valB ? 1 : -1;
        } else {
          return valA > valB ? 1 : -1;
        }
      });
    }

    // LIMIT
    const limitMatch = normalizedSql.match(/limit\s+(\d+|\$\d+)/i);
    if (limitMatch) {
      let limitVal = limitMatch[1];
      if (limitVal.startsWith("$")) {
        const idx = parseInt(limitVal.substring(1)) - 1;
        limitVal = params[idx];
      }
      const limitNum = parseInt(limitVal);
      if (!isNaN(limitNum)) {
        data = data.slice(0, limitNum);
      }
    }

    if (isCount) {
      const countKey = normalizedSql.match(/select\s+count\(\*\)\s+as\s+([a-zA-Z0-9_]+)/i)?.[1] || "count";
      return { rows: [{ [countKey]: data.length }], rowCount: 1 };
    }

    return { rows: JSON.parse(JSON.stringify(data)), rowCount: data.length };
  }

  // 4. INSERT
  if (lowerSql.startsWith("insert into")) {
    const match = normalizedSql.match(/insert\s+into\s+([a-zA-Z0-9_]+)\s*\(([^)]+)\)\s*values\s*\(([^)]+)\)/i);
    if (match) {
      const tableName = match[1];
      const cols = match[2].split(",").map(c => c.trim().replace(/['"`]/g, ""));
      const valsRaw = match[3].split(",");

      let actualTableName = tableName;
      if (actualTableName === "attendances") {
        actualTableName = "attendance";
      }

      if (!dbState[actualTableName]) {
        dbState[actualTableName] = [];
      }

      const newRow: Record<string, any> = {};
      
      // Auto-increment primary key 'id'
      let maxId = 0;
      for (const r of dbState[actualTableName]) {
        if (r.id && typeof r.id === "number" && r.id > maxId) {
          maxId = r.id;
        }
      }
      newRow.id = maxId + 1;

      cols.forEach((col, idx) => {
        const rawV = valsRaw[idx];
        const valRaw = rawV ? rawV.trim() : "";
        if (valRaw.startsWith("$")) {
          const pIdx = parseInt(valRaw.substring(1)) - 1;
          newRow[col] = params[pIdx];
        } else {
          // literal
          let literal = valRaw;
          if (literal.startsWith("'") && literal.endsWith("'")) {
            literal = literal.substring(1, literal.length - 1);
          }
          newRow[col] = literal;
        }
      });

      // Implement ON CONFLICT handling for unique keys (inventory_items, settings, attendance)
      if (actualTableName === "attendance") {
        const empId = Number(newRow.employee_id);
        const punchTime = newRow.punch_time ? String(newRow.punch_time).trim() : null;
        if (empId && punchTime) {
          const existing = dbState["attendance"].find(r => 
            Number(r.employee_id) === empId && 
            (String(r.punch_time || "").trim() === punchTime || String(r.check_in || "").trim() === punchTime)
          );
          if (existing) {
            if (lowerSql.includes("do nothing")) {
              return { rows: [], rowCount: 0 };
            }
            return { rows: [existing], rowCount: 1 };
          }
        }
      } else if (actualTableName === "inventory_items") {
        const whId = Number(newRow.warehouse_id);
        const ingId = Number(newRow.ingredient_id);
        const existing = dbState[actualTableName].find(r => Number(r.warehouse_id) === whId && Number(r.ingredient_id) === ingId);
        if (existing) {
          if (lowerSql.includes("do update")) {
            const updateMatch = normalizedSql.match(/do\s+update\s+set\s+(.+)$/i);
            if (updateMatch) {
              const setExpr = updateMatch[1];
              const setParts = setExpr.split("=");
              if (setParts.length === 2) {
                const colName = setParts[0].trim().replace(/['"`]/g, "");
                if (colName === "quantity") {
                  const currentQty = Number(existing.quantity) || 0;
                  const excludedQty = Number(newRow.quantity) || 0;
                  existing.quantity = currentQty + excludedQty;
                }
              }
            }
          }
          saveDb();
          return { rows: [existing], rowCount: 1 };
        }
      } else if (actualTableName === "settings" || actualTableName === "hr_settings") {
        // BUGFIX 2026-08-25 — hr_settings upsert: the fallback's ON CONFLICT
        // handling only covered the `settings` table, so every save to
        // hr_settings PUSHED A NEW ROW instead of updating the existing one.
        // Duplicates accumulated and the GET reducer could return a stale
        // value. Treat hr_settings exactly like settings: match by key and
        // update in place.
        const keyVal = String(newRow.key).trim();
        const existing = dbState[actualTableName].find(r => String(r.key).trim() === keyVal);
        if (existing) {
          existing.value = newRow.value;
          saveDb();
          return { rows: [existing], rowCount: 1 };
        }
      }

      // Default attributes
      if (actualTableName === "users" && !newRow.permissions) {
        newRow.permissions = JSON.stringify({ all: true });
      }

      if (actualTableName === "suppliers") {
        if (!newRow.supplier_code || newRow.supplier_code === "0" || newRow.supplier_code === 0) {
          newRow.supplier_code = `SUP-${String(newRow.id).padStart(6, "0")}`;
        }
        if (!newRow.created_at || String(newRow.created_at).toLowerCase().startsWith("now(")) {
          newRow.created_at = new Date().toISOString();
        }
        if (!newRow.updated_at || String(newRow.updated_at).toLowerCase().startsWith("now(")) {
          newRow.updated_at = new Date().toISOString();
        }
        if (String(newRow.approved_at || "").toLowerCase().startsWith("now(")) {
          newRow.approved_at = new Date().toISOString();
        }
      }

      if (actualTableName === "warehouses") {
        newRow.status = newRow.status || "active";
        newRow.linked_module = newRow.linked_module || "general";
        if (!newRow.code) {
          newRow.code = String(newRow.id);
        }
        
        // Auto-seed inventory_items for this new warehouse for all ingredients
        if (!dbState["inventory_items"]) dbState["inventory_items"] = [];
        const existingIngs = dbState["ingredients"] || [];
        let invIdCounter = Math.max(0, ...(dbState["inventory_items"] || []).map((x: any) => Number(x.id) || 0)) + 1;
        for (const ing of existingIngs) {
          const hasInv = dbState["inventory_items"].some((ii: any) => Number(ii.ingredient_id) === Number(ing.id) && Number(ii.warehouse_id) === Number(newRow.id));
          if (!hasInv) {
            const ingCost = Number(ing.cost) || Number(ing.avg_cost) || 20;
            dbState["inventory_items"].push({
              id: invIdCounter++,
              warehouse_id: Number(newRow.id),
              ingredient_id: Number(ing.id),
              quantity: 0,
              reserved: 0,
              in_transit: 0,
              available: 0,
              avg_cost: ingCost,
              last_cost: ingCost,
              cost: ingCost,
              min_quantity: Number(ing.min_stock) || 10,
              max_quantity: Number(ing.max_stock) || 100,
              location_id: null
            });
          }
        }
      }

      if (actualTableName === "ingredients") {
        if (!newRow.item_code || String(newRow.item_code).trim() === "" || newRow.item_code === "null") {
          newRow.item_code = `ITEM-${1000 + newRow.id}`;
        }
        // Auto-seed inventory_items across all warehouses for this ingredient
        if (!dbState["inventory_items"]) dbState["inventory_items"] = [];
        const existingWhs = dbState["warehouses"] || [];
        let invIdCounter = Math.max(0, ...(dbState["inventory_items"] || []).map((x: any) => Number(x.id) || 0)) + 1;
        for (const wh of existingWhs) {
          const hasInv = dbState["inventory_items"].some((ii: any) => Number(ii.ingredient_id) === Number(newRow.id) && Number(ii.warehouse_id) === Number(wh.id));
          if (!hasInv) {
            const ingCost = Number(newRow.cost) || Number(newRow.avg_cost) || 20;
            dbState["inventory_items"].push({
              id: invIdCounter++,
              warehouse_id: Number(wh.id),
              ingredient_id: Number(newRow.id),
              quantity: Number(newRow.current_stock) || 0,
              reserved: 0,
              in_transit: 0,
              available: Number(newRow.current_stock) || 0,
              avg_cost: ingCost,
              last_cost: ingCost,
              cost: ingCost,
              min_quantity: Number(newRow.min_stock) || 10,
              max_quantity: Number(newRow.max_stock) || 100,
              location_id: null
            });
          }
        }
      }

      if (actualTableName === "purchases" && !newRow.date) {
        newRow.date = new Date().toISOString();
      }

      // IMPORTANT: use actualTableName (the normalized one), not the raw
      // user-supplied tableName. The old code did `dbState[tableName].push(...)`
      // which for INSERT INTO "attendances" wrote to a throwaway key
      // `dbState["attendances"]` instead of `dbState["attendance"]` —
      // silently dropping EVERY attendance row inserted during fingerprint
      // sync (rows appeared nowhere, days never showed up in reports).
      if (actualTableName === "inventory_items") {
        const whId = Number(newRow.warehouse_id);
        const ingId = Number(newRow.ingredient_id);
        const existing = dbState["inventory_items"].find(
          (r: any) => Number(r.warehouse_id) === whId && Number(r.ingredient_id) === ingId
        );
        if (existing) {
          existing.quantity = (Number(existing.quantity) || 0) + (Number(newRow.quantity) || 0);
          existing.reserved = (Number(existing.reserved) || 0) + (Number(newRow.reserved) || 0);
          existing.in_transit = (Number(existing.in_transit) || 0) + (Number(newRow.in_transit) || 0);
          existing.available = Math.max((Number(existing.quantity) || 0) - (Number(existing.reserved) || 0), 0);
          if (newRow.avg_cost) existing.avg_cost = newRow.avg_cost;
          if (newRow.last_cost) existing.last_cost = newRow.last_cost;
          if (newRow.cost) existing.cost = newRow.cost;

          const invList = dbState["inventory_items"] || [];
          const ingList = dbState["ingredients"] || [];
          const target = ingList.find((g: any) => Number(g.id) === ingId);
          if (target) {
            const sum = invList.filter((i: any) => Number(i.ingredient_id) === ingId)
                               .reduce((s: number, i: any) => s + (Number(i.quantity) || 0), 0);
            target.current_stock = sum;
          }
          saveDb();
          return { rows: [existing], rowCount: 1 };
        } else {
          dbState[actualTableName].push(newRow);
        }
      } else {
        dbState[actualTableName].push(newRow);
      }

      if (actualTableName === "inventory_items" && newRow.ingredient_id) {
        const invList = dbState["inventory_items"] || [];
        const ingList = dbState["ingredients"] || [];
        const target = ingList.find((g: any) => Number(g.id) === Number(newRow.ingredient_id));
        if (target) {
          const sum = invList.filter((i: any) => Number(i.ingredient_id) === Number(newRow.ingredient_id))
                             .reduce((s: number, i: any) => s + (Number(i.quantity) || 0), 0);
          target.current_stock = sum;
        }
      }

      saveDb();

      return { rows: [newRow], rowCount: 1 };
    }
  }

  // 5. UPDATE
  if (lowerSql.startsWith("update")) {
    // Special-case the attendance UPDATE that uses CASE WHEN / CAST (Postgres-specific syntax)
    // The frontend's "Edit fingerprint record" feature sends:
    //   UPDATE attendance SET check_in = CASE WHEN $1::text IS NOT NULL THEN ... END,
    //     check_out = CASE WHEN $2::text IS NOT NULL THEN ... END,
    //     date = CAST($3::text AS DATE), work_hours = $4, delay_minutes = $5, penalty = $6
    //   WHERE id = $7
    // params: [check_in, check_out, date, work_hours, delay_minutes, penalty, id]
    if (
      lowerSql.startsWith("update attendance") &&
      lowerSql.includes("case when") &&
      lowerSql.includes("where id = $")
    ) {
      const idMatch = lowerSql.match(/where\s+id\s*=\s*\$(\d+)/i);
      if (idMatch) {
        const idIdx = parseInt(idMatch[1]) - 1;
        const targetId = Number(params[idIdx]);
        let checkIn = params[0];   // $1
        let checkOut = params[1];  // $2
        const dateVal = params[2];   // $3
        const workHours = Number(params[3]) || 0;     // $4
        const delayMinutes = Number(params[4]) || 0;  // $5
        const penalty = Number(params[5]) || 0;       // $6

        // Normalize time strings: "10:05" → "10:05:00", "10:05:00" → "10:05:00"
        const normalizeTime = (t: string): string => {
          if (!t || typeof t !== "string") return "";
          const parts = t.split(":");
          if (parts.length === 2) return `${parts[0]}:${parts[1]}:00`;
          if (parts.length === 3) return `${parts[0]}:${parts[1]}:${parts[2]}`;
          return t;
        };
        checkIn = checkIn ? normalizeTime(String(checkIn)) : "";
        checkOut = checkOut ? normalizeTime(String(checkOut)) : "";

        const list = dbState["attendance"] || [];
        const rec = list.find((r: any) => Number(r.id) === targetId);
        if (rec) {
          // Build full ISO timestamps like the original TIMESTAMP cast would
          if (checkIn && dateVal) {
            rec.check_in = `${dateVal}T${checkIn}.000Z`;
          } else {
            rec.check_in = null;
          }
          if (checkOut && dateVal) {
            rec.check_out = `${dateVal}T${checkOut}.000Z`;
          } else {
            rec.check_out = null;
          }
          rec.date = dateVal;
          rec.work_hours = workHours;
          rec.delay_minutes = delayMinutes;
          rec.penalty = penalty;
          saveDb();
          return { rows: [rec], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
    }

    const match = normalizedSql.match(/update\s+([a-zA-Z0-9_]+)\s+set\s+(.+?)(?:\s+where\s+(.+?))?$/i);
    if (match) {
      const tableName = match[1];
      const setsRaw = match[2];
      const whereClause = match[3] ? match[3].trim() : null;

      const data = dbState[tableName] || [];
      const updatedRows: any[] = [];

      const setOps: { col: string; val: any }[] = [];
      // Split SET clauses on commas that are NOT inside parentheses (depth 0),
      // so SQL functions like COALESCE(department_id, $2) stay intact as ONE clause
      // instead of being broken into garbage tokens (previous bug that corrupted
      // employees.department_id to the literal string "COALESCE(department_id").
      const splitSetClauses = (raw: string): string[] => {
        const parts: string[] = [];
        let depth = 0;
        let current = "";
        let inQuote: string | null = null;
        for (const ch of raw) {
          if (inQuote) {
            current += ch;
            if (ch === inQuote) inQuote = null;
            continue;
          }
          if (ch === "'" || ch === '"') { inQuote = ch; current += ch; continue; }
          if (ch === "(") { depth++; current += ch; continue; }
          if (ch === ")") { depth = Math.max(0, depth - 1); current += ch; continue; }
          if (ch === "," && depth === 0) { parts.push(current); current = ""; continue; }
          current += ch;
        }
        if (current.trim()) parts.push(current);
        return parts;
      };
      const parts = splitSetClauses(setsRaw);
      parts.forEach(p => {
        const eqIdx = p.indexOf("=");
        if (eqIdx !== -1) {
          const col = p.substring(0, eqIdx).trim().replace(/['"`]/g, "");
          const valRaw = p.substring(eqIdx + 1).trim();
          let val: any;
          // General COALESCE(...) support:
          //   COALESCE(col, $N)  |  COALESCE(col, col2, 'literal')  |  COALESCE(col, 'literal')
          // Evaluated per-row: first non-null/non-empty argument wins.
          // Column refs resolve against the current row, $N against params,
          // quoted strings are literals.
          const coalesceMatch = valRaw.match(/^COALESCE\((.+)\)$/i);
          if (coalesceMatch) {
            const args = splitSetClauses(coalesceMatch[1]).map(s => s.trim()).filter(Boolean);
            setOps.push({ col, val: { __coalesceArgs: args } });
            return;
          }
          if (valRaw.startsWith("$")) {
            const pIdx = parseInt(valRaw.substring(1)) - 1;
            val = params[pIdx];
          } else {
            let literal = valRaw;
            if (literal.startsWith("'") && literal.endsWith("'")) {
              literal = literal.substring(1, literal.length - 1);
            }
            val = literal;
          }
          setOps.push({ col, val });
        }
      });

      // Helper to keep ingredients current_stock synchronized with inventory_items
      const syncIngredientStock = (ingId?: any) => {
        const invList = dbState["inventory_items"] || [];
        const ingList = dbState["ingredients"] || [];
        if (ingId !== undefined && ingId !== null) {
          const target = ingList.find((g: any) => Number(g.id) === Number(ingId));
          if (target) {
            const sum = invList.filter((i: any) => Number(i.ingredient_id) === Number(ingId))
                               .reduce((s: number, i: any) => s + (Number(i.quantity) || 0), 0);
            target.current_stock = sum;
          }
        } else {
          ingList.forEach((target: any) => {
            const sum = invList.filter((i: any) => Number(i.ingredient_id) === Number(target.id))
                               .reduce((s: number, i: any) => s + (Number(i.quantity) || 0), 0);
            target.current_stock = sum;
          });
        }
      };

      data.forEach(row => {
        let match = true;
        if (whereClause) {
          match = evaluateConditions(row, whereClause, params);
        }
        if (match) {
          setOps.forEach(op => {
            if (op.col === "supplier_code" && (String(op.val).includes("||") || String(op.val).includes("LPAD") || !op.val || op.val === "0" || op.val === 0)) {
              row[op.col] = `SUP-${String(row.id).padStart(6, "0")}`;
              return;
            }
            // Deferred COALESCE(...): evaluate per-row — take the first
            // non-null / non-empty argument (columns from the row, $N from
            // params, '...' as string literal).
            if (op.val && typeof op.val === "object" && Array.isArray(op.val.__coalesceArgs)) {
              row[op.col] = resolveCoalesceArgs(row, op.val.__coalesceArgs, params);
              return;
            }
            const valStr = String(op.val).trim();
            // Handle subquery like (SELECT COALESCE(SUM(quantity), 0) FROM inventory_items WHERE ingredient_id = $1)
            if (valStr.startsWith("(") && valStr.toLowerCase().includes("select") && valStr.endsWith(")")) {
              const innerSql = valStr.substring(1, valStr.length - 1).trim();
              if (innerSql.toLowerCase().includes("from inventory_items") && innerSql.toLowerCase().includes("sum(quantity)")) {
                const targetIngId = row.id || (params.length > 0 ? params[0] : null);
                const invList = dbState["inventory_items"] || [];
                const totalQty = invList
                  .filter((i: any) => Number(i.ingredient_id) === Number(targetIngId))
                  .reduce((s: number, i: any) => s + (Number(i.quantity) || 0), 0);
                row[op.col] = totalQty;
                return;
              }
            }
            if (valStr.toUpperCase().startsWith("GREATEST(") && valStr.endsWith(")")) {
              const inner = valStr.substring(9, valStr.length - 1).trim();
              const commaIdx = inner.lastIndexOf(",");
              let computed = 0;
              if (commaIdx !== -1) {
                const right = Number(inner.substring(commaIdx + 1).trim()) || 0;
                const q = Number(row.quantity) || 0;
                const r = Number(row.reserved) || 0;
                computed = Math.max(q - r, right);
              }
              row[op.col] = computed;
              return;
            }
            const hasPlus = valStr.includes("+");
            const hasMinus = valStr.includes("-");
            if (hasPlus || hasMinus) {
              const parts = valStr.split(hasPlus ? "+" : "-");
              if (parts.length === 2) {
                const rightHand = parts[1].trim();
                let operandValue = 0;
                if (rightHand.startsWith("$")) {
                  const pIdx = parseInt(rightHand.substring(1)) - 1;
                  operandValue = Number(params[pIdx]);
                } else {
                  operandValue = Number(rightHand);
                }
                if (isNaN(operandValue)) operandValue = 0;
                
                const currentVal = Number(row[op.col]) || 0;
                if (hasPlus) {
                  row[op.col] = currentVal + operandValue;
                } else {
                  row[op.col] = currentVal - operandValue;
                }
              } else {
                row[op.col] = op.val;
              }
            } else {
              row[op.col] = op.val;
            }
          });
          updatedRows.push(row);
        }
      });

      if (tableName === "inventory_items") {
        syncIngredientStock();
      }

      saveDb();
      return { rows: updatedRows, rowCount: updatedRows.length };
    }
  }

  // 6. DELETE
  if (lowerSql.startsWith("delete")) {
    const match = normalizedSql.match(/delete\s+from\s+([a-zA-Z0-9_]+)(?:\s+where\s+(.+?))?$/i);
    if (match) {
      const tableName = match[1];
      const whereClause = match[2] ? match[2].trim() : null;

      const data = dbState[tableName] || [];
      const remaining: any[] = [];
      const deleted: any[] = [];

      data.forEach(row => {
        let match = true;
        if (whereClause) {
          match = evaluateConditions(row, whereClause, params);
        }
        if (match) {
          deleted.push(row);
        } else {
          remaining.push(row);
        }
      });

      dbState[tableName] = remaining;
      saveDb();
      return { rows: deleted, rowCount: deleted.length };
    }
  }

  return { rows: [], rowCount: 0 };
}

function filterData(data: any[], whereClause: string, params: any[]): any[] {
  return data.filter(row => evaluateConditions(row, whereClause, params));
}

/**
 * Resolve COALESCE(arg1, arg2, ...) arguments against a row.
 * Each arg can be:
 *   - $N          → params[N-1]
 *   - 'literal'   → the literal string itself
 *   - column_name → the current row's value for that column (type-cast suffix like ::text is stripped)
 * Returns the first non-null / non-empty argument. Values that are literal
 * "COALESCE(" strings (from the old parser bug) are treated as empty so the
 * data self-heals instead of propagating the corruption.
 */
function resolveCoalesceArgs(row: any, args: string[], params: any[]): any {
  const isEmptyVal = (v: any) =>
    v === null ||
    v === undefined ||
    v === "" ||
    (typeof v === "string" && v.trim().toUpperCase().startsWith("COALESCE("));

  for (const rawArg of args) {
    const arg = rawArg.trim();
    if (!arg) continue;

    let value: any;
    if (arg.startsWith("$")) {
      const pIdx = parseInt(arg.substring(1)) - 1;
      value = params[pIdx];
    } else if (arg.startsWith("'") && arg.endsWith("'")) {
      value = arg.substring(1, arg.length - 1);
    } else {
      // Column reference (strip Postgres type casts like ::text)
      const colName = arg.replace(/::[a-zA-Z_]+(\(\d+\))?/g, "").trim();
      value = row[colName];
    }

    if (!isEmptyVal(value)) {
      return value;
    }
  }
  return null;
}

/**
 * Evaluate a SQL WHERE clause against a row.
 * Handles AND, OR, parentheses, LIKE with wildcards, and Postgres type casts (::text).
 * This is a lightweight evaluator for the offline DB fallback - it doesn't need to be
 * a full SQL parser, just good enough for the queries our own code generates.
 */
function evaluateConditions(row: any, clause: string, params: any[]): boolean {
  // Tokenize: split into AND/OR groups while respecting parentheses
  // First, normalize whitespace
  const normalized = clause.replace(/\s+/g, " ").trim();

  // Split by OR at the top level (respecting parens)
  const orParts = splitByKeyword(normalized, "or");
  for (const orPart of orParts) {
    // Each OR part is an AND group
    const andParts = splitByKeyword(orPart, "and");
    let allMatch = true;
    for (const part of andParts) {
      const trimmed = part.trim();
      // Strip outer parens if they wrap the whole expression
      const unwrapped = stripOuterParens(trimmed);
      if (!evaluateSingleCondition(row, unwrapped, params)) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) return true; // OR: any matching group is enough
  }
  return false;
}

/** Split a clause by a keyword (AND/OR) at the top level, respecting parentheses. */
function splitByKeyword(clause: string, keyword: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  const tokens = clause.split(/\s+/);
  for (const tok of tokens) {
    const lowerTok = tok.toLowerCase();
    let inDepth = depth;
    for (const ch of tok) {
      if (ch === "(") inDepth++;
      if (ch === ")") inDepth--;
    }
    if (depth === 0 && lowerTok === keyword) {
      parts.push(current.trim());
      current = "";
    } else {
      current += (current ? " " : "") + tok;
    }
    depth = inDepth;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Remove wrapping parentheses like "(notes LIKE '...')" → "notes LIKE '...'" */
function stripOuterParens(s: string): string {
  let str = s.trim();
  while (str.startsWith("(") && str.endsWith(")")) {
    // Check the parens are balanced as a wrapper
    let depth = 0;
    let isWrapper = true;
    for (let i = 0; i < str.length; i++) {
      if (str[i] === "(") depth++;
      else if (str[i] === ")") depth--;
      if (depth === 0 && i < str.length - 1) { isWrapper = false; break; }
    }
    if (isWrapper) {
      str = str.substring(1, str.length - 1).trim();
    } else {
      break;
    }
  }
  return str;
}

/** Evaluate a single leaf condition like "col = $1" or "col LIKE 'pattern%'" */
function evaluateSingleCondition(row: any, part: string, params: any[]): boolean {
  const trimmed = part.trim();
  if (trimmed === "1=1" || trimmed === "1 = 1" || trimmed === "true") {
    return true;
  }

  // IS NOT NULL / IS NULL
  const isNotNullMatch = trimmed.match(/^([a-zA-Z0-9_\.]+)\s+is\s+not\s+null$/i);
  if (isNotNullMatch) {
    let col = isNotNullMatch[1].trim();
    if (col.includes(".")) col = col.split(".")[1];
    const v = row[col];
    return v !== null && v !== undefined && v !== "" && String(v) !== "null" && String(v) !== "undefined";
  }

  const isNullMatch = trimmed.match(/^([a-zA-Z0-9_\.]+)\s+is\s+null$/i);
  if (isNullMatch) {
    let col = isNullMatch[1].trim();
    if (col.includes(".")) col = col.split(".")[1];
    const v = row[col];
    return v === null || v === undefined || v === "" || String(v) === "null" || String(v) === "undefined";
  }

  // BUGFIX 2026-08-25 — SUPPORT `col IN (...)` CLAUSES:
  // The old code had no IN handler, so any `WHERE x IN ('a','b')` fell
  // through the operator regex, hit `return true` (unknown clause), and
  // matched EVERY row — turning targeted DELETE/SELECT statements into
  // table-wide wipes. This bit hr_settings cleanup: DELETE ... WHERE key
  // IN ('key','value') erased the whole table right after a successful
  // save, making settings "disappear" on the next page load.
  const inMatch = trimmed.match(/^([a-zA-Z0-9_\.]+)\s+in\s*\((.+)\)$/i);
  if (inMatch) {
    let inCol: string = inMatch[1].trim();
    const inCastIdx = inCol.indexOf("::");
    if (inCastIdx !== -1) inCol = inCol.substring(0, inCastIdx).trim();
    if (inCol.includes(".")) inCol = inCol.split(".")[1];

    // Parse the value list: 'a', 'b', $1, 123, NULL ...
    const listRaw = inMatch[2];
    const values: any[] = [];
    const listRegex = /'([^']*)'|\$(\d+)|([^,\s()]+)/g;
    let m: RegExpExecArray | null;
    while ((m = listRegex.exec(listRaw)) !== null) {
      if (m[1] !== undefined) {
        values.push(m[1]);               // quoted literal
      } else if (m[2] !== undefined) {
        values.push(params[parseInt(m[2]) - 1]); // positional param
      } else if (m[3] !== undefined) {
        const tok = m[3];
        if (tok.toLowerCase() === "null") continue;
        const num = Number(tok);
        values.push(isNaN(num) ? tok : num);
      }
    }

    const rowVal = row[inCol];
    if (rowVal === undefined) return false;
    return values.some(v => String(rowVal) === String(v));
  }

  const compMatch = trimmed.match(/^(.+?)\s*(<=|>=|!=|<>|=|ilike|like|>|<)\s*(.+)$/i);
  if (compMatch) {
    const leftRaw = compMatch[1].trim();
    const op = compMatch[2].trim().toLowerCase();
    const rightRaw = compMatch[3].trim();

    const leftVal = evalSqlExpr(leftRaw, row, params);
    const rightVal = evalSqlExpr(rightRaw, row, params);

    if (op === "=") {
      if (leftVal === null || rightVal === null) return leftVal === rightVal;
      return String(leftVal) === String(rightVal);
    } else if (op === "!=" || op === "<>") {
      if (leftVal === null || rightVal === null) return leftVal !== rightVal;
      return String(leftVal) !== String(rightVal);
    } else if (op === "like" || op === "ilike") {
      const pattern = String(rightVal || "").replace(/%/g, ".*").replace(/_/g, ".");
      const regex = new RegExp(`^${pattern}$`, op === "ilike" ? "i" : undefined);
      return regex.test(String(leftVal || ""));
    } else if (op === ">") {
      return Number(leftVal) > Number(rightVal);
    } else if (op === "<") {
      return Number(leftVal) < Number(rightVal);
    } else if (op === ">=") {
      return Number(leftVal) >= Number(rightVal);
    } else if (op === "<=") {
      return Number(leftVal) <= Number(rightVal);
    }
  }

  return true;
}

function evalSqlExpr(expr: string, row: any, params: any[]): any {
  let s = expr.trim();
  const castIdx = s.indexOf("::");
  if (castIdx !== -1) s = s.substring(0, castIdx).trim();

  if (s.includes(".") && !s.includes("(") && !s.startsWith("'") && !s.startsWith('"')) {
    s = s.split(".")[1].trim();
  }

  let isLower = false;
  let isTrim = false;
  while (true) {
    if (s.toLowerCase().startsWith("lower(") && s.endsWith(")")) {
      isLower = true;
      s = s.substring(6, s.length - 1).trim();
    } else if (s.toLowerCase().startsWith("trim(") && s.endsWith(")")) {
      isTrim = true;
      s = s.substring(5, s.length - 1).trim();
    } else {
      break;
    }
  }

  let val: any;
  if (s.startsWith("$")) {
    const pIdx = parseInt(s.substring(1)) - 1;
    val = params[pIdx];
  } else if (s.startsWith("'") && s.endsWith("'")) {
    val = s.substring(1, s.length - 1);
  } else if (s.toLowerCase() === "true") {
    val = true;
  } else if (s.toLowerCase() === "false") {
    val = false;
  } else if (!isNaN(Number(s)) && s !== "") {
    val = Number(s);
  } else if (s.toLowerCase() === "null") {
    val = null;
  } else {
    val = row ? row[s] : undefined;
  }

  if (val !== undefined && val !== null) {
    if (typeof val === "string") {
      if (isTrim) val = val.trim();
      if (isLower) val = val.toLowerCase();
    }
  }
  return val;
}

let useOfflineFallback = !process.env.DATABASE_URL || process.env.DATABASE_URL.trim() === "";

if (useOfflineFallback) {
  console.log("Offline fallback database is active.");
}

declare global {
  // Reuse one PostgreSQL pool during Vite/tsx hot reloads.
  // This prevents every module reload from creating another set of DB clients.
  // eslint-disable-next-line no-var
  var __remoPgPool: any;
}

const realPool = globalThis.__remoPgPool ?? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
  // Keep the application footprint small. PostgreSQL installations used by
  // this ERP may have a low max_connections value, and the ERP has many
  // modules sharing this single pool.
  max: Math.min(Number(process.env.PG_POOL_MAX || 4), 10),
  min: 0,
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 5000),
  connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS || 10000),
  maxUses: 7500,
  allowExitOnIdle: false,
});

globalThis.__remoPgPool = realPool;

realPool.on('error', (err: any) => {
  console.warn('[DB Pool] Notice on idle client:', err?.message || err);
});

function isDbConnectionError(error: any): boolean {
  if (!error) return false;
  const msg = (error.message || '').toLowerCase();
  const code = error.code || '';
  return (
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'ENOTFOUND' ||
    code === 'ETIMEDOUT' ||
    code === 'EHOSTUNREACH' ||
    code === '57P01' || // admin_shutdown
    code === '57P02' || // crash_shutdown
    code === '57P03' || // cannot_connect_now
    code === '53300' || // too_many_connections / sorry, too many clients already
    code === '53400' || // configuration_limit_exceeded
    code === '08000' || // connection_exception
    code === '08003' || // connection_does_not_exist
    code === '08006' || // connection_failure
    code === '08001' || // sqlclient_unable_to_establish_sqlconnection
    code === '08004' || // sqlserver_rejected_establishment_of_sqlconnection
    msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('read econnreset') ||
    msg.includes('connection refused') ||
    msg.includes('enotfound') ||
    msg.includes('etimedout') ||
    msg.includes('too many clients') ||
    msg.includes('sorry, too many clients already') ||
    msg.includes('remaining connection slots are reserved') ||
    msg.includes('connection terminated') ||
    msg.includes('client has encountered a connection error') ||
    msg.includes('no pg_hba.conf entry') ||
    msg.includes('password authentication') ||
    (msg.includes('database') && msg.includes('does not exist'))
  );
}

export const pool = {
  /**
   * Execute a complete business operation in one PostgreSQL transaction.
   * Kept on the shared pool object so all modules use the same connection pool.
   */
  async transaction<T>(work: (client: any) => Promise<T>, options?: { isolation?: 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE'; readOnly?: boolean }) {
    if (useOfflineFallback) {
      const client = {
        query: async (sql: string, params?: any[]) => handleFallbackQuery(sql, params),
        release: () => {},
      };
      return await work(client);
    }
    try {
      const client = await this.connect();
      let committed = false;
      try {
        await client.query('BEGIN');
        if (options?.isolation) await client.query(`SET TRANSACTION ISOLATION LEVEL ${options.isolation}`);
        if (options?.readOnly) await client.query('SET TRANSACTION READ ONLY');
        const result = await work(client);
        await client.query('COMMIT');
        committed = true;
        return result;
      } catch (error) {
        if (!committed) { try { await client.query('ROLLBACK'); } catch (_) {} }
        throw error;
      } finally {
        if (client && typeof client.release === 'function') {
          try { client.release(); } catch (_) {}
        }
      }
    } catch (err: any) {
      if (isDbConnectionError(err)) {
        if (!useOfflineFallback) {
          console.log("Offline fallback database activated during transaction:", err.message || err.code);
          useOfflineFallback = true;
        }
        const client = {
          query: async (sql: string, params?: any[]) => handleFallbackQuery(sql, params),
          release: () => {},
        };
        return await work(client);
      }
      throw err;
    }
  },
  async query(sql: string, params?: any[]) {
    if (useOfflineFallback) {
      return handleFallbackQuery(sql, params);
    }
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await realPool.query(sql, params);
      } catch (error: any) {
        if (isDbConnectionError(error)) {
          // If it's a transient connection surge, back off briefly before retrying
          if (attempt < maxRetries && (error.code === '53300' || error.message?.includes('too many clients') || error.code === 'ECONNRESET')) {
            await new Promise((r) => setTimeout(r, attempt * 100));
            continue;
          }
          if (!useOfflineFallback) {
            console.log("Offline fallback database activated due to connection limit/error:", error.message || error.code);
            useOfflineFallback = true;
          }
          return handleFallbackQuery(sql, params);
        }
        throw error;
      }
    }
    return handleFallbackQuery(sql, params);
  },
  async connect() {
    if (useOfflineFallback) {
      return {
        query: async (sql: string, params?: any[]) => handleFallbackQuery(sql, params),
        release: () => {},
      };
    }
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await realPool.connect();
      } catch (error: any) {
        if (isDbConnectionError(error)) {
          if (attempt < maxRetries && (error.code === '53300' || error.message?.includes('too many clients') || error.code === 'ECONNRESET')) {
            await new Promise((r) => setTimeout(r, attempt * 100));
            continue;
          }
          if (!useOfflineFallback) {
            console.log("Offline fallback database activated on connect:", error.message || error.code);
            useOfflineFallback = true;
          }
          return {
            query: async (sql: string, params?: any[]) => handleFallbackQuery(sql, params),
            release: () => {},
          };
        }
        throw error;
      }
    }
    return {
      query: async (sql: string, params?: any[]) => handleFallbackQuery(sql, params),
      release: () => {},
    };
  },
  async end() {
    if (!useOfflineFallback) {
      try {
        return await realPool.end();
      } catch (_) {}
    }
  },
  on(event: any, listener: (...args: any[]) => void) {
    return realPool.on(event, listener);
  }
} as any;
