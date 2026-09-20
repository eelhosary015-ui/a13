import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
  Legend,
} from 'recharts';
import { FileText, Printer, Download, Calendar, BarChart3, PieChart as PieIcon, Layers, TrendingUp } from 'lucide-react';
import * as XLSX from 'xlsx';
import { downloadDataAsPdf } from '../../utils/pdfExport';

interface CostsReportsDetailsProps {
  reportId: string;
  costs: any[];
  centers: any[];
  items: any[];
  budgets: any[];
}

type ReportRow = {
  name: string;
  value: number;
  actual?: number;
  count?: number;
  [key: string]: any;
};

const COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

const amountOf = (row: any) => Number(row?.amount ?? row?.total ?? 0) || 0;
const cleanId = (id: string) => (id || '').startsWith('report_') ? id : `report_${id || 'op_summary'}`;

export const CostsReportsDetails: React.FC<CostsReportsDetailsProps> = ({ reportId, costs = [], centers = [], items = [], budgets = [] }) => {
  const normalizedReportId = cleanId(reportId);

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 2 }).format(Number(amount || 0));

  const getLabel = (row: any, fields: string[], fallback = 'غير محدد') => {
    for (const field of fields) {
      const value = row?.[field];
      if (value !== null && value !== undefined && String(value).trim() !== '') return String(value);
    }
    return fallback;
  };

  const aggregate = (rows: any[], labelFields: string[]): ReportRow[] => {
    const map = new Map<string, { value: number; count: number }>();
    rows.forEach(row => {
      const name = getLabel(row, labelFields);
      const current = map.get(name) || { value: 0, count: 0 };
      current.value += amountOf(row);
      current.count += 1;
      map.set(name, current);
    });
    return Array.from(map.entries())
      .map(([name, v]) => ({ name, value: v.value, count: v.count }))
      .sort((a, b) => b.value - a.value);
  };

  const dateRows = (rows: any[], mode: 'day' | 'week' | 'month' | 'year'): ReportRow[] => {
    const map = new Map<string, { value: number; count: number; sort: number }>();
    rows.forEach(row => {
      const date = new Date(row.date);
      if (Number.isNaN(date.getTime())) return;
      let name = '';
      let sort = date.getTime();
      if (mode === 'day') {
        name = date.toLocaleDateString('ar-EG');
      } else if (mode === 'week') {
        const d = new Date(date);
        const day = d.getDay() || 7;
        d.setDate(d.getDate() - day + 1);
        name = `أسبوع ${d.toLocaleDateString('ar-EG')}`;
        sort = d.getTime();
      } else if (mode === 'month') {
        name = `${MONTHS_AR[date.getMonth()]} ${date.getFullYear()}`;
        sort = new Date(date.getFullYear(), date.getMonth(), 1).getTime();
      } else {
        name = String(date.getFullYear());
        sort = new Date(date.getFullYear(), 0, 1).getTime();
      }
      const current = map.get(name) || { value: 0, count: 0, sort };
      current.value += amountOf(row);
      current.count += 1;
      map.set(name, current);
    });
    return Array.from(map.entries())
      .map(([name, v]) => ({ name, value: v.value, count: v.count, sort: v.sort }))
      .sort((a, b) => a.sort - b.sort)
      .map(({ name, value, count }) => ({ name, value, count }));
  };

  const filteredByStatus = (status: string) => costs.filter(c => {
    const s = String(c.approval_status ?? c.status ?? '').toLowerCase();
    return status === 'approved'
      ? ['approved', 'معتمد', 'موافق عليه', 'مقبول'].includes(s)
      : ['pending', 'pending approval', 'معلق', 'قيد الاعتماد', 'draft'].includes(s);
  });

  const reportData = useMemo(() => {
    const id = normalizedReportId;
    let rows: ReportRow[] = [];
    let chart: 'table' | 'bar' | 'pie' | 'line' = 'table';
    let title = 'تقرير التكاليف';
    let description = 'تقرير فعلي مبني على بيانات مديول التكاليف';

    switch (id) {
      case 'report_op_summary':
        title = 'ملخص التكاليف';
        description = 'إجمالي التكاليف التشغيلية موزعاً حسب التصنيف الفعلي';
        rows = aggregate(costs, ['category', 'cost_type', 'department']);
        chart = 'bar';
        break;
      case 'report_op_daily':
        title = 'تقرير التكاليف اليومية';
        description = 'حركة التكاليف الفعلية حسب يوم التسجيل';
        rows = dateRows(costs, 'day');
        chart = 'line';
        break;
      case 'report_op_weekly':
        title = 'تقرير التكاليف الأسبوعية';
        description = 'حركة التكاليف الفعلية حسب الأسبوع';
        rows = dateRows(costs, 'week');
        chart = 'line';
        break;
      case 'report_op_monthly':
        title = 'تقرير التكاليف الشهرية';
        description = 'التطور الشهري للإنفاق التشغيلي الفعلي';
        rows = dateRows(costs, 'month');
        chart = 'bar';
        break;
      case 'report_op_yearly':
        title = 'تقرير التكاليف السنوية';
        description = 'إجمالي التكاليف الفعلية حسب السنة المالية';
        rows = dateRows(costs, 'year');
        chart = 'bar';
        break;
      case 'report_op_transactions':
        title = 'تقرير عمليات التكاليف';
        description = 'سجل تفصيلي لكل عمليات التكاليف المسجلة';
        rows = [...costs].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map(c => ({
          name: getLabel(c, ['voucher_no', 'id']),
          value: amountOf(c),
          count: 1,
          date: c.date,
          category: getLabel(c, ['category', 'cost_type']),
          center: getLabel(c, ['cost_center_name', 'department']),
          branch: getLabel(c, ['branch']),
          status: getLabel(c, ['approval_status', 'status']),
        }));
        break;
      case 'report_op_approved':
        title = 'تقرير العمليات المعتمدة';
        description = 'جميع عمليات التكاليف التي تم اعتمادها فعلياً';
        rows = dateRows(filteredByStatus('approved'), 'day');
        chart = 'bar';
        break;
      case 'report_op_pending':
        title = 'تقرير العمليات المعلقة';
        description = 'عمليات التكاليف التي ما زالت في انتظار الاعتماد';
        rows = dateRows(filteredByStatus('pending'), 'day');
        chart = 'bar';
        break;
      case 'report_cc_all':
      case 'report_cc_compare':
      case 'report_cc_highest':
      case 'report_cc_lowest':
      case 'report_chart_center':
      case 'report_chart_top_centers':
      case 'report_ana_center':
        title = id === 'report_cc_all' ? 'تقرير مراكز التكلفة' : 'تحليل مراكز التكلفة';
        description = 'إجمالي التكاليف الفعلية لكل مركز تكلفة';
        rows = aggregate(costs, ['cost_center_name', 'center', 'department']);
        if (id === 'report_cc_highest' || id === 'report_chart_top_centers') rows = rows.slice(0, 10);
        if (id === 'report_cc_lowest') rows = [...rows].sort((a, b) => a.value - b.value).slice(0, 10);
        chart = id === 'report_ana_center' ? 'pie' : 'bar';
        break;
      case 'report_cc_dept':
      case 'report_emp_dept':
      case 'report_emp_admin':
        title = id === 'report_cc_dept' ? 'تكلفة كل إدارة' : 'تكلفة الأقسام والإدارات';
        description = 'التكلفة الفعلية موزعة حسب الإدارة';
        rows = aggregate(costs, ['department']);
        chart = 'bar';
        break;
      case 'report_item_all':
      case 'report_item_expense':
      case 'report_item_compare':
      case 'report_item_highest':
      case 'report_chart_top_expenses':
      case 'report_ana_item':
        title = 'تقرير عناصر التكلفة';
        description = 'التكاليف الفعلية موزعة حسب بند التكلفة';
        rows = aggregate(costs, ['cost_item_name', 'item', 'category', 'cost_type']);
        if (id === 'report_item_highest' || id === 'report_chart_top_expenses') rows = rows.slice(0, 10);
        chart = id === 'report_ana_item' ? 'pie' : 'bar';
        break;
      case 'report_branch_cost':
      case 'report_branch_compare':
      case 'report_branch_profit':
      case 'report_chart_branch':
      case 'report_ana_branch':
        title = 'تقرير تكاليف الفروع';
        description = 'إجمالي المصروفات والتكاليف الفعلية لكل فرع';
        rows = aggregate(costs, ['branch']);
        chart = id === 'report_ana_branch' ? 'pie' : 'bar';
        break;
      case 'report_proj_cost':
      case 'report_proj_profit':
      case 'report_proj_progress':
      case 'report_proj_compare':
      case 'report_ana_project':
        title = 'تقرير تكاليف المشاريع';
        description = 'التكاليف الفعلية المرتبطة بكل مشروع';
        rows = aggregate(costs, ['project']);
        chart = id === 'report_ana_project' ? 'pie' : 'bar';
        break;
      case 'report_emp_cost':
      case 'report_emp_labor':
        title = 'تقرير تكلفة الموظفين والعمالة';
        description = 'التكاليف الفعلية المرتبطة بالموظفين';
        rows = aggregate(costs, ['employee', 'employee_name', 'department']);
        chart = 'bar';
        break;
      case 'report_ana_supplier':
        title = 'تحليل التكاليف حسب المورد';
        description = 'إجمالي الإنفاق الفعلي لكل مورد';
        rows = aggregate(costs, ['supplier']);
        chart = 'pie';
        break;
      case 'report_ana_customer':
        title = 'تحليل التكاليف حسب العميل';
        description = 'التكاليف الفعلية المرتبطة بالعملاء';
        rows = aggregate(costs, ['customer']);
        chart = 'pie';
        break;
      case 'report_ana_product':
      case 'report_chart_product':
      case 'report_chart_top_products':
      case 'report_prod_cost':
      case 'report_prod_unit':
      case 'report_prod_material':
      case 'report_prod_operation':
        title = 'تقرير تكلفة المنتجات';
        description = 'التكاليف الفعلية المرتبطة بالمنتجات والأصناف';
        rows = aggregate(costs, ['product', 'product_name', 'cost_item_name']);
        if (id === 'report_chart_top_products') rows = rows.slice(0, 10);
        chart = id === 'report_ana_product' || id === 'report_chart_product' ? 'pie' : 'bar';
        break;
      case 'report_budget_actual':
      case 'report_budget_consumption':
      case 'report_budget_remaining':
      case 'report_budget_exceeded':
      case 'report_chart_budget': {
        title = 'تقرير الموازنة مقابل الفعلي';
        description = 'مقارنة الموازنة المسجلة مع التكلفة الفعلية من العمليات';
        const actualByKey = new Map<string, number>();
        costs.forEach(c => {
          const key = `${c.cost_center_id ?? ''}|${c.cost_item_id ?? ''}`;
          actualByKey.set(key, (actualByKey.get(key) || 0) + amountOf(c));
        });
        rows = budgets.map(b => {
          const key = `${b.cost_center_id ?? ''}|${b.cost_item_id ?? ''}`;
          const actual = actualByKey.get(key) || 0;
          const name = getLabel(b, ['cost_center_name', 'cost_item_name'], `${b.month || ''} ${b.year || ''}`.trim());
          return { name, value: Number(b.amount || 0), actual };
        });
        if (id === 'report_budget_remaining') rows = rows.map(r => ({ ...r, value: Math.max(0, r.value - (r.actual || 0)) }));
        if (id === 'report_budget_exceeded') rows = rows.filter(r => (r.actual || 0) > r.value);
        chart = 'bar';
        break;
      }
      case 'report_var_standard':
      case 'report_var_ratio':
      case 'report_var_reasons':
      case 'report_var_highest':
      case 'report_chart_variance':
        title = 'تحليل الانحرافات';
        description = 'مقارنة القيم المخططة أو المعيارية بالقيم الفعلية المتاحة';
        rows = budgets.map(b => {
          const key = `${b.cost_center_id ?? ''}|${b.cost_item_id ?? ''}`;
          const actual = costs.filter(c => `${c.cost_center_id ?? ''}|${c.cost_item_id ?? ''}` === key).reduce((s, c) => s + amountOf(c), 0);
          return { name: getLabel(b, ['cost_center_name', 'cost_item_name']), value: Number(b.amount || 0), actual };
        }).map(r => ({ ...r, variance: (r.actual || 0) - r.value }));
        rows.sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));
        chart = 'bar';
        break;
      case 'report_ana_period':
      case 'report_chart_trend':
      case 'report_chart_monthly':
      case 'report_chart_period_compare':
        title = 'تحليل التكاليف حسب الفترة';
        description = 'اتجاه التكاليف الفعلية عبر الزمن';
        rows = dateRows(costs, 'month');
        chart = id === 'report_chart_trend' || id === 'report_ana_period' || id === 'report_chart_period_compare' ? 'line' : 'bar';
        break;
      default:
        title = 'تقرير التكاليف';
        rows = aggregate(costs, ['category', 'cost_item_name', 'department']);
        chart = 'bar';
        break;
    }

    return { title, description, rows, chart };
  }, [normalizedReportId, costs, budgets]);

  const total = reportData.rows.reduce((sum, row) => sum + Number(row.value || 0), 0);
  const hasData = reportData.rows.length > 0 && total > 0;

  const printReport = () => window.print();

  const exportRows = () => reportData.rows.map(row => [
    row.name,
    Number(row.value || 0).toFixed(2),
    row.actual === undefined ? '' : Number(row.actual || 0).toFixed(2),
    row.count ?? ''
  ]);

  const exportCsv = () => {
    const headers = ['البند', 'القيمة', 'الفعلي', 'عدد العمليات'];
    const lines = reportData.rows.map(row => [
      row.name,
      Number(row.value || 0).toFixed(2),
      row.actual === undefined ? '' : Number(row.actual || 0).toFixed(2),
      row.count ?? '',
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const csv = '\ufeff' + [headers.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${normalizedReportId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportExcel = () => {
    const sheet = XLSX.utils.aoa_to_sheet([['البند', 'القيمة', 'الفعلي', 'عدد العمليات'], ...exportRows()]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'التقرير');
    XLSX.writeFile(workbook, `${normalizedReportId}.xlsx`);
  };

  const exportPdf = async () => {
    await downloadDataAsPdf(['البند', 'القيمة', 'الفعلي', 'عدد العمليات'], exportRows(), normalizedReportId, reportData.title);
  };

  const renderChart = () => {
    if (!hasData) return null;
    if (reportData.chart === 'pie') {
      return (
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={reportData.rows.slice(0, 12)} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={70} outerRadius={120} paddingAngle={3}>
                {reportData.rows.slice(0, 12).map((_, index) => <Cell key={index} fill={COLORS[index % COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(value: any) => formatCurrency(Number(value || 0))} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      );
    }
    if (reportData.chart === 'line') {
      return (
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={reportData.rows}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(value: any) => formatCurrency(Number(value || 0))} />
              <Line type="monotone" dataKey="value" stroke="#4f46e5" strokeWidth={3} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      );
    }
    return (
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={reportData.rows.slice(0, 20)}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip formatter={(value: any) => formatCurrency(Number(value || 0))} />
            {reportData.rows.some(r => r.actual !== undefined) && <Legend />}
            <Bar dataKey="value" name="الموازنة / القيمة" fill="#4f46e5" radius={[4, 4, 0, 0]} />
            {reportData.rows.some(r => r.actual !== undefined) && <Bar dataKey="actual" name="الفعلي" fill="#10b981" radius={[4, 4, 0, 0]} />}
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  };

  return (
    <div className="space-y-6 animate-fade-in pb-12" dir="rtl">
      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4 bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center">
            <FileText className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-800">{reportData.title}</h2>
            <p className="text-sm text-slate-500 mt-1">{reportData.description}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={printReport} className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium">
            <Printer className="w-4 h-4" /> طباعة
          </button>
          <button onClick={exportCsv} className="flex items-center gap-2 px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg font-medium">
            <Download className="w-4 h-4" /> تصدير CSV
          </button>
          <button onClick={exportExcel} className="flex items-center gap-2 px-4 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg font-medium">
            <Download className="w-4 h-4" /> Excel
          </button>
          <button onClick={exportPdf} className="flex items-center gap-2 px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg font-medium">
            <FileText className="w-4 h-4" /> PDF
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-xs text-slate-500">عدد السجلات</div>
          <div className="text-2xl font-black text-slate-900 mt-1">{reportData.rows.length.toLocaleString('ar-EG')}</div>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-xs text-slate-500">إجمالي القيمة</div>
          <div className="text-2xl font-black text-indigo-700 mt-1">{formatCurrency(total)}</div>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-xs text-slate-500">إجمالي عمليات التكاليف</div>
          <div className="text-2xl font-black text-slate-900 mt-1">{costs.length.toLocaleString('ar-EG')}</div>
        </div>
      </div>

      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
        {hasData && reportData.chart !== 'table' && <div className="mb-8">{renderChart()}</div>}

        {!hasData ? (
          <div className="py-20 flex flex-col items-center justify-center text-slate-400 text-center">
            <BarChart3 className="w-16 h-16 text-slate-300 mb-4" />
            <h3 className="text-lg font-bold text-slate-600">لا توجد بيانات فعلية لهذا التقرير</h3>
            <p className="text-sm mt-2">قم بتسجيل عمليات تكاليف أو ضبط الموازنة والفترة الزمنية ثم أعد فتح التقرير.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right">
              <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                <tr>
                  <th className="px-4 py-4">البند</th>
                  <th className="px-4 py-4">القيمة</th>
                  {reportData.rows.some(r => r.actual !== undefined) && <th className="px-4 py-4">الفعلي</th>}
                  <th className="px-4 py-4">عدد العمليات</th>
                  <th className="px-4 py-4">النسبة</th>
                </tr>
              </thead>
              <tbody>
                {reportData.rows.map((row, index) => {
                  const percentage = total > 0 ? (Number(row.value || 0) / total) * 100 : 0;
                  return (
                    <tr key={`${row.name}-${index}`} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-4 font-medium text-slate-800">{row.name}</td>
                      <td className="px-4 py-4 font-mono font-medium text-slate-700">{formatCurrency(row.value)}</td>
                      {reportData.rows.some(r => r.actual !== undefined) && <td className="px-4 py-4 font-mono font-medium text-emerald-700">{row.actual === undefined ? '-' : formatCurrency(row.actual)}</td>}
                      <td className="px-4 py-4 text-slate-600">{row.count === undefined ? '-' : row.count.toLocaleString('ar-EG')}</td>
                      <td className="px-4 py-4 min-w-44">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-500 w-12">{percentage.toFixed(1)}%</span>
                          <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${Math.min(100, Math.max(0, percentage))}%` }} />
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-slate-50 font-bold text-slate-800 border-t-2 border-slate-200">
                <tr>
                  <td className="px-4 py-4">الإجمالي</td>
                  <td className="px-4 py-4 font-mono">{formatCurrency(total)}</td>
                  {reportData.rows.some(r => r.actual !== undefined) && <td className="px-4 py-4 font-mono">{formatCurrency(reportData.rows.reduce((s, r) => s + Number(r.actual || 0), 0))}</td>}
                  <td className="px-4 py-4">{reportData.rows.reduce((s, r) => s + Number(r.count || 0), 0).toLocaleString('ar-EG')}</td>
                  <td className="px-4 py-4">100%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
