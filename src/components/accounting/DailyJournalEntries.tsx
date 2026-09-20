import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  BookOpen, Plus, Sparkles, Search, ChevronLeft, Trash2, Save, Check,
  FileText, Filter, Calendar, X, Paperclip, Link2, Eye, Clock, CheckCircle2,
  AlertTriangle, FileSpreadsheet, Printer, Copy, ChevronDown, Info,
  ClipboardList, Building2, Hash, StickyNote, UploadCloud, ShieldCheck, User,
  Scale, Lightbulb
} from "lucide-react";
import { api } from "../../utils/api";

/* ═══════════════════════════════════════════════════════════════
   أنواع البيانات
   ═══════════════════════════════════════════════════════════════ */
interface JournalLine {
  id: number;
  account_id: string;
  account_name: string;
  cost_center: string;
  sub_account: string;
  description: string;
  debit: string;
  credit: string;
}

interface JournalEntryData {
  id?: number;
  code: string;
  date: string;
  entry_type: "يومي" | "افتتاحي" | "إقفال" | "تسوية";
  description: string;
  reference: string;
  source: string;
  branch: string;
  project: string;
  currency: string;
  exchange_rate: string;
  status: "draft" | "approved" | "cancelled";
  lines: JournalLine[];
  created_by: string;
  created_at: string;
  approved_by?: string;
  approved_at?: string;
}

interface AccountOption {
  id: number;
  code: string;
  name: string;
  type?: string;
}

/* ═══════════════════════════════════════════════════════════════
   إعدادات ثابتة
   ═══════════════════════════════════════════════════════════════ */
const ENTRY_TYPES: Array<"يومي" | "افتتاحي" | "إقفال" | "تسوية"> = ["يومي", "افتتاحي", "إقفال", "تسوية"];

const PROJECTS = ["بدون مشروع", "مشروع دبي مول", "مشروع أبوظبي مول", "مشروع برج الرياض", "مشروع التوسعات"];

const MAIN_SOURCES = [
  "قيد يدوي",
  "فاتورة مبيعات",
  "فاتورة مشتريات",
  "سند قبض",
  "سند صرف",
  "مسير رواتب",
  "تسوية بنكية",
  "إهلاك أصول",
];

const COST_CENTERS = ["التشغيل", "الإدارة", "التسويق", "المبيعات", "المخزون", "بدون مركز"];

const BRANCHES = ["الفرع الرئيسي", "دبي مول", "أبوظبي مول", "مركز المدينة"];

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  draft: { label: "مسودة", color: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200" },
  approved: { label: "معتمد", color: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200" },
  cancelled: { label: "ملغي", color: "text-rose-700", bg: "bg-rose-50", border: "border-rose-200" },
};

const emptyLine = (id: number): JournalLine => ({
  id,
  account_id: "",
  account_name: "",
  cost_center: "التشغيل",
  sub_account: "",
  description: "",
  debit: "",
  credit: "",
});

const nextCode = (n: number) =>
  `JE-${new Date().getFullYear()}-${String(100100 + n).slice(1)}`;

const fmt = (v: number) =>
  v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ═══════════════════════════════════════════════════════════════
   نظام الإشعارات (Toast)
   ═══════════════════════════════════════════════════════════════ */
interface Toast {
  id: number;
  message: string;
  type: "error" | "success" | "info" | "warning";
}

const ToastStack: React.FC<{ toasts: Toast[]; onDismiss: (id: number) => void }> = ({ toasts, onDismiss }) => {
  const icons = {
    error: <AlertTriangle className="w-5 h-5 text-rose-500" />,
    success: <CheckCircle2 className="w-5 h-5 text-emerald-500" />,
    info: <Info className="w-5 h-5 text-blue-500" />,
    warning: <AlertTriangle className="w-5 h-5 text-amber-500" />,
  };
  const borders = {
    error: "border-r-rose-500",
    success: "border-r-emerald-500",
    info: "border-r-blue-500",
    warning: "border-r-amber-500",
  };
  return (
    <div className="fixed bottom-6 left-6 z-[100] space-y-3 pointer-events-none">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, x: -40, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -40, scale: 0.95 }}
            className={`pointer-events-auto bg-white border ${borders[t.type]} border-r-4 shadow-xl rounded-2xl px-5 py-4 flex items-center gap-3 min-w-[320px] max-w-md`}
          >
            {icons[t.type]}
            <p className="text-sm font-bold text-slate-800 flex-1">{t.message}</p>
            <button onClick={() => onDismiss(t.id)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   حقل اختيار الحساب القابل للبحث
   ═══════════════════════════════════════════════════════════════ */
const AccountSelect: React.FC<{
  value: string;
  accounts: AccountOption[];
  onChange: (id: string, name: string) => void;
  disabled?: boolean;
}> = ({ value, accounts, onChange, disabled }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const selected = accounts.find((a) => String(a.id) === value);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const filtered = useMemo(() => {
    if (!query.trim()) return accounts;
    const q = query.trim().toLowerCase();
    return accounts.filter(
      (a) => a.code?.toLowerCase().includes(q) || a.name?.toLowerCase().includes(q)
    );
  }, [query, accounts]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className="w-full h-9 bg-white border border-slate-200 rounded-xl px-3 text-right text-xs font-bold text-slate-800 hover:border-blue-300 focus:border-blue-400 focus:outline-none transition-colors disabled:bg-slate-50 disabled:text-slate-400 flex items-center justify-between gap-1 cursor-pointer"
      >
        <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
        <span className={selected ? "" : "text-slate-400 font-normal"}>
          {selected ? `${selected.code} - ${selected.name}` : "اختر الحساب..."}
        </span>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-[280px] bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden">
          <div className="p-2 border-b border-slate-100">
            <div className="relative">
              <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="ابحث بالكود أو الاسم..."
                className="w-full h-8 bg-slate-50 border border-slate-200 rounded-lg pr-8 pl-3 text-xs focus:outline-none focus:border-blue-400"
              />
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="p-4 text-center text-xs text-slate-400">لا توجد نتائج مطابقة</p>
            ) : (
              filtered.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => {
                    onChange(String(a.id), a.name);
                    setOpen(false);
                    setQuery("");
                  }}
                  className={`w-full px-3 py-2.5 text-right hover:bg-blue-50 transition-colors flex items-center gap-2 cursor-pointer ${
                    String(a.id) === value ? "bg-blue-50" : ""
                  }`}
                >
                  <span className="font-mono text-[10px] font-bold text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded">{a.code}</span>
                  <span className="text-xs font-bold text-slate-700 flex-1">{a.name}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   البطاقات الجانبية — المرفقات + المراجعة والاعتماد
   ═══════════════════════════════════════════════════════════════ */
interface AttachmentFile { id: number; name: string; size: string; }

const SideCards: React.FC<{ entry: JournalEntryData; balanced: boolean; totalDebit: number; totalCredit: number }> = ({
  entry, balanced, totalDebit, totalCredit,
}) => {
  const [attachments, setAttachments] = useState<AttachmentFile[]>([
    { id: 1, name: "فاتورة_مورد_0824.pdf", size: "1.2 MB" },
  ]);
  const [dragOver, setDragOver] = useState(false);

  const addFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const newFiles: AttachmentFile[] = Array.from(files).map((f, i) => ({
      id: Date.now() + i,
      name: f.name,
      size: `${(f.size / 1024 / 1024).toFixed(1)} MB`,
    }));
    setAttachments((prev) => [...prev, ...newFiles]);
  };

  const removeAttachment = (id: number) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  return (
    <div className="space-y-4">
      {/* المرفقات والربط المحاسبي */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2.5 bg-gradient-to-l from-slate-50 to-white">
          <div className="w-9 h-9 rounded-xl bg-purple-50 flex items-center justify-center">
            <Paperclip className="w-4.5 h-4.5 text-purple-600" />
          </div>
          <div>
            <h4 className="text-sm font-black text-slate-800">المرفقات والربط المحاسبي</h4>
            <p className="text-[10px] text-slate-400">إدارة المرفقات وربط القيد بالمستندات</p>
          </div>
        </div>
        <div className="p-5 space-y-3">
          <label
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
            className={`w-full py-6 border-2 border-dashed rounded-2xl transition-all flex flex-col items-center gap-2 cursor-pointer group ${
              dragOver ? "border-purple-400 bg-purple-50/50 scale-[1.02]" : "border-slate-200 hover:border-purple-300 hover:bg-purple-50/30"
            }`}
          >
            <input
              type="file"
              multiple
              className="hidden"
              onChange={(e) => addFiles(e.target.files)}
            />
            <UploadCloud className={`w-8 h-8 transition-colors ${dragOver ? "text-purple-500" : "text-slate-300 group-hover:text-purple-400"}`} />
            <span className="text-xs font-bold text-slate-500 group-hover:text-purple-600">
              {dragOver ? "أفلت الملفات هنا الآن ✓" : "اسحب الملفات هنا أو اضغط للرفع"}
            </span>
            <span className="text-[10px] text-slate-400">PDF, JPG, PNG حتى 10 ميجابايت</span>
          </label>
          <div className="space-y-2">
            {attachments.map((att) => (
              <div key={att.id} className="flex items-center gap-2.5 p-3 bg-slate-50 rounded-xl border border-slate-100 group">
                <FileText className="w-4 h-4 text-rose-500" />
                <span className="text-xs font-bold text-slate-700 flex-1 truncate">{att.name}</span>
                <span className="text-[10px] text-slate-400 font-mono">{att.size}</span>
                <button
                  type="button"
                  onClick={() => removeAttachment(att.id)}
                  className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-rose-500 transition-all cursor-pointer"
                  title="حذف المرفق"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            {attachments.length === 0 && (
              <p className="text-center text-[11px] text-slate-400 py-2">لا توجد مرفقات بعد</p>
            )}
          </div>
          <div className="pt-3 border-t border-slate-100 space-y-2.5">
            <div className="flex items-center gap-2 text-xs">
              <Link2 className="w-3.5 h-3.5 text-blue-500" />
              <span className="font-bold text-slate-600">المصدر:</span>
              <span className="text-slate-800 font-black">{entry.source}</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <Building2 className="w-3.5 h-3.5 text-emerald-500" />
              <span className="font-bold text-slate-600">الفرع:</span>
              <span className="text-slate-800 font-black">{entry.branch}</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <Hash className="w-3.5 h-3.5 text-amber-500" />
              <span className="font-bold text-slate-600">المرجع:</span>
              <span className="text-slate-800 font-mono font-bold" dir="ltr">{entry.reference || "—"}</span>
            </div>
          </div>
        </div>
      </div>

      {/* المراجعة والاعتماد */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2.5 bg-gradient-to-l from-slate-50 to-white">
          <div className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center">
            <ShieldCheck className="w-4.5 h-4.5 text-emerald-600" />
          </div>
          <div>
            <h4 className="text-sm font-black text-slate-800">المراجعة والاعتماد</h4>
            <p className="text-[10px] text-slate-400">سجل التدقيق ومعلومات الاعتماد</p>
          </div>
        </div>
        <div className="p-5 space-y-3">
          <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-xs font-black">
              {entry.created_by?.charAt(0) || "م"}
            </div>
            <div className="flex-1">
              <p className="text-xs font-black text-slate-800">أنشأ بواسطة {entry.created_by}</p>
              <p className="text-[10px] text-slate-400">تاريخ الإنشاء: {entry.created_at}</p>
            </div>
            <User className="w-4 h-4 text-slate-300" />
          </div>

          <div className="space-y-2.5 pt-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-500">حالة التوازن</span>
              {balanced ? (
                <span className="font-black text-emerald-600 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> متزن
                </span>
              ) : (
                <span className="font-black text-rose-600 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" /> غير متزن
                </span>
              )}
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-500">إجمالي المدين</span>
              <span className="font-mono font-black text-slate-800" dir="ltr">{fmt(totalDebit)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-500">إجمالي الدائن</span>
              <span className="font-mono font-black text-slate-800" dir="ltr">{fmt(totalCredit)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-500">عدد البنود</span>
              <span className="font-mono font-black text-slate-800">{entry.lines.length}</span>
            </div>
          </div>

          {entry.status === "approved" ? (
            <div className="flex items-center gap-3 p-3 bg-emerald-50 rounded-xl border border-emerald-100">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              <div className="flex-1">
                <p className="text-xs font-black text-emerald-800">تم الاعتماد بواسطة {entry.approved_by || "المدير المالي"}</p>
                <p className="text-[10px] text-emerald-600">{entry.approved_at || ""}</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 p-3 bg-amber-50 rounded-xl border border-amber-100">
              <Clock className="w-5 h-5 text-amber-600" />
              <div className="flex-1">
                <p className="text-xs font-black text-amber-800">بانتظار الاعتماد</p>
                <p className="text-[10px] text-amber-600">القيد محفوظ كمسودة ولم يُعتمد بعد</p>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 text-[10px] text-slate-400 pt-2 border-t border-slate-100">
            <Eye className="w-3 h-3" />
            <span>آخر عرض: اليوم • سجل التدقيق مفعّل</span>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   المكون الرئيسي
   ═══════════════════════════════════════════════════════════════ */
interface DailyJournalEntriesProps {
  onBack?: () => void;
}

export const DailyJournalEntries: React.FC<DailyJournalEntriesProps> = ({ onBack }) => {
  const [mode, setMode] = useState<"list" | "editor">("list");
  const [entries, setEntries] = useState<JournalEntryData[]>([]);
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);

  /* حالة الإشعارات */
  const [toasts, setToasts] = useState<Toast[]>([]);
  const pushToast = useCallback((message: string, type: Toast["type"] = "error") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  const dismissToast = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  /* حالة البحث والفلاتر */
  const [searchQuery, setSearchQuery] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [showFilters, setShowFilters] = useState(false);

  /* حالة المحرر */
  const [editor, setEditor] = useState<JournalEntryData | null>(null);

  /* مرفقات زر «إرفاق مستند» في الهيدر */
  const [attachedFiles, setAttachedFiles] = useState<string[]>([]);
  const handleAttachFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const names = Array.from(files).map((f) => f.name);
    setAttachedFiles((prev) => [...prev, ...names]);
    pushToast(`تم إرفاق ${names.length} مستند بنجاح`, "success");
    e.target.value = "";
  };

  /* ═══ تحميل البيانات ═══ */
  const loadEntries = useCallback(async () => {
    setLoading(true);
    try {
      const [entriesRes, accountsRes] = await Promise.all([
        api.get("/api/journal-entries").catch(() => null),
        api.get("/api/accounts").catch(() => null),
      ]);
      if (entriesRes?.ok) {
        const raw = await entriesRes.json();
        const list: JournalEntryData[] = (Array.isArray(raw) ? raw : raw?.data || []).map((e: any, i: number) => ({
          id: e.id,
          code: e.code || e.reference || nextCode(i + 1),
          date: (e.date || "").split("T")[0],
          entry_type: e.entry_type || "يومي",
          description: e.description || "",
          reference: e.reference || "",
          source: e.source || "قيد يدوي",
          branch: e.branch || "الفرع الرئيسي",
          project: e.project || "بدون مشروع",
          currency: e.currency || "EGP",
          exchange_rate: e.exchange_rate || "1.00",
          status: e.status || "approved",
          created_by: e.created_by || "مدير النظام",
          created_at: (e.created_at || "").split("T")[0],
          approved_by: e.approved_by,
          approved_at: e.approved_at ? String(e.approved_at).split("T")[0] : undefined,
          lines: (e.items || []).map((it: any, idx: number) => ({
            id: it.id || idx + 1,
            account_id: String(it.account_id || ""),
            account_name: it.account_name || "",
            cost_center: it.cost_center || "التشغيل",
            sub_account: it.sub_account || "",
            description: it.notes || "",
            debit: it.debit ? String(it.debit) : "",
            credit: it.credit ? String(it.credit) : "",
          })),
        }));
        setEntries(list);
      }
      if (accountsRes?.ok) {
        const accs = await accountsRes.json();
        const list: AccountOption[] = (Array.isArray(accs) ? accs : accs?.data || []).map((a: any) => ({
          id: a.id,
          code: String(a.code || a.id),
          name: a.name || "",
          type: a.type,
        }));
        setAccounts(list);
      }
    } catch (e) {
      console.error("Failed to load journal entries", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  /* ═══ الحسابات الحية للقيد ═══ */
  const totalDebit = useMemo(
    () => editor?.lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0) || 0,
    [editor]
  );
  const totalCredit = useMemo(
    () => editor?.lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0) || 0,
    [editor]
  );
  const diff = Math.abs(totalDebit - totalCredit);
  const balanced = totalDebit > 0 && totalDebit === totalCredit;
  const filledLines = editor?.lines.filter((l) => l.account_id).length || 0;

  /* ═══ فلاتر القائمة ═══ */
  const filteredEntries = useMemo(() => {
    return entries.filter((e) => {
      const q = searchQuery.trim().toLowerCase();
      if (q) {
        const hay = `${e.description} ${e.reference} ${e.code}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filterFrom && e.date < filterFrom) return false;
      if (filterTo && e.date > filterTo) return false;
      if (filterStatus !== "all" && e.status !== filterStatus) return false;
      if (filterType !== "all" && e.entry_type !== filterType) return false;
      return true;
    });
  }, [entries, searchQuery, filterFrom, filterTo, filterStatus, filterType]);

  /* ═══ إدارة سطور القيد ═══ */
  const newEntry = () => {
    const n = entries.length + 1;
    /* صفّا مثال جاهزان (مبيعات آجلة) — يحاكيان بنية قيد حقيقي متوازن */
    const customerAcc = accounts.find((a) => String(a.code) === "1000") || accounts.find((a) => (a.name || "").includes("عميل")) || accounts[0];
    const salesAcc = accounts.find((a) => String(a.code) === "4000") || accounts.find((a) => (a.name || "").includes("مبيعات")) || accounts[1];
    const exampleLines: JournalLine[] = [
      {
        id: 1,
        account_id: customerAcc ? String(customerAcc.id) : "",
        account_name: customerAcc?.name || "",
        cost_center: "التشغيل",
        sub_account: "",
        description: "إثبات مبيعات آجلة — فاتورة رقم INV-101",
        debit: "15000",
        credit: "",
      },
      {
        id: 2,
        account_id: salesAcc ? String(salesAcc.id) : "",
        account_name: salesAcc?.name || "",
        cost_center: "التشغيل",
        sub_account: "",
        description: "إثبات مبيعات آجلة — فاتورة رقم INV-101",
        debit: "",
        credit: "15000",
      },
    ];
    setEditor({
      code: nextCode(n),
      date: new Date().toISOString().split("T")[0],
      entry_type: "يومي",
      description: "",
      reference: "",
      source: "قيد يدوي",
      branch: "الفرع الرئيسي",
      project: "بدون مشروع",
      currency: "EGP",
      exchange_rate: "1.00",
      status: "draft",
      lines: exampleLines,
      created_by: "محمد",
      created_at: new Date().toISOString().split("T")[0],
    });
    setAttachedFiles([]);
    setMode("editor");
  };

  const editEntry = (e: JournalEntryData) => {
    const lines = e.lines.length > 0 ? e.lines : [emptyLine(1), emptyLine(2), emptyLine(3)];
    setEditor({ ...e, lines });
    setMode("editor");
  };

  const updateLine = (lineId: number, field: keyof JournalLine, value: string) => {
    if (!editor) return;
    setEditor({
      ...editor,
      lines: editor.lines.map((l) => (l.id === lineId ? { ...l, [field]: value } : l)),
    });
  };

  /* كشف الحسابات المكررة — لتلوين الصفوف وإظهار الخطأ المضمّن */
  const duplicateAccountIds = useMemo(() => {
    if (!editor) return new Set<string>();
    const seen = new Map<string, number>();
    editor.lines.forEach((l) => {
      if (!l.account_id) return;
      seen.set(l.account_id, (seen.get(l.account_id) || 0) + 1);
    });
    return new Set([...seen.entries()].filter(([, c]) => c > 1).map(([k]) => k));
  }, [editor]);

  /* تكرار سطر بنفس الحساب غير مسموح — منع + رسالة */
  const handleAccountChange = (lineId: number, accountId: string, accountName: string) => {
    if (!editor) return;
    const duplicate = editor.lines.find((l) => l.id !== lineId && l.account_id === accountId && accountId !== "");
    if (duplicate) {
      pushToast(`لا يمكن تكرار نفس الحساب "${accountName}" — الحساب مستخدم بالفعل في بند آخر من هذا القيد!`, "error");
      return;
    }
    updateLine(lineId, "account_id", accountId);
    updateLine(lineId, "account_name", accountName);
  };

  /* مدين/دائن حصريين — إدخال أحدهما يصفّر الآخر */
  const handleDebitChange = (lineId: number, value: string) => {
    if (!editor) return;
    setEditor({
      ...editor,
      lines: editor.lines.map((l) =>
        l.id === lineId
          ? { ...l, debit: value, credit: value && parseFloat(value) > 0 ? "" : l.credit }
          : l
      ),
    });
  };

  const handleCreditChange = (lineId: number, value: string) => {
    if (!editor) return;
    setEditor({
      ...editor,
      lines: editor.lines.map((l) =>
        l.id === lineId
          ? { ...l, credit: value, debit: value && parseFloat(value) > 0 ? "" : l.debit }
          : l
      ),
    });
  };

  const addLine = () => {
    if (!editor) return;
    const maxId = Math.max(0, ...editor.lines.map((l) => l.id));
    setEditor({ ...editor, lines: [...editor.lines, emptyLine(maxId + 1)] });
  };

  const removeLine = (lineId: number) => {
    if (!editor) return;
    if (editor.lines.length <= 1) {
      pushToast("لا يمكن حذف جميع البنود — يجب أن يحتوي القيد على بند واحد على الأقل", "warning");
      return;
    }
    setEditor({ ...editor, lines: editor.lines.filter((l) => l.id !== lineId) });
  };

  const clearAllLines = () => {
    if (!editor) return;
    setEditor({ ...editor, lines: [emptyLine(1), emptyLine(2), emptyLine(3)] });
    pushToast("تم مسح جميع بنود القيد", "info");
  };

  /* تكرار صف — ينشئ سطراً جديداً بنفس بيانات السطر المصدر (بمعرّف مختلف) */
  const duplicateLine = (lineId: number) => {
    if (!editor) return;
    const src = editor.lines.find((l) => l.id === lineId);
    if (!src) return;
    const maxId = Math.max(0, ...editor.lines.map((l) => l.id));
    setEditor({ ...editor, lines: [...editor.lines, { ...src, id: maxId + 1, debit: src.debit, credit: src.credit }] });
    pushToast("تم تكرار السطر — يمكنك تعديل الحساب أو المبلغ", "success");
  };

  /* القيد العكسي — يقلب المدين والدائن في سطر جديد أسفل الجدول */
  const reverseEntry = () => {
    if (!editor) return;
    if (editor.lines.filter((l) => l.account_id && (parseFloat(l.debit) > 0 || parseFloat(l.credit) > 0)).length === 0) {
      pushToast("لا يمكن عمل قيد عكسي لقيد بدون بنود صالحة", "warning");
      return;
    }
    let maxId = Math.max(0, ...editor.lines.map((l) => l.id));
    const reversed = editor.lines
      .filter((l) => l.account_id && (parseFloat(l.debit) > 0 || parseFloat(l.credit) > 0))
      .map((l) => {
        maxId += 1;
        return {
          ...l,
          id: maxId,
          debit: l.credit, // قلب الاتجاه
          credit: l.debit,
          description: l.description ? `${l.description} (عكسي)` : "قيد عكسي",
        };
      });
    setEditor({
      ...editor,
      description: editor.description ? `${editor.description} — قيد عكسي` : "قيد عكسي",
      lines: [...editor.lines, ...reversed],
    });
    pushToast(`تم إضافة ${reversed.length} سطر عكسي — لاحظ أن القيد أصبح غير متزن حتى اكتمال التعديل`, "info");
  };

  /* نسخ القيد — إنشاء نسخة جديدة من القيد الحالي بكود جديد */
  const copyEntry = () => {
    if (!editor) return;
    const n = entries.length + 1;
    let maxId = Math.max(0, ...editor.lines.map((l) => l.id));
    const copiedLines = editor.lines.map((l) => {
      maxId += 1;
      return { ...l, id: maxId };
    });
    setEditor({
      ...editor,
      id: undefined,
      code: nextCode(n),
      status: "draft",
      description: `${editor.description} (نسخة)`,
      lines: copiedLines,
      approved_by: undefined,
      approved_at: undefined,
    });
    pushToast(`تم إنشاء نسخة جديدة من القيد برقم ${nextCode(n)} — عدّل واحفظ`, "success");
  };

  /* ═══ الحفظ والاعتماد ═══ */
  const saveEntry = async (approve: boolean) => {
    if (!editor) return;

    if (!editor.description.trim()) {
      pushToast("يرجى إدخال بيان القيد العام قبل الحفظ", "warning");
      return;
    }
    const validLines = editor.lines.filter((l) => l.account_id && (parseFloat(l.debit) > 0 || parseFloat(l.credit) > 0));
    if (validLines.length < 2) {
      pushToast("يجب أن يحتوي القيد على بندين صالحين على الأقل (حساب + مبلغ)", "warning");
      return;
    }

    if (approve) {
      if (!balanced) {
        pushToast(`لا يمكن اعتماد قيد غير متزن! الفرق الحالي: ${fmt(diff)} — يجب أن يتساوى المدين مع الدائن`, "error");
        return;
      }
    }

    try {
      const payload: any = {
        date: editor.date,
        description: editor.description,
        reference: editor.reference,
        entry_type: editor.entry_type,
        source: editor.source,
        branch: editor.branch,
        code: editor.code,
        status: approve ? "approved" : "draft",
        total_debit: totalDebit,
        total_credit: totalCredit,
        items: validLines.map((l) => ({
          account_id: Number(l.account_id),
          debit: parseFloat(l.debit) || 0,
          credit: parseFloat(l.credit) || 0,
          notes: l.description,
          cost_center: l.cost_center,
        })),
      };

      let res;
      if (editor.id) {
        res = await api.put(`/api/journal-entries/${editor.id}`, payload);
      } else {
        res = await api.post("/api/journal-entries", payload);
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        pushToast(err.error || "فشل حفظ القيد", "error");
        return;
      }

      const saved: JournalEntryData = {
        ...editor,
        id: editor.id || entries.length + 1,
        status: approve ? "approved" : "draft",
        lines: validLines,
        approved_by: approve ? "المدير المالي" : undefined,
        approved_at: approve ? new Date().toISOString().split("T")[0] : undefined,
      };

      setEntries((prev) => (editor.id ? prev.map((e) => (e.id === editor.id ? saved : e)) : [saved, ...prev]));
      setMode("list");
      pushToast(approve ? `تم اعتماد القيد ${editor.code} بنجاح ✓` : `تم حفظ القيد ${editor.code} كمسودة`, "success");
    } catch (e: any) {
      pushToast(e?.message || "حدث خطأ أثناء الحفظ", "error");
    }
  };

  const deleteEntry = async (entry: JournalEntryData) => {
    if (!confirm(`هل أنت متأكد من حذف القيد ${entry.code}؟\nلا يمكن التراجع عن هذا الإجراء.`)) return;
    try {
      if (entry.id) {
        const res = await api.delete(`/api/journal-entries/${entry.id}`);
        if (!res.ok) throw new Error("delete failed");
      }
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
      pushToast(`تم حذف القيد ${entry.code}`, "success");
    } catch {
      pushToast("فشل حذف القيد", "error");
    }
  };

  const cancelEntry = (entry: JournalEntryData) => {
    setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, status: "cancelled" as const } : e)));
    pushToast(`تم إلغاء القيد ${entry.code}`, "info");
  };

  const ocrScan = () => {
    pushToast("جاري تشغيل الماسح الضوئي OCR... سيتم رفع الفاتورة وقراءة بياناتها تلقائياً", "info");
  };

  const entryTotals = (e: JournalEntryData) => {
    const d = e.lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
    const c = e.lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
    return { d, c };
  };

  /* ═══════════════════════════════════════════════════════════════
     RENDER — صفحة القائمة
     ═══════════════════════════════════════════════════════════════ */
  if (mode === "list") {
    return (
      <div dir="rtl" className="min-h-screen bg-[#F5F7FA] font-sans">
        <ToastStack toasts={toasts} onDismiss={dismissToast} />
        <div className="max-w-[96%] mx-auto py-6 space-y-5">

          {/* ─── Header ─── */}
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              {onBack && (
                <button onClick={onBack} className="w-10 h-10 rounded-2xl bg-white border border-slate-200 shadow-sm flex items-center justify-center text-slate-500 hover:text-blue-600 hover:border-blue-200 transition-all cursor-pointer">
                  <ChevronLeft className="w-5 h-5" />
                </button>
              )}
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center text-white shadow-lg shadow-blue-600/20">
                <BookOpen className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-2xl font-black text-slate-900">القيود اليومية</h1>
                <p className="text-xs text-slate-400 font-bold mt-0.5">القسم الفرعي: القيود اليومية</p>
              </div>
            </div>
          </div>

          {/* ─── Top Action Bar ─── */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex flex-col md:flex-row items-stretch md:items-center gap-3">
            <button
              onClick={newEntry}
              className="flex items-center justify-center gap-2 bg-[#E67E22] hover:bg-[#d35400] text-white px-6 py-3 rounded-xl font-black text-sm transition-all shadow-md shadow-orange-500/20 hover:shadow-lg hover:shadow-orange-500/30 cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-4.5 h-4.5" />
              قيد يومية جديد
            </button>
            <button
              onClick={ocrScan}
              className="flex items-center justify-center gap-2 bg-gradient-to-l from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white px-6 py-3 rounded-xl font-black text-sm transition-all shadow-md shadow-purple-500/20 hover:shadow-lg hover:shadow-purple-500/30 cursor-pointer whitespace-nowrap"
            >
              <Sparkles className="w-4.5 h-4.5" />
              مسح فاتورة OCR
            </button>
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute right-4 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-slate-400" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ابحث عن قيد بواسطة الوصف، رقم المرجع، أو الكود..."
                className="w-full h-12 bg-[#F8F9FA] border border-slate-200 rounded-full pr-12 pl-5 text-sm font-bold text-slate-800 placeholder:text-slate-400 placeholder:font-normal focus:outline-none focus:border-blue-400 focus:bg-white focus:shadow-md focus:shadow-blue-500/5 transition-all"
              />
            </div>
          </div>

          {/* ─── Filters ─── */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="w-full px-5 py-3.5 flex items-center justify-between hover:bg-slate-50 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2.5">
                <Filter className="w-4.5 h-4.5 text-blue-600" />
                <span className="text-sm font-black text-slate-700">الفلاتر المتقدمة</span>
                {(filterFrom || filterTo || filterStatus !== "all" || filterType !== "all") && (
                  <span className="bg-blue-100 text-blue-700 text-[10px] font-black px-2 py-0.5 rounded-full">
                    {(filterFrom || filterTo ? 1 : 0) + (filterStatus !== "all" ? 1 : 0) + (filterType !== "all" ? 1 : 0)} مفعّل
                  </span>
                )}
              </div>
              <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${showFilters ? "rotate-180" : ""}`} />
            </button>
            {showFilters && (
              <div className="px-5 pb-5 pt-1 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-black text-slate-500">من تاريخ</label>
                  <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)}
                    className="w-full h-10 bg-slate-50 border border-slate-200 rounded-xl px-3 text-sm font-bold text-slate-700 focus:outline-none focus:border-blue-400" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-black text-slate-500">إلى تاريخ</label>
                  <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)}
                    className="w-full h-10 bg-slate-50 border border-slate-200 rounded-xl px-3 text-sm font-bold text-slate-700 focus:outline-none focus:border-blue-400" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-black text-slate-500">الحالة</label>
                  <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
                    className="w-full h-10 bg-slate-50 border border-slate-200 rounded-xl px-3 text-sm font-bold text-slate-700 focus:outline-none focus:border-blue-400 cursor-pointer">
                    <option value="all">كل الحالات</option>
                    <option value="draft">مسودة</option>
                    <option value="approved">معتمد</option>
                    <option value="cancelled">ملغي</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-black text-slate-500">النوع</label>
                  <select value={filterType} onChange={(e) => setFilterType(e.target.value)}
                    className="w-full h-10 bg-slate-50 border border-slate-200 rounded-xl px-3 text-sm font-bold text-slate-700 focus:outline-none focus:border-blue-400 cursor-pointer">
                    <option value="all">كل الأنواع</option>
                    {ENTRY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* ─── Table ─── */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gradient-to-l from-slate-100 to-slate-50 border-b border-slate-200">
                    <th className="px-5 py-4 text-right font-black text-slate-600">رقم القيد</th>
                    <th className="px-5 py-4 text-right font-black text-slate-600">التاريخ</th>
                    <th className="px-5 py-4 text-right font-black text-slate-600">بيان القيد (الوصف العام)</th>
                    <th className="px-5 py-4 text-right font-black text-slate-600">المرجع والمستند</th>
                    <th className="px-5 py-4 text-center font-black text-slate-600">إجمالي المدين</th>
                    <th className="px-5 py-4 text-center font-black text-slate-600">إجمالي الدائن</th>
                    <th className="px-5 py-4 text-center font-black text-slate-600">الحالة</th>
                    <th className="px-5 py-4 text-center font-black text-slate-600">العمليات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr>
                      <td colSpan={8} className="p-16 text-center">
                        <div className="inline-flex flex-col items-center gap-4">
                          <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-slate-200 border-t-blue-600" />
                          <p className="text-sm font-bold text-slate-400">جاري تحميل القيود...</p>
                        </div>
                      </td>
                    </tr>
                  ) : filteredEntries.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-20 text-center">
                        <div className="inline-flex flex-col items-center gap-4">
                          <div className="w-20 h-20 rounded-full bg-slate-50 border-2 border-dashed border-slate-200 flex items-center justify-center">
                            <BookOpen className="w-9 h-9 text-slate-300" />
                          </div>
                          <p className="text-sm font-bold text-slate-500">لا يوجد قيود يومية مسجلة حتى الآن. ابدأ بإضافة قيد جديد!</p>
                          <button onClick={newEntry}
                            className="mt-2 flex items-center gap-2 bg-[#E67E22] hover:bg-[#d35400] text-white px-5 py-2.5 rounded-xl font-black text-xs transition-all cursor-pointer">
                            <Plus className="w-4 h-4" /> إضافة أول قيد
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredEntries.map((entry, idx) => {
                      const { d, c } = entryTotals(entry);
                      const sc = STATUS_CONFIG[entry.status] || STATUS_CONFIG.draft;
                      return (
                        <tr key={entry.id || idx} className={`hover:bg-blue-50/30 transition-colors ${idx % 2 === 0 ? "bg-white" : "bg-slate-50/40"}`}>
                          <td className="px-5 py-4">
                            <button onClick={() => editEntry(entry)} className="font-mono font-black text-blue-700 hover:text-blue-800 hover:underline decoration-dotted underline-offset-4 cursor-pointer" dir="ltr">
                              {entry.code}
                            </button>
                          </td>
                          <td className="px-5 py-4 text-slate-600 font-bold" dir="ltr">{entry.date}</td>
                          <td className="px-5 py-4 max-w-[260px]">
                            <p className="font-bold text-slate-800 truncate" title={entry.description}>{entry.description || "—"}</p>
                            <span className="text-[10px] text-slate-400 font-bold">{entry.entry_type}</span>
                          </td>
                          <td className="px-5 py-4">
                            <div className="flex items-center gap-1.5">
                              <FileText className="w-3.5 h-3.5 text-slate-400" />
                              <span className="font-mono text-xs text-slate-600 font-bold" dir="ltr">{entry.reference || "—"}</span>
                            </div>
                          </td>
                          <td className="px-5 py-4 text-center">
                            <span className="font-mono font-black text-blue-800 bg-blue-50 px-2.5 py-1 rounded-lg" dir="ltr">{fmt(d)}</span>
                          </td>
                          <td className="px-5 py-4 text-center">
                            <span className={`font-mono font-black px-2.5 py-1 rounded-lg ${d === c && d > 0 ? "text-emerald-700 bg-emerald-50" : "text-rose-700 bg-rose-50"}`} dir="ltr">{fmt(c)}</span>
                          </td>
                          <td className="px-5 py-4 text-center">
                            <span className={`inline-flex items-center gap-1.5 text-[11px] font-black px-3 py-1.5 rounded-full border ${sc.color} ${sc.bg} ${sc.border}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${entry.status === "approved" ? "bg-emerald-500" : entry.status === "draft" ? "bg-amber-500" : "bg-rose-500"}`} />
                              {sc.label}
                            </span>
                          </td>
                          <td className="px-5 py-4">
                            <div className="flex items-center justify-center gap-1">
                              <button onClick={() => editEntry(entry)} title="عرض / تعديل"
                                className="w-8 h-8 rounded-lg hover:bg-blue-100 text-slate-400 hover:text-blue-600 transition-all flex items-center justify-center cursor-pointer">
                                <Eye className="w-4 h-4" />
                              </button>
                              <button onClick={() => cancelEntry(entry)} title="إلغاء القيد" disabled={entry.status === "cancelled"}
                                className="w-8 h-8 rounded-lg hover:bg-amber-100 text-slate-400 hover:text-amber-600 transition-all flex items-center justify-center cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed">
                                <X className="w-4 h-4" />
                              </button>
                              <button onClick={() => deleteEntry(entry)} title="حذف"
                                className="w-8 h-8 rounded-lg hover:bg-rose-100 text-slate-400 hover:text-rose-600 transition-all flex items-center justify-center cursor-pointer">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {!loading && filteredEntries.length > 0 && (
              <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500">
                  إجمالي القيود المعروضة: <span className="font-black text-slate-800">{filteredEntries.length}</span>
                  {filteredEntries.length !== entries.length && ` (من ${entries.length})`}
                </span>
                <span className="text-[10px] text-slate-400 font-bold">القيود اليومية • نظام محاسبي</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }


  /* ═══════════════════════════════════════════════════════════════
     RENDER — صفحة إنشاء / تعديل القيد (Premium SaaS Design)
     ═══════════════════════════════════════════════════════════════ */
  if (!editor) return null;

  const openRecentEntry = (e: JournalEntryData) => {
    const hasUnsaved = editor.lines.some((l) => l.account_id || l.debit || l.credit) || editor.description;
    if (hasUnsaved && !confirm("سيتم فقدان التعديلات غير المحفوظة في القيد الحالي. هل تريد فتح القيد المحدد؟")) return;
    editEntry(e);
  };

  /* شريط التوازن المرئي (نسبة المدين من الإجمالي) */
  const grandTotal = totalDebit + totalCredit;
  const debitShare = grandTotal > 0 ? (totalDebit / grandTotal) * 100 : 50;

  return (
    <div dir="rtl" className="min-h-screen bg-[#F8FAFC] font-sans">
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      <div className="max-w-[97%] mx-auto py-6 space-y-5">

        {/* ─── Header: العنوان + أزرار الإجراءات ─── */}
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-[#1E3A8A] flex items-center justify-center text-white shadow-md shadow-blue-900/15">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-black text-slate-900 flex items-center gap-2 flex-wrap">
                {editor.id ? "تعديل قيد يومية" : "قيد يومية جديد"}
                <span className="text-[#1E3A8A] font-mono tracking-wide" dir="ltr">- {editor.code}</span>
              </h1>
              <p className="text-xs text-slate-400 font-bold mt-0.5">القسم الفرعي: القيود اليومية</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* إلغاء — Secondary */}
            <button
              type="button"
              onClick={() => { setMode("list"); setEditor(null); setAttachedFiles([]); }}
              className="flex items-center gap-2 border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-800 px-4 py-2.5 rounded-xl font-bold text-sm transition-all shadow-sm cursor-pointer"
            >
              <X className="w-4 h-4" />
              إلغاء
            </button>

            {/* إرفاق مستند */}
            <label className="flex items-center gap-2 border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-800 px-4 py-2.5 rounded-xl font-bold text-sm transition-all shadow-sm cursor-pointer">
              <input type="file" multiple className="hidden" onChange={handleAttachFiles} />
              <Paperclip className="w-4 h-4" />
              إرفاق مستند
              {attachedFiles.length > 0 && (
                <span className="bg-emerald-100 text-emerald-700 text-[10px] font-black px-2 py-0.5 rounded-full">{attachedFiles.length}</span>
              )}
            </label>

            {/* اعتماد — Outline */}
            <button
              type="button"
              onClick={() => saveEntry(true)}
              disabled={!balanced}
              title={balanced ? "اعتماد القيد وترحيله للحسابات" : "القيد غير متوازن — لا يمكن الاعتماد حتى يتساوى المدين مع الدائن"}
              className={`flex items-center gap-2 border-2 px-5 py-2.5 rounded-xl font-black text-sm transition-all ${
                balanced
                  ? "border-[#1E3A8A] text-[#1E3A8A] bg-transparent hover:bg-[#1E3A8A] hover:text-white shadow-sm cursor-pointer"
                  : "border-slate-200 text-slate-300 bg-slate-50 cursor-not-allowed"
              }`}
            >
              <CheckCircle2 className="w-4 h-4" />
              اعتماد
            </button>

            {/* حفظ — Primary */}
            <button
              type="button"
              onClick={() => saveEntry(false)}
              className="flex items-center gap-2 bg-[#1E3A8A] hover:bg-[#1a3377] text-white px-6 py-2.5 rounded-xl font-black text-sm transition-all shadow-md shadow-blue-900/20 hover:shadow-lg cursor-pointer"
            >
              <Save className="w-4 h-4" />
              حفظ
            </button>
          </div>
        </div>

        {/* ─── Section 1: بيانات القيد الأساسية ─── */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div className="space-y-1.5">
              <label className="text-xs font-black text-slate-500">رقم القيد</label>
              <input value={editor.code} disabled dir="ltr"
                className="w-full h-11 bg-slate-50 border border-slate-200 rounded-xl px-4 text-sm font-mono font-black text-slate-600 cursor-not-allowed" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-black text-slate-500">تاريخ القيد <span className="text-rose-500">*</span></label>
              <input type="date" value={editor.date} onChange={(e) => setEditor({ ...editor, date: e.target.value })}
                className="w-full h-11 bg-white border border-slate-200 rounded-xl px-4 text-sm font-bold text-slate-800 focus:outline-none focus:border-[#1E3A8A] focus:ring-2 focus:ring-blue-100 transition-all" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-black text-slate-500">نوع القيد <span className="text-rose-500">*</span></label>
              <select value={editor.entry_type} onChange={(e) => setEditor({ ...editor, entry_type: e.target.value as any })}
                className="w-full h-11 bg-white border border-slate-200 rounded-xl px-4 text-sm font-bold text-slate-800 focus:outline-none focus:border-[#1E3A8A] focus:ring-2 focus:ring-blue-100 transition-all cursor-pointer">
                {ENTRY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-black text-slate-500">بيان القيد العام (الوصف)</label>
            <input value={editor.description} onChange={(e) => setEditor({ ...editor, description: e.target.value })}
              placeholder="مثال: قيد إثبات مبيعات آجلة عن شهر يناير 2026"
              className="w-full h-11 bg-white border border-slate-200 rounded-xl px-4 text-sm font-bold text-slate-800 focus:outline-none focus:border-[#1E3A8A] focus:ring-2 focus:ring-blue-100 transition-all placeholder:font-normal placeholder:text-slate-300" />
          </div>
        </div>

        {/* ─── Section 2: المرجع والعملة والمشروع ─── */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div className="space-y-1.5">
              <label className="text-xs font-black text-slate-500">المرجع / رقم المستند</label>
              <input value={editor.reference} onChange={(e) => setEditor({ ...editor, reference: e.target.value })}
                placeholder="INV-2026-0101" dir="ltr"
                className="w-full h-11 bg-white border border-slate-200 rounded-xl px-4 text-sm font-mono font-bold text-slate-800 focus:outline-none focus:border-[#1E3A8A] focus:ring-2 focus:ring-blue-100 transition-all placeholder:font-normal placeholder:text-slate-300" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-black text-slate-500">العملة وسعر الصرف</label>
              <div className="flex gap-2">
                <select value={editor.currency} onChange={(e) => setEditor({ ...editor, currency: e.target.value, exchange_rate: e.target.value === "EGP" ? "1.00" : editor.exchange_rate })}
                  className="w-[42%] h-11 bg-white border border-slate-200 rounded-xl px-2 text-xs font-bold text-slate-800 focus:outline-none focus:border-[#1E3A8A] transition-all cursor-pointer">
                  <option value="EGP">EGP - جنيه مصري</option>
                  <option value="SAR">SAR - ريال سعودي</option>
                  <option value="AED">AED - درهم إماراتي</option>
                  <option value="USD">USD - دولار أمريكي</option>
                  <option value="EUR">EUR - يورو</option>
                </select>
                <input type="number" step="0.01" min="0" value={editor.exchange_rate}
                  onChange={(e) => setEditor({ ...editor, exchange_rate: e.target.value })}
                  disabled={editor.currency === "EGP"} dir="ltr"
                  title={editor.currency === "EGP" ? "سعر الصرف الأساسي للجنيه المصري" : `سعر صرف 1 ${editor.currency} بالجنيه`}
                  className="flex-1 h-11 bg-white border border-slate-200 rounded-xl px-3 text-sm font-mono font-bold text-slate-800 focus:outline-none focus:border-[#1E3A8A] disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed" />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-black text-slate-500">المشروع / مركز التكلفة</label>
              <select value={editor.project} onChange={(e) => setEditor({ ...editor, project: e.target.value })}
                className="w-full h-11 bg-white border border-slate-200 rounded-xl px-4 text-sm font-bold text-slate-800 focus:outline-none focus:border-[#1E3A8A] focus:ring-2 focus:ring-blue-100 transition-all cursor-pointer">
                {PROJECTS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* ─── المحتوى الرئيسي: جدول البنود + الشريط الجانبي ─── */}
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_330px] gap-5 items-start">

          {/* ═══ بطاقة جدول البنود ═══ */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <FileSpreadsheet className="w-4.5 h-4.5 text-[#1E3A8A]" />
                <div>
                  <h3 className="text-sm font-black text-slate-800">بنود القيد المحاسبي</h3>
                  <p className="text-[10px] text-slate-400 font-bold">{editor.lines.length} سطر • بنود صالحة: {filledLines} • اضغط Enter لإضافة سطر</p>
                </div>
              </div>
              {duplicateAccountIds.size > 0 && (
                <span className="flex items-center gap-1.5 bg-rose-50 border border-rose-200 text-rose-700 text-[11px] font-black px-3 py-1.5 rounded-full">
                  <AlertTriangle className="w-3.5 h-3.5" /> لا يمكن تكرار نفس الحساب ({duplicateAccountIds.size})
                </span>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-[#F1F5FB] text-[#1E3A8A] border-b-2 border-[#1E3A8A]/10">
                    <th className="px-2 py-3.5 text-center font-black w-10">#</th>
                    <th className="px-2 py-3.5 text-right font-black min-w-[185px]">الحساب</th>
                    <th className="px-2 py-3.5 text-right font-black min-w-[160px]">البيان / الوصف</th>
                    <th className="px-2 py-3.5 text-center font-black min-w-[100px]">مدين</th>
                    <th className="px-2 py-3.5 text-center font-black min-w-[100px]">دائن</th>
                    <th className="px-2 py-3.5 text-center font-black min-w-[110px]">مركز التكلفة</th>
                    <th className="px-2 py-3.5 text-center font-black w-24">العمليات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {editor.lines.map((line, idx) => {
                    const isDup = duplicateAccountIds.has(line.account_id);
                    return (
                      <tr key={line.id} className={`transition-colors ${isDup ? "bg-rose-50/60" : idx % 2 === 0 ? "bg-white" : "bg-slate-50/30"} hover:bg-blue-50/30`}>
                        <td className="px-2 py-2.5 text-center">
                          <span className={`inline-flex items-center justify-center w-6 h-6 rounded-lg text-[10px] font-black ${isDup ? "bg-rose-100 text-rose-700" : "bg-[#1E3A8A]/5 text-[#1E3A8A]"}`}>
                            {idx + 1}
                          </span>
                        </td>
                        <td className="px-2 py-2.5">
                          <AccountSelect
                            value={line.account_id}
                            accounts={accounts}
                            onChange={(accId, accName) => handleAccountChange(line.id, accId, accName)}
                          />
                          {isDup && (
                            <p className="text-[9px] font-black text-rose-600 mt-1 flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" /> حساب مكرر — غير مسموح
                            </p>
                          )}
                        </td>
                        <td className="px-2 py-2.5">
                          <input value={line.description} onChange={(e) => updateLine(line.id, "description", e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLine(); } }}
                            placeholder="وصف البند..."
                            className="w-full h-9 bg-white border border-slate-200 rounded-xl px-3 text-xs font-bold text-slate-700 focus:outline-none focus:border-[#1E3A8A] focus:ring-2 focus:ring-blue-100 transition-all placeholder:font-normal placeholder:text-slate-300" />
                        </td>
                        <td className="px-2 py-2.5 bg-blue-50/20">
                          <input type="number" step="0.01" min="0" value={line.debit} onChange={(e) => handleDebitChange(line.id, e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLine(); } }}
                            placeholder="0.00" dir="ltr" disabled={!!line.credit && parseFloat(line.credit) > 0}
                            title={line.credit && parseFloat(line.credit) > 0 ? "أدخل قيمة دائن بالفعل — امسحها أولاً" : "أدخل المدين (يمسح الدائن تلقائياً)"}
                            className="w-full h-9 bg-white border border-blue-100 rounded-xl px-2 text-center text-xs font-mono font-black text-[#1E3A8A] focus:outline-none focus:border-[#1E3A8A] focus:ring-2 focus:ring-blue-100 transition-all placeholder:font-normal placeholder:text-slate-300 disabled:bg-slate-50 disabled:text-slate-300 disabled:cursor-not-allowed" />
                        </td>
                        <td className="px-2 py-2.5 bg-purple-50/20">
                          <input type="number" step="0.01" min="0" value={line.credit} onChange={(e) => handleCreditChange(line.id, e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLine(); } }}
                            placeholder="0.00" dir="ltr" disabled={!!line.debit && parseFloat(line.debit) > 0}
                            title={line.debit && parseFloat(line.debit) > 0 ? "أدخل قيمة مدين بالفعل — امسحها أولاً" : "أدخل الدائن (يمسح المدين تلقائياً)"}
                            className="w-full h-9 bg-white border border-purple-100 rounded-xl px-2 text-center text-xs font-mono font-black text-purple-700 focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100 transition-all placeholder:font-normal placeholder:text-slate-300 disabled:bg-slate-50 disabled:text-slate-300 disabled:cursor-not-allowed" />
                        </td>
                        <td className="px-2 py-2.5">
                          <select value={line.cost_center} onChange={(e) => updateLine(line.id, "cost_center", e.target.value)}
                            className="w-full h-9 bg-white border border-slate-200 rounded-xl px-2 text-xs font-bold text-slate-700 focus:outline-none focus:border-[#1E3A8A] cursor-pointer">
                            {COST_CENTERS.map((cc) => <option key={cc} value={cc}>{cc}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-2.5">
                          <div className="flex items-center justify-center gap-1">
                            <button type="button" onClick={() => duplicateLine(line.id)} title="تكرار السطر"
                              className="w-8 h-8 rounded-lg hover:bg-purple-100 text-slate-400 hover:text-purple-600 transition-all flex items-center justify-center cursor-pointer">
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                            <button type="button" onClick={() => removeLine(line.id)} title="حذف السطر"
                              className="w-8 h-8 rounded-lg hover:bg-rose-100 text-slate-400 hover:text-rose-600 transition-all flex items-center justify-center cursor-pointer">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* ─── شريط الإجماليات اللاصق ─── */}
            <div className="sticky bottom-0 z-10 bg-white/95 backdrop-blur-sm border-t-2 border-[#1E3A8A]/10 px-6 py-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <div>
                  <span className="text-[10px] font-bold text-slate-400 block">إجمالي المدين</span>
                  <span className="font-mono font-black text-lg text-[#1E3A8A] leading-tight" dir="ltr">{fmt(totalDebit)}</span>
                </div>
                <div className="w-px h-9 bg-slate-200 hidden sm:block" />
                <div>
                  <span className="text-[10px] font-bold text-slate-400 block">إجمالي الدائن</span>
                  <span className="font-mono font-black text-lg text-purple-700 leading-tight" dir="ltr">{fmt(totalCredit)}</span>
                </div>
                <div className="w-px h-9 bg-slate-200 hidden sm:block" />
                <div>
                  <span className="text-[10px] font-bold text-slate-400 block">الفرق</span>
                  <span className={`font-mono font-black text-lg leading-tight ${diff > 0 ? "text-rose-600" : "text-emerald-600"}`} dir="ltr">{fmt(diff)}</span>
                </div>
              </div>
              {balanced ? (
                <motion.span initial={{ scale: 0.9 }} animate={{ scale: 1 }}
                  className="flex items-center gap-2 bg-emerald-100 text-emerald-700 border border-emerald-200 text-xs font-black px-4 py-2 rounded-xl">
                  <CheckCircle2 className="w-4 h-4" />
                  القيد متوازن ✓
                </motion.span>
              ) : (
                <motion.span initial={{ scale: 0.9 }} animate={{ scale: 1 }}
                  className="flex flex-col items-center bg-rose-100 text-rose-700 border border-rose-200 px-4 py-1.5 rounded-xl">
                  <span className="flex items-center gap-1.5 text-xs font-black">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    الفرق: <span dir="ltr">{fmt(diff)}</span>
                  </span>
                  <span className="text-[9px] font-bold text-rose-500">
                    {totalDebit > totalCredit ? "المدين أكبر — أكمل الدائن" : "الدائن أكبر — أكمل المدين"}
                  </span>
                </motion.span>
              )}
            </div>

            {/* ─── أزرار إدارة البنود ─── */}
            <div className="px-6 py-3.5 border-t border-slate-100 bg-[#FAFBFD] flex flex-wrap items-center gap-2.5">
              <button type="button" onClick={addLine}
                className="flex items-center gap-2 bg-white border border-[#1E3A8A]/20 text-[#1E3A8A] hover:bg-blue-50 px-4 py-2 rounded-xl font-black text-xs transition-all shadow-sm cursor-pointer">
                <Plus className="w-4 h-4" />
                إضافة سطر
              </button>
              <button type="button" onClick={clearAllLines}
                className="flex items-center gap-2 bg-white border border-rose-200 text-rose-600 hover:bg-rose-50 px-4 py-2 rounded-xl font-black text-xs transition-all shadow-sm cursor-pointer">
                <Trash2 className="w-4 h-4" />
                مسح الكل
              </button>
              <div className="mr-auto flex items-center gap-2">
                <button type="button" onClick={reverseEntry} title="إضافة بنود عكسية (قلب المدين والدائن)"
                  className="flex items-center gap-1.5 bg-white border border-amber-200 text-amber-700 hover:bg-amber-50 px-3.5 py-2 rounded-xl font-bold text-xs transition-all shadow-sm cursor-pointer">
                  <ClipboardList className="w-3.5 h-3.5" />
                  قيد عكسي
                </button>
                <button type="button" onClick={copyEntry} title="نسخ القيد بكود جديد"
                  className="flex items-center gap-1.5 bg-white border border-purple-200 text-purple-700 hover:bg-purple-50 px-3.5 py-2 rounded-xl font-bold text-xs transition-all shadow-sm cursor-pointer">
                  <Copy className="w-3.5 h-3.5" />
                  نسخ القيد
                </button>
              </div>
            </div>
          </div>

          {/* ═══ الشريط الجانبي (يسار الديسكتوب) ═══ */}
          <div className="space-y-4">

            {/* بطاقة التوازن */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-8 h-8 rounded-xl bg-[#1E3A8A]/8 flex items-center justify-center">
                  <Scale className="w-4 h-4 text-[#1E3A8A]" />
                </div>
                <h3 className="text-sm font-black text-slate-800">توازن القيد</h3>
              </div>
              <div className="space-y-2.5">
                <div className="flex justify-between items-center p-3 bg-[#1E3A8A]/5 rounded-xl">
                  <span className="text-xs font-bold text-slate-500">إجمالي المدين</span>
                  <span className="font-mono font-black text-[#1E3A8A]" dir="ltr">{fmt(totalDebit)}</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-purple-50 rounded-xl">
                  <span className="text-xs font-bold text-slate-500">إجمالي الدائن</span>
                  <span className="font-mono font-black text-purple-700" dir="ltr">{fmt(totalCredit)}</span>
                </div>

                {/* شريط نسبة التوازن */}
                <div className="pt-1">
                  <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden flex">
                    <div className="bg-[#1E3A8A] h-full transition-all duration-500" style={{ width: `${debitShare}%` }} />
                    <div className="bg-purple-400 h-full transition-all duration-500" style={{ width: `${100 - debitShare}%` }} />
                  </div>
                  <div className="flex justify-between mt-1.5">
                    <span className="text-[9px] font-black text-[#1E3A8A]">مدين {Math.round(debitShare)}%</span>
                    <span className="text-[9px] font-black text-purple-500">دائن {Math.round(100 - debitShare)}%</span>
                  </div>
                </div>

                {balanced ? (
                  <div className="flex items-center gap-2.5 p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                    <div>
                      <p className="text-xs font-black text-emerald-800">القيد متوازن ✓</p>
                      <p className="text-[10px] text-emerald-600 font-bold">جاهز للاعتماد والترحيل</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2.5 p-3 bg-rose-50 rounded-xl border border-rose-100">
                    <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
                    <div>
                      <p className="text-xs font-black text-rose-800">الفرق: <span dir="ltr">{fmt(diff)}</span> غير متزن</p>
                      <p className="text-[10px] text-rose-600 font-bold">
                        {totalDebit > totalCredit ? `أضف ${fmt(diff)} في خانة الدائن` : `أضف ${fmt(diff)} في خانة المدين`}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* أحدث القيود */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-black text-slate-800 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-[#1E3A8A]" />
                  أحدث القيود
                </h3>
                <button onClick={() => { setEditor(null); setMode("list"); }}
                  className="text-[11px] font-black text-[#1E3A8A] hover:underline cursor-pointer">
                  عرض الكل
                </button>
              </div>
              <div className="space-y-1.5">
                {entries.slice(0, 5).map((e) => (
                  <button key={e.id} onClick={() => openRecentEntry(e)}
                    className="w-full flex items-center gap-3 p-2.5 hover:bg-slate-50 rounded-xl transition-colors text-right cursor-pointer group">
                    <div className="w-9 h-9 rounded-xl bg-[#1E3A8A]/5 flex items-center justify-center shrink-0 group-hover:bg-[#1E3A8A]/10 transition-colors">
                      <FileText className="w-4 h-4 text-[#1E3A8A]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-black text-slate-700 truncate">{e.description || e.code}</p>
                      <p className="text-[10px] text-slate-400 font-bold" dir="ltr">{e.code} • {e.date}</p>
                    </div>
                    <ChevronLeft className="w-3.5 h-3.5 text-slate-300 group-hover:text-[#1E3A8A] transition-colors" />
                  </button>
                ))}
                {entries.length === 0 && (
                  <p className="text-center text-[11px] text-slate-400 py-6 font-bold">لا توجد قيود سابقة بعد</p>
                )}
              </div>
            </div>

            {/* نصائح سريعة */}
            <div className="bg-gradient-to-bl from-[#1E3A8A]/5 via-blue-50 to-indigo-50 rounded-2xl border border-blue-100 p-5">
              <div className="flex items-center gap-2 mb-3">
                <Lightbulb className="w-4 h-4 text-amber-500" />
                <h3 className="text-sm font-black text-slate-800">نصائح سريعة</h3>
              </div>
              <ul className="space-y-2.5">
                {[
                  "اضغط Enter في أي خانة بالجدول لإضافة سطر جديد فوراً",
                  "إدخال مدين يمسح الدائن تلقائياً في نفس السطر والعكس",
                  "لا يمكن اعتماد القيد إلا إذا تساوى المدين مع الدائن تماماً",
                  "لا يمكن تكرار نفس الحساب في أكثر من سطر داخل القيد الواحد",
                  "استخدم «قيد عكسي» لعكس بنود القيد أو «نسخ القيد» لإنشاء نسخة جديدة",
                ].map((tip, i) => (
                  <li key={i} className="flex gap-2 text-[11px] font-bold text-slate-600 leading-relaxed">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#1E3A8A] mt-1.5 shrink-0" />
                    {tip}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
