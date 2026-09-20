import React, { useState, useEffect } from 'react';
import { 
  FileText, Search, Printer, Calendar, Filter, RotateCcw, 
  CheckCircle2, AlertTriangle, Layers, Package, ShieldCheck, 
  ArrowRightLeft, FileDown, Sheet, TrendingUp, ChevronLeft,
  Wrench, Activity, Clock, Zap, Hash, DollarSign, Building2,
  Users, Percent, BarChart3, PieChart, Tag, CheckCircle, Info
} from 'lucide-react';
import { downloadDataAsWord } from '../../utils/wordExport';
import { databaseStorage } from '../../utils/databaseStorage';

interface ProductReportData {
  code: string;
  name: string;
  category: string;
  type: string;
  unit: string;
  brand: string;
  currentStock: number;
  plmStatus: string;
  version: string;
  minQty: number;
  maxQty: number;
  unitCost?: number;
}

interface OrderReportData {
  orderNumber: string;
  productName: string;
  productId: string;
  quantity: number;
  startDate: string;
  endDate: string;
  priority: 'high' | 'normal' | 'low';
  status: 'draft' | 'pending' | 'in_progress' | 'completed' | 'paused' | 'cancelled';
  supervisor: string;
  progress: number;
  totalCost?: number;
}

interface QualityCheckReportData {
  id: string;
  qcpTitle: string;
  orderNumber: string;
  productName: string;
  status: 'accepted' | 'rejected';
  inspector: string;
  checkedDate: string;
  testType: string;
  measuredValue: number;
  unit?: string;
  notes: string;
}

interface TransferredReportData {
  transferId: string;
  orderNumber: string;
  productName: string;
  productId: string;
  quantityTransferred: number;
  unit: string;
  transferredBy: string;
  transferDate: string;
  targetWarehouse: string;
  batchNumber: string;
  status: 'transferred' | 'approved' | 'pending_receipt';
}

interface EfficiencyReportData {
  line: string;
  target: number;
  actual: number;
  oee: number;
  availability: number;
  performance: number;
  quality: number;
  downtimeHrs: number;
  supervisor: string;
}

interface MaintenanceReportData {
  code: string;
  name: string;
  type: 'وقائية' | 'طارئة' | 'دورية';
  task: string;
  tech: string;
  date: string;
  cost: number;
  status: 'completed' | 'in_progress' | 'scheduled';
}

interface BomWasteReportData {
  bomCode: string;
  productName: string;
  standardQty: number;
  actualUsed: number;
  scrapQty: number;
  unit: string;
  variancePct: number;
  wasteCost: number;
  status: 'optimal' | 'within_limit' | 'exceeded';
}

type SubTabType = 'orders' | 'products' | 'quality' | 'transferred' | 'efficiency' | 'maintenance' | 'bom_waste';

const REPORT_TITLES: Record<string, { title: string; subtitle: string; subTab: SubTabType }> = {
  // Operational & Orders
  report_op_summary: { title: "تقرير ملخص تكاليف وأوامر الإنتاج", subtitle: "إجمالي التكاليف وحجم أوامر التشغيل المنجزة والمعلقة", subTab: "orders" },
  report_op_daily: { title: "تقرير التكاليف والإنتاج اليومي", subtitle: "متابعة الإنتاج والتكاليف على مدار ساعات العمل اليومية", subTab: "orders" },
  report_op_weekly: { title: "تقرير التكاليف والإنتاج الأسبوعي", subtitle: "حركة خطوط الإنتاج والتكاليف الأسبوعية المقارنة", subTab: "orders" },
  report_op_monthly: { title: "تقرير التكاليف والإنتاج الشهري", subtitle: "الأداء المالي والإنتاجي الشهري للمصنع", subTab: "orders" },
  report_op_yearly: { title: "تقرير التكاليف والإنتاج السنوي", subtitle: "الملخص السنوي لأوامر التشغيل وتكلفة المخرجات", subTab: "orders" },
  report_op_transactions: { title: "تقرير حركة عمليات التكاليف والإنتاج", subtitle: "سجل العمليات الدقيقة على خطوط الإنتاج", subTab: "orders" },
  report_op_approved: { title: "تقرير العمليات والأوامر المعتمدة", subtitle: "أوامر الإنتاج المعتمدة ومطابقتها للمعايير", subTab: "orders" },
  report_op_pending: { title: "تقرير العمليات والأوامر المعلقة", subtitle: "الأوامر قيد الانتظار أو التجهيز بالصالة", subTab: "orders" },
  orders_report: { title: "تقرير حركة أوامر الإنتاج والتشغيل", subtitle: "مراقبة وتتبع الوجبات وأوامر العمل بصالات التصنيع", subTab: "orders" },

  // Cost Centers & Transfers
  report_cc_all: { title: "تقرير مراكز التكلفة وصالات التصنيع", subtitle: "تحليل المصروفات والإنتاجية لكل مركز تكلفة", subTab: "transferred" },
  report_cc_compare: { title: "تقرير مقارنة مراكز التكلفة", subtitle: "مقارنة التكاليف والمخرجات بين خطوط الإنتاج المختلفة", subTab: "transferred" },
  report_cc_highest: { title: "تقرير أعلى مراكز التكلفة استهلاكاً", subtitle: "المراكز الأعلى في استهلاك الخامات والتشغيل", subTab: "transferred" },
  report_cc_lowest: { title: "تقرير أقل مراكز التكلفة استهلاكاً", subtitle: "المراكز الأكثر كفاءة في ضبط التكاليف", subTab: "transferred" },
  report_cc_dept: { title: "تقرير تكلفة خطوط وإدارات الإنتاج", subtitle: "توزيع التكاليف على الإدارات الصناعية", subTab: "transferred" },
  transferred_report: { title: "تقرير المنتجات المرحلة للمستودعات", subtitle: "سندات ترحيل وتسليم الحصيلة التامة للمخازن", subTab: "transferred" },

  // Products & Items
  report_item_all: { title: "تقرير عناصر تكاليف الخامات والتشغيل", subtitle: "تفاصيل عناصر التكلفة المباشرة وغير المباشرة", subTab: "products" },
  report_item_expense: { title: "تقرير المصروفات حسب عنصر التكلفة", subtitle: "تحليل مصروفات الخامات والوقود والمستلزمات", subTab: "products" },
  report_item_compare: { title: "مقارنة عناصر التكلفة بين الفترات", subtitle: "تطور أسعار واستهلاك عناصر التكلفة", subTab: "products" },
  report_item_highest: { title: "أعلى عناصر التكلفة تأثيراً على المنتج", subtitle: "العناصر الرئيسية المكونة لسياسة التسعير", subTab: "products" },
  report_prod_cost: { title: "تقرير تكاليف المنتجات والتصنيع", subtitle: "تحليل إجمالي تكلفة المنتج النهائي والنصف تصنيع", subTab: "products" },
  report_prod_unit: { title: "تقرير تكلفة الوحدة المنتجة", subtitle: "حساب التكلفة الفردية لكل وحدة منتجة بالدقة", subTab: "products" },
  report_prod_margin: { title: "تقرير هامش الربح والربحية للمنتجات", subtitle: "مقارنة سعر البيع بتكلفة التصنيع الفعلية", subTab: "products" },
  report_prod_material: { title: "تقرير تكلفة المواد والخامات المباشرة", subtitle: "تكلفة المواد المكونة للوجبة الصناعية", subTab: "products" },
  report_prod_operation: { title: "تقرير تكاليف التشغيل والعمالة المباشرة", subtitle: "مصروفات التشغيل وساعات الماكينات لكل صنف", subTab: "products" },
  products_report: { title: "تقرير إدارة المنتجات والخامات والمواصفات", subtitle: "الملف الهيكلي للمواد وتحديد الرصيد والـ PLM", subTab: "products" },

  // Quality
  quality_report: { title: "تقرير مراقبة وضمان جودة الإنتاج", subtitle: "سجل الفحوصات الفنية وااختبارات العينات الميدانية", subTab: "quality" },
  report_quality: { title: "تقرير المعايرة واختبارات الجودة", subtitle: "نتائج عينات الجودة ومطابقتها للمواصفات", subTab: "quality" },

  // Efficiency / OEE
  report_oee: { title: "تقرير كفاءة المعدات الشاملة (OEE)", subtitle: "مؤشرات الجاهزية والأداء والجودة للماكينات", subTab: "efficiency" },
  report_chart_trend: { title: "تقرير اتجاهات تكاليف وكفاءة الإنتاج", subtitle: "الرسوم البيانية والتحليل الزمني لمسار التكاليف", subTab: "efficiency" },

  // Maintenance
  report_maintenance: { title: "تقرير صيانة المعدات وأعطال المصنع", subtitle: "سجل الصيانة الوقائية والطارئة وتوقف الماكينات", subTab: "maintenance" },

  // BOM & Waste
  report_bom_waste: { title: "تقرير وصفات التصنيع ونسب الهدر (BOM)", subtitle: "تحليل الانحراف بين الاستهلاك المعياري والفعلي", subTab: "bom_waste" }
};

const resolveSubTabAndTitle = (initialTab?: string): { subTab: SubTabType; specificTitle: string | null; specificSubtitle: string | null } => {
  if (!initialTab) {
    return { subTab: 'orders', specificTitle: null, specificSubtitle: null };
  }

  const mapped = REPORT_TITLES[initialTab];
  if (mapped) {
    return { subTab: mapped.subTab, specificTitle: mapped.title, specificSubtitle: mapped.subtitle };
  }

  const str = initialTab.toLowerCase();
  if (str.includes('prod') || str.includes('item') || str.includes('material')) {
    return { subTab: 'products', specificTitle: null, specificSubtitle: null };
  }
  if (str.includes('quality') || str.includes('qc') || str.includes('inspect')) {
    return { subTab: 'quality', specificTitle: null, specificSubtitle: null };
  }
  if (str.includes('transfer') || str.includes('cc_') || str.includes('branch') || str.includes('wh')) {
    return { subTab: 'transferred', specificTitle: null, specificSubtitle: null };
  }
  if (str.includes('oee') || str.includes('eff') || str.includes('chart') || str.includes('ana') || str.includes('var')) {
    return { subTab: 'efficiency', specificTitle: null, specificSubtitle: null };
  }
  if (str.includes('maint') || str.includes('down')) {
    return { subTab: 'maintenance', specificTitle: null, specificSubtitle: null };
  }
  if (str.includes('bom') || str.includes('scrap') || str.includes('waste')) {
    return { subTab: 'bom_waste', specificTitle: null, specificSubtitle: null };
  }

  return { subTab: 'orders', specificTitle: null, specificSubtitle: null };
};

const FALLBACK_PRODUCTS: ProductReportData[] = [];
const FALLBACK_ORDERS: OrderReportData[] = [];
const FALLBACK_QUALITY_CHECKS: QualityCheckReportData[] = [];
const FALLBACK_TRANSFERS: TransferredReportData[] = [];
const FALLBACK_EFFICIENCY: EfficiencyReportData[] = [];
const FALLBACK_MAINTENANCE: MaintenanceReportData[] = [];
const FALLBACK_BOM_WASTE: BomWasteReportData[] = [];

interface ProductionReportsProps {
  onBack?: () => void;
  initialTab?: string;
}

export function ProductionReports({ onBack, initialTab }: ProductionReportsProps = {}) {
  const resolved = resolveSubTabAndTitle(initialTab);
  const [activeSubTab, setActiveSubTab] = useState<SubTabType>(resolved.subTab);
  const [customTitle, setCustomTitle] = useState<string | null>(resolved.specificTitle);
  const [customSubtitle, setCustomSubtitle] = useState<string | null>(resolved.specificSubtitle);

  useEffect(() => {
    const r = resolveSubTabAndTitle(initialTab);
    setActiveSubTab(r.subTab);
    setCustomTitle(r.specificTitle);
    setCustomSubtitle(r.specificSubtitle);
  }, [initialTab]);
  
  // Filtering States
  const [searchTerm, setSearchTerm] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Data Containers
  const [productsList, setProductsList] = useState<ProductReportData[]>([]);
  const [ordersList, setOrdersList] = useState<OrderReportData[]>([]);
  const [qcList, setQcList] = useState<QualityCheckReportData[]>([]);
  const [transfersList, setTransfersList] = useState<TransferredReportData[]>([]);
  const [efficiencyList] = useState<EfficiencyReportData[]>(FALLBACK_EFFICIENCY);
  const [maintenanceList] = useState<MaintenanceReportData[]>(FALLBACK_MAINTENANCE);
  const [bomWasteList] = useState<BomWasteReportData[]>(FALLBACK_BOM_WASTE);

  useEffect(() => {
    const loadAll = async () => {
      // Products
      const savedProd = await databaseStorage.getItem<any[]>('remo_production_products', []);
      if (savedProd && savedProd.length > 0) {
        const mapped = savedProd.map((p: any) => ({
          code: p.code || 'FIN-000',
          name: p.name || 'منتج مجهول',
          category: p.category || 'العامة',
          type: p.type === 'raw' ? 'خام' : p.type === 'finished' ? 'نهائي' : p.type === 'semi_finished' ? 'نصف مصنع' : 'مواد تشغيل',
          unit: p.unit || 'وحدة',
          brand: p.brand || 'العلامة العامة',
          currentStock: p.inventoryData?.currentStock || 0,
          plmStatus: p.plmStatus || 'approved',
          version: p.version || 'v1.0',
          minQty: p.inventoryData?.minQty || 0,
          maxQty: p.inventoryData?.maxQty || 100,
          unitCost: p.costingData?.standardCost || 50
        }));
        setProductsList(mapped);
      } else {
        setProductsList(FALLBACK_PRODUCTS);
      }

      // Orders
      const savedOrders = await databaseStorage.getItem<any[]>('remo_production_orders', []);
      if (savedOrders && savedOrders.length > 0) {
        const mapped = savedOrders.map((o: any) => ({
          orderNumber: o.orderNumber || 'PRD-UNK',
          productName: o.productName || 'منتج غير معرف',
          productId: o.productId || 'RAW-UNK',
          quantity: o.quantity || 1,
          startDate: o.startDate || '',
          endDate: o.endDate || '',
          priority: o.priority || 'normal',
          status: o.status || 'draft',
          supervisor: o.supervisor || 'فني غير محدد',
          progress: o.progress || 0,
          totalCost: (o.quantity || 1) * 250
        }));
        setOrdersList(mapped);
      } else {
        setOrdersList(FALLBACK_ORDERS);
      }

      // Quality Checks
      const savedQC = await databaseStorage.getItem<any[]>('remo_pro_quality_checks', []);
      if (savedQC && savedQC.length > 0) {
        setQcList(savedQC);
      } else {
        setQcList(FALLBACK_QUALITY_CHECKS);
      }

      // Transfers
      const savedJobs = await databaseStorage.getItem<any[]>('remo_production_jobs', []);
      let generatedTransfers: TransferredReportData[] = [...FALLBACK_TRANSFERS];

      if (savedJobs && savedJobs.length > 0) {
        savedJobs.forEach((job: any) => {
          if (job.producedQty > 0) {
            const matchedOrder = savedOrders.find((o: any) => o.orderNumber === job.orderNumber);
            const prodName = matchedOrder ? matchedOrder.productName : `منتج ${job.id}`;
            const prodCode = matchedOrder ? matchedOrder.productId : 'RAW-UNK';
            
            const transferRecord: TransferredReportData = {
              transferId: `JOB-TR-${job.id}`,
              orderNumber: job.orderNumber,
              productName: prodName,
              productId: prodCode,
              quantityTransferred: job.producedQty,
              unit: 'وحدة',
              transferredBy: job.worker || 'كادر التشغيل الفني',
              transferDate: new Date().toISOString().split('T')[0],
              targetWarehouse: 'مخزن صالة الإنتاج المؤقت',
              batchNumber: `BATCH-${job.orderNumber}-${job.id}`,
              status: job.status === 'completed' ? 'approved' : 'transferred'
            };
            generatedTransfers.push(transferRecord);
          }
        });
      }
      setTransfersList(generatedTransfers);
    };
    loadAll();
  }, []);

  const clearFilters = () => {
    setSearchTerm('');
    setStartDate('');
    setEndDate('');
  };

  const isWithinDateRange = (itemDate?: string) => {
    if (!itemDate) return true;
    const date = new Date(itemDate);
    if (startDate) {
      const start = new Date(startDate);
      if (date < start) return false;
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      if (date > end) return false;
    }
    return true;
  };

  // Filtered Lists
  const filteredProducts = productsList.filter(p => 
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    p.code.toLowerCase().includes(searchTerm.toLowerCase()) || 
    p.category.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredOrders = ordersList.filter(o => {
    const matchesSearch = o.orderNumber.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          o.productName.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          o.productId.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          (o.supervisor || '').toLowerCase().includes(searchTerm.toLowerCase());
    return matchesSearch && (isWithinDateRange(o.startDate) || isWithinDateRange(o.endDate));
  });

  const filteredQC = qcList.filter(q => {
    const matchesSearch = q.id.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          q.productName.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          (q.orderNumber || '').toLowerCase().includes(searchTerm.toLowerCase()) || 
                          q.inspector.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          (q.notes || '').toLowerCase().includes(searchTerm.toLowerCase());
    return matchesSearch && isWithinDateRange(q.checkedDate);
  });

  const filteredTransfers = transfersList.filter(t => {
    const matchesSearch = t.transferId.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          t.productName.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          t.productId.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          t.orderNumber.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          t.targetWarehouse.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          t.transferredBy.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesSearch && isWithinDateRange(t.transferDate);
  });

  const filteredEfficiency = efficiencyList.filter(e => 
    e.line.toLowerCase().includes(searchTerm.toLowerCase()) ||
    e.supervisor.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredMaintenance = maintenanceList.filter(m => {
    const matchesSearch = m.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          m.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          m.task.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          m.tech.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesSearch && isWithinDateRange(m.date);
  });

  const filteredBomWaste = bomWasteList.filter(b => 
    b.bomCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
    b.productName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // --- PRINT FUNCTIONALITY ---
  const handlePrint = () => {
    const printContent = document.getElementById('report-print-area');
    if (!printContent) return;

    const printStyle = `
      <style>
        body { font-family: 'Cairo', 'Arial', sans-serif; direction: rtl; text-align: right; background: white; color: black; padding: 20px; }
        table { width: 100%; border-collapse: collapse; margin-top: 25px; font-size: 11px; }
        th, td { border: 1px solid #1e293b; padding: 10px; text-align: right; }
        th { background-color: #f1f5f9; font-weight: bold; }
        .no-print { display: none !important; }
        .text-rose-600 { color: #dc2626 !important; }
        .text-emerald-600 { color: #059669 !important; }
        .font-mono { font-family: monospace; }
        .print-header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #4f46e5; padding-bottom: 15px; }
        .print-header h1 { font-size: 20px; color: #1e1b4b; }
        .print-metadata { display: flex; justify-content: space-between; font-size: 11px; color: #475569; margin-bottom: 20px; }
      </style>
    `;
    
    const win = window.open('', '_blank');
    if (win) {
      win.document.write('<html><head><title>تقرير إدارة الانتاج والصناعة</title>' + printStyle + '</head><body>');
      win.document.write(printContent.innerHTML);
      win.document.write('</body></html>');
      win.document.close();
      win.focus();
      setTimeout(() => {
        win.print();
        win.close();
      }, 500);
    }
  };

  // --- DOWNLOAD EXCEL ---
  const handleDownloadExcel = () => {
    let headers: string[] = [];
    let rows: any[][] = [];
    let fileName = customTitle ? customTitle.replace(/\s+/g, '_') : 'تقرير_الإنتاج';

    if (activeSubTab === 'products') {
      headers = ['الكود الصناعي', 'الاسم الفني', 'الفئة', 'النوع', 'الوحدة', 'المخزون الحالي', 'الحد الأدنى', 'الحد الأقصى', 'تكلفة الوحدة', 'حالة PLM'];
      rows = filteredProducts.map(p => [
        p.code, p.name, p.category, p.type, p.unit, p.currentStock, p.minQty, p.maxQty, `${p.unitCost || 0} ج.م`,
        p.plmStatus === 'approved' ? 'مقبول ومعتمد' : 'تحت التطوير'
      ]);
    } else if (activeSubTab === 'orders') {
      headers = ['رقم أمر الإنتاج', 'المنتج المستهدف', 'الكمية المطلوبة', 'رقم الكود', 'تاريخ البدء', 'تاريخ التسليم', 'الأولوية', 'الحالة التشغيلية', 'المشرف المسؤول', 'نسبة الإنجاز %'];
      rows = filteredOrders.map(o => [
        o.orderNumber, o.productName, o.quantity, o.productId, o.startDate, o.endDate,
        o.priority === 'high' ? 'عالية' : 'عادية',
        o.status === 'completed' ? 'مكتمل' : o.status === 'in_progress' ? 'قيد التشغيل' : 'معلق',
        o.supervisor, `${o.progress}%`
      ]);
    } else if (activeSubTab === 'quality') {
      headers = ['رقم الفحص الفني', 'نوع الفحص', 'أمر الإنتاج', 'المنتج المختبر', 'حالة فحص الجودة', 'المفتش', 'تاريخ الفحص', 'ملاحظات المعايرة'];
      rows = filteredQC.map(q => [
        q.id, q.qcpTitle, q.orderNumber, q.productName,
        q.status === 'accepted' ? 'سليم ومقبول' : 'مرفوض',
        q.inspector, q.checkedDate, q.notes
      ]);
    } else if (activeSubTab === 'transferred') {
      headers = ['رقم سند التحويل', 'أمر الإنتاج', 'الاسم الفني للمنتج', 'كود الصنف', 'الكمية المرحلة', 'المسؤول', 'تاريخ التحويل', 'المخزن الهدف', 'رقم الدفعة', 'الحالة'];
      rows = filteredTransfers.map(t => [
        t.transferId, t.orderNumber, t.productName, t.productId, `${t.quantityTransferred} ${t.unit}`,
        t.transferredBy, t.transferDate, t.targetWarehouse, t.batchNumber,
        t.status === 'approved' ? 'تأكيد الاستلام' : 'جاري التحويل'
      ]);
    } else if (activeSubTab === 'efficiency') {
      headers = ['خط الإنتاج', 'الهدف (وحدة)', 'الفعلي (وحدة)', 'مؤشر OEE %', 'الجاهزية %', 'الأداء %', 'الجودة %', 'ساعات التوقف', 'المشرف المسؤول'];
      rows = filteredEfficiency.map(e => [
        e.line, e.target, e.actual, `${e.oee}%`, `${e.availability}%`, `${e.performance}%`, `${e.quality}%`, `${e.downtimeHrs} ساعة`, e.supervisor
      ]);
    } else if (activeSubTab === 'maintenance') {
      headers = ['كود الماكينة', 'اسم المعدة', 'نوع الصيانة', 'بيان المهمة', 'الفني المسؤول', 'تاريخ الصيانة', 'التكلفة (ج.م)', 'الحالة'];
      rows = filteredMaintenance.map(m => [
        m.code, m.name, m.type, m.task, m.tech, m.date, m.cost,
        m.status === 'completed' ? 'تم الانتهاء' : 'جاري العمل'
      ]);
    } else {
      headers = ['كود BOM', 'اسم المنتج', 'الكمية المعيارية', 'الاستهلاك الفعلي', 'كمية الهدر/الخردة', 'نسبة الانحراف %', 'تكلفة الهدر (ج.م)', 'حالة الانحراف'];
      rows = filteredBomWaste.map(b => [
        b.bomCode, b.productName, `${b.standardQty} ${b.unit}`, `${b.actualUsed} ${b.unit}`, `${b.scrapQty} ${b.unit}`, `${b.variancePct}%`, b.wasteCost,
        b.status === 'optimal' ? 'مثالي' : b.status === 'within_limit' ? 'مقبول' : 'تجاوز الحد'
      ]);
    }

    const csvContent = "\uFEFF" + [
      headers.join(","),
      ...rows.map(e => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${fileName}_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // --- DOWNLOAD WORD ---
  const handleDownloadWord = () => {
    let reportTitle = customTitle || 'تقرير مفصل لإدارة ومتابعة عمليات الإنتاج';
    let headers: string[] = [];
    let rows: any[][] = [];

    if (activeSubTab === 'products') {
      headers = ["الكود الصناعي", "الاسم الفني", "الفئة", "النوع", "المخزون الفعلي", "حد الطلب الأدنى", "PLM", "تكلفة الوحدة"];
      rows = filteredProducts.map(p => [p.code, p.name, p.category, p.type, `${p.currentStock} ${p.unit}`, p.minQty, p.plmStatus, `${p.unitCost || 0} ج.م`]);
    } else if (activeSubTab === 'orders') {
      headers = ["رقم الوجبة/الأمر", "المشغولات المستهدفة", "الكمية الفنية", "كود الصنف", "بدء التشغيل", "تاريخ التسليم", "المشرف الفني", "معدل الإنجاز %"];
      rows = filteredOrders.map(o => [o.orderNumber, o.productName, o.quantity, o.productId, o.startDate, o.endDate, o.supervisor, `${o.progress}%`]);
    } else if (activeSubTab === 'quality') {
      headers = ["كود المعاينة", "نوعية الاختبار", "رقم الوجبة", "المنتج المختبر", "حالة المطابقة", "المفتش الفني", "تاريخ الفحص", "ملاحظات المعمل"];
      rows = filteredQC.map(q => [q.id, q.qcpTitle, q.orderNumber, q.productName, q.status === 'accepted' ? '✓ مطابق' : '❌ مرفوض', q.inspector, q.checkedDate, q.notes]);
    } else if (activeSubTab === 'transferred') {
      headers = ["رقم سند التحويل", "خط الإنتاج المصدر", "صنف التشغيل الفني", "الكمية المستلمة", "تاريخ الإخراج", "المستودع الهدف", "رقم الدفعة", "الحالة"];
      rows = filteredTransfers.map(t => [t.transferId, t.orderNumber, t.productName, `${t.quantityTransferred} ${t.unit}`, t.transferDate, t.targetWarehouse, t.batchNumber, t.status === 'approved' ? '✓ تم الاستلام' : 'جاري التحويل']);
    } else if (activeSubTab === 'efficiency') {
      headers = ["خط الإنتاج", "مؤشر OEE %", "الجاهزية %", "الأداء %", "الجودة %", "ساعات التوقف", "المشرف المسؤول"];
      rows = filteredEfficiency.map(e => [e.line, `${e.oee}%`, `${e.availability}%`, `${e.performance}%`, `${e.quality}%`, `${e.downtimeHrs} ساعة`, e.supervisor]);
    } else if (activeSubTab === 'maintenance') {
      headers = ["كود الماكينة", "اسم المعدة", "نوع الصيانة", "المهمة", "الفني", "التاريخ", "التكلفة", "الحالة"];
      rows = filteredMaintenance.map(m => [m.code, m.name, m.type, m.task, m.tech, m.date, `${m.cost} ج.م`, m.status === 'completed' ? 'مكتمل' : 'قيد التنفيذ']);
    } else {
      headers = ["كود BOM", "اسم المنتج", "الكمية المعيارية", "الاستهلاك الفعلي", "كمية الهدر", "نسبة الانحراف %", "تكلفة الهدر", "الحالة"];
      rows = filteredBomWaste.map(b => [b.bomCode, b.productName, `${b.standardQty} ${b.unit}`, `${b.actualUsed} ${b.unit}`, `${b.scrapQty} ${b.unit}`, `${b.variancePct}%`, `${b.wasteCost} ج.م`, b.status]);
    }

    downloadDataAsWord(headers, rows, (customTitle || 'تقرير_الإنتاج').replace(/\s+/g, '_'), reportTitle);
  };

  const activeTitleDisplay = customTitle || (
    activeSubTab === 'products' ? '1. تقرير إدارة المنتجات والخامات والمواصفات' :
    activeSubTab === 'orders' ? '2. تقرير أوامر الإنتاج والتشغيل' :
    activeSubTab === 'quality' ? '3. تقرير مراقبة وضمان جودة المنتج' :
    activeSubTab === 'transferred' ? '4. تقرير المنتجات المرحلة للمستودعات' :
    activeSubTab === 'efficiency' ? '5. تقرير كفاءة المعدات الشاملة (OEE)' :
    activeSubTab === 'maintenance' ? '6. تقرير صيانة الآلات والمعدات' :
    '7. تقرير وصفات التصنيع ونسب الهدر (BOM)'
  );

  const activeSubtitleDisplay = customSubtitle || (
    activeSubTab === 'products' ? 'تتبع كود المنتج والمخزون الميداني وحالات PLM والحدود القياسية' :
    activeSubTab === 'orders' ? 'حالة الوجبات وأوامر التشغيل ومعدل التقدم الفعلي بصالات التصنيع' :
    activeSubTab === 'quality' ? 'تراخيص العينات الميدانية وسجل المطابقة والمواصفات الفنية للوجبات' :
    activeSubTab === 'transferred' ? 'الحصيلة التامة المرحلة للمستودعات وسندات الاستلام والترصيد' :
    activeSubTab === 'efficiency' ? 'مؤشرات الأداء والجاهزية ومعدلات توقف الخطوط على مدار الورديات' :
    activeSubTab === 'maintenance' ? 'سجل الصيانة الوقائية والجدولة الفنية لتكاليف وإصلاحات الماكينات' :
    'مقارنة الاستهلاك الفعلي للمواد بالوصفة المعيارية وحساب تكاليف الخردة'
  );

  return (
    <div className={`bg-transparent space-y-6 font-cairo ${onBack ? 'p-6' : ''}`} dir="rtl">
      
      {/* Upper controls & header */}
      <div className="bg-white rounded-[1.5rem] border border-slate-200/80 p-5 shadow-sm">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-100 pb-5 mb-5 w-full">
          <div className="flex items-center gap-3">
            {onBack && (
              <button 
                type="button"
                onClick={onBack}
                className="p-2.5 bg-slate-50 hover:bg-slate-100 text-slate-700 hover:text-slate-900 rounded-xl border border-slate-200 shadow-sm transition-all focus:outline-none focus:ring-0 active:scale-95 flex items-center justify-center cursor-pointer font-bold shrink-0 ml-2"
                title="الرجوع للوحة المؤشرات الرئيسية"
              >
                <ChevronLeft className="w-5 h-5 translate-x-[0.5px]" />
              </button>
            )}
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 bg-indigo-50 text-indigo-700 text-[10px] font-black rounded-md border border-indigo-100">
                  مديول الإنتاج والتصنيع
                </span>
                {customTitle && (
                  <span className="px-2.5 py-0.5 bg-amber-50 text-amber-700 text-[10px] font-black rounded-md border border-amber-200 animate-pulse">
                    تقرير مخصص
                  </span>
                )}
              </div>
              <h2 id="reports-main-title" className="text-lg font-black text-slate-800 flex items-center gap-2 mt-1">
                <FileText className="w-5 h-5 text-indigo-600 shrink-0" />
                {activeTitleDisplay}
              </h2>
              <p className="text-xs font-semibold text-slate-500 mt-0.5">
                {activeSubtitleDisplay}
              </p>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-2">
            <button 
              type="button"
              onClick={handlePrint}
              className="px-3.5 py-2 bg-slate-900 hover:bg-indigo-650 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 cursor-pointer shadow-xs transition-all active:scale-95"
              title="طباعة التقرير الحالي بالتنسيق الرسمي"
            >
              <Printer className="w-3.5 h-3.5" />
              طباعة التقرير
            </button>
            <button 
              type="button"
              onClick={handleDownloadExcel}
              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 cursor-pointer shadow-xs transition-all active:scale-95"
              title="تصدير شيت إكسيل Excel متوافق مع كافة البرامج"
            >
              <Sheet className="w-3.5 h-3.5" />
              تحميل شيت Excel
            </button>
            <button 
              type="button"
              onClick={handleDownloadWord}
              className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 cursor-pointer shadow-xs transition-all active:scale-95"
              title="تصدير ملف وورد Word قابل للتعديل الفني وسجل الإثبات"
            >
              <FileDown className="w-3.5 h-3.5" />
              تحميل مستند Word
            </button>
          </div>
        </div>

        {/* Report Selector Category Tabs */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2">
          <button
            onClick={() => { setActiveSubTab('orders'); setCustomTitle(null); setCustomSubtitle(null); clearFilters(); }}
            className={`p-3 rounded-2xl border text-right transition-all cursor-pointer flex flex-col justify-between ${
              activeSubTab === 'orders'
                ? 'bg-indigo-900 border-indigo-900 text-white shadow-md'
                : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700'
            }`}
          >
            <div className="flex justify-between items-center w-full">
              <Layers className={`w-4 h-4 ${activeSubTab === 'orders' ? 'text-indigo-300' : 'text-slate-400'}`} />
              <span className="text-[9px] font-black px-1.5 py-0.5 bg-indigo-50/20 rounded text-indigo-300">الأوامر</span>
            </div>
            <div className="mt-2">
              <h3 className="text-xs font-black">أوامر الإنتاج</h3>
              <p className="text-[9px] font-medium opacity-80 mt-0.5">التشغيل والإنجاز</p>
            </div>
          </button>

          <button
            onClick={() => { setActiveSubTab('products'); setCustomTitle(null); setCustomSubtitle(null); clearFilters(); }}
            className={`p-3 rounded-2xl border text-right transition-all cursor-pointer flex flex-col justify-between ${
              activeSubTab === 'products'
                ? 'bg-slate-900 border-slate-900 text-white shadow-md'
                : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700'
            }`}
          >
            <div className="flex justify-between items-center w-full">
              <Package className={`w-4 h-4 ${activeSubTab === 'products' ? 'text-indigo-400' : 'text-slate-400'}`} />
              <span className="text-[9px] font-black px-1.5 py-0.5 bg-slate-200/50 rounded text-slate-600">المنتجات</span>
            </div>
            <div className="mt-2">
              <h3 className="text-xs font-black">المنتجات والخامات</h3>
              <p className="text-[9px] font-medium opacity-80 mt-0.5">الرصيد وPLM</p>
            </div>
          </button>

          <button
            onClick={() => { setActiveSubTab('quality'); setCustomTitle(null); setCustomSubtitle(null); clearFilters(); }}
            className={`p-3 rounded-2xl border text-right transition-all cursor-pointer flex flex-col justify-between ${
              activeSubTab === 'quality'
                ? 'bg-purple-900 border-purple-900 text-white shadow-md'
                : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700'
            }`}
          >
            <div className="flex justify-between items-center w-full">
              <ShieldCheck className={`w-4 h-4 ${activeSubTab === 'quality' ? 'text-purple-300' : 'text-slate-400'}`} />
              <span className="text-[9px] font-black px-1.5 py-0.5 bg-purple-50/20 rounded text-purple-300">الجودة</span>
            </div>
            <div className="mt-2">
              <h3 className="text-xs font-black">مراقبة الجودة</h3>
              <p className="text-[9px] font-medium opacity-80 mt-0.5">العينات والمطابقة</p>
            </div>
          </button>

          <button
            onClick={() => { setActiveSubTab('transferred'); setCustomTitle(null); setCustomSubtitle(null); clearFilters(); }}
            className={`p-3 rounded-2xl border text-right transition-all cursor-pointer flex flex-col justify-between ${
              activeSubTab === 'transferred'
                ? 'bg-emerald-900 border-emerald-900 text-white shadow-md'
                : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700'
            }`}
          >
            <div className="flex justify-between items-center w-full">
              <ArrowRightLeft className={`w-4 h-4 ${activeSubTab === 'transferred' ? 'text-emerald-300' : 'text-slate-400'}`} />
              <span className="text-[9px] font-black px-1.5 py-0.5 bg-emerald-50/20 rounded text-emerald-300">المستودعات</span>
            </div>
            <div className="mt-2">
              <h3 className="text-xs font-black">ترحيل الإنتاج</h3>
              <p className="text-[9px] font-medium opacity-80 mt-0.5">سندات الاستلام</p>
            </div>
          </button>

          <button
            onClick={() => { setActiveSubTab('efficiency'); setCustomTitle(null); setCustomSubtitle(null); clearFilters(); }}
            className={`p-3 rounded-2xl border text-right transition-all cursor-pointer flex flex-col justify-between ${
              activeSubTab === 'efficiency'
                ? 'bg-amber-900 border-amber-900 text-white shadow-md'
                : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700'
            }`}
          >
            <div className="flex justify-between items-center w-full">
              <Zap className={`w-4 h-4 ${activeSubTab === 'efficiency' ? 'text-amber-300' : 'text-slate-400'}`} />
              <span className="text-[9px] font-black px-1.5 py-0.5 bg-amber-50/20 rounded text-amber-300">OEE</span>
            </div>
            <div className="mt-2">
              <h3 className="text-xs font-black">كفاءة الخطوط</h3>
              <p className="text-[9px] font-medium opacity-80 mt-0.5">الأداء والجاهزية</p>
            </div>
          </button>

          <button
            onClick={() => { setActiveSubTab('maintenance'); setCustomTitle(null); setCustomSubtitle(null); clearFilters(); }}
            className={`p-3 rounded-2xl border text-right transition-all cursor-pointer flex flex-col justify-between ${
              activeSubTab === 'maintenance'
                ? 'bg-rose-900 border-rose-900 text-white shadow-md'
                : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700'
            }`}
          >
            <div className="flex justify-between items-center w-full">
              <Wrench className={`w-4 h-4 ${activeSubTab === 'maintenance' ? 'text-rose-300' : 'text-slate-400'}`} />
              <span className="text-[9px] font-black px-1.5 py-0.5 bg-rose-50/20 rounded text-rose-300">الصيانة</span>
            </div>
            <div className="mt-2">
              <h3 className="text-xs font-black">صيانة المعدات</h3>
              <p className="text-[9px] font-medium opacity-80 mt-0.5">الأعطال والتكاليف</p>
            </div>
          </button>

          <button
            onClick={() => { setActiveSubTab('bom_waste'); setCustomTitle(null); setCustomSubtitle(null); clearFilters(); }}
            className={`p-3 rounded-2xl border text-right transition-all cursor-pointer flex flex-col justify-between ${
              activeSubTab === 'bom_waste'
                ? 'bg-teal-900 border-teal-900 text-white shadow-md'
                : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700'
            }`}
          >
            <div className="flex justify-between items-center w-full">
              <Activity className={`w-4 h-4 ${activeSubTab === 'bom_waste' ? 'text-teal-300' : 'text-slate-400'}`} />
              <span className="text-[9px] font-black px-1.5 py-0.5 bg-teal-50/20 rounded text-teal-300">BOM</span>
            </div>
            <div className="mt-2">
              <h3 className="text-xs font-black">الوصفات والهدر</h3>
              <p className="text-[9px] font-medium opacity-80 mt-0.5">الانحراف والخردة</p>
            </div>
          </button>
        </div>
      </div>

      {/* FILTER PANEL */}
      <div className="bg-white rounded-[1.5rem] border border-slate-200/80 p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-3 text-xs font-black uppercase text-slate-400 tracking-wider">
          <Filter className="w-4 h-4 text-slate-400" />
          محددات تصفية وفلترة التقرير
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          {/* Search Field */}
          <div className="space-y-1">
            <label className="block text-[10px] font-black text-slate-400">بحث بالكلمة المفتاحية أو الكود</label>
            <div className="relative">
              <input
                type="text"
                placeholder="ادخل نص للبحث..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-3 pr-9 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-slate-500/10 focus:border-slate-400 font-bold text-xs text-slate-800 outline-none transition-all"
              />
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-3" />
            </div>
          </div>

          {/* Date range starts */}
          <div className="space-y-1">
            <label className="block text-[10px] font-black text-slate-400">من تاريخ</label>
            <div className="relative">
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="w-full pl-3 pr-9 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-slate-500/10 focus:border-slate-400 font-bold text-xs text-slate-800 outline-none transition-all"
              />
              <Calendar className="w-4 h-4 text-slate-400 absolute right-3 top-3 pointer-events-none" />
            </div>
          </div>

          {/* Date range ends */}
          <div className="space-y-1">
            <label className="block text-[10px] font-black text-slate-400">إلى تاريخ</label>
            <div className="relative">
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="w-full pl-3 pr-9 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-slate-500/10 focus:border-slate-400 font-bold text-xs text-slate-800 outline-none transition-all"
              />
              <Calendar className="w-4 h-4 text-slate-400 absolute right-3 top-3 pointer-events-none" />
            </div>
          </div>

          {/* Reset Filters */}
          <div>
            <button
              onClick={clearFilters}
              type="button"
              className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs rounded-xl flex items-center justify-center gap-1 transition-all cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              إعادة تهيئة الفلاتر
            </button>
          </div>
        </div>
      </div>

      {/* RENDER TABLE CONTAINER & PRINT WRAPPER */}
      <div id="report-print-area" className="bg-white rounded-[1.5rem] border border-slate-200/80 p-6 shadow-sm">
        
        {/* Printable Only Header */}
        <div className="hidden print:block print-header">
          <h1>منظومة Remo Pro برو - مديول الإنتاج والتصنيع الفني</h1>
          <p>{activeTitleDisplay}</p>
          <div className="print-metadata">
            <span>التاريخ الحالي: {new Date().toLocaleDateString('ar-EG')}</span>
            <span>المشغل المسؤول: {navigator.userAgent ? 'النظام الرقمي الذكي' : 'المشرف الرئيسي'}</span>
          </div>
        </div>

        {/* Dynamic Summaries Cards */}
        {activeSubTab === 'products' && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5 no-print">
            <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200">
              <span className="text-[10px] font-black text-slate-400 block uppercase">إجمالي كود الخامات والمنتجات</span>
              <strong className="text-lg font-black text-slate-800 font-mono mt-0.5 block">{filteredProducts.length}</strong>
            </div>
            <div className="p-3.5 bg-indigo-50/50 rounded-2xl border border-indigo-100">
              <span className="text-[10px] font-black text-indigo-400 block uppercase">منتجات معتمدة للتشغيل</span>
              <strong className="text-lg font-black text-indigo-900 font-mono mt-0.5 block">
                {filteredProducts.filter(p => p.plmStatus === 'approved').length}
              </strong>
            </div>
            <div className="p-3.5 bg-emerald-50/50 rounded-2xl border border-emerald-100">
              <span className="text-[10px] font-black text-emerald-400 block uppercase">إجمالي الرصيد بالمخازن</span>
              <strong className="text-lg font-black text-emerald-900 font-mono mt-0.5 block">
                {Number(filteredProducts.reduce((sum, p) => sum + (Number(p.currentStock) || 0), 0) || 0).toLocaleString()} وحدة
              </strong>
            </div>
            <div className="p-3.5 bg-amber-50 rounded-2xl border border-amber-100">
              <span className="text-[10px] font-black text-amber-500 block uppercase">قيد التطوير الفني (PLM)</span>
              <strong className="text-lg font-black text-amber-900 font-mono mt-0.5 block">
                {filteredProducts.filter(p => p.plmStatus !== 'approved').length}
              </strong>
            </div>
          </div>
        )}

        {activeSubTab === 'orders' && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5 no-print">
            <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200">
              <span className="text-[10px] font-black text-slate-400 block uppercase">أوامر الإنتاج المعروضة</span>
              <strong className="text-lg font-black text-slate-800 font-mono mt-0.5 block">{filteredOrders.length}</strong>
            </div>
            <div className="p-3.5 bg-emerald-50/50 rounded-2xl border border-emerald-100">
              <span className="text-[10px] font-black text-emerald-500 block uppercase">أوامر مكتملة ومغلقة</span>
              <strong className="text-lg font-black text-emerald-900 font-mono mt-0.5 block">
                {filteredOrders.filter(o => o.status === 'completed').length}
              </strong>
            </div>
            <div className="p-3.5 bg-indigo-50/50 rounded-2xl border border-indigo-100">
              <span className="text-[10px] font-black text-indigo-400 block uppercase">أوامر جارية بالصالة</span>
              <strong className="text-lg font-black text-indigo-900 font-mono mt-0.5 block">
                {filteredOrders.filter(o => o.status === 'in_progress').length}
              </strong>
            </div>
            <div className="p-3.5 bg-amber-50 rounded-2xl border border-amber-100">
              <span className="text-[10px] font-black text-amber-500 block uppercase">متوسط نسبة الإنجاز الفني</span>
              <strong className="text-lg font-black text-amber-900 font-mono mt-0.5 block">
                {filteredOrders.length > 0 
                  ? Math.round(filteredOrders.reduce((sum, o) => sum + (o.progress || 0), 0) / filteredOrders.length) 
                  : 0}%
              </strong>
            </div>
          </div>
        )}

        {activeSubTab === 'quality' && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5 no-print">
            <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200">
              <span className="text-[10px] font-black text-slate-400 block uppercase">إجمالي عينات الفحص المجهري</span>
              <strong className="text-lg font-black text-slate-800 font-mono mt-0.5 block">{filteredQC.length}</strong>
            </div>
            <div className="p-3.5 bg-emerald-50/50 rounded-2xl border border-emerald-100">
              <span className="text-[10px] font-black text-emerald-500 block uppercase">عينات سليمة (مقبولة)</span>
              <strong className="text-lg font-black text-emerald-900 font-mono mt-0.5 block">
                {filteredQC.filter(q => q.status === 'accepted').length}
              </strong>
            </div>
            <div className="p-3.5 bg-rose-50 rounded-2xl border border-rose-100">
              <span className="text-[10px] font-black text-rose-500 block uppercase">مرفوضات عدم المطابقة (NCR)</span>
              <strong className="text-lg font-black text-rose-900 font-mono mt-0.5 block">
                {filteredQC.filter(q => q.status === 'rejected').length}
              </strong>
            </div>
            <div className="p-3.5 bg-purple-50 rounded-2xl border border-purple-100">
              <span className="text-[10px] font-black text-purple-600 block uppercase">نسبة نجاح واجتياز الجودة</span>
              <strong className="text-lg font-black text-purple-900 font-mono mt-0.5 block">
                {filteredQC.length > 0 
                  ? Math.round((filteredQC.filter(q => q.status === 'accepted').length / filteredQC.length) * 100) 
                  : 100}%
              </strong>
            </div>
          </div>
        )}

        {activeSubTab === 'transferred' && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5 no-print">
            <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200">
              <span className="text-[10px] font-black text-slate-400 block uppercase">إجمالي سندات التحويل</span>
              <strong className="text-lg font-black text-slate-800 font-mono mt-0.5 block">{filteredTransfers.length}</strong>
            </div>
            <div className="p-3.5 bg-emerald-50/50 rounded-2xl border border-emerald-100">
              <span className="text-[10px] font-black text-emerald-500 block uppercase">حوالات تم اعتمادها بالمستودع</span>
              <strong className="text-lg font-black text-emerald-900 font-mono mt-0.5 block">
                {filteredTransfers.filter(t => t.status === 'approved').length}
              </strong>
            </div>
            <div className="p-3.5 bg-indigo-50/50 rounded-2xl border border-indigo-100">
              <span className="text-[10px] font-black text-indigo-400 block uppercase">إجمالي الكميات المرحلة</span>
              <strong className="text-lg font-black text-indigo-900 font-mono mt-0.5 block">
                {Number(filteredTransfers.reduce((sum, t) => sum + (Number(t.quantityTransferred) || 0), 0) || 0).toLocaleString()} وحدة
              </strong>
            </div>
            <div className="p-3.5 bg-amber-50 rounded-2xl border border-amber-100">
              <span className="text-[10px] font-black text-amber-500 block uppercase">سندات بانتظار تأكيد المستلم</span>
              <strong className="text-lg font-black text-amber-900 font-mono mt-0.5 block">
                {filteredTransfers.filter(t => t.status !== 'approved').length}
              </strong>
            </div>
          </div>
        )}

        {activeSubTab === 'efficiency' && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5 no-print">
            <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200">
              <span className="text-[10px] font-black text-slate-400 block uppercase">عدد خطوط الإنتاج النشطة</span>
              <strong className="text-lg font-black text-slate-800 font-mono mt-0.5 block">{filteredEfficiency.length}</strong>
            </div>
            <div className="p-3.5 bg-emerald-50/50 rounded-2xl border border-emerald-100">
              <span className="text-[10px] font-black text-emerald-500 block uppercase">متوسط مؤشر OEE الشامل</span>
              <strong className="text-lg font-black text-emerald-900 font-mono mt-0.5 block">
                {filteredEfficiency.length > 0 ? Math.round(filteredEfficiency.reduce((sum, e) => sum + (Number(e.oee) || 0), 0) / filteredEfficiency.length) : 0}%
              </strong>
            </div>
            <div className="p-3.5 bg-indigo-50/50 rounded-2xl border border-indigo-100">
              <span className="text-[10px] font-black text-indigo-400 block uppercase">نسبة الجاهزية التشغيلية</span>
              <strong className="text-lg font-black text-indigo-900 font-mono mt-0.5 block">
                {filteredEfficiency.length > 0 ? Math.round(filteredEfficiency.reduce((sum, e) => sum + (Number(e.availability) || 0), 0) / filteredEfficiency.length) : 0}%
              </strong>
            </div>
            <div className="p-3.5 bg-amber-50 rounded-2xl border border-amber-100">
              <span className="text-[10px] font-black text-amber-500 block uppercase">إجمالي ساعات التوقف</span>
              <strong className="text-lg font-black text-amber-900 font-mono mt-0.5 block">
                {Number(filteredEfficiency.reduce((sum, e) => sum + (Number(e.downtimeHrs) || 0), 0) || 0)} ساعة
              </strong>
            </div>
          </div>
        )}

        {activeSubTab === 'maintenance' && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5 no-print">
            <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200">
              <span className="text-[10px] font-black text-slate-400 block uppercase">عدد المعدات الخاضعة للصيانة</span>
              <strong className="text-lg font-black text-slate-800 font-mono mt-0.5 block">{filteredMaintenance.length}</strong>
            </div>
            <div className="p-3.5 bg-emerald-50/50 rounded-2xl border border-emerald-100">
              <span className="text-[10px] font-black text-emerald-500 block uppercase">صيانة تم إنجازها</span>
              <strong className="text-lg font-black text-emerald-900 font-mono mt-0.5 block">
                {filteredMaintenance.filter(m => m.status === 'completed').length}
              </strong>
            </div>
            <div className="p-3.5 bg-rose-50 rounded-2xl border border-rose-100">
              <span className="text-[10px] font-black text-rose-500 block uppercase">إجمالي تكاليف الصيانة</span>
              <strong className="text-lg font-black text-rose-900 font-mono mt-0.5 block">
                {Number(filteredMaintenance.reduce((sum, m) => sum + (m.cost || 0), 0) || 0).toLocaleString()} ج.م
              </strong>
            </div>
            <div className="p-3.5 bg-amber-50 rounded-2xl border border-amber-100">
              <span className="text-[10px] font-black text-amber-500 block uppercase">صيانات قيد التنفيذ والجدولة</span>
              <strong className="text-lg font-black text-amber-900 font-mono mt-0.5 block">
                {filteredMaintenance.filter(m => m.status !== 'completed').length}
              </strong>
            </div>
          </div>
        )}

        {activeSubTab === 'bom_waste' && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5 no-print">
            <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200">
              <span className="text-[10px] font-black text-slate-400 block uppercase">عدد وصفات التصنيع المفحوصة</span>
              <strong className="text-lg font-black text-slate-800 font-mono mt-0.5 block">{filteredBomWaste.length}</strong>
            </div>
            <div className="p-3.5 bg-emerald-50/50 rounded-2xl border border-emerald-100">
              <span className="text-[10px] font-black text-emerald-500 block uppercase">وصفات ضمن النطاق المثالي</span>
              <strong className="text-lg font-black text-emerald-900 font-mono mt-0.5 block">
                {filteredBomWaste.filter(b => b.status === 'optimal' || b.status === 'within_limit').length}
              </strong>
            </div>
            <div className="p-3.5 bg-rose-50 rounded-2xl border border-rose-100">
              <span className="text-[10px] font-black text-rose-500 block uppercase">إجمالي تكلفة الخردة والهدر</span>
              <strong className="text-lg font-black text-rose-900 font-mono mt-0.5 block">
                {Number(filteredBomWaste.reduce((sum, b) => sum + (b.wasteCost || 0), 0) || 0).toLocaleString()} ج.م
              </strong>
            </div>
            <div className="p-3.5 bg-amber-50 rounded-2xl border border-amber-100">
              <span className="text-[10px] font-black text-amber-500 block uppercase">وصفات تجاوزت حد الهدر المسموح</span>
              <strong className="text-lg font-black text-amber-900 font-mono mt-0.5 block">
                {filteredBomWaste.filter(b => b.status === 'exceeded').length}
              </strong>
            </div>
          </div>
        )}

        {/* DATA TABLES */}
        <div className="overflow-x-auto">
          
          {/* TAB 1: PRODUCTS */}
          {activeSubTab === 'products' && (
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="bg-slate-100 text-slate-700 text-xs font-black border-b border-slate-200">
                  <th className="p-3">الكود الصناعي</th>
                  <th className="p-3">اسم المنتج/الخامة</th>
                  <th className="p-3">الفئة والتصنيف</th>
                  <th className="p-3">النوع</th>
                  <th className="p-3">الرصيد الفعلي</th>
                  <th className="p-3">حد الطلب الأدنى</th>
                  <th className="p-3">تكلفة الوحدة</th>
                  <th className="p-3">دورة حياة PLM</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs font-bold text-slate-800">
                {filteredProducts.map((p, idx) => (
                  <tr key={idx} className="hover:bg-slate-50 transition-colors">
                    <td className="p-3 font-mono font-black text-indigo-600">{p.code}</td>
                    <td className="p-3 font-bold">{p.name}</td>
                    <td className="p-3 text-slate-500">{p.category}</td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-bold text-[10px]">
                        {p.type}
                      </span>
                    </td>
                    <td className="p-3 font-mono font-black">
                      {p.currentStock} {p.unit}
                    </td>
                    <td className="p-3 font-mono text-slate-500">{p.minQty}</td>
                    <td className="p-3 font-mono text-emerald-700 font-black">{p.unitCost ? `${p.unitCost} ج.م` : '-'}</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${
                        p.plmStatus === 'approved' 
                          ? 'bg-emerald-100 text-emerald-800' 
                          : 'bg-amber-100 text-amber-800'
                      }`}>
                        {p.plmStatus === 'approved' ? 'معتمد ومثبت' : 'قيد التطوير'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* TAB 2: ORDERS */}
          {activeSubTab === 'orders' && (
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="bg-slate-100 text-slate-700 text-xs font-black border-b border-slate-200">
                  <th className="p-3">رقم أمر الإنتاج</th>
                  <th className="p-3">المنتج المستهدف</th>
                  <th className="p-3">الكمية المطلوبة</th>
                  <th className="p-3">تاريخ البدء</th>
                  <th className="p-3">تاريخ التسليم</th>
                  <th className="p-3">المشرف المسؤول</th>
                  <th className="p-3">نسبة الإنجاز</th>
                  <th className="p-3">الحالة الفنية</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs font-bold text-slate-800">
                {filteredOrders.map((o, idx) => (
                  <tr key={idx} className="hover:bg-slate-50 transition-colors">
                    <td className="p-3 font-mono font-black text-indigo-600">{o.orderNumber}</td>
                    <td className="p-3 font-bold">{o.productName}</td>
                    <td className="p-3 font-mono font-bold">{o.quantity} وحدة</td>
                    <td className="p-3 text-slate-500 font-mono">{o.startDate || '-'}</td>
                    <td className="p-3 text-slate-500 font-mono">{o.endDate || '-'}</td>
                    <td className="p-3 font-semibold">{o.supervisor}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 bg-slate-200 h-2 rounded-full overflow-hidden">
                          <div className="bg-indigo-600 h-full rounded-full" style={{ width: `${o.progress}%` }}></div>
                        </div>
                        <span className="font-mono text-[10px]">{o.progress}%</span>
                      </div>
                    </td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${
                        o.status === 'completed' ? 'bg-emerald-100 text-emerald-800' :
                        o.status === 'in_progress' ? 'bg-indigo-100 text-indigo-800' :
                        o.status === 'paused' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'
                      }`}>
                        {o.status === 'completed' ? 'مكتمل' : o.status === 'in_progress' ? 'جاري التشغيل' : o.status === 'paused' ? 'معلق' : 'مخطط'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* TAB 3: QUALITY */}
          {activeSubTab === 'quality' && (
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="bg-slate-100 text-slate-700 text-xs font-black border-b border-slate-200">
                  <th className="p-3">رقم الفحص</th>
                  <th className="p-3">عنوان الاختبار</th>
                  <th className="p-3">أمر الإنتاج</th>
                  <th className="p-3">اسم المنتج</th>
                  <th className="p-3">المفتش المناوب</th>
                  <th className="p-3">التاريخ</th>
                  <th className="p-3">نتيجة الفحص</th>
                  <th className="p-3">ملاحظات المعايرة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs font-bold text-slate-800">
                {filteredQC.map((q, idx) => (
                  <tr key={idx} className="hover:bg-slate-50 transition-colors">
                    <td className="p-3 font-mono font-black text-purple-600">{q.id}</td>
                    <td className="p-3 font-bold">{q.qcpTitle}</td>
                    <td className="p-3 font-mono text-indigo-600">{q.orderNumber}</td>
                    <td className="p-3">{q.productName}</td>
                    <td className="p-3 text-slate-600">{q.inspector}</td>
                    <td className="p-3 font-mono text-slate-500">{q.checkedDate}</td>
                    <td className="p-3">
                      <span className={`px-2.5 py-0.5 rounded-md text-[10px] font-black ${
                        q.status === 'accepted' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                      }`}>
                        {q.status === 'accepted' ? '✓ مطابق ومقبول' : '❌ غير مطابق (مرفوض)'}
                      </span>
                    </td>
                    <td className="p-3 text-slate-500 max-w-xs truncate">{q.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* TAB 4: TRANSFERRED */}
          {activeSubTab === 'transferred' && (
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="bg-slate-100 text-slate-700 text-xs font-black border-b border-slate-200">
                  <th className="p-3">رقم السند</th>
                  <th className="p-3">أمر الإنتاج</th>
                  <th className="p-3">المنتج المرحل</th>
                  <th className="p-3">الكمية المرحلت</th>
                  <th className="p-3">المستودع الهدف</th>
                  <th className="p-3">تاريخ التحويل</th>
                  <th className="p-3">المسؤول</th>
                  <th className="p-3">حالة الترحيل</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs font-bold text-slate-800">
                {filteredTransfers.map((t, idx) => (
                  <tr key={idx} className="hover:bg-slate-50 transition-colors">
                    <td className="p-3 font-mono font-black text-emerald-600">{t.transferId}</td>
                    <td className="p-3 font-mono text-indigo-600">{t.orderNumber}</td>
                    <td className="p-3 font-bold">{t.productName}</td>
                    <td className="p-3 font-mono font-black">{t.quantityTransferred} {t.unit}</td>
                    <td className="p-3 text-slate-600">{t.targetWarehouse}</td>
                    <td className="p-3 font-mono text-slate-500">{t.transferDate}</td>
                    <td className="p-3">{t.transferredBy}</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${
                        t.status === 'approved' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                      }`}>
                        {t.status === 'approved' ? 'تم الاستلام والترصيد' : 'جاري الترحيل'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* TAB 5: EFFICIENCY / OEE */}
          {activeSubTab === 'efficiency' && (
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="bg-slate-100 text-slate-700 text-xs font-black border-b border-slate-200">
                  <th className="p-3">خط الإنتاج / الماكينة</th>
                  <th className="p-3">الهدف المعياري</th>
                  <th className="p-3">الإنتاج الفعلي</th>
                  <th className="p-3">مؤشر OEE</th>
                  <th className="p-3">الجاهزية</th>
                  <th className="p-3">الأداء</th>
                  <th className="p-3">الجودة</th>
                  <th className="p-3">ساعات التوقف</th>
                  <th className="p-3">المشرف المسؤول</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs font-bold text-slate-800">
                {filteredEfficiency.map((e, idx) => (
                  <tr key={idx} className="hover:bg-slate-50 transition-colors">
                    <td className="p-3 font-bold text-slate-900">{e.line}</td>
                    <td className="p-3 font-mono">{e.target} وحدة</td>
                    <td className="p-3 font-mono text-indigo-600 font-black">{e.actual} وحدة</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded font-mono font-black text-xs ${
                        e.oee >= 90 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                      }`}>
                        {e.oee}%
                      </span>
                    </td>
                    <td className="p-3 font-mono">{e.availability}%</td>
                    <td className="p-3 font-mono">{e.performance}%</td>
                    <td className="p-3 font-mono">{e.quality}%</td>
                    <td className="p-3 font-mono text-rose-600 font-bold">{e.downtimeHrs} ساعة</td>
                    <td className="p-3 text-slate-600">{e.supervisor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* TAB 6: MAINTENANCE */}
          {activeSubTab === 'maintenance' && (
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="bg-slate-100 text-slate-700 text-xs font-black border-b border-slate-200">
                  <th className="p-3">كود الماكينة</th>
                  <th className="p-3">اسم المعدة</th>
                  <th className="p-3">نوع الصيانة</th>
                  <th className="p-3">بيان المهمة والإصلاح</th>
                  <th className="p-3">الفني المسؤول</th>
                  <th className="p-3">تاريخ التنفيذ</th>
                  <th className="p-3">تكلفة الصيانة</th>
                  <th className="p-3">حالة المهمة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs font-bold text-slate-800">
                {filteredMaintenance.map((m, idx) => (
                  <tr key={idx} className="hover:bg-slate-50 transition-colors">
                    <td className="p-3 font-mono font-black text-rose-600">{m.code}</td>
                    <td className="p-3 font-bold">{m.name}</td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-800 text-[10px] font-bold">
                        {m.type}
                      </span>
                    </td>
                    <td className="p-3 text-slate-700 max-w-xs">{m.task}</td>
                    <td className="p-3 text-slate-600">{m.tech}</td>
                    <td className="p-3 font-mono text-slate-500">{m.date}</td>
                    <td className="p-3 font-mono font-black text-rose-700">{Number(m.cost || 0 || 0).toLocaleString()} ج.م</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-black ${
                        m.status === 'completed' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                      }`}>
                        {m.status === 'completed' ? 'تم الانتهاء' : 'قيد التنفيذ'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* TAB 7: BOM WASTE */}
          {activeSubTab === 'bom_waste' && (
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="bg-slate-100 text-slate-700 text-xs font-black border-b border-slate-200">
                  <th className="p-3">كود BOM</th>
                  <th className="p-3">اسم المنتج/الخامة</th>
                  <th className="p-3">الكمية المعيارية</th>
                  <th className="p-3">الاستهلاك الفعلي</th>
                  <th className="p-3">كمية الهدر الخردة</th>
                  <th className="p-3">نسبة الانحراف %</th>
                  <th className="p-3">تكلفة الهدر المالي</th>
                  <th className="p-3">تقييم الانحراف</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs font-bold text-slate-800">
                {filteredBomWaste.map((b, idx) => (
                  <tr key={idx} className="hover:bg-slate-50 transition-colors">
                    <td className="p-3 font-mono font-black text-teal-600">{b.bomCode}</td>
                    <td className="p-3 font-bold">{b.productName}</td>
                    <td className="p-3 font-mono">{b.standardQty} {b.unit}</td>
                    <td className="p-3 font-mono font-bold text-slate-900">{b.actualUsed} {b.unit}</td>
                    <td className="p-3 font-mono font-black text-rose-600">{b.scrapQty} {b.unit}</td>
                    <td className="p-3 font-mono">{b.variancePct}%</td>
                    <td className="p-3 font-mono font-black text-rose-700">{Number(b.wasteCost || 0 || 0).toLocaleString()} ج.م</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-black ${
                        b.status === 'optimal' ? 'bg-emerald-100 text-emerald-800' :
                        b.status === 'within_limit' ? 'bg-indigo-100 text-indigo-800' : 'bg-rose-100 text-rose-800'
                      }`}>
                        {b.status === 'optimal' ? 'مثالي' : b.status === 'within_limit' ? 'مقبول' : 'تجاوز حد الهدر'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

        </div>
      </div>
    </div>
  );
}
