import React, { useState, useEffect, useMemo } from "react";
import {
  Box, MapPin, Lock, Truck, Tag, Hash, FileText,
  History, TrendingUp, AlertTriangle, CheckCircle2,
  Calendar, Layers, ShieldCheck, RefreshCw, Search,
  Download, Filter, SlidersHorizontal, ChevronDown,
  ChevronRight, MoreVertical, Eye, Printer, ArrowRightLeft,
  PlusCircle, Edit3, X, Sparkles, Clock, ArrowUpRight,
  ArrowDownRight, Check, Bookmark, Database, RotateCcw
} from "lucide-react";
import { api } from "../../utils/api";
import { StockItemDetailsDrawer } from "./StockItemDetailsDrawer";

interface EnterpriseStockBalanceViewProps {
  warehouses: any[];
  ingredients: any[];
  onNotify?: (msg: string, type?: "success" | "error" | "info") => void;
  onNavigateToFeature?: (featureId: string) => void;
}

interface ColumnConfig {
  id: string;
  label: string;
  defaultVisible: boolean;
  category: "basic" | "quantities" | "costs" | "movements" | "tracking";
}

const ALL_COLUMNS: ColumnConfig[] = [
  { id: "item", label: "الصنف والكود", defaultVisible: true, category: "basic" },
  { id: "warehouse", label: "المخزن", defaultVisible: true, category: "basic" },
  { id: "status", label: "حالة المخزون", defaultVisible: true, category: "basic" },
  { id: "location", label: "موقع التخزين (Bin/Rack)", defaultVisible: true, category: "basic" },
  { id: "quantity", label: "الكمية الحالية", defaultVisible: true, category: "quantities" },
  { id: "units_breakdown", label: "تعدد الوحدات", defaultVisible: false, category: "quantities" },
  { id: "available", label: "المتاح للصرف", defaultVisible: true, category: "quantities" },
  { id: "reserved", label: "المحجوز", defaultVisible: true, category: "quantities" },
  { id: "in_transit", label: "قيد النقل", defaultVisible: true, category: "quantities" },
  { id: "reorder", label: "حد الطلب (ROP/Min)", defaultVisible: true, category: "quantities" },
  { id: "consumption", label: "معدل الاستهلاك وأيام التغطية", defaultVisible: false, category: "quantities" },
  { id: "avg_cost", label: "متوسط التكلفة", defaultVisible: true, category: "costs" },
  { id: "last_price", label: "آخر سعر شراء", defaultVisible: false, category: "costs" },
  { id: "value", label: "قيمة المخزون", defaultVisible: true, category: "costs" },
  { id: "last_movement", label: "آخر حركة", defaultVisible: true, category: "movements" },
  { id: "last_receipt", label: "آخر استلام", defaultVisible: false, category: "movements" },
  { id: "last_issue", label: "آخر صرف", defaultVisible: false, category: "movements" },
  { id: "batches", label: "التشغيلات والصلاحية", defaultVisible: false, category: "tracking" },
  { id: "serials", label: "الأرقام التسلسلية", defaultVisible: false, category: "tracking" },
  { id: "actions", label: "الإجراءات", defaultVisible: true, category: "basic" },
];

export const EnterpriseStockBalanceView: React.FC<EnterpriseStockBalanceViewProps> = ({
  warehouses,
  ingredients,
  onNotify,
  onNavigateToFeature
}) => {
  // Data state
  const [items, setItems] = useState<any[]>([]);
  const [kpis, setKpis] = useState<any>({});
  const [loading, setLoading] = useState(true);

  // Filters state
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedWarehouse, setSelectedWarehouse] = useState("all");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedStockStatus, setSelectedStockStatus] = useState("all");
  const [selectedItemType, setSelectedItemType] = useState("all");
  const [selectedBrand, setSelectedBrand] = useState("all");
  const [filterHasBatch, setFilterHasBatch] = useState(false);
  const [filterHasSerial, setFilterHasSerial] = useState(false);
  const [filterMinQty, setFilterMinQty] = useState("");
  const [filterMaxQty, setFilterMaxQty] = useState("");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  // Saved filters
  const [savedFilters, setSavedFilters] = useState<Array<{ name: string; filters: any }>>([]);
  const [newFilterName, setNewFilterName] = useState("");
  const [showSaveFilterModal, setShowSaveFilterModal] = useState(false);

  // Pagination & Sorting
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortField, setSortField] = useState("ingredient_name");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  // Column Visibility state
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem("remo_stock_balance_cols");
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    const defaults: Record<string, boolean> = {};
    ALL_COLUMNS.forEach(c => { defaults[c.id] = c.defaultVisible; });
    return defaults;
  });
  const [showColumnManager, setShowColumnManager] = useState(false);

  // Drawer & Modals state
  const [selectedDrawerItemId, setSelectedDrawerItemId] = useState<number | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Reserved Stock breakdown modal
  const [reservedModalItem, setReservedModalItem] = useState<any | null>(null);
  // In-Transit breakdown modal
  const [inTransitModalItem, setInTransitModalItem] = useState<any | null>(null);
  // Quick Action Menu Open Row
  const [openMenuRowId, setOpenMenuRowId] = useState<number | null>(null);

  // Load Saved filters from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem("remo_saved_stock_filters");
      if (saved) setSavedFilters(JSON.parse(saved));
    } catch (e) {}
  }, []);

  const saveColumnPreferences = (newCols: Record<string, boolean>) => {
    setVisibleColumns(newCols);
    try {
      localStorage.setItem("remo_stock_balance_cols", JSON.stringify(newCols));
    } catch (e) {}
  };

  const handleSaveFilter = () => {
    if (!newFilterName.trim()) return;
    const current = {
      searchQuery,
      selectedWarehouse,
      selectedCategory,
      selectedStockStatus,
      selectedItemType,
      selectedBrand,
      filterHasBatch,
      filterHasSerial
    };
    const updated = [...savedFilters, { name: newFilterName.trim(), filters: current }];
    setSavedFilters(updated);
    try {
      localStorage.setItem("remo_saved_stock_filters", JSON.stringify(updated));
    } catch (e) {}
    setNewFilterName("");
    setShowSaveFilterModal(false);
    onNotify?.("تم حفظ الفلتر بنجاح", "success");
  };

  const applySavedFilter = (f: any) => {
    setSearchQuery(f.searchQuery || "");
    setSelectedWarehouse(f.selectedWarehouse || "all");
    setSelectedCategory(f.selectedCategory || "all");
    setSelectedStockStatus(f.selectedStockStatus || "all");
    setSelectedItemType(f.selectedItemType || "all");
    setSelectedBrand(f.selectedBrand || "all");
    setFilterHasBatch(!!f.filterHasBatch);
    setFilterHasSerial(!!f.filterHasSerial);
    onNotify?.(`تم تطبيق الفلتر: ${f.name}`, "info");
  };

  const removeSavedFilter = (index: number) => {
    const updated = savedFilters.filter((_, i) => i !== index);
    setSavedFilters(updated);
    try {
      localStorage.setItem("remo_saved_stock_filters", JSON.stringify(updated));
    } catch (e) {}
  };

  // Fetch Stock Intelligence Data
  const fetchData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedWarehouse !== "all") params.append("warehouse_id", selectedWarehouse);
      if (selectedCategory !== "all") params.append("category", selectedCategory);
      if (selectedStockStatus !== "all") params.append("stock_status", selectedStockStatus);
      if (selectedItemType !== "all") params.append("item_type", selectedItemType);
      if (selectedBrand !== "all") params.append("brand", selectedBrand);
      if (searchQuery) params.append("search", searchQuery);
      if (filterHasBatch) params.append("has_batch", "true");
      if (filterHasSerial) params.append("has_serial", "true");
      if (filterMinQty) params.append("min_qty", filterMinQty);
      if (filterMaxQty) params.append("max_qty", filterMaxQty);

      const res = await api.get(`/api/inventory/stock-intelligence?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
        setKpis(data.kpis || {});
      } else {
        // Fallback to basic inventory items if endpoint fails
        const basicRes = await api.get(`/api/inventory-items${selectedWarehouse !== "all" ? `?warehouse_id=${selectedWarehouse}` : ""}`);
        if (basicRes.ok) {
          const basicItems = await basicRes.json();
          setItems(Array.isArray(basicItems) ? basicItems : basicItems.data || []);
        }
      }
    } catch (e) {
      console.error("Stock intelligence fetch error:", e);
      onNotify?.("فشل تحميل أرصدة المخزون", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setCurrentPage(1);
    fetchData();
  }, [
    selectedWarehouse,
    selectedCategory,
    selectedStockStatus,
    selectedItemType,
    selectedBrand,
    filterHasBatch,
    filterHasSerial,
    searchQuery,
    filterMinQty,
    filterMaxQty
  ]);

  // Helpers for code and text sanitization
  const cleanCode = (rawCode: any, id?: any) => {
    if (!rawCode || rawCode === "NULL" || rawCode === "null" || rawCode === "undefined") {
      return id ? `ITEM-${id}` : "";
    }
    const s = String(rawCode).trim();
    if (s.startsWith("-")) {
      return `ITEM-${s.replace("-", "")}`;
    }
    if (!s.startsWith("ITEM-") && !isNaN(Number(s))) {
      return `ITEM-${s}`;
    }
    return s;
  };

  const cleanStr = (val: any) => {
    if (!val || val === "NULL" || val === "null" || val === "undefined") return null;
    const s = String(val).trim();
    return s || null;
  };

  // Client-side filtering safeguard & sorting
  const filteredItems = useMemo(() => {
    let result = items;

    // Strict Warehouse Filter Safeguard
    if (selectedWarehouse !== "all") {
      result = result.filter(i => String(i.warehouse_id) === String(selectedWarehouse));
    }

    // Stock Status Filter
    if (selectedStockStatus !== "all") {
      result = result.filter(i => i.status === selectedStockStatus);
    }

    // Category Filter
    if (selectedCategory !== "all") {
      result = result.filter(i => cleanStr(i.category) === selectedCategory);
    }

    // Brand Filter
    if (selectedBrand !== "all") {
      result = result.filter(i => cleanStr(i.brand) === selectedBrand);
    }

    // Item Type Filter
    if (selectedItemType !== "all") {
      result = result.filter(i => i.item_type === selectedItemType);
    }

    // Search Filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(i => {
        const name = (i.ingredient_name || i.name || "").toLowerCase();
        const code = String(cleanCode(i.ingredient_code || i.item_code || i.code, i.ingredient_id || i.id)).toLowerCase();
        const barcode = String(i.barcode || "").toLowerCase();
        const whName = (i.warehouse_name || "").toLowerCase();
        return name.includes(q) || code.includes(q) || barcode.includes(q) || whName.includes(q);
      });
    }

    // Batch and Serial Filters
    if (filterHasBatch) {
      result = result.filter(i => Number(i.batch_count || 0) > 0);
    }
    if (filterHasSerial) {
      result = result.filter(i => Number(i.serial_count || 0) > 0);
    }

    // Min & Max Qty
    if (filterMinQty !== "") {
      const min = Number(filterMinQty);
      if (!isNaN(min)) result = result.filter(i => Number(i.quantity || 0) >= min);
    }
    if (filterMaxQty !== "") {
      const max = Number(filterMaxQty);
      if (!isNaN(max)) result = result.filter(i => Number(i.quantity || 0) <= max);
    }

    return result;
  }, [
    items,
    selectedWarehouse,
    selectedStockStatus,
    selectedCategory,
    selectedBrand,
    selectedItemType,
    searchQuery,
    filterHasBatch,
    filterHasSerial,
    filterMinQty,
    filterMaxQty
  ]);

  // Client-side sorting & pagination on the intelligence dataset
  const sortedItems = useMemo(() => {
    return [...filteredItems].sort((a, b) => {
      let valA = a[sortField];
      let valB = b[sortField];

      if (typeof valA === "string") {
        return sortOrder === "asc" ? valA.localeCompare(b[sortField] || "", "ar") : (b[sortField] || "").localeCompare(valA, "ar");
      }
      return sortOrder === "asc" ? (valA || 0) - (valB || 0) : (valB || 0) - (valA || 0);
    });
  }, [filteredItems, sortField, sortOrder]);

  const totalPages = Math.max(1, Math.ceil(sortedItems.length / pageSize));
  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedItems.slice(start, start + pageSize);
  }, [sortedItems, currentPage, pageSize]);

  // Categories & Brands list extracted from data
  const categories = useMemo(() => {
    const set = new Set<string>();
    items.forEach(i => {
      const c = cleanStr(i.category);
      if (c) set.add(c);
    });
    ingredients.forEach(i => {
      const c = cleanStr(i.category);
      if (c) set.add(c);
    });
    return Array.from(set);
  }, [items, ingredients]);

  const brands = useMemo(() => {
    const set = new Set<string>();
    items.forEach(i => {
      const b = cleanStr(i.brand);
      if (b) set.add(b);
    });
    return Array.from(set);
  }, [items]);

  const fmt = (n: any) => Number(n || 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 });
  const fmtMoney = (n: any) => `${fmt(n)} ج.م`;

  // Status Badge Component
  const renderStatusBadge = (status: string, label?: string) => {
    switch (status) {
      case "out_of_stock":
        return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-50 text-red-700 font-bold text-xs border border-red-200"><span className="w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse"></span> نافد (0)</span>;
      case "low_stock":
        return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 font-bold text-xs border border-amber-200"><span className="w-1.5 h-1.5 rounded-full bg-amber-600"></span> منخفض</span>;
      case "overstock":
        return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-orange-50 text-orange-700 font-bold text-xs border border-orange-200"><span className="w-1.5 h-1.5 rounded-full bg-orange-600"></span> زائد</span>;
      case "fully_reserved":
        return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-purple-50 text-purple-700 font-bold text-xs border border-purple-200"><span className="w-1.5 h-1.5 rounded-full bg-purple-600"></span> محجوز بالكامل</span>;
      case "in_transit":
        return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 font-bold text-xs border border-blue-200"><span className="w-1.5 h-1.5 rounded-full bg-blue-600"></span> قيد النقل</span>;
      default:
        return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 font-bold text-xs border border-emerald-200"><span className="w-1.5 h-1.5 rounded-full bg-emerald-600"></span> طبيعي</span>;
    }
  };

  // Comprehensive Excel Export
  const exportToExcelComprehensive = () => {
    try {
      const exportData = sortedItems.map(i => ({
        "اسم الصنف": i.ingredient_name || i.name,
        "كود الصنف": cleanCode(i.ingredient_code || i.item_code || i.code, i.ingredient_id || i.id),
        "الباركود": cleanStr(i.barcode) || "",
        "التصنيف": cleanStr(i.category) || "",
        "الماركة": cleanStr(i.brand) || "",
        "المخزن": i.warehouse_name || "",
        "موقع التخزين": i.location_formatted || i.location_code || "عام",
        "الوحدة الأساسية": i.ingredient_unit || i.unit || "قطعة",
        "الرصيد الإجمالي": Number(i.quantity || 0),
        "المتاح للصرف": Number(i.available || 0),
        "المحجوز": Number(i.reserved || 0),
        "قيد النقل": Number(i.in_transit || 0),
        "الحد الأدنى": Number(i.min_stock || 0),
        "نقطة إعادة الطلب": Number(i.reorder_point || 0),
        "الحد الأقصى": Number(i.max_stock || 0),
        "متوسط التكلفة": Number(i.avg_cost || 0),
        "آخر سعر شراء": Number(i.last_purchase_price || 0),
        "إجمالي القيمة": Number(i.inventory_value || (Number(i.quantity || 0) * Number(i.avg_cost || 0))),
        "حالة المخزون": i.statusLabel || i.status || "طبيعي",
        "أيام التغطية": i.days_of_supply !== 999 ? i.days_of_supply : "غير محدد",
        "معدل الاستهلاك اليومي": Number(i.daily_avg_consumption || 0),
        "الكمية المقترحة للشراء": Number(i.suggested_order_qty || 0),
        "تاريخ آخر حركة": i.last_movement?.date ? new Date(i.last_movement.date).toLocaleDateString("ar-EG") : "—",
        "نوع آخر حركة": i.last_movement?.ref_type || "—",
        "كمية آخر حركة": i.last_movement?.delta || "—",
      }));

      // Create CSV / Excel content
      const headers = Object.keys(exportData[0] || {});
      const csvRows = [
        headers.join(","),
        ...exportData.map(row => headers.map(h => `"${String((row as any)[h] || "").replace(/"/g, '""')}"`).join(","))
      ];
      const blob = new Blob(["\uFEFF" + csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `enterprise_stock_balance_${new Date().toISOString().split("T")[0]}.csv`;
      link.click();
      onNotify?.("تم تصدير تقرير الأرصدة الشامل بنجاح", "success");
    } catch (e) {
      onNotify?.("فشل تصدير البيانات", "error");
    }
  };

  const handleOpenDrawer = (ingredientId: number) => {
    setSelectedDrawerItemId(ingredientId);
    setIsDrawerOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* ─── HEADER & ACTIONS ─── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-black">
              <Box className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-black text-slate-900">أرصدة الأصناف والرقابة المخزنية</h1>
              <p className="text-xs text-slate-500 mt-0.5">Enterprise Stock Balances & Real-Time Inventory Intelligence</p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Column Manager Button */}
          <button
            onClick={() => setShowColumnManager(!showColumnManager)}
            className="flex items-center gap-2 px-3.5 py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-bold border border-slate-200 transition-colors"
          >
            <SlidersHorizontal className="w-4 h-4 text-slate-500" /> الأعمدة
          </button>

          {/* Advanced Filter Toggle */}
          <button
            onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold border transition-colors ${
              showAdvancedFilters || selectedStockStatus !== "all" || selectedCategory !== "all"
                ? "bg-orange-50 text-orange-700 border-orange-200"
                : "bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200"
            }`}
          >
            <Filter className="w-4 h-4" /> فلاتر متقدمة
          </button>

          {/* Excel Export */}
          <button
            onClick={exportToExcelComprehensive}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs transition-colors"
          >
            <Download className="w-4 h-4" /> تصدير Excel شامل
          </button>

          {/* Refresh */}
          <button
            onClick={fetchData}
            title="تحديث البيانات"
            className="p-2 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-xl border border-slate-200 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin text-orange-500" : ""}`} />
          </button>
        </div>
      </div>

      {/* ─── 10 INTERACTIVE KPI CARDS ─── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {/* Card 1: Total Value */}
        <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold text-slate-500">إجمالي قيمة المخزون</p>
            <p className="text-lg font-black text-slate-900 mt-1">{fmtMoney(kpis.total_value || 0)}</p>
            <span className="text-[10px] text-slate-400 font-medium">وفق متوسط التكلفة</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center">
            <TrendingUp className="w-5 h-5" />
          </div>
        </div>

        {/* Card 2: Total Items */}
        <div
          onClick={() => { setSelectedStockStatus("all"); }}
          className="bg-white hover:bg-slate-50 rounded-2xl p-4 border border-slate-200 shadow-xs flex items-center justify-between cursor-pointer transition-colors"
        >
          <div>
            <p className="text-[11px] font-bold text-slate-500">إجمالي الأصناف</p>
            <p className="text-lg font-black text-blue-600 mt-1">{kpis.total_items || items.length}</p>
            <span className="text-[10px] text-slate-400 font-medium">الكمية: {fmt(kpis.total_quantity || 0)}</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
            <Box className="w-5 h-5" />
          </div>
        </div>

        {/* Card 3: Low Stock */}
        <div
          onClick={() => { setSelectedStockStatus(selectedStockStatus === "low_stock" ? "all" : "low_stock"); }}
          className={`rounded-2xl p-4 border shadow-xs flex items-center justify-between cursor-pointer transition-colors ${
            selectedStockStatus === "low_stock" ? "bg-amber-100 border-amber-400" : "bg-white hover:bg-amber-50/50 border-slate-200"
          }`}
        >
          <div>
            <p className="text-[11px] font-bold text-amber-700">أصناف منخفضة</p>
            <p className="text-lg font-black text-amber-600 mt-1">{kpis.low_stock_count || 0}</p>
            <span className="text-[10px] text-amber-600/80 font-bold">دون نقطة الطلب</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5" />
          </div>
        </div>

        {/* Card 4: Out of Stock */}
        <div
          onClick={() => { setSelectedStockStatus(selectedStockStatus === "out_of_stock" ? "all" : "out_of_stock"); }}
          className={`rounded-2xl p-4 border shadow-xs flex items-center justify-between cursor-pointer transition-colors ${
            selectedStockStatus === "out_of_stock" ? "bg-red-100 border-red-400" : "bg-white hover:bg-red-50/50 border-slate-200"
          }`}
        >
          <div>
            <p className="text-[11px] font-bold text-red-700">أصناف نافدة</p>
            <p className="text-lg font-black text-red-600 mt-1">{kpis.out_of_stock_count || 0}</p>
            <span className="text-[10px] text-red-600/80 font-bold">رصيد 0 أو سالب</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-red-50 text-red-600 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5" />
          </div>
        </div>

        {/* Card 5: Overstock */}
        <div
          onClick={() => { setSelectedStockStatus(selectedStockStatus === "overstock" ? "all" : "overstock"); }}
          className={`rounded-2xl p-4 border shadow-xs flex items-center justify-between cursor-pointer transition-colors ${
            selectedStockStatus === "overstock" ? "bg-orange-100 border-orange-400" : "bg-white hover:bg-orange-50/50 border-slate-200"
          }`}
        >
          <div>
            <p className="text-[11px] font-bold text-orange-700">مخزون زائد (Overstock)</p>
            <p className="text-lg font-black text-orange-600 mt-1">{kpis.overstock_count || 0}</p>
            <span className="text-[10px] text-orange-600/80 font-medium">فوق الحد الأقصى</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center">
            <Layers className="w-5 h-5" />
          </div>
        </div>

        {/* Card 6: Fully Reserved */}
        <div
          onClick={() => { setSelectedStockStatus(selectedStockStatus === "fully_reserved" ? "all" : "fully_reserved"); }}
          className={`rounded-2xl p-4 border shadow-xs flex items-center justify-between cursor-pointer transition-colors ${
            selectedStockStatus === "fully_reserved" ? "bg-purple-100 border-purple-400" : "bg-white hover:bg-purple-50/50 border-slate-200"
          }`}
        >
          <div>
            <p className="text-[11px] font-bold text-purple-700">محجوز بالكامل</p>
            <p className="text-lg font-black text-purple-600 mt-1">{kpis.fully_reserved_count || 0}</p>
            <span className="text-[10px] text-purple-600/80 font-medium">إجمالي المحجوز: {fmt(kpis.total_reserved || 0)}</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
            <Lock className="w-5 h-5" />
          </div>
        </div>

        {/* Card 7: In Transit */}
        <div
          onClick={() => { setSelectedStockStatus(selectedStockStatus === "in_transit" ? "all" : "in_transit"); }}
          className={`rounded-2xl p-4 border shadow-xs flex items-center justify-between cursor-pointer transition-colors ${
            selectedStockStatus === "in_transit" ? "bg-blue-100 border-blue-400" : "bg-white hover:bg-blue-50/50 border-slate-200"
          }`}
        >
          <div>
            <p className="text-[11px] font-bold text-blue-700">قيد النقل بين المخازن</p>
            <p className="text-lg font-black text-blue-600 mt-1">{fmt(kpis.total_in_transit || 0)}</p>
            <span className="text-[10px] text-blue-600/80 font-medium">تحويلات جارية</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
            <Truck className="w-5 h-5" />
          </div>
        </div>

        {/* Card 8: Expiring Soon */}
        <div
          onClick={() => { setFilterHasBatch(!filterHasBatch); }}
          className={`rounded-2xl p-4 border shadow-xs flex items-center justify-between cursor-pointer transition-colors ${
            filterHasBatch ? "bg-amber-100 border-amber-400" : "bg-white hover:bg-amber-50/50 border-slate-200"
          }`}
        >
          <div>
            <p className="text-[11px] font-bold text-amber-700">قرب انتهاء الصلاحية</p>
            <p className="text-lg font-black text-amber-600 mt-1">{kpis.expiring_count || 0}</p>
            <span className="text-[10px] text-amber-600/80 font-medium">خلال 30 يوماً</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
            <Tag className="w-5 h-5" />
          </div>
        </div>

        {/* Card 9: Expired */}
        <div
          onClick={() => { setFilterHasBatch(!filterHasBatch); }}
          className="bg-white hover:bg-red-50/50 rounded-2xl p-4 border border-slate-200 shadow-xs flex items-center justify-between cursor-pointer transition-colors"
        >
          <div>
            <p className="text-[11px] font-bold text-red-700">منتهي الصلاحية</p>
            <p className="text-lg font-black text-red-600 mt-1">{kpis.expired_count || 0}</p>
            <span className="text-[10px] text-red-600/80 font-medium">يتطلب إتلاف أو إرجاع</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-red-50 text-red-600 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5" />
          </div>
        </div>

        {/* Card 10: Slow Moving */}
        <div
          onClick={() => {}}
          className="bg-white hover:bg-slate-50 rounded-2xl p-4 border border-slate-200 shadow-xs flex items-center justify-between cursor-pointer transition-colors"
        >
          <div>
            <p className="text-[11px] font-bold text-slate-500">أصناف راكدة</p>
            <p className="text-lg font-black text-slate-700 mt-1">{kpis.slow_moving_count || 0}</p>
            <span className="text-[10px] text-slate-400 font-medium">دون حركة صرف 30 يوم</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center">
            <Clock className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* ─── SEARCH & FILTER BAR ─── */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-4 shadow-xs">
        <div className="flex flex-col md:flex-row items-center gap-3">
          {/* Search Input */}
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-3.5" />
            <input
              type="text"
              placeholder="بحث باسم الصنف، الكود، الباركود، SKU، أو اسم المخزن..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pr-10 pl-4 py-2.5 text-xs font-bold text-slate-800 focus:outline-none focus:border-orange-500 focus:bg-white transition-all"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} className="absolute left-3 top-3 text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Warehouse Dropdown */}
          <select
            value={selectedWarehouse}
            onChange={e => setSelectedWarehouse(e.target.value)}
            className="w-full md:w-56 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-700 focus:outline-none focus:border-orange-500"
          >
            <option value="all">كل المخازن والفروع</option>
            {warehouses.map((w, wIdx) => (
              <option key={`wh-stock-${w.id ?? wIdx}-${wIdx}`} value={w.id}>{w.name} ({w.code})</option>
            ))}
          </select>

          {/* Stock Status Dropdown */}
          <select
            value={selectedStockStatus}
            onChange={e => setSelectedStockStatus(e.target.value)}
            className="w-full md:w-48 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-700 focus:outline-none focus:border-orange-500"
          >
            <option value="all">كل حالات المخزون</option>
            <option value="optimal">🟢 طبيعي</option>
            <option value="low_stock">🟡 منخفض (تحت الطلب)</option>
            <option value="out_of_stock">🔴 نافد (0)</option>
            <option value="overstock">🟠 زائد (فوق الحد)</option>
            <option value="fully_reserved">🟣 محجوز بالكامل</option>
            <option value="in_transit">🔵 قيد النقل</option>
          </select>

          {/* Advanced Filter Toggle */}
          <button
            onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
            className={`px-3 py-2.5 rounded-xl text-xs font-bold flex items-center gap-1.5 border transition-colors whitespace-nowrap ${
              showAdvancedFilters || selectedCategory !== "all" || selectedBrand !== "all" || selectedItemType !== "all" || filterHasBatch || filterHasSerial || filterMinQty || filterMaxQty
                ? "bg-orange-50 border-orange-200 text-orange-700 font-black"
                : "bg-slate-100 hover:bg-slate-200 border-transparent text-slate-700"
            }`}
          >
            <Filter className="w-4 h-4 text-orange-500" />
            <span>فلاتر متقدمة</span>
            {(selectedCategory !== "all" || selectedBrand !== "all" || filterHasBatch || filterHasSerial) && (
              <span className="w-2 h-2 rounded-full bg-orange-600"></span>
            )}
          </button>

          {/* Reset Filters when active */}
          {(searchQuery || selectedWarehouse !== "all" || selectedStockStatus !== "all" || selectedCategory !== "all" || selectedBrand !== "all" || selectedItemType !== "all" || filterHasBatch || filterHasSerial || filterMinQty || filterMaxQty) && (
            <button
              onClick={() => {
                setSearchQuery("");
                setSelectedWarehouse("all");
                setSelectedStockStatus("all");
                setSelectedCategory("all");
                setSelectedBrand("all");
                setSelectedItemType("all");
                setFilterHasBatch(false);
                setFilterHasSerial(false);
                setFilterMinQty("");
                setFilterMaxQty("");
              }}
              title="إعادة ضبط الفلاتر"
              className="px-3 py-2.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-xl text-xs font-bold flex items-center gap-1 transition-colors whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5" /> إعادة ضبط
            </button>
          )}

          {/* Save Filter Button */}
          <button
            onClick={() => setShowSaveFilterModal(true)}
            title="حفظ الفلتر الحالي كنموذج جاهز"
            className="px-3 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors whitespace-nowrap"
          >
            <Bookmark className="w-4 h-4 text-orange-500" /> حفظ الفلتر
          </button>
        </div>

        {/* Saved Filters Chips */}
        {savedFilters.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto pt-1 pb-1">
            <span className="text-[11px] font-bold text-slate-400 whitespace-nowrap">الفلاتر المحفوظة:</span>
            {savedFilters.map((sf, idx) => (
              <div key={idx} className="flex items-center gap-1 bg-slate-100 rounded-lg px-2.5 py-1 text-[11px] font-bold text-slate-700 whitespace-nowrap">
                <button onClick={() => applySavedFilter(sf.filters)} className="hover:text-orange-600 transition-colors">
                  {sf.name}
                </button>
                <button onClick={() => removeSavedFilter(idx)} className="text-slate-400 hover:text-red-500 ml-1">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Advanced Filters Expandable Drawer */}
        {showAdvancedFilters && (
          <div className="pt-4 border-t border-slate-100 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs animate-in fade-in duration-200">
            <div>
              <label className="text-slate-500 font-bold block mb-1">التصنيف</label>
              <select
                value={selectedCategory}
                onChange={e => setSelectedCategory(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 focus:outline-none"
              >
                <option value="all">كل التصنيفات</option>
                {categories.map((c, cIdx) => <option key={`stock-cat-${c || cIdx}-${cIdx}`} value={c}>{c}</option>)}
              </select>
            </div>

            <div>
              <label className="text-slate-500 font-bold block mb-1">الماركة / Brand</label>
              <select
                value={selectedBrand}
                onChange={e => setSelectedBrand(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 focus:outline-none"
              >
                <option value="all">كل الماركات</option>
                {brands.map((b, bIdx) => <option key={`stock-brand-${b || bIdx}-${bIdx}`} value={b}>{b}</option>)}
              </select>
            </div>

            <div>
              <label className="text-slate-500 font-bold block mb-1">نوع الصنف (Item Type)</label>
              <select
                value={selectedItemType}
                onChange={e => setSelectedItemType(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 focus:outline-none"
              >
                <option value="all">كل الأنواع</option>
                <option value="raw_material">مادة خام (Raw Material)</option>
                <option value="finished_good">منتج تام (Finished Good)</option>
                <option value="consumable">مستهلكات وتشغيل (Consumable)</option>
                <option value="spare_part">قطع غيار (Spare Part)</option>
                <option value="asset">أصول ومعدات (Asset)</option>
              </select>
            </div>

            <div>
              <label className="text-slate-500 font-bold block mb-1">الكمية (من / إلى)</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  placeholder="من"
                  value={filterMinQty}
                  onChange={e => setFilterMinQty(e.target.value)}
                  className="w-1/2 bg-slate-50 border border-slate-200 rounded-xl px-2 py-2 text-xs text-slate-800"
                />
                <input
                  type="number"
                  placeholder="إلى"
                  value={filterMaxQty}
                  onChange={e => setFilterMaxQty(e.target.value)}
                  className="w-1/2 bg-slate-50 border border-slate-200 rounded-xl px-2 py-2 text-xs text-slate-800"
                />
              </div>
            </div>

            <div className="col-span-2 md:col-span-4 flex flex-wrap items-center gap-4 pt-2">
              <label className="flex items-center gap-2 cursor-pointer text-slate-700 font-bold">
                <input
                  type="checkbox"
                  checked={filterHasBatch}
                  onChange={e => setFilterHasBatch(e.target.checked)}
                  className="w-4 h-4 rounded text-orange-600 focus:ring-0"
                />
                <span>يحتوي على تشغيلات وتواريخ صلاحية (Batches)</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-slate-700 font-bold">
                <input
                  type="checkbox"
                  checked={filterHasSerial}
                  onChange={e => setFilterHasSerial(e.target.checked)}
                  className="w-4 h-4 rounded text-blue-600 focus:ring-0"
                />
                <span>يحتوي على أرقام تسلسلية (Serials)</span>
              </label>

              <button
                onClick={() => {
                  setSelectedCategory("all");
                  setSelectedBrand("all");
                  setSelectedItemType("all");
                  setFilterHasBatch(false);
                  setFilterHasSerial(false);
                  setFilterMinQty("");
                  setFilterMaxQty("");
                  setSelectedStockStatus("all");
                }}
                className="text-red-600 hover:text-red-700 font-bold mr-auto text-xs"
              >
                إعادة ضبط كل الفلاتر
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ─── MAIN ENTERPRISE STOCK TABLE ─── */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
              <tr>
                {visibleColumns.item && (
                  <th onClick={() => { setSortField("ingredient_name"); setSortOrder(sortOrder === "asc" ? "desc" : "asc"); }}
                      className="p-4 font-bold text-slate-700 cursor-pointer hover:text-orange-600 select-none">
                    الصنف والكود {sortField === "ingredient_name" && (sortOrder === "asc" ? "▲" : "▼")}
                  </th>
                )}
                {visibleColumns.warehouse && (
                  <th onClick={() => { setSortField("warehouse_name"); setSortOrder(sortOrder === "asc" ? "desc" : "asc"); }}
                      className="p-4 font-bold text-slate-700 cursor-pointer hover:text-orange-600 select-none text-center">
                    المخزن {sortField === "warehouse_name" && (sortOrder === "asc" ? "▲" : "▼")}
                  </th>
                )}
                {visibleColumns.status && <th className="p-4 font-bold text-slate-700 text-center">حالة المخزون</th>}
                {visibleColumns.location && <th className="p-4 font-bold text-slate-700 text-center">مكان التخزين (Location)</th>}
                {visibleColumns.quantity && (
                  <th onClick={() => { setSortField("quantity"); setSortOrder(sortOrder === "asc" ? "desc" : "asc"); }}
                      className="p-4 font-bold text-slate-700 text-center cursor-pointer hover:text-orange-600 select-none">
                    الكمية الحالية {sortField === "quantity" && (sortOrder === "asc" ? "▲" : "▼")}
                  </th>
                )}
                {visibleColumns.units_breakdown && <th className="p-4 font-bold text-slate-700 text-center">تعدد الوحدات</th>}
                {visibleColumns.available && <th className="p-4 font-bold text-slate-700 text-center">المتاح للصرف</th>}
                {visibleColumns.reserved && <th className="p-4 font-bold text-slate-700 text-center">المحجوز</th>}
                {visibleColumns.in_transit && <th className="p-4 font-bold text-slate-700 text-center">قيد النقل</th>}
                {visibleColumns.reorder && <th className="p-4 font-bold text-slate-700 text-center">حد الطلب (ROP/Min)</th>}
                {visibleColumns.consumption && <th className="p-4 font-bold text-slate-700 text-center">معدل الاستهلاك / التغطية</th>}
                {visibleColumns.avg_cost && <th className="p-4 font-bold text-slate-700 text-center">متوسط التكلفة</th>}
                {visibleColumns.last_price && <th className="p-4 font-bold text-slate-700 text-center">آخر سعر شراء</th>}
                {visibleColumns.value && (
                  <th onClick={() => { setSortField("inventory_value"); setSortOrder(sortOrder === "asc" ? "desc" : "asc"); }}
                      className="p-4 font-bold text-slate-700 text-center cursor-pointer hover:text-orange-600 select-none">
                    قيمة المخزون {sortField === "inventory_value" && (sortOrder === "asc" ? "▲" : "▼")}
                  </th>
                )}
                {visibleColumns.last_movement && <th className="p-4 font-bold text-slate-700 text-center">آخر حركة</th>}
                {visibleColumns.last_receipt && <th className="p-4 font-bold text-slate-700 text-center">آخر استلام</th>}
                {visibleColumns.last_issue && <th className="p-4 font-bold text-slate-700 text-center">آخر صرف</th>}
                {visibleColumns.batches && <th className="p-4 font-bold text-slate-700 text-center">التشغيلات</th>}
                {visibleColumns.serials && <th className="p-4 font-bold text-slate-700 text-center">السيريال</th>}
                {visibleColumns.actions && <th className="p-4 font-bold text-slate-700 text-center w-20">الإجراءات</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={20} className="p-12 text-center text-slate-400">
                    <RefreshCw className="w-8 h-8 animate-spin text-orange-500 mx-auto mb-2" />
                    <p className="text-xs font-bold">جاري تحميل بيانات الأرصدة والذكاء المخزني...</p>
                  </td>
                </tr>
              ) : paginatedItems.length === 0 ? (
                <tr>
                  <td colSpan={20} className="p-12 text-center text-slate-400">
                    <Box className="w-10 h-10 mx-auto mb-2 text-slate-300" />
                    <p className="text-sm font-bold text-slate-700">لا توجد أصناف تطابق الفلاتر المحددة</p>
                    <p className="text-xs text-slate-400 mt-1">جرب تغيير كلمات البحث أو إعادة ضبط خيارات التصفية</p>
                  </td>
                </tr>
              ) : (
                paginatedItems.map((item, idx) => {
                  const qty = Number(item.quantity || 0);
                  const reserved = Number(item.reserved || 0);
                  const inTransit = Number(item.in_transit || 0);
                  const available = Number(item.available || Math.max(qty - reserved, 0));
                  const avgCost = Number(item.avg_cost || item.cost || 0);
                  const value = Number(item.inventory_value || (qty * avgCost));

                  return (
                    <tr
                      key={item.item_id || item.id || idx}
                      className="hover:bg-orange-50/20 transition-colors group"
                    >
                      {/* 1. Item Master */}
                      {visibleColumns.item && (
                        <td className="p-4">
                          <div className="flex items-center gap-3">
                            <div
                              onClick={() => handleOpenDrawer(item.ingredient_id || item.id)}
                              className="w-9 h-9 rounded-xl bg-orange-50 text-orange-600 hover:bg-orange-500 hover:text-white flex items-center justify-center font-black cursor-pointer transition-colors shrink-0"
                            >
                              <Box className="w-4 h-4" />
                            </div>
                            <div>
                              <button
                                onClick={() => handleOpenDrawer(item.ingredient_id || item.id)}
                                className="font-black text-slate-900 hover:text-orange-600 text-right text-xs transition-colors flex items-center gap-1.5"
                              >
                                {item.ingredient_name || item.name}
                              </button>
                              <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[11px]">
                                {cleanCode(item.ingredient_code || item.item_code || item.code, item.ingredient_id || item.id) && (
                                  <span className="font-mono text-orange-700 bg-orange-50 border border-orange-200/80 px-2 py-0.5 rounded-md font-bold text-[10px]">
                                    {cleanCode(item.ingredient_code || item.item_code || item.code, item.ingredient_id || item.id)}
                                  </span>
                                )}
                                {cleanStr(item.category) && (
                                  <span className="text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded text-[10px] font-medium">
                                    {cleanStr(item.category)}
                                  </span>
                                )}
                                {cleanStr(item.barcode) && (
                                  <span className="text-slate-400 font-mono text-[10px]">
                                    [{cleanStr(item.barcode)}]
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                      )}

                      {/* 2. Warehouse */}
                      {visibleColumns.warehouse && (
                        <td className="p-4 text-center">
                          <span className="font-bold text-slate-800">{item.warehouse_name}</span>
                          {item.warehouse_code && <span className="text-[10px] text-slate-400 block font-mono">({item.warehouse_code})</span>}
                        </td>
                      )}

                      {/* 3. Stock Status */}
                      {visibleColumns.status && (
                        <td className="p-4 text-center">
                          {renderStatusBadge(item.status, item.statusLabel)}
                        </td>
                      )}

                      {/* 4. Location */}
                      {visibleColumns.location && (
                        <td className="p-4 text-center">
                          {item.location_code ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 text-slate-800 font-mono text-[11px] font-bold">
                              <MapPin className="w-3 h-3 text-amber-600" />
                              {item.location_code}
                            </span>
                          ) : (
                            <span className="text-slate-400 italic text-[11px]">غير محدد</span>
                          )}
                        </td>
                      )}

                      {/* 5. Quantity */}
                      {visibleColumns.quantity && (
                        <td className="p-4 text-center">
                          <span className="font-black text-slate-900 text-sm">{fmt(qty)}</span>
                          <span className="text-[11px] font-medium text-slate-500 mr-1">{item.ingredient_unit || item.unit || "وحدة"}</span>
                        </td>
                      )}

                      {/* 6. Multi-UOM Breakdown */}
                      {visibleColumns.units_breakdown && (
                        <td className="p-4 text-center text-[11px] font-bold text-purple-700">
                          {item.secondary_unit_text || "—"}
                        </td>
                      )}

                      {/* 7. Available */}
                      {visibleColumns.available && (
                        <td className="p-4 text-center">
                          <span className="font-black text-emerald-600 text-sm">{fmt(available)}</span>
                        </td>
                      )}

                      {/* 8. Reserved (Clickable) */}
                      {visibleColumns.reserved && (
                        <td className="p-4 text-center">
                          {reserved > 0 ? (
                            <button
                              onClick={() => setReservedModalItem(item)}
                              className="px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-700 font-black text-xs border border-amber-200 transition-colors"
                            >
                              {fmt(reserved)}
                            </button>
                          ) : (
                            <span className="text-slate-400">0</span>
                          )}
                        </td>
                      )}

                      {/* 9. In Transit (Clickable) */}
                      {visibleColumns.in_transit && (
                        <td className="p-4 text-center">
                          {inTransit > 0 ? (
                            <button
                              onClick={() => setInTransitModalItem(item)}
                              className="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 font-black text-xs border border-blue-200 transition-colors"
                            >
                              {fmt(inTransit)}
                            </button>
                          ) : (
                            <span className="text-slate-400">0</span>
                          )}
                        </td>
                      )}

                      {/* 10. Reorder Point / Min */}
                      {visibleColumns.reorder && (
                        <td className="p-4 text-center">
                          <div className="text-[11px]">
                            <span className="font-bold text-amber-700">ROP: {fmt(item.reorder_point || item.min_stock)}</span>
                            {Number(item.max_stock) > 0 && <span className="text-slate-400 block text-[10px]">Max: {fmt(item.max_stock)}</span>}
                          </div>
                        </td>
                      )}

                      {/* 11. Consumption Intelligence */}
                      {visibleColumns.consumption && (
                        <td className="p-4 text-center text-[11px]">
                          <span className="font-bold text-slate-800">{fmt(item.daily_avg_consumption)} / يوم</span>
                          <span className={`block font-bold text-[10px] ${item.days_of_supply < 15 ? "text-red-600" : "text-emerald-600"}`}>
                            {item.days_of_supply !== 999 ? `تغطية: ${item.days_of_supply} يوم` : "—"}
                          </span>
                        </td>
                      )}

                      {/* 12. Avg Cost */}
                      {visibleColumns.avg_cost && (
                        <td className="p-4 text-center font-bold text-slate-700">
                          {fmtMoney(avgCost)}
                        </td>
                      )}

                      {/* 13. Last Purchase Price */}
                      {visibleColumns.last_price && (
                        <td className="p-4 text-center text-slate-600">
                          {fmtMoney(item.last_purchase_price || 0)}
                        </td>
                      )}

                      {/* 14. Inventory Value */}
                      {visibleColumns.value && (
                        <td className="p-4 text-center font-black text-slate-900">
                          {fmtMoney(value)}
                        </td>
                      )}

                      {/* 15. Last Movement */}
                      {visibleColumns.last_movement && (
                        <td className="p-4 text-center">
                          {item.last_movement?.date ? (
                            <button
                              onClick={() => handleOpenDrawer(item.ingredient_id || item.id)}
                              className="text-[11px] text-right hover:text-orange-600 transition-colors"
                            >
                              <span className="font-bold text-slate-800 block">{new Date(item.last_movement.date).toLocaleDateString("ar-EG")}</span>
                              <span className={`font-bold ${Number(item.last_movement.delta) > 0 ? "text-emerald-600" : "text-red-600"}`}>
                                {item.last_movement.ref_type} ({item.last_movement.delta > 0 ? `+${item.last_movement.delta}` : item.last_movement.delta})
                              </span>
                            </button>
                          ) : (
                            <span className="text-slate-400 text-[11px]">—</span>
                          )}
                        </td>
                      )}

                      {/* 16. Last Receipt */}
                      {visibleColumns.last_receipt && (
                        <td className="p-4 text-center text-[11px]">
                          {item.last_receipt?.date ? (
                            <div>
                              <span className="font-bold text-slate-800 block">{new Date(item.last_receipt.date).toLocaleDateString("ar-EG")}</span>
                              <span className="text-emerald-700 font-bold">{fmt(item.last_receipt.quantity)} وحدة</span>
                            </div>
                          ) : "—"}
                        </td>
                      )}

                      {/* 17. Last Issue */}
                      {visibleColumns.last_issue && (
                        <td className="p-4 text-center text-[11px]">
                          {item.last_issue?.date ? (
                            <div>
                              <span className="font-bold text-slate-800 block">{new Date(item.last_issue.date).toLocaleDateString("ar-EG")}</span>
                              <span className="text-red-600 font-bold">{fmt(item.last_issue.quantity)} وحدة</span>
                            </div>
                          ) : "—"}
                        </td>
                      )}

                      {/* 18. Batches */}
                      {visibleColumns.batches && (
                        <td className="p-4 text-center">
                          {item.batch_count > 0 ? (
                            <span className="px-2 py-0.5 rounded-lg bg-purple-50 text-purple-700 font-bold text-xs border border-purple-200">
                              {item.batch_count} تشغيلة
                            </span>
                          ) : "—"}
                        </td>
                      )}

                      {/* 19. Serials */}
                      {visibleColumns.serials && (
                        <td className="p-4 text-center">
                          {item.serial_count > 0 ? (
                            <span className="px-2 py-0.5 rounded-lg bg-blue-50 text-blue-700 font-bold text-xs border border-blue-200">
                              {item.serial_count} سيريال
                            </span>
                          ) : "—"}
                        </td>
                      )}

                      {/* 20. Row Actions Dropdown */}
                      {visibleColumns.actions && (
                        <td className="p-4 text-center relative">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => handleOpenDrawer(item.ingredient_id || item.id)}
                              title="عرض تفاصيل الصنف بالكامل"
                              className="p-1.5 rounded-lg bg-slate-100 hover:bg-orange-500 hover:text-white text-slate-600 transition-colors"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setOpenMenuRowId(openMenuRowId === (item.item_id || item.id) ? null : (item.item_id || item.id))}
                              className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </button>
                          </div>

                          {/* Dropdown Menu */}
                          {openMenuRowId === (item.item_id || item.id) && (
                            <div className="absolute left-0 top-12 z-30 w-48 bg-white rounded-2xl shadow-xl border border-slate-200 p-1.5 text-right space-y-1 animate-in fade-in zoom-in-95 duration-150">
                              <button
                                onClick={() => {
                                  setSelectedDrawerItemId(item.ingredient_id || item.id);
                                  setIsDrawerOpen(true);
                                  setOpenMenuRowId(null);
                                }}
                                className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold text-slate-700 hover:bg-orange-50 hover:text-orange-600 transition-colors"
                              >
                                <Eye className="w-3.5 h-3.5" /> عرض بطاقة الصنف الشاملة
                              </button>
                              <button
                                onClick={() => {
                                  onNavigateToFeature?.("transactions");
                                  setOpenMenuRowId(null);
                                }}
                                className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
                              >
                                <PlusCircle className="w-3.5 h-3.5 text-emerald-600" /> حركة استلام / صرف جديدة
                              </button>
                              <button
                                onClick={() => {
                                  onNavigateToFeature?.("transfers");
                                  setOpenMenuRowId(null);
                                }}
                                className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
                              >
                                <ArrowRightLeft className="w-3.5 h-3.5 text-blue-600" /> تحويل لمخزن آخر
                              </button>
                              <button
                                onClick={() => {
                                  onNavigateToFeature?.("barcode");
                                  setOpenMenuRowId(null);
                                }}
                                className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
                              >
                                <Printer className="w-3.5 h-3.5 text-purple-600" /> طباعة ملصق الباركود
                              </button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
            {/* Table Footer Totals */}
            <tfoot className="bg-slate-50 border-t-2 border-slate-200 font-bold text-slate-800">
              <tr>
                <td className="p-4">إجمالي الصفحة ({paginatedItems.length} صنف)</td>
                <td colSpan={visibleColumns.location ? 3 : 2}></td>
                {visibleColumns.quantity && (
                  <td className="p-4 text-center font-black text-slate-900 text-sm">
                    {fmt(paginatedItems.reduce((s, i) => s + Number(i.quantity || 0), 0))}
                  </td>
                )}
                {visibleColumns.units_breakdown && <td></td>}
                {visibleColumns.available && (
                  <td className="p-4 text-center font-black text-emerald-700 text-sm">
                    {fmt(paginatedItems.reduce((s, i) => s + Number(i.available || 0), 0))}
                  </td>
                )}
                {visibleColumns.reserved && (
                  <td className="p-4 text-center font-black text-amber-700 text-sm">
                    {fmt(paginatedItems.reduce((s, i) => s + Number(i.reserved || 0), 0))}
                  </td>
                )}
                {visibleColumns.in_transit && (
                  <td className="p-4 text-center font-black text-blue-700 text-sm">
                    {fmt(paginatedItems.reduce((s, i) => s + Number(i.in_transit || 0), 0))}
                  </td>
                )}
                <td colSpan={visibleColumns.avg_cost ? (visibleColumns.consumption ? 3 : 2) : 1}></td>
                {visibleColumns.value && (
                  <td className="p-4 text-center font-black text-slate-900 text-sm">
                    {fmtMoney(paginatedItems.reduce((s, i) => s + Number(i.inventory_value || 0), 0))}
                  </td>
                )}
                <td colSpan={5}></td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* ─── PAGINATION CONTROLS ─── */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-3">
            <span className="text-slate-500 font-bold">عرض</span>
            <select
              value={pageSize}
              onChange={e => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
              className="bg-white border border-slate-200 rounded-lg px-2 py-1 font-bold text-slate-700"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <span className="text-slate-500 font-bold">
              إجمالي النتائج: <strong className="text-slate-900">{sortedItems.length}</strong> صنف
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
              className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 disabled:opacity-40 font-bold"
            >
              الأول
            </button>
            <button
              onClick={() => setCurrentPage(p => Math.max(p - 1, 1))}
              disabled={currentPage === 1}
              className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 disabled:opacity-40 font-bold"
            >
              السابق
            </button>
            <span className="px-3 py-1.5 font-black text-orange-600 bg-orange-50 rounded-lg border border-orange-200">
              {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages))}
              disabled={currentPage === totalPages}
              className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 disabled:opacity-40 font-bold"
            >
              التالي
            </button>
            <button
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage === totalPages}
              className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 disabled:opacity-40 font-bold"
            >
              الأخير
            </button>
          </div>
        </div>
      </div>

      {/* ─── COLUMN MANAGER MODAL ─── */}
      {showColumnManager && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-lg w-full shadow-2xl border border-slate-200 space-y-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-5 h-5 text-orange-500" />
                <h3 className="text-base font-black text-slate-900">تخصيص أعمدة الجدول</h3>
              </div>
              <button onClick={() => setShowColumnManager(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500">حدد الأعمدة التي ترغب في إظهارها في شاشة أرصدة المخزون، وسيتم حفظ تفضيلاتك آلياً:</p>

            <div className="grid grid-cols-2 gap-2.5 max-h-80 overflow-y-auto p-1">
              {ALL_COLUMNS.map(col => {
                const isChecked = !!visibleColumns[col.id];
                return (
                  <label
                    key={col.id}
                    className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-xs font-bold cursor-pointer transition-colors ${
                      isChecked ? "bg-orange-50/50 border-orange-200 text-slate-900" : "bg-slate-50 border-slate-200 text-slate-500"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={e => {
                        saveColumnPreferences({ ...visibleColumns, [col.id]: e.target.checked });
                      }}
                      className="w-4 h-4 rounded text-orange-600 focus:ring-0"
                    />
                    <span>{col.label}</span>
                  </label>
                );
              })}
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-100">
              <button
                onClick={() => {
                  const reset: Record<string, boolean> = {};
                  ALL_COLUMNS.forEach(c => { reset[c.id] = c.defaultVisible; });
                  saveColumnPreferences(reset);
                }}
                className="text-xs font-bold text-slate-500 hover:text-slate-800"
              >
                استعادة الافتراضي
              </button>
              <button
                onClick={() => setShowColumnManager(false)}
                className="px-5 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-xs font-bold shadow-xs transition-colors"
              >
                تم وتطبيق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── SAVE FILTER MODAL ─── */}
      {showSaveFilterModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black text-slate-900">حفظ الفلتر الحالي</h3>
              <button onClick={() => setShowSaveFilterModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-500">أدخل اسماً للفلتر لسهولة استخدامه لاحقاً بنقرة زر:</p>
            <input
              type="text"
              placeholder="مثال: أصناف الخامات المنخفضة بالمخزن الرئيسي"
              value={newFilterName}
              onChange={e => setNewFilterName(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-800 focus:outline-none focus:border-orange-500"
            />
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowSaveFilterModal(false)}
                className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-xs font-bold"
              >
                إلغاء
              </button>
              <button
                onClick={handleSaveFilter}
                disabled={!newFilterName.trim()}
                className="px-5 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-colors"
              >
                حفظ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── RESERVED STOCK MODAL BREAKDOWN ─── */}
      {reservedModalItem && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-lg w-full shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Lock className="w-5 h-5 text-amber-600" />
                <h3 className="text-base font-black text-slate-900">تفاصيل الكميات المحجوزة</h3>
              </div>
              <button onClick={() => setReservedModalItem(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div>
              <p className="font-bold text-slate-900 text-sm">{reservedModalItem.ingredient_name || reservedModalItem.name}</p>
              <p className="text-xs text-slate-500">المخزن: <strong className="text-slate-700">{reservedModalItem.warehouse_name}</strong> | إجمالي المحجوز: <strong className="text-amber-600">{fmt(reservedModalItem.reserved)} {reservedModalItem.ingredient_unit}</strong></p>
            </div>
            <div className="bg-slate-50 rounded-2xl p-4 text-xs text-slate-600 space-y-2">
              <p className="leading-relaxed">
                الكميات المحجوزة مقيدة لأوامر مبيعات مؤكدة، أو طلبات صرف أقسام قيد التجهيز، أو أوامر تشغيل مطابخ وصيانة.
              </p>
              <button
                onClick={() => {
                  setSelectedDrawerItemId(reservedModalItem.ingredient_id || reservedModalItem.id);
                  setIsDrawerOpen(true);
                  setReservedModalItem(null);
                }}
                className="w-full mt-2 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-bold text-xs transition-colors flex items-center justify-center gap-1.5"
              >
                <Eye className="w-4 h-4" /> فتح بطاقة الحجوزات الكاملة
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── IN TRANSIT MODAL BREAKDOWN ─── */}
      {inTransitModalItem && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-lg w-full shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Truck className="w-5 h-5 text-blue-600" />
                <h3 className="text-base font-black text-slate-900">تفاصيل البضاعة قيد النقل</h3>
              </div>
              <button onClick={() => setInTransitModalItem(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div>
              <p className="font-bold text-slate-900 text-sm">{inTransitModalItem.ingredient_name || inTransitModalItem.name}</p>
              <p className="text-xs text-slate-500">الكمية قيد النقل: <strong className="text-blue-600">{fmt(inTransitModalItem.in_transit)} {inTransitModalItem.ingredient_unit}</strong></p>
            </div>
            <div className="bg-slate-50 rounded-2xl p-4 text-xs text-slate-600 space-y-2">
              <p className="leading-relaxed">
                هذه الكميات تم شحنها في مناقلات بين المخازن وهي في طريقها للاستلام الفعلي في المخزن المستهدف.
              </p>
              <button
                onClick={() => {
                  onNavigateToFeature?.("transfers");
                  setInTransitModalItem(null);
                }}
                className="w-full mt-2 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xs transition-colors flex items-center justify-center gap-1.5"
              >
                <ArrowRightLeft className="w-4 h-4" /> الانتقال لسندات التحويل بين المخازن
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── RIGHT-SIDE DETAILS DRAWER ─── */}
      <StockItemDetailsDrawer
        itemId={selectedDrawerItemId}
        isOpen={isDrawerOpen}
        onClose={() => { setIsDrawerOpen(false); setSelectedDrawerItemId(null); }}
        onNotify={onNotify}
        onRefreshParent={fetchData}
      />
    </div>
  );
};
