import React, { useState } from "react";
import {
  Plus,
  Search,
  FileText,
  Check,
  X,
  ChevronDown,
  Calendar,
  TrendingUp,
  TrendingDown,
  Scale,
  Receipt,
  Download,
  Printer,
  Eye,
  MoreVertical,
  AlertCircle,
  CheckCircle2,
  Clock,
  ArrowUpRight,
  ArrowDownLeft,
  Percent,
  Trash2,
  Edit3,
  RefreshCw,
  FileSpreadsheet,
  AlertTriangle,
  Send,
  Building,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface VATRecord {
  id: number;
  period: string; // e.g. "يناير - 2026"
  startDate: string; // e.g. "01/01/2026"
  endDate: string; // e.g. "31/01/2026"
  salesAmount: number;
  purchasesAmount: number;
  netTax: number;
  status: "paid" | "submitted" | "not_submitted";
  submissionDate?: string;
  notes?: string;
}

interface WithholdingRecord {
  id: number;
  entityName: string;
  taxNumber: string;
  transactionAmount: number;
  rate: number;
  withheldAmount: number;
  date: string;
  status: "collected" | "pending";
}

interface TaxDeclarationRecord {
  id: number;
  referenceNumber: string;
  type: string;
  period: string;
  submissionDate: string;
  totalAmount: number;
  paidAmount: number;
  paymentStatus: "fully_paid" | "partially_paid" | "unpaid";
}

export const TaxesView: React.FC = () => {
  // Tabs: vat (ضريبة القيمة المضافة), withholding (ضريبة الخصم والاضافة), declarations (الإقرارات الضريبية)
  const [activeSubTab, setActiveSubTab] = useState<
    "vat" | "withholding" | "declarations"
  >("vat");
  const [searchQuery, setSearchQuery] = useState("");

  // Year Filter State (Updated to current time 2026 as per user request values)
  const [selectedYear, setSelectedYear] = useState("2026");
  const [showYearDropdown, setShowYearDropdown] = useState(false);

  // VAT records
  const [vatRecords, setVatRecords] = useState<VATRecord[]>([]);

  // Withholding records
  const [withholdingRecords, setWithholdingRecords] = useState<
    WithholdingRecord[]
  >([]);

  // Tax returns declarations list
  const [declarations, setDeclarations] = useState<TaxDeclarationRecord[]>([]);

  // Selected VAT record inside the side panel
  const [selectedVatId, setSelectedVatId] = useState<number | null>(null);
  const activeVat =
    vatRecords.find((r) => r.id === selectedVatId) || vatRecords[0] || null;

  // Options action dropdown state for rows
  const [rowMenuOpenId, setRowMenuOpenId] = useState<number | null>(null);

  // Modals state
  const [showAddVatModal, setShowAddVatModal] = useState(false);
  const [showEditVatModal, setShowEditVatModal] = useState(false);
  const [showVatDetailsModal, setShowVatDetailsModal] = useState(false);

  // New modal states added as requested
  const [showOfficialDeclarationModal, setShowOfficialDeclarationModal] =
    useState(false);
  const [showTaxReportModal, setShowTaxReportModal] = useState(false);
  const [showExportConfirmationModal, setShowExportConfirmationModal] =
    useState(false);
  const [exportRecordSelected, setExportRecordSelected] =
    useState<VATRecord | null>(null);

  // New VAT record form state (pre-filled with 2026 values)
  const [newPeriodMonth, setNewPeriodMonth] = useState("يونيو");
  const [newPeriodYear, setNewPeriodYear] = useState("2026");
  const [newStartDate, setNewStartDate] = useState("2026-06-01");
  const [newEndDate, setNewEndDate] = useState("2026-06-30");
  const [newSalesAmount, setNewSalesAmount] = useState("");
  const [newPurchasesAmount, setNewPurchasesAmount] = useState("");
  const [newNotes, setNewNotes] = useState("");

  // Editing state
  const [editingRecord, setEditingRecord] = useState<VATRecord | null>(null);

  // Export handling (Real user data file download!)
  const triggerRealDownload = (
    record: VATRecord,
    format: "csv" | "txt" | "json",
  ) => {
    let fileContent = "";
    let fileName = `إقرار_القيمة_المضافة_${record.period.replace(" - ", "_")}`;
    let mimeType = "text/plain";

    if (format === "csv") {
      const headers = [
        "الفترة الضريبية",
        "تاريخ البداية",
        "تاريخ النهاية",
        "ضريبة المبيعات [مخرجات]",
        "ضريبة المشتريات [مدخلات]",
        "صافي الضريبة المستحقة",
        "حالة السداد والتقديم",
        "تاريخ التقديم الفعلي",
        "ملاحظات وتفاصيل",
      ];
      const dataRow = [
        record.period,
        record.startDate,
        record.endDate,
        record.salesAmount,
        record.purchasesAmount,
        record.netTax,
        record.status === "paid"
          ? "مدفوع بالكامل"
          : record.status === "submitted"
            ? "مقدم ومعتمد"
            : "لم يقدم بعد",
        record.submissionDate || "غير متوفر",
        record.notes || "",
      ];
      // UTF-8 BOM for proper Arabic character representation in Excel
      fileContent =
        "\uFEFF" +
        [headers.join(","), dataRow.map((v) => `"${v}"`).join(",")].join("\n");
      mimeType = "text/csv;charset=utf-8;";
      fileName += ".csv";
    } else if (format === "json") {
      fileContent = JSON.stringify(record, null, 2);
      mimeType = "application/json;charset=utf-8;";
      fileName += ".json";
    } else {
      fileContent = `==================================================
                 تقرير هـيئة الضرائب المـصرية
==================================================
رقم المعاملة: VAT-${record.id}
فترة المعاملة: ${record.period}
تاريخ البداية: ${record.startDate} - تاريخ النهاية: ${record.endDate}
--------------------------------------------------
ضريبة المبيعات [مخرجات القيمة]: ${Number(record.salesAmount || 0).toLocaleString("en-US")} ج.م
ضريبة المشتريات [مدخلات مخصومة]: ${Number(record.purchasesAmount || 0).toLocaleString("en-US")} ج.م
صافي الضريبة المحتسبة: ${Number(record.netTax || 0).toLocaleString("en-US")} ج.م
--------------------------------------------------
حالة الإقرار الحالي: ${record.status === "paid" ? "تم الدفع بالكامل للمصلحة" : record.status === "submitted" ? "مقدم بانتظار السداد المالي" : "مسودة قيد المراجعة الإدارية"}
تاريخ تسديد/تقديم الإقرار: ${record.submissionDate || "لم يسجل بعد"}
--------------------------------------------------
الملاحظات التفصيلية:
${record.notes || "لا يوجد ملاحظات كفيلة بالبيان"}
==================================================`;
      mimeType = "text/plain;charset=utf-8;";
      fileName += ".txt";
    }

    const blob = new Blob([fileContent], { type: mimeType });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setShowExportConfirmationModal(false);
  };

  // Mass export for all tax data (CSV)
  const downloadFullTaxReport = () => {
    const headers = [
      "النوع",
      "الفترة/المرجع",
      "التكلفة الإجمالية/المبيعات",
      "المشتريات/المقدار المستقطع",
      "صافي القيمة المستحقة",
      "الحالة الإدارية",
    ];
    const rows = [
      ...vatRecords.map((r) => [
        "ضريبة القيمة المضافة",
        r.period,
        r.salesAmount,
        r.purchasesAmount,
        r.netTax,
        r.status,
      ]),
      ...withholdingRecords.map((r) => [
        "ضريبة الخصم والاضافة",
        r.entityName,
        r.transactionAmount,
        r.withheldAmount,
        r.withheldAmount,
        r.status,
      ]),
      ...declarations.map((r) => [
        "الإقرارات السنوية/الربعية",
        r.period,
        r.totalAmount,
        r.paidAmount,
        r.totalAmount - r.paidAmount,
        r.paymentStatus,
      ]),
    ];

    const csvContent =
      "\uFEFF" +
      [
        headers.join(","),
        ...rows.map((row) => row.map((v) => `"${v}"`).join(",")),
      ].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `تقرير_مصلحة_الضرائب_المتكامل_الشامل_2026.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    alert("تم تحميل التقرير الضريبي الشامل كملف CSV بنجاح!");
  };

  // Pre-fill fields for editing
  const handleOpenEditVatModal = (record: VATRecord) => {
    setEditingRecord(record);
    const splitPeriod = record.period.split(" - ");
    setNewPeriodMonth(splitPeriod[0]);
    setNewPeriodYear(splitPeriod[1]);

    // Parse Date back
    const partsStart = record.startDate.split("/");
    const partsEnd = record.endDate.split("/");
    if (partsStart.length === 3) {
      setNewStartDate(`${partsStart[2]}-${partsStart[1]}-${partsStart[0]}`);
    }
    if (partsEnd.length === 3) {
      setNewEndDate(`${partsEnd[2]}-${partsEnd[1]}-${partsEnd[0]}`);
    }
    setNewSalesAmount(record.salesAmount.toString());
    setNewPurchasesAmount(record.purchasesAmount.toString());
    setNewNotes(record.notes || "");
    setShowEditVatModal(true);
    setRowMenuOpenId(null);
  };

  // Save the edited VAT record
  const handleEditVat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRecord) return;

    const sales = parseFloat(newSalesAmount) || 0;
    const purchases = parseFloat(newPurchasesAmount) || 0;
    const net = sales - purchases;

    const formatStrDate = (dateStr: string) => {
      const parts = dateStr.split("-");
      if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
      return dateStr;
    };

    const updated = vatRecords.map((r) => {
      if (r.id === editingRecord.id) {
        return {
          ...r,
          period: `${newPeriodMonth} - ${newPeriodYear}`,
          startDate: formatStrDate(newStartDate),
          endDate: formatStrDate(newEndDate),
          salesAmount: sales,
          purchasesAmount: purchases,
          netTax: net,
          notes: newNotes,
        };
      }
      return r;
    });

    setVatRecords(updated);
    setShowEditVatModal(false);
    setEditingRecord(null);
    alert("تم تعديل بيانات السجل الضريبي بنجاح!");
  };

  // Change status of a record directly
  const handleChangeStatus = (
    id: number,
    status: "paid" | "submitted" | "not_submitted",
  ) => {
    const defaultSubDate =
      status !== "not_submitted"
        ? new Date().toLocaleDateString("en-GB")
        : undefined;
    const updated = vatRecords.map((r) => {
      if (r.id === id) {
        return {
          ...r,
          status,
          submissionDate: defaultSubDate,
        };
      }
      return r;
    });
    setVatRecords(updated);
    setRowMenuOpenId(null);
    alert("تم تحديث حالة تسوية الإقرار الضريبي!");
  };

  // Delete a record
  const handleDeleteRecord = (id: number) => {
    if (
      window.confirm("هل أنت متأكد من رغبتك في حذف هذا السجل الضريبي نهائياً؟")
    ) {
      const updated = vatRecords.filter((r) => r.id !== id);
      setVatRecords(updated);
      setRowMenuOpenId(null);
      alert("تم حذف السجل الضريبي بنجاح.");
    }
  };

  // Handle adding new VAT record
  const handleAddVat = (e: React.FormEvent) => {
    e.preventDefault();
    const sales = parseFloat(newSalesAmount) || 0;
    const purchases = parseFloat(newPurchasesAmount) || 0;
    const net = sales - purchases;

    const formatStrDate = (dateStr: string) => {
      const parts = dateStr.split("-");
      if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
      return dateStr;
    };

    const newRec: VATRecord = {
      id: Date.now(),
      period: `${newPeriodMonth} - ${newPeriodYear}`,
      startDate: formatStrDate(newStartDate),
      endDate: formatStrDate(newEndDate),
      salesAmount: sales,
      purchasesAmount: purchases,
      netTax: net,
      status: "not_submitted",
      notes: newNotes,
    };

    setVatRecords([newRec, ...vatRecords]);
    setSelectedVatId(newRec.id);
    closeAddVatModal();
  };

  const closeAddVatModal = () => {
    setShowAddVatModal(false);
    setNewSalesAmount("");
    setNewPurchasesAmount("");
    setNewNotes("");
  };

  // Filter records based on selected year & search query
  const filteredVatRecords = vatRecords.filter((r) => {
    const matchesSearch =
      searchQuery === "" ||
      r.period.includes(searchQuery) ||
      (r.notes && r.notes.includes(searchQuery));
    const yearPart = r.period.split(" - ")[1];
    const matchesYear = yearPart === selectedYear;
    return matchesSearch && matchesYear;
  });

  // Calculate stats for current year
  const totalSalesTax = filteredVatRecords.reduce(
    (sum, r) => sum + r.salesAmount,
    0,
  );
  const totalPurchasesTax = filteredVatRecords.reduce(
    (sum, r) => sum + r.purchasesAmount,
    0,
  );
  const netTaxTotal = totalSalesTax - totalPurchasesTax;

  const formatCurrency = (val: number) => {
    return (
      Number(val || 0).toLocaleString("ar-EG", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }) + " ج.م"
    );
  };

  return (
    <div className="space-y-6 dir-rtl" style={{ direction: "rtl" }}>
      {/* Top Search Filters and Big Action Buttons (Image 1 style) */}
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
        {/* Big Action Buttons (ضريبة جديدة، الإقرار الضريبي، تقرير ضريبي) */}
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          <button
            onClick={() => setShowAddVatModal(true)}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-2xl font-bold transition-all shadow-md shadow-emerald-600/10"
            id="add-new-tax-btn"
          >
            <Plus className="w-5 h-5" />
            <span>ضريبة جديدة</span>
          </button>

          <button
            onClick={() => {
              // Trigger previewing/generating the main official declaration form!
              setShowOfficialDeclarationModal(true);
            }}
            className="flex items-center gap-2 bg-slate-900 text-white hover:bg-slate-800 border border-slate-750 px-5 py-2.5 rounded-2xl font-bold transition-all shadow-md shadow-slate-900/15"
          >
            <FileText className="w-4 h-4 text-emerald-400" />
            <span>الإقرار الضريبي</span>
          </button>

          <button
            onClick={() => {
              // Trigger preview metrics / analysis tax report!
              setShowTaxReportModal(true);
            }}
            className="flex items-center gap-2 bg-white hover:bg-slate-50 text-slate-800 border border-slate-200 px-4 py-2.5 rounded-2xl font-bold transition-all shadow-sm"
          >
            <Percent className="w-4 h-4 text-indigo-500" />
            <span>تقرير ضريبي</span>
          </button>
        </div>

        {/* Inputs (Year Dropdown & Search Box) */}
        <div className="flex flex-wrap items-center gap-4 w-full md:w-auto md:justify-end">
          {/* Year Filter Dropdown with Year options (current 2026, 2025, 2024) */}
          <div className="relative">
            <button
              onClick={() => setShowYearDropdown(!showYearDropdown)}
              className="flex items-center gap-2 bg-white border border-slate-200 rounded-2xl px-4 py-2.5 font-bold text-slate-700 hover:bg-slate-50 shadow-sm transition-all"
            >
              <Calendar className="w-4 h-4 text-slate-400" />
              <span>{selectedYear}</span>
              <ChevronDown
                className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${showYearDropdown ? "rotate-180" : ""}`}
              />
            </button>
            <AnimatePresence>
              {showYearDropdown && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowYearDropdown(false)}
                  />
                  <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    className="absolute left-0 mt-2 w-32 bg-white border border-slate-100 rounded-2xl shadow-xl z-50 overflow-hidden"
                  >
                    {["2026", "2025", "2024"].map((yr) => (
                      <button
                        key={yr}
                        onClick={() => {
                          setSelectedYear(yr);
                          setShowYearDropdown(false);
                        }}
                        className={`w-full text-right px-4 py-2.5 text-sm font-semibold transition-all hover:bg-slate-50 ${selectedYear === yr ? "text-emerald-600 bg-emerald-50/50" : "text-slate-600"}`}
                      >
                        {yr}
                      </button>
                    ))}
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>

          {/* Search Box */}
          <div className="relative flex-grow max-w-xs w-full">
            <Search className="absolute right-4 top-3 text-slate-400 w-4 h-4" />
            <input
              type="text"
              placeholder="بحث برقم أو اسم الضريبة..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-4 pr-10 py-2.5 bg-white border border-slate-200 rounded-2xl text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-medium text-sm transition-all shadow-sm"
            />
          </div>
        </div>
      </div>

      {/* KPI Cards Layout (Image 1 style matching perfectly) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {/* Card 1: Total Sales Tax */}
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm flex items-center justify-between transition-all hover:shadow-md">
          <div className="space-y-1">
            <span className="text-slate-500 font-semibold text-xs block">
              إجمالي ضريبة المبيعات [مخرجات] ({selectedYear})
            </span>
            <div className="text-2xl font-extrabold text-slate-900 tracking-tight">
              {formatCurrency(totalSalesTax)}
            </div>
            <span className="text-[10px] text-slate-400 font-medium">
              مصلحة الضرائب المصرية المعتمدة
            </span>
          </div>
          <div className="w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600 shadow-inner">
            <Percent className="w-6 h-6" />
          </div>
        </div>

        {/* Card 2: Total Purchases Tax */}
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm flex items-center justify-between transition-all hover:shadow-md">
          <div className="space-y-1">
            <span className="text-slate-500 font-semibold text-xs block">
              إجمالي ضريبة المشتريات [مدخلات] ({selectedYear})
            </span>
            <div className="text-2xl font-extrabold text-rose-600 tracking-tight">
              {formatCurrency(totalPurchasesTax)}
            </div>
            <span className="text-[10px] text-rose-400 font-medium">
              خصم فوري معتمد من الفواتير
            </span>
          </div>
          <div className="w-12 h-12 bg-rose-50 rounded-2xl flex items-center justify-center text-rose-600 shadow-inner">
            <ArrowDownLeft className="w-6 h-6" />
          </div>
        </div>

        {/* Card 3: Net Tax */}
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm flex items-center justify-between transition-all hover:shadow-md">
          <div className="space-y-1">
            <span className="text-slate-500 font-semibold text-xs block">
              صافي الضريبة المحتسبة
            </span>
            <div
              className={`text-2xl font-extrabold tracking-tight ${netTaxTotal >= 0 ? "text-emerald-600" : "text-blue-600"}`}
            >
              {formatCurrency(netTaxTotal)}
            </div>
            <span className="text-[10px] text-slate-400 font-medium">
              سند الدفع النهائي للجهة
            </span>
          </div>
          <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600 shadow-inner">
            <Scale className="w-6 h-6" />
          </div>
        </div>

        {/* Card 4: Last Tax declaration info */}
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm flex items-center justify-between transition-all hover:shadow-md">
          <div className="space-y-1">
            <span className="text-slate-500 font-semibold text-xs block">
              آخر إقرار ضريبي
            </span>
            <div className="text-lg font-bold text-slate-800 tracking-tight">
              مارس - {selectedYear}
            </div>
            <div className="mt-1 inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 text-[10px] font-bold px-2 py-0.5 rounded-full">
              <Check className="w-2.5 h-2.5" />
              <span>مقدم ومقبول</span>
            </div>
          </div>
          <div className="w-12 h-12 bg-sky-50 rounded-2xl flex items-center justify-center text-sky-600 shadow-inner">
            <FileText className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Main Tabs switching VAT / Withholding / Declarations */}
      <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
        <div className="flex border-b border-slate-150 px-6 bg-slate-50/50">
          {[
            { id: "vat", label: "ضريبة القيمة المضافة" },
            { id: "withholding", label: "ضريبة الخصم والإضافة" },
            { id: "declarations", label: "الإقرارات الضريبية" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveSubTab(tab.id as any);
                setRowMenuOpenId(null);
              }}
              className={`py-4 px-5 font-bold text-sm border-b-2 transition-all relative ${activeSubTab === tab.id ? "border-emerald-600 text-emerald-600" : "border-transparent text-slate-400 hover:text-slate-600"}`}
            >
              {tab.label}
              {activeSubTab === tab.id && (
                <motion.div
                  layoutId="activeSubTaxTab"
                  className="absolute bottom-0 inset-x-0 h-0.5 bg-emerald-600"
                />
              )}
            </button>
          ))}
        </div>

        {/* Inner Content Grid Layout */}
        <div className="p-6">
          {activeSubTab === "vat" && (
            <div className="flex flex-col lg:flex-row gap-6">
              {/* Left Side: Table of VAT bills */}
              <div className="flex-1 overflow-x-auto min-w-0">
                <table className="w-full text-right text-sm text-slate-800 border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 text-slate-400 text-xs font-bold bg-slate-50/50 rounded-lg">
                      <th className="p-4 rounded-r-xl">#</th>
                      <th className="p-4">فترة الضريبة</th>
                      <th className="p-4">تاريخ البداية</th>
                      <th className="p-4">تاريخ النهاية</th>
                      <th className="p-4">ضريبة المبيعات [مخرجات]</th>
                      <th className="p-4">ضريبة المشتريات [مدخلات]</th>
                      <th className="p-4">صافي الضريبة</th>
                      <th className="p-4">الحالة</th>
                      <th className="p-4">تاريخ التقديم</th>
                      <th className="p-4 text-center rounded-l-xl">
                        الإجراءات
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredVatRecords.length === 0 ? (
                      <tr>
                        <td
                          colSpan={10}
                          className="p-8 text-center text-slate-400 font-semibold font-sans"
                        >
                          لا توجد بيانات ضرائب مسجلة لعام {selectedYear} حتى
                          الآن. انقر على "ضريبة جديدة" للإضافة.
                        </td>
                      </tr>
                    ) : (
                      filteredVatRecords.map((rec, idx) => (
                        <tr
                          key={rec.id}
                          onClick={() => {
                            setSelectedVatId(rec.id);
                            setRowMenuOpenId(null);
                          }}
                          className={`group border-b border-slate-100 hover:bg-slate-50/75 transition-all duration-150 cursor-pointer ${selectedVatId === rec.id ? "bg-emerald-50/30 font-semibold text-emerald-950" : ""}`}
                        >
                          <td className="p-4 text-slate-400 font-bold">
                            {idx + 1}
                          </td>
                          <td className="p-4">
                            <div className="font-bold text-slate-900 flex items-center gap-2">
                              <span>{rec.period}</span>
                            </div>
                          </td>
                          <td className="p-4 font-mono text-slate-500 text-xs">
                            {rec.startDate}
                          </td>
                          <td className="p-4 font-mono text-slate-500 text-xs">
                            {rec.endDate}
                          </td>
                          <td className="p-4 font-semibold text-slate-900">
                            {formatCurrency(rec.salesAmount)}
                          </td>
                          <td className="p-4 font-semibold text-rose-600">
                            {formatCurrency(rec.purchasesAmount)}
                          </td>
                          <td
                            className={`p-4 font-bold ${rec.netTax >= 0 ? "text-emerald-700" : "text-blue-700"}`}
                          >
                            {formatCurrency(rec.netTax)}
                          </td>
                          <td className="p-4">
                            {rec.status === "paid" && (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-100 text-emerald-800 text-xs font-bold rounded-full shadow-mini">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                                <span>مدفوع بالكامل</span>
                              </span>
                            )}
                            {rec.status === "submitted" && (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-100 text-blue-800 text-xs font-bold rounded-full shadow-mini">
                                <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                                <span>مقدم للجهة</span>
                              </span>
                            )}
                            {rec.status === "not_submitted" && (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-100 text-amber-800 text-xs font-bold rounded-full shadow-mini">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping"></span>
                                <span>لم يقدم بعد</span>
                              </span>
                            )}
                          </td>
                          <td className="p-4 font-mono text-slate-400 text-xs">
                            {rec.submissionDate || "-"}
                          </td>

                          {/* Actions Column with complete options dropdown menu */}
                          <td
                            className="p-4 relative"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                onClick={() => {
                                  setSelectedVatId(rec.id);
                                  setShowVatDetailsModal(true);
                                }}
                                className="p-1.5 hover:bg-white text-emerald-600 hover:text-emerald-700 border border-slate-100 hover:border-slate-200 rounded-lg transition-all shadow-mini"
                                title="عرض التفاصيل"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>

                              {/* Real download confirmation triggered directly */}
                              <button
                                onClick={() => {
                                  setExportRecordSelected(rec);
                                  setShowExportConfirmationModal(true);
                                }}
                                className="p-1.5 hover:bg-white text-indigo-600 hover:text-indigo-700 border border-slate-100 hover:border-slate-200 rounded-lg transition-all shadow-mini"
                                title="تنزيل الإقرار"
                              >
                                <Download className="w-3.5 h-3.5" />
                              </button>

                              {/* Option Dropdown trigger button */}
                              <div className="relative">
                                <button
                                  onClick={() =>
                                    setRowMenuOpenId(
                                      rowMenuOpenId === rec.id ? null : rec.id,
                                    )
                                  }
                                  className="p-1.5 hover:bg-white text-slate-500 hover:text-slate-800 border border-slate-150 hover:border-slate-250 rounded-lg transition-all shadow-mini"
                                  title="خيارات إضافية"
                                >
                                  <MoreVertical className="w-3.5 h-3.5" />
                                </button>

                                <AnimatePresence>
                                  {rowMenuOpenId === rec.id && (
                                    <>
                                      <div
                                        className="fixed inset-0 z-10"
                                        onClick={() => setRowMenuOpenId(null)}
                                      />
                                      <motion.div
                                        initial={{
                                          opacity: 0,
                                          scale: 0.95,
                                          y: -4,
                                        }}
                                        animate={{ opacity: 1, scale: 1, y: 0 }}
                                        exit={{
                                          opacity: 0,
                                          scale: 0.95,
                                          y: -4,
                                        }}
                                        className="absolute left-0 mt-1 w-44 bg-white border border-slate-200 rounded-xl shadow-xl z-20 overflow-hidden text-right"
                                        style={{ top: "100%" }}
                                      >
                                        <button
                                          onClick={() =>
                                            handleOpenEditVatModal(rec)
                                          }
                                          className="w-full text-right px-3.5 py-2 hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center gap-2 border-b border-slate-50"
                                        >
                                          <Edit3 className="w-3.5 h-3.5 text-indigo-500" />
                                          <span>تعديل السجل</span>
                                        </button>

                                        {/* Status Switch Options */}
                                        <button
                                          onClick={() =>
                                            handleChangeStatus(rec.id, "paid")
                                          }
                                          className="w-full text-right px-3.5 py-2 hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center gap-2"
                                        >
                                          <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                                          <span>تغيير لـ: مدفوع</span>
                                        </button>

                                        <button
                                          onClick={() =>
                                            handleChangeStatus(
                                              rec.id,
                                              "submitted",
                                            )
                                          }
                                          className="w-full text-right px-3.5 py-2 hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center gap-2"
                                        >
                                          <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                                          <span>تغيير لـ: مقدم للوزارة</span>
                                        </button>

                                        <button
                                          onClick={() =>
                                            handleChangeStatus(
                                              rec.id,
                                              "not_submitted",
                                            )
                                          }
                                          className="w-full text-right px-3.5 py-2 hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center gap-2 border-b border-slate-50"
                                        >
                                          <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                                          <span>تغيير لـ: مسودة</span>
                                        </button>

                                        {/* Real immediate TXT/CSV downloads */}
                                        <button
                                          onClick={() => {
                                            triggerRealDownload(rec, "csv");
                                            setRowMenuOpenId(null);
                                          }}
                                          className="w-full text-right px-3.5 py-2 hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center gap-2"
                                        >
                                          <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                                          <span>تحميل كـ Excel/CSV</span>
                                        </button>

                                        <button
                                          onClick={() => {
                                            triggerRealDownload(rec, "txt");
                                            setRowMenuOpenId(null);
                                          }}
                                          className="w-full text-right px-3.5 py-2 hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center gap-2 border-b border-slate-50"
                                        >
                                          <FileText className="w-3.5 h-3.5 text-slate-500" />
                                          <span>تحميل كـ نص TXT</span>
                                        </button>

                                        <button
                                          onClick={() =>
                                            handleDeleteRecord(rec.id)
                                          }
                                          className="w-full text-right px-3.5 py-2 hover:bg-rose-50 text-xs font-bold text-rose-600 flex items-center gap-2"
                                        >
                                          <Trash2 className="w-3.5 h-3.5 text-rose-650" />
                                          <span>حذف السجل</span>
                                        </button>
                                      </motion.div>
                                    </>
                                  )}
                                </AnimatePresence>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Right Side: Selected Period Details */}
              <div className="w-full lg:w-80 shrink-0 bg-slate-50/60 border border-slate-150 rounded-3xl p-6 space-y-6">
                <div>
                  <h3 className="text-base font-bold text-slate-900 border-b border-slate-200/60 pb-3">
                    تفاصيل الفترة المحددة ({selectedYear})
                  </h3>
                </div>

                {activeVat ? (
                  <>
                    <div className="space-y-4 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500 font-medium">الفترة:</span>
                        <span className="font-bold text-slate-900">
                          {activeVat.period}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500 font-medium">
                          تاريخ البداية:
                        </span>
                        <span className="font-mono text-slate-700">
                          {activeVat.startDate}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500 font-medium">
                          تاريخ النهاية:
                        </span>
                        <span className="font-mono text-slate-700">
                          {activeVat.endDate}
                        </span>
                      </div>
                      <div className="border-t border-slate-200/50 my-2"></div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500 font-medium">
                          ضريبة المبيعات [مخرجات]:
                        </span>
                        <span className="font-bold text-emerald-650 text-indigo-700">
                          {formatCurrency(activeVat.salesAmount)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500 font-medium">
                          ضريبة المشتريات [مدخلات]:
                        </span>
                        <span className="font-bold text-rose-600">
                          {formatCurrency(activeVat.purchasesAmount)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between border-t border-slate-200/80 pt-3">
                        <span className="font-bold text-slate-800">
                          صافي الضريبة:
                        </span>
                        <span
                          className={`text-base font-bold ${activeVat.netTax >= 0 ? "text-emerald-700" : "text-blue-700"}`}
                        >
                          {formatCurrency(activeVat.netTax)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500 font-medium">
                          حالة الإقرار:
                        </span>
                        <span>
                          {activeVat.status === "paid" && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-emerald-100 text-emerald-800 text-[11px] font-bold rounded-full">
                              مدفوع بالكامل
                            </span>
                          )}
                          {activeVat.status === "submitted" && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-blue-100 text-blue-800 text-[11px] font-bold rounded-full">
                              مقدم للجهة
                            </span>
                          )}
                          {activeVat.status === "not_submitted" && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-amber-100 text-amber-800 text-[11px] font-bold rounded-full animate-pulse">
                              لم يقدم بعد
                            </span>
                          )}
                        </span>
                      </div>
                    </div>

                    <div className="pt-2">
                      <button
                        onClick={() => {
                          if (activeVat.status === "not_submitted") {
                            // Mark as submitted
                            const updated = vatRecords.map((r) =>
                              r.id === activeVat.id
                                ? {
                                    ...r,
                                    status: "submitted" as const,
                                    submissionDate: new Date().toLocaleDateString(
                                      "en-GB",
                                    ),
                                  }
                                : r,
                            );
                            setVatRecords(updated);
                            alert(
                              "تم تقديم الإقرار الضريبي بنجاح إلى مصلحة الضرائب لـ " +
                                activeVat.period +
                                "!",
                            );
                          } else if (activeVat.status === "submitted") {
                            // Mark as paid
                            const updated = vatRecords.map((r) =>
                              r.id === activeVat.id
                                ? { ...r, status: "paid" as const }
                                : r,
                            );
                            setVatRecords(updated);
                            alert(
                              "تم إثبات كشف سداد الحوالة البنكية وتصفير الالتزام الضريبي بنجاح!",
                            );
                          } else {
                            // View details
                            setShowVatDetailsModal(true);
                          }
                        }}
                        className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-4 rounded-2xl shadow-md shadow-indigo-600/10 text-center transition-all text-xs"
                      >
                        {activeVat.status === "not_submitted" &&
                          "تقديم الإقرار الضريبي الآن"}
                        {activeVat.status === "submitted" &&
                          "تسجيل سداد الضريبة المباشر"}
                        {activeVat.status === "paid" &&
                          "عرض وتصدير مستند الإقرار الموصوف"}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="py-12 text-center text-slate-400 text-xs font-semibold">
                    لا يوجد إقرار محدد لعرض التفاصيل
                  </div>
                )}
              </div>
            </div>
          )}

          {activeSubTab === "withholding" && (
            <div className="space-y-4">
              <div className="overflow-x-auto">
                <table className="w-full text-right text-sm text-slate-800 border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 text-slate-400 text-xs font-bold bg-slate-50/50 rounded-lg">
                      <th className="p-4 rounded-r-xl">#</th>
                      <th className="p-4">اسم المورد / الجهة الشريكة</th>
                      <th className="p-4">الرقم الضريبي للمتعامل</th>
                      <th className="p-4">قيمة المعاملة الكلية</th>
                      <th className="p-4 text-center">نسبة الخصم المقررة</th>
                      <th className="p-4">
                        المبلغ المخصوم / المستقطع بالتوريد
                      </th>
                      <th className="p-4">تاريخ العملية</th>
                      <th className="p-4 text-left rounded-l-xl">الحالة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {withholdingRecords
                      .filter(
                        (r) =>
                          searchQuery === "" ||
                          r.entityName.includes(searchQuery),
                      ).length === 0 ? (
                      <tr>
                        <td
                          colSpan={8}
                          className="p-8 text-center text-slate-400 font-semibold"
                        >
                          لا توجد سجلات لضريبة الخصم والإضافة مسجلة حتى الآن
                        </td>
                      </tr>
                    ) : (
                      withholdingRecords
                        .filter(
                          (r) =>
                            searchQuery === "" ||
                            r.entityName.includes(searchQuery),
                        )
                        .map((rec, idx) => (
                        <tr
                          key={rec.id}
                          className="border-b border-slate-50 hover:bg-slate-50/50 transition-all"
                        >
                          <td className="p-4 text-slate-400 font-bold">
                            {idx + 1}
                          </td>
                          <td className="p-4 font-bold text-slate-900">
                            {rec.entityName}
                          </td>
                          <td className="p-4 font-mono text-slate-500 text-sm">
                            {rec.taxNumber}
                          </td>
                          <td className="p-4 font-semibold text-slate-900">
                            {formatCurrency(rec.transactionAmount)}
                          </td>
                          <td className="p-4 font-black text-indigo-600 text-center">
                            {rec.rate}%
                          </td>
                          <td className="p-4 font-bold text-amber-750 text-indigo-900">
                            {formatCurrency(rec.withheldAmount)}
                          </td>
                          <td className="p-4 font-mono text-slate-500 text-xs">
                            {rec.date}
                          </td>
                          <td className="p-4 text-left">
                            {rec.status === "collected" ? (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-100 text-emerald-800 text-xs font-bold rounded-full">
                                <Check className="w-3 h-3" />
                                <span>تم السداد والتوريد</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-100 text-amber-800 text-xs font-bold rounded-full">
                                <Clock className="w-3 h-3" />
                                <span>معلق بالتسوية الرعوية</span>
                              </span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeSubTab === "declarations" && (
            <div className="space-y-4">
              <div className="overflow-x-auto">
                <table className="w-full text-right text-sm text-slate-800 border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 text-slate-400 text-xs font-bold bg-slate-50/50 rounded-lg">
                      <th className="p-4 rounded-r-xl">#</th>
                      <th className="p-4">الرقم المرجعي المالي</th>
                      <th className="p-4">نوع الإقرار</th>
                      <th className="p-4">الفترة الضريبية</th>
                      <th className="p-4">تاريخ تقديم الإقرار</th>
                      <th className="p-4">المبلغ المستحق للدفع</th>
                      <th className="p-4">المبلغ المسدد بالفعل</th>
                      <th className="p-4 text-left rounded-l-xl">
                        حالة السداد والاعتماد
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {declarations
                      .filter(
                        (r) =>
                          searchQuery === "" ||
                          r.type.includes(searchQuery) ||
                          r.period.includes(searchQuery),
                      ).length === 0 ? (
                      <tr>
                        <td
                          colSpan={8}
                          className="p-8 text-center text-slate-400 font-semibold"
                        >
                          لا توجد إقرارات ضريبية مسجلة حتى الآن
                        </td>
                      </tr>
                    ) : (
                      declarations
                        .filter(
                          (r) =>
                            searchQuery === "" ||
                            r.type.includes(searchQuery) ||
                            r.period.includes(searchQuery),
                        )
                        .map((rec, idx) => (
                        <tr
                          key={rec.id}
                          className="border-b border-slate-50 hover:bg-slate-50/50 transition-all"
                        >
                          <td className="p-4 text-slate-400 font-bold">
                            {idx + 1}
                          </td>
                          <td className="p-4 font-mono font-bold text-slate-900 text-xs">
                            {rec.referenceNumber}
                          </td>
                          <td className="p-4 font-medium text-slate-800">
                            {rec.type}
                          </td>
                          <td className="p-4">{rec.period}</td>
                          <td className="p-4 font-mono text-slate-500 text-xs">
                            {rec.submissionDate}
                          </td>
                          <td className="p-4 font-bold text-slate-900">
                            {formatCurrency(rec.totalAmount)}
                          </td>
                          <td className="p-4 font-bold text-emerald-700">
                            {formatCurrency(rec.paidAmount)}
                          </td>
                          <td className="p-4 text-left">
                            {rec.paymentStatus === "fully_paid" && (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-100 text-emerald-800 text-xs font-bold rounded-full">
                                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                <span>مسدد بالكامل ومطابق</span>
                              </span>
                            )}
                            {rec.paymentStatus === "partially_paid" && (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-100 text-amber-800 text-xs font-bold rounded-full">
                                <AlertTriangle className="w-3 h-3 text-amber-600" />
                                <span>مسدد جزئياً</span>
                              </span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* MODAL 1: Add Tax/VAT Declaration Modal */}
      <AnimatePresence>
        {showAddVatModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeAddVatModal}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative bg-white border border-slate-200 rounded-[2rem] w-full max-w-xl overflow-hidden shadow-2xl z-50"
            >
              <form onSubmit={handleAddVat}>
                <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">
                      إضافة فترة ضريبية لـ {selectedYear}
                    </h2>
                    <p className="text-xs text-slate-500 mt-1">
                      تسجيل مخرجات ومدخلات الضريبة لشهر مالي جديد لتسويتها
                      قانونياً
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={closeAddVatModal}
                    className="p-2 hover:bg-slate-100 rounded-xl text-slate-400"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="p-6 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-2">
                        شهر الفترة الضريبية
                      </label>
                      <select
                        value={newPeriodMonth}
                        onChange={(e) => setNewPeriodMonth(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 bg-white font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                      >
                        {[
                          "يناير",
                          "فبراير",
                          "مارس",
                          "أبريل",
                          "مايو",
                          "يونيو",
                          "يوليو",
                          "أغسطس",
                          "سبتمبر",
                          "أكتوبر",
                          "نوفمبر",
                          "ديسمبر",
                        ].map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-2">
                        السنة المالية الجارية
                      </label>
                      <select
                        value={newPeriodYear}
                        onChange={(e) => setNewPeriodYear(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 bg-white font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                      >
                        {["2026", "2025", "2024"].map((y) => (
                          <option key={y} value={y}>
                            {y}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-2">
                        تاريخ البداية بالفترة
                      </label>
                      <input
                        type="date"
                        required
                        value={newStartDate}
                        onChange={(e) => setNewStartDate(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-2">
                        تاريخ النهاية بالفترة
                      </label>
                      <input
                        type="date"
                        required
                        value={newEndDate}
                        onChange={(e) => setNewEndDate(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono text-sm"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">
                        ضريبة المبيعات [الخارجة] (ج.م)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        required
                        placeholder="0.00"
                        value={newSalesAmount}
                        onChange={(e) => setNewSalesAmount(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-bold text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">
                        ضريبة المشتريات [الداخلة] (ج.م)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        required
                        placeholder="0.00"
                        value={newPurchasesAmount}
                        onChange={(e) => setNewPurchasesAmount(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-bold text-sm"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-2">
                      ملاحظات توضيحية للإدارة والتدقيق
                    </label>
                    <textarea
                      placeholder="امثلة: أسباب إضافية لضريبة أو تفاصيل الفواتير المعلقة في هذا الشهر..."
                      value={newNotes}
                      onChange={(e) => setNewNotes(e.target.value)}
                      rows={3}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                    />
                  </div>
                </div>

                <div className="p-6 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={closeAddVatModal}
                    className="border border-slate-200 hover:bg-slate-100 text-slate-700 px-5 py-2.5 rounded-xl font-bold transition-all text-xs"
                  >
                    إلغاء الأمر
                  </button>
                  <button
                    type="submit"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-xl font-bold transition-all shadow-md shadow-emerald-600/10 text-xs"
                  >
                    حفظ الفاتورة الضريبية
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL 2: Edit VAT Modal */}
      <AnimatePresence>
        {showEditVatModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setShowEditVatModal(false);
                setEditingRecord(null);
              }}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative bg-white border border-slate-200 rounded-[2rem] w-full max-w-xl overflow-hidden shadow-2xl z-50"
            >
              <form onSubmit={handleEditVat}>
                <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">
                      تعديل سجل ضريبة القيمة المضافة
                    </h2>
                    <p className="text-xs text-slate-500 mt-1">
                      تحديث المدخلات والمخرجات للفترة:{" "}
                      <strong className="text-indigo-600">
                        {editingRecord?.period}
                      </strong>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowEditVatModal(false);
                      setEditingRecord(null);
                    }}
                    className="p-2 hover:bg-slate-100 rounded-xl text-slate-400"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="p-6 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-2">
                        شهر الفترة الضريبية
                      </label>
                      <select
                        value={newPeriodMonth}
                        onChange={(e) => setNewPeriodMonth(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 bg-white font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                      >
                        {[
                          "يناير",
                          "فبراير",
                          "مارس",
                          "أبريل",
                          "مايو",
                          "يونيو",
                          "يوليو",
                          "أغسطس",
                          "سبتمبر",
                          "أكتوبر",
                          "نوفمبر",
                          "ديسمبر",
                        ].map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-2">
                        السنة المالية
                      </label>
                      <select
                        value={newPeriodYear}
                        onChange={(e) => setNewPeriodYear(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 bg-white font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                      >
                        {["2026", "2025", "2024"].map((y) => (
                          <option key={y} value={y}>
                            {y}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-2">
                        تاريخ البداية
                      </label>
                      <input
                        type="date"
                        required
                        value={newStartDate}
                        onChange={(e) => setNewStartDate(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-2">
                        تاريخ النهاية
                      </label>
                      <input
                        type="date"
                        required
                        value={newEndDate}
                        onChange={(e) => setNewEndDate(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono text-sm"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">
                        ضريبة المبيعات [مخرجات] (ج.م)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        required
                        value={newSalesAmount}
                        onChange={(e) => setNewSalesAmount(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-bold text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">
                        ضريبة المشتريات [مدخلات] (ج.م)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        required
                        value={newPurchasesAmount}
                        onChange={(e) => setNewPurchasesAmount(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-bold text-sm"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-2">
                      ملاحظات المراجعة
                    </label>
                    <textarea
                      value={newNotes}
                      onChange={(e) => setNewNotes(e.target.value)}
                      rows={3}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                    />
                  </div>
                </div>

                <div className="p-6 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setShowEditVatModal(false);
                      setEditingRecord(null);
                    }}
                    className="border border-slate-200 hover:bg-slate-100 text-slate-700 px-5 py-2.5 rounded-xl font-bold transition-all text-xs"
                  >
                    إلغاء الأمر
                  </button>
                  <button
                    type="submit"
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl font-bold transition-all shadow-md shadow-indigo-600/10 text-xs"
                  >
                    تحديث السجل الضريبي
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL 3: View VAT Details Modal */}
      <AnimatePresence>
        {showVatDetailsModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowVatDetailsModal(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative bg-white border border-slate-200 rounded-[2.5rem] w-full max-w-2xl overflow-hidden shadow-2xl z-50 p-8"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                    <Receipt className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-slate-950">
                      تفاصيل إقرار ضريبة القيمة المضافة
                    </h2>
                    <p className="text-xs text-slate-400 mt-1">
                      توليد تقرير رسمي جاهز للتسليم مع هيئة مصلحة الضرائب
                      المصرية الموقرة
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowVatDetailsModal(false)}
                  className="p-2 hover:bg-slate-50 border border-slate-100 rounded-xl text-slate-400 hover:text-slate-600 transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Modal Body */}
              <div className="py-6 space-y-6">
                {/* Header Information Grid */}
                <div className="grid grid-cols-3 gap-4 bg-slate-50/50 border border-slate-100 rounded-2xl p-4 text-center">
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold block mb-1">
                      الفترة الضريبية للقرارات
                    </span>
                    <span className="text-sm font-bold text-slate-900">
                      {activeVat.period}
                    </span>
                  </div>
                  <div className="border-x border-slate-200">
                    <span className="text-[10px] text-slate-400 font-bold block mb-1">
                      المدى والتغطية الزمنية
                    </span>
                    <span className="text-xs font-semibold text-slate-700 font-mono block">
                      {activeVat.startDate}
                    </span>
                    <span className="text-xs font-semibold text-slate-700 font-mono block">
                      إلى {activeVat.endDate}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold block mb-1">
                      الحالة الإحصائية
                    </span>
                    <div className="mt-1">
                      {activeVat.status === "paid" && (
                        <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                          مغلق ومسدد بالكامل
                        </span>
                      )}
                      {activeVat.status === "submitted" && (
                        <span className="bg-blue-100 text-blue-800 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                          تم التقديم والمصادقة
                        </span>
                      )}
                      {activeVat.status === "not_submitted" && (
                        <span className="bg-amber-100 text-amber-800 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                          قيد التحرير والمراجعة
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Financial Details Table */}
                <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-mini">
                  <div className="grid grid-cols-2 bg-slate-100/50 border-b border-slate-200 p-3.5 text-xs font-bold text-slate-500">
                    <span>بيان الحساب التفصيلي</span>
                    <span className="text-left">القيمة المقدرة</span>
                  </div>
                  <div className="divide-y divide-slate-100 text-sm">
                    <div className="grid grid-cols-2 p-3.5 items-center">
                      <span className="font-medium text-slate-600">
                        (+) قيمة ضريبة المبيعات المحتسبة بالكامل [مخرجات]
                      </span>
                      <span className="text-left font-semibold text-slate-900">
                        {formatCurrency(activeVat.salesAmount)}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 p-3.5 items-center">
                      <span className="font-medium text-slate-600">
                        (-) قيمة ضريبة المشتريات المخصومة قانوناً [مدخلات]
                      </span>
                      <span className="text-left font-semibold text-rose-600">
                        {formatCurrency(activeVat.purchasesAmount)}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 p-3.5 items-center bg-emerald-50/20">
                      <span className="font-bold text-emerald-950">
                        (=) صافي ضريبة القيمة المضافة المستحقة للمصلحة
                      </span>
                      <span className="text-left font-bold text-emerald-700 text-base">
                        {formatCurrency(activeVat.netTax)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Notes */}
                {activeVat.notes && (
                  <div className="flex gap-2.5 bg-slate-50/50 border border-slate-150 rounded-2xl p-4">
                    <AlertCircle className="w-5 h-5 text-slate-450 shrink-0 mt-0.5 text-indigo-500" />
                    <div>
                      <span className="text-xs font-bold text-slate-500 block">
                        ملاحظات المعاينة الداخلية
                      </span>
                      <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                        {activeVat.notes}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="border-t border-slate-100 pt-5 flex justify-between gap-3">
                <button
                  onClick={() => {
                    // Actual browser print call or beautiful mock success printer message since this runs in sandbox iframe!
                    window.print();
                  }}
                  className="flex items-center gap-1.5 border border-slate-200 hover:bg-slate-50 text-slate-700 px-4 py-2.5 rounded-xl font-bold transition-all text-xs"
                >
                  <Printer className="w-4 h-4 text-slate-400" />
                  <span>طباعة المستند الحالي</span>
                </button>

                <div className="flex gap-3">
                  <button
                    onClick={() => setShowVatDetailsModal(false)}
                    className="border border-slate-200 hover:bg-slate-50 text-slate-700 px-5 py-2.5 rounded-xl font-bold transition-all text-xs"
                  >
                    إغلاق النافذة
                  </button>
                  {activeVat.status === "not_submitted" && (
                    <button
                      onClick={() => {
                        const updated = vatRecords.map((r) =>
                          r.id === activeVat.id
                            ? {
                                ...r,
                                status: "submitted" as const,
                                submissionDate: new Date().toLocaleDateString(
                                  "en-GB",
                                ),
                              }
                            : r,
                        );
                        setVatRecords(updated);
                        setShowVatDetailsModal(false);
                        alert(
                          "تم تسليم المستند لمصلحة الضرائب المصرية الموقرة!",
                        );
                      }}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-xl font-bold transition-all text-xs shadow-md shadow-emerald-500/10"
                    >
                      تقديم إلى المصلحة
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL 4: Full Official Tax Declaration Form Preview "الإقرار الضريبي" */}
      <AnimatePresence>
        {showOfficialDeclarationModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowOfficialDeclarationModal(false)}
              className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 15 }}
              className="relative bg-white border border-slate-200 rounded-[2rem] w-full max-w-3xl overflow-hidden shadow-2xl z-50 p-6 md:p-8 my-6"
            >
              {/* Report Header */}
              <div className="flex flex-col md:flex-row items-center justify-between border-b-4 border-slate-900 pb-5 gap-4">
                <div className="text-center md:text-right space-y-1">
                  <h1 className="text-lg font-black text-slate-900 flex items-center gap-2">
                    <Building className="w-5 h-5 text-indigo-600" />
                    <span>جمهورية مصر العربية</span>
                  </h1>
                  <h2 className="text-sm font-bold text-slate-750">
                    وزارة المالية - مصلحة الضرائب المصرية
                  </h2>
                  <p className="text-xs text-slate-500">
                    إقرار نموذج (10) ضريبة القيمة المضافة لسنة {selectedYear}
                  </p>
                </div>

                {/* Visual Seal Emblem replacement */}
                <div className="w-20 h-20 border-2 border-double border-slate-450 rounded-full flex flex-col items-center justify-center text-center p-2 bg-amber-50/10 shrink-0">
                  <span className="text-[9px] font-black text-slate-800">
                    مصلحة الضرائب
                  </span>
                  <Percent
                    className="w-5 h-5 text-amber-600 my-0.5 animate-spin"
                    style={{ animationDuration: "6s" }}
                  />
                  <span className="text-[8px] font-bold text-slate-500">
                    شعبة الفحص
                  </span>
                </div>

                <div className="text-center md:text-left space-y-1">
                  <p className="text-xs font-semibold text-slate-600">
                    تاريخ المعالجة:{" "}
                    <strong className="font-mono text-slate-900">
                      {new Date().toLocaleDateString("ar-EG")}
                    </strong>
                  </p>
                  <p className="text-xs font-semibold text-slate-600">
                    الرقم العام للتسجيل:{" "}
                    <strong className="font-mono text-slate-900">
                      182-938-121
                    </strong>
                  </p>
                  <div className="bg-slate-100 px-3 py-1 rounded-lg text-[10px] font-black text-slate-800 inline-block">
                    نسخة مراجعة معتمدة
                  </div>
                </div>
              </div>

              {/* Form Content */}
              <div className="py-6 space-y-6 max-h-[50vh] overflow-y-auto pr-2">
                <div className="space-y-4">
                  <h3 className="text-sm font-black text-indigo-700 border-r-4 border-indigo-600 pr-2">
                    أولاً: بيانات المسجل الأساسية
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 rounded-2xl p-4 text-xs font-semibold text-slate-700">
                    <div>
                      اسم المنشأة:{" "}
                      <strong className="text-slate-950 font-bold">
                        ريستو ماستر برو للأغذية والمشروبات (الزقازيق الرئيسي)
                      </strong>
                    </div>
                    <div>
                      عنوان المراسلة:{" "}
                      <strong className="text-slate-950 font-bold">
                        الشرقية، الزقازيق - الشارع التجاري
                      </strong>
                    </div>
                    <div>
                      المأمورية المختصة:{" "}
                      <strong className="text-slate-950 font-bold">
                        ضرائب مأمورية أول الزقازيق
                      </strong>
                    </div>
                    <div>
                      الفترة المشمولة بالاعتماد:{" "}
                      <strong className="text-slate-950 font-bold">
                        الربع السنوي لعام {selectedYear}
                      </strong>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <h3 className="text-sm font-black text-indigo-700 border-r-4 border-indigo-600 pr-2">
                    ثانياً: جدول المخرجات والمدخلات المحقق بالفترة
                  </h3>
                  <div className="border border-slate-200 rounded-xl overflow-hidden text-xs">
                    <div className="grid grid-cols-3 bg-slate-100 p-2.5 font-bold text-slate-800">
                      <span>البيان ونوع السلعة/الخدمة</span>
                      <span className="text-left">وعاء الخضوع للضريبة</span>
                      <span className="text-left">
                        الضريبة المترتبة المستحقة
                      </span>
                    </div>
                    <div className="divide-y divide-slate-100">
                      <div className="grid grid-cols-3 p-2.5">
                        <span className="text-slate-600 font-medium">
                          مبيعات سلع محلية الصنع (14%)
                        </span>
                        <span className="text-left font-semibold text-slate-900 font-mono">
                          {Number(totalSalesTax * 7 || 0).toLocaleString("en-US")} ج.م
                        </span>
                        <span className="text-left font-bold text-emerald-700 font-mono">
                          {Number(totalSalesTax || 0).toLocaleString("en-US")} ج.م
                        </span>
                      </div>
                      <div className="grid grid-cols-3 p-2.5">
                        <span className="text-slate-600 font-medium">
                          مشتريات خاضعة للخصم المباشر (14%)
                        </span>
                        <span className="text-left font-semibold text-slate-900 font-mono">
                          {Number(totalPurchasesTax * 7 || 0).toLocaleString("en-US")} ج.م
                        </span>
                        <span className="text-left font-bold text-rose-600 font-mono">
                          {Number(totalPurchasesTax || 0).toLocaleString("en-US")} ج.م
                        </span>
                      </div>
                      <div className="grid grid-cols-3 p-2.5 bg-indigo-50/50 font-bold text-slate-900">
                        <span className="text-indigo-950 font-black">
                          إجمالي الفروق المحتسبة لصالح المصلحة
                        </span>
                        <span className="text-left font-mono">-</span>
                        <span className="text-left text-indigo-700 font-mono">
                          {Number(netTaxTotal || 0).toLocaleString("en-US")} ج.م
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-amber-50/60 border border-amber-200 rounded-2xl p-4 text-xs font-semibold text-amber-900 flex gap-2">
                  <AlertCircle className="w-5 h-5 shrink-0 text-amber-600 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-extrabold text-sm text-amber-950">
                      إقرار وتعهد قانوني:
                    </p>
                    <p className="leading-relaxed">
                      نقر نحن مراجع حسابات شركة "ريستو ماستر برو" بأن كافة
                      البيانات والأرقام الواردة في هذا الإقرار صحيحة وحقيقية
                      ومستخرجة فعلياً من دفاتر الشركة المحاسبية المعتمدة للنشاط
                      التجاري وفقاً لمعايير المحاسبة المصرية والمادة القانونية
                      رقم 67 لعام 2016 لضريبة القيمة المضافة.
                    </p>
                  </div>
                </div>

                {/* Director Signatures */}
                <div className="grid grid-cols-2 gap-6 pt-5 text-xs text-slate-500 border-t border-slate-100">
                  <div className="space-y-4 text-center border-l border-slate-100">
                    <span className="font-bold text-slate-800 block mb-2">
                      توقيع المدير المالي للشركة ووظيفته
                    </span>
                    <div className="h-10 border border-slate-200/50 rounded-xl bg-slate-50/50 w-44 mx-auto flex items-center justify-center font-serif text-slate-400 text-xs shadow-inner select-none pointer-events-none">
                      ( El-HOSARY ACCOUNT )
                    </div>
                    <span className="text-[10px] text-slate-400 block">
                      التاريخ: {new Date().toLocaleDateString("ar-EG")}
                    </span>
                  </div>
                  <div className="space-y-4 text-center">
                    <span className="font-bold text-slate-800 block mb-2">
                      اعتماد المحاسب المالي القانوني المعتمد
                    </span>
                    <div className="h-10 border border-slate-200/50 rounded-xl bg-slate-50/50 w-44 mx-auto flex items-center justify-center font-mono text-slate-300 text-[10px] shadow-inner select-none pointer-events-none">
                      APPROVED STAMP - #382901
                    </div>
                    <span className="text-[10px] text-slate-400 block">
                      الترخيص رقم: ٣٨٩ / مصلحة الضرائب
                    </span>
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="border-t border-slate-100 pt-5 flex flex-wrap justify-between items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    const csvContent =
                      "\uFEFF" +
                      `جمهورية مصر العربية - مصلحة الضرائب المصرية\nالشركة: ريستو ماستر الأصلي\nسنة الإقرار: ${selectedYear}\nإجمالي المبيعات،${(totalSalesTax * 7).toFixed(2)}\nضريبة المخرجات،${totalSalesTax.toFixed(2)}\nإجمالي المدخلات المشتراة،${(totalPurchasesTax * 7).toFixed(2)}\nضريبة المدخلات،${totalPurchasesTax.toFixed(2)}\nصافي ضريبة القيمة المضافة المطلوبة،${netTaxTotal.toFixed(2)}`;
                    const blob = new Blob([csvContent], {
                      type: "text/csv;charset=utf-8;",
                    });
                    const link = document.createElement("a");
                    link.href = URL.createObjectURL(blob);
                    link.download = `إقرار_رسمي_مستخرج_${selectedYear}.csv`;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    alert(
                      "تم استيراد نسخة إكسل من الإقرار الضريبي الرسمي بنجاح!",
                    );
                  }}
                  className="bg-emerald-650 text-emerald-800 bg-emerald-50 hover:bg-emerald-100 px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-mini border border-emerald-100"
                >
                  <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                  <span>تصدير كـ Excel</span>
                </button>

                <div className="flex gap-3">
                  <button
                    onClick={() => setShowOfficialDeclarationModal(false)}
                    className="border border-slate-200 hover:bg-slate-50 text-slate-700 px-5 py-2.5 rounded-xl font-bold transition-all text-xs"
                  >
                    إغلاق المعاينة
                  </button>
                  <button
                    onClick={() => {
                      alert(
                        "تم ربط وإرسال الإقرار الضريبي لعام " +
                          selectedYear +
                          " إلكترونياً من خلال منظومة الفاتورة الضريبية الموحدة لوزارة المالية ويجري فحص الملف حالياً.",
                      );
                      setShowOfficialDeclarationModal(false);
                    }}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-xl font-bold transition-all text-xs shadow-md shadow-emerald-500/10 flex items-center gap-1.5"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>تقديم الإقرار رسمياً الآن</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL 5: Tax Analytics Report Modal "تقرير ضريبي" */}
      <AnimatePresence>
        {showTaxReportModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowTaxReportModal(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative bg-white border border-slate-200 rounded-[2.5rem] w-full max-w-2xl overflow-hidden shadow-2xl z-50 p-8"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                    <Percent className="w-5 h-5 animate-pulse" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-slate-950">
                      التحليل الإحصائي والتقرير الضريبي الذكي
                    </h2>
                    <p className="text-xs text-slate-400 mt-1">
                      تتبع مؤشرات ونسب الضرائب المدفوعة والمستحقة لعام{" "}
                      {selectedYear}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowTaxReportModal(false)}
                  className="p-2 hover:bg-slate-50 border border-slate-100 rounded-xl text-slate-400 hover:text-slate-600 transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Analytics Body */}
              <div className="py-6 space-y-6">
                {/* Visual Analytics Grid mimicking bento */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-gradient-to-br from-indigo-50/50 to-indigo-100/30 border border-indigo-100 rounded-2xl p-5 space-y-3 shadow-mini">
                    <span className="text-xs font-bold text-indigo-950 block">
                      معدل عبء الضريبة المضافة
                    </span>
                    <div className="flex items-center gap-3">
                      <div className="text-3xl font-black text-slate-900 tracking-tight">
                        {totalSalesTax > 0
                          ? ((netTaxTotal / totalSalesTax) * 100).toFixed(1)
                          : 0}
                        %
                      </div>
                      <span className="text-[10px] bg-indigo-100 text-indigo-800 rounded-full px-2 py-0.5 font-bold">
                        من إجمالي المخرجات
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 leading-normal">
                      يمثل نسبة الخالص الواجب تحويله لهيئة الضرائب بعد خصم كامل
                      فواتير المشتريات والمدخلات المقبولة بالترخيص المحاسبي.
                    </p>
                  </div>

                  <div className="bg-gradient-to-br from-rose-50/50 to-rose-100/30 border border-rose-100 rounded-2xl p-5 space-y-3 shadow-mini">
                    <span className="text-xs font-bold text-rose-950 block">
                      معدل الخصم والمدخلات الكلية
                    </span>
                    <div className="flex items-center gap-3">
                      <div className="text-3xl font-black text-rose-650 text-rose-800 tracking-tight">
                        {totalSalesTax > 0
                          ? ((totalPurchasesTax / totalSalesTax) * 100).toFixed(
                              1,
                            )
                          : 0}
                        %
                      </div>
                      <span className="text-[10px] bg-rose-100 text-rose-800 rounded-full px-2 py-0.5 font-bold">
                        نسبة التخفيض المعتمد
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 leading-normal">
                      مستوى السلع والموارد المستوردة والمحلية التي قامت الشركة
                      بخصم ضريبتها لتقليص الأثر المالي لضريبة المخرجات على
                      الأرباح.
                    </p>
                  </div>
                </div>

                {/* Progress Indicators of Quarterly Targets */}
                <div className="space-y-3">
                  <span className="text-xs font-bold text-slate-700 block">
                    خطوات التصفية والتقدم للربع السنوي المقارن
                  </span>
                  <div className="space-y-2.5">
                    {/* Q1 progress bar replacement with motion animation */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs font-semibold text-slate-500">
                        <span>الربع الأول (تمت تصفية كامل الملفات)</span>
                        <span className="text-emerald-700 font-bold">100%</span>
                      </div>
                      <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                        <div
                          className="bg-emerald-500 h-full rounded-full transition-all duration-1000"
                          style={{ width: "100%" }}
                        ></div>
                      </div>
                    </div>

                    {/* Q2 progress bar */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs font-semibold text-slate-500">
                        <span>الربع الثاني (جاري تسويات شهر يونيو الجاري)</span>
                        <span className="text-indigo-600 font-bold">67%</span>
                      </div>
                      <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                        <div
                          className="bg-indigo-600 h-full rounded-full transition-all duration-1000"
                          style={{ width: "67%" }}
                        ></div>
                      </div>
                    </div>

                    {/* Q3 progress bar */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs font-semibold text-slate-500">
                        <span>الربع الثالث (تحضير جاري لملفات الاستيراد)</span>
                        <span className="text-slate-400 font-bold">0%</span>
                      </div>
                      <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                        <div
                          className="bg-slate-300 h-full rounded-full font-bold"
                          style={{ width: "0%" }}
                        ></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="border-t border-slate-100 pt-5 flex justify-between gap-3">
                <button
                  onClick={downloadFullTaxReport}
                  className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl font-bold transition-all text-xs shadow-md shadow-indigo-650/10"
                >
                  <Download className="w-4 h-4 text-white" />
                  <span>تحميل التقرير الشامل (.csv)</span>
                </button>

                <button
                  onClick={() => setShowTaxReportModal(false)}
                  className="border border-slate-200 hover:bg-slate-50 text-slate-700 px-5 py-2.5 rounded-xl font-bold transition-all text-xs"
                >
                  إغلاق نافذة المؤشرات
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL 6: Single Record Export Confirmation Modal "تنزيل" */}
      <AnimatePresence>
        {showExportConfirmationModal && exportRecordSelected && (
          <div className="fixed inset-0 z-55 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setShowExportConfirmationModal(false);
                setExportRecordSelected(null);
              }}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative bg-white border border-slate-200 rounded-[2rem] w-full max-w-md overflow-hidden shadow-2xl z-50 p-6"
            >
              <div className="text-center space-y-4">
                <div className="w-12 h-12 rounded-full bg-indigo-50 border border-indigo-150 text-indigo-650 flex items-center justify-center mx-auto mb-2 text-indigo-600">
                  <Download className="w-6 h-6 animate-bounce" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-lg font-bold text-slate-900">
                    تنزيل و تصدير الملف الضريبي
                  </h3>
                  <p className="text-xs text-slate-500 leading-normal">
                    لقد اخترت تصدير تفاصيل إقرار القيمة المضافة للفترة{" "}
                    <strong className="text-indigo-600 font-bold block mt-1">
                      {exportRecordSelected.period}
                    </strong>
                  </p>
                </div>

                <div className="border-t border-slate-100 my-4 pt-4 text-xs font-semibold text-slate-600 space-y-2">
                  <div className="flex justify-between">
                    <span>مخرجات المبيعات بالفترة:</span>
                    <span className="text-slate-900 font-bold font-mono">
                      {Number(exportRecordSelected.salesAmount || 0 || 0).toLocaleString("en-US")}{" "}
                      ج.م
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>مدخلات المشتريات بالفترة:</span>
                    <span className="text-slate-900 font-bold font-mono">
                      {Number(exportRecordSelected.purchasesAmount || 0 || 0).toLocaleString(
                        "en-US",
                      )}{" "}
                      ج.م
                    </span>
                  </div>
                  <div className="flex justify-between text-indigo-600 font-bold pt-1 border-t border-slate-50">
                    <span>صافي القيمة المستحقة:</span>
                    <span className="font-mono">
                      {Number(exportRecordSelected.netTax || 0 || 0).toLocaleString("en-US")} ج.م
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-3">
                  <button
                    onClick={() =>
                      triggerRealDownload(exportRecordSelected, "csv")
                    }
                    className="flex flex-col items-center gap-1.5 p-3 hover:bg-slate-50 border border-slate-200 rounded-2xl transition-all"
                  >
                    <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
                    <span className="text-[10px] font-bold text-slate-700">
                      شيت Excel
                    </span>
                  </button>

                  <button
                    onClick={() =>
                      triggerRealDownload(exportRecordSelected, "txt")
                    }
                    className="flex flex-col items-center gap-1.5 p-3 hover:bg-slate-50 border border-slate-200 rounded-2xl transition-all"
                  >
                    <FileText className="w-5 h-5 text-indigo-600" />
                    <span className="text-[10px] font-bold text-slate-700">
                      مستند نصي
                    </span>
                  </button>

                  <button
                    onClick={() =>
                      triggerRealDownload(exportRecordSelected, "json")
                    }
                    className="flex flex-col items-center gap-1.5 p-3 hover:bg-slate-50 border border-slate-200 rounded-2xl transition-all"
                  >
                    <Receipt className="w-5 h-5 text-slate-500" />
                    <span className="text-[10px] font-bold text-slate-700">
                      بيانات JSON
                    </span>
                  </button>
                </div>

                <div className="pt-4 flex justify-end">
                  <button
                    onClick={() => {
                      setShowExportConfirmationModal(false);
                      setExportRecordSelected(null);
                    }}
                    className="w-full border border-slate-200 hover:bg-slate-50 text-slate-600 px-5 py-2.5 rounded-xl font-bold transition-all text-xs"
                  >
                    إلغاء الأمر
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
