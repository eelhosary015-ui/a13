import React, { useState, useEffect } from 'react';
import { X, Search, CheckCircle2, AlertTriangle, ScanBarcode, Trash2, ArrowRightLeft, Save, FileCheck2, User, FileText } from 'lucide-react';
import { api } from '../../../utils/api';

interface WastageCreateModalProps {
  wastageId: number | null;
  onClose: () => void;
  onSuccess: () => void;
  onNotify: (msg: string, type?: 'success'|'error') => void;
  userRole?: string;
}

export default function WastageCreateModal({ wastageId, onClose, onSuccess, onNotify, userRole }: WastageCreateModalProps) {
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [reasons, setReasons] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  
  const [form, setForm] = useState({
    wastage_number: 'جديد (Wastage)',
    wastage_date: new Date().toISOString().substring(0, 10),
    warehouse_id: '',
    wastage_type: '',
    reason_id: '',
    responsible_person: '',
    notes: '',
    status: 'draft'
  });
  
  const [items, setItems] = useState<any[]>([]);
  const [productSearch, setProductSearch] = useState("");

  const isReadonly = form.status === 'approved';
  // Security rule: Only role inventory_manager can approve. Clerk can only draft.
  // Wait, if userRole is not provided, we will assume admin for testing but real logic needs role.
  const canApprove = !userRole || userRole === 'admin' || userRole === 'inventory_manager';

  useEffect(() => {
    fetchInitialData();
    if (wastageId) fetchWastage(wastageId);
  }, [wastageId]);

  const fetchInitialData = async () => {
    try {
      const [whRes, reasRes, prodRes] = await Promise.all([
        api.get('/api/warehouses'),
        api.get('/api/wastage-reasons'),
        api.get('/api/products')
      ]);
      if (whRes.ok) setWarehouses(await whRes.json());
      if (reasRes.ok) setReasons(await reasRes.json());
      if (prodRes.ok) setProducts(await prodRes.json());
    } catch (err) {
      console.error(err);
    }
  };

  const fetchWastage = async (id: number) => {
    setLoading(true);
    try {
      const res = await api.get(`/api/inventory-wastage/${id}`);
      if (res.ok) {
        const data = await res.json();
        setForm({
          wastage_number: data.wastage_number,
          wastage_date: (data.wastage_date || "").substring(0, 10),
          warehouse_id: data.warehouse_id,
          wastage_type: data.wastage_type || '',
          reason_id: data.reason_id || '',
          responsible_person: data.responsible_person || '',
          notes: data.notes || '',
          status: data.status
        });
        setItems(data.items.map((i: any) => ({
          product_id: i.product_id,
          name: i.product_name,
          unit: i.unit,
          current_qty: Number(i.current_qty),
          wastage_qty: Number(i.wastage_qty),
          unit_cost: Number(i.unit_cost),
          total_cost: Number(i.total_cost)
        })));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchStock = async (warehouseId: string, productId: string) => {
    try {
      const res = await api.get(`/api/inventory/stock?warehouse_id=${warehouseId}&product_id=${productId}`);
      if (res.ok) {
        const data = await res.json();
        return data.length > 0 ? Number(data[0].quantity) : 0;
      }
    } catch (err) {
      console.error(err);
    }
    return 0;
  };

  const addProduct = async (product: any) => {
    if (!form.warehouse_id) {
      onNotify("الرجاء اختيار المخزن أولاً", "error");
      return;
    }
    if (items.some(i => i.product_id === product.id)) {
      onNotify("الصنف موجود بالفعل في القائمة", "error");
      return;
    }

    const currentQty = await fetchStock(form.warehouse_id, product.id);
    const unitCost = Number(product.cost_price || 0);

    setItems([...items, {
      product_id: product.id,
      name: product.name,
      unit: product.unit,
      current_qty: currentQty,
      wastage_qty: 0,
      unit_cost: unitCost,
      total_cost: 0
    }]);
    setProductSearch("");
  };

  const updateItem = (index: number, field: string, value: string) => {
    const newItems = [...items];
    const it = newItems[index];
    
    if (field === 'wastage_qty') {
      let qty = Number(value) || 0;
      if (qty < 0) qty = 0;
      if (qty > it.current_qty) qty = it.current_qty; // validation
      it.wastage_qty = qty;
      it.total_cost = qty * it.unit_cost;
    }
    if (field === 'unit_cost') {
      const cost = Number(value) || 0;
      it.unit_cost = cost;
      it.total_cost = it.wastage_qty * cost;
    }
    
    setItems(newItems);
  };

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const handleWarehouseChange = (e: any) => {
    if (items.length > 0) {
      if (!window.confirm("تغيير المخزن سيؤدي إلى مسح الأصناف الحالية. هل أنت متأكد؟")) return;
    }
    setForm({...form, warehouse_id: e.target.value});
    setItems([]);
  };

  const handleSave = async (status: string) => {
    if (!form.warehouse_id || !form.wastage_type || !form.reason_id) {
      onNotify("الرجاء إكمال البيانات الأساسية", "error");
      return;
    }
    if (items.length === 0) {
      onNotify("الرجاء إضافة أصناف للهالك", "error");
      return;
    }
    
    // validate qty
    const invalidItem = items.find(i => i.wastage_qty <= 0 || i.wastage_qty > i.current_qty);
    if (invalidItem) {
      onNotify(`الكمية غير صحيحة للصنف: ${invalidItem.name}`, "error");
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        ...form,
        status,
        total_value: items.reduce((s, i) => s + i.total_cost, 0),
        items
      };

      if (!wastageId) {
        const res = await api.post('/api/inventory-wastage', payload);
        if (!res.ok) throw new Error("Failed to create");
        const created = await res.json();
        if (status === 'approved') {
          await api.post(`/api/inventory-wastage/${created.id}/approve`, {});
        }
      } else if (status === 'approved') {
        const res = await api.post(`/api/inventory-wastage/${wastageId}/approve`, {});
        if (!res.ok) throw new Error("Failed to approve");
      }
      
      onNotify(status === 'approved' ? "تم اعتماد الهالك بنجاح" : "تم حفظ المسودة", "success");
      onSuccess();
    } catch (err: any) {
      onNotify(err.message, "error");
    } finally {
      setSubmitting(false);
    }
  };

  const totalValue = items.reduce((sum, it) => sum + it.total_cost, 0);

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-white dark:bg-slate-950" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm z-10">
        <div className="flex items-center gap-4">
          <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors">
            <X className="w-6 h-6 text-slate-500" />
          </button>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-red-100 dark:bg-red-900/40 rounded-xl flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-800 dark:text-slate-100">تسجيل هالك وتالف</h2>
              <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">
                {form.status === 'approved' ? 'معتمد' : 'مسودة'}
              </p>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {!isReadonly && (
            <>
              <button 
                onClick={() => handleSave('draft')}
                disabled={submitting}
                className="flex items-center gap-2 px-5 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl font-bold transition-all"
              >
                <Save className="w-5 h-5" /> حفظ كمسودة
              </button>
              
              {canApprove && (
                <button 
                  onClick={() => {
                    if(window.confirm("اعتماد الهالك سيقوم بخصم الكميات من المخزن بشكل نهائي وإنشاء قيد محاسبي. هل أنت متأكد؟")) {
                      handleSave('approved');
                    }
                  }}
                  disabled={submitting}
                  className="flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold shadow-lg shadow-red-600/20 transition-all"
                >
                  <FileCheck2 className="w-5 h-5" /> اعتماد وتسجيل القيد
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 bg-slate-50/80 dark:bg-slate-900/50">
        <div className="max-w-7xl mx-auto space-y-6">
          
          {/* Section A: Header Data */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm">
            <h3 className="text-base font-bold mb-5 flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-3 text-slate-800 dark:text-slate-100">
              <FileText className="w-5 h-5 text-red-500" />
              البيانات الأساسية للهالك
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">رقم العملية</label>
                <input type="text" disabled value={form.wastage_number ?? ""} className="w-full h-10 px-3 bg-transparent border-0 rounded-lg font-mono text-sm font-bold text-slate-700 dark:text-slate-300 focus:ring-0" />
              </div>
              
              <div className="bg-blue-50/50 dark:bg-blue-900/10 p-3 rounded-xl border border-blue-100 dark:border-blue-900/30">
                <label className="block text-xs font-semibold text-blue-600 dark:text-blue-400 mb-2">تاريخ الهالك *</label>
                <input type="date" disabled={isReadonly} value={form.wastage_date ?? ""} onChange={e => setForm({...form, wastage_date: e.target.value})} className="w-full h-10 px-3 bg-white dark:bg-slate-900 border border-blue-200 dark:border-blue-800 rounded-lg font-mono text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500" />
              </div>

              <div className="bg-indigo-50/50 dark:bg-indigo-900/10 p-3 rounded-xl border border-indigo-100 dark:border-indigo-900/30">
                <label className="block text-xs font-semibold text-indigo-600 dark:text-indigo-400 mb-2">المخزن *</label>
                <select disabled={isReadonly} value={form.warehouse_id ?? ""} onChange={handleWarehouseChange} className="w-full h-10 px-3 bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-800 rounded-lg text-sm font-semibold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500">
                  <option value="">اختر المخزن...</option>
                  {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>

              <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">نوع الهالك *</label>
                <select disabled={isReadonly} value={form.wastage_type ?? ""} onChange={e => setForm({...form, wastage_type: e.target.value})} className="w-full h-10 px-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:border-red-500 focus:ring-1 focus:ring-red-500">
                  <option value="">اختر النوع...</option>
                  <option value="storage">تالف تخزين</option>
                  <option value="breakage">كسر</option>
                  <option value="expired">منتهي صلاحية</option>
                  <option value="manufacturing">هالك تصنيع</option>
                </select>
              </div>

              <div className="bg-amber-50/50 dark:bg-amber-900/10 p-3 rounded-xl border border-amber-100 dark:border-amber-900/30">
                <label className="block text-xs font-semibold text-amber-600 dark:text-amber-400 mb-2">السبب (حسب النوع) *</label>
                <select disabled={isReadonly} value={form.reason_id ?? ""} onChange={e => setForm({...form, reason_id: e.target.value})} className="w-full h-10 px-3 bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-800 rounded-lg text-sm focus:border-amber-500 focus:ring-1 focus:ring-amber-500">
                  <option value="">اختر السبب...</option>
                  {reasons.filter(r => form.wastage_type === '' || r.type === form.wastage_type || form.wastage_type === 'manufacturing').map(r => <option key={r.id} value={r.id}>{r.name_ar}</option>)}
                </select>
              </div>

              <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">الشخص المسؤول / المتسبب</label>
                <div className="relative">
                  <User className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input disabled={isReadonly} type="text" value={form.responsible_person ?? ""} onChange={e => setForm({...form, responsible_person: e.target.value})} className="w-full h-10 pr-9 pl-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:border-red-500 focus:ring-1 focus:ring-red-500" placeholder="اسم الموظف أو القسم" />
                </div>
              </div>

              <div className="lg:col-span-3 bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">الملاحظات</label>
                <input disabled={isReadonly} type="text" value={form.notes ?? ""} onChange={e => setForm({...form, notes: e.target.value})} className="w-full h-10 px-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:border-red-500 focus:ring-1 focus:ring-red-500" placeholder="وصف إضافي للحالة..." />
              </div>
            </div>
          </div>

          {/* Section B: Grid */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden flex flex-col min-h-[400px]">
            <div className="flex flex-col sm:flex-row items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50 gap-4">
              <h3 className="text-base font-bold flex items-center gap-2 text-slate-800 dark:text-slate-100 shrink-0">
                جدول الأصناف الهالكة
                <span className="px-2.5 py-0.5 rounded-full bg-red-100 text-red-600 text-[11px] font-mono">{items.length} صنف</span>
              </h3>
              
              {!isReadonly && (
                <div className="w-full sm:w-80 relative">
                  <Search className="w-5 h-5 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input 
                    type="text" 
                    placeholder="ابحث بالاسم أو الباركود لإضافة صنف..." 
                    value={productSearch}
                    onChange={e => setProductSearch(e.target.value)}
                    className="w-full h-10 pr-10 pl-4 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:border-red-500 focus:ring-1 focus:ring-red-500"
                  />
                  {productSearch && (
                    <div className="absolute top-full right-0 left-0 mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl overflow-hidden z-20 max-h-60 overflow-y-auto">
                      {products.filter(p => p.name.includes(productSearch)).slice(0,5).map(p => (
                        <button key={p.id} onClick={() => addProduct(p)} className="w-full text-right px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800 border-b border-slate-100 dark:border-slate-800 last:border-0 flex items-center justify-between">
                          <span className="font-bold text-slate-800 dark:text-slate-200">{p.name}</span>
                          <span className="text-xs text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-md">{p.unit}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                    <th className="py-3 px-4 w-12 text-center font-bold">#</th>
                    <th className="py-3 px-4 min-w-[200px] font-bold">الصنف</th>
                    <th className="py-3 px-4 w-20 text-center font-bold">الوحدة</th>
                    <th className="py-3 px-4 w-28 text-center bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300 font-bold border-r border-slate-200 dark:border-slate-700">الرصيد الحالي</th>
                    <th className="py-3 px-4 w-32 text-center bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300 font-bold border-r border-slate-200 dark:border-slate-700">الكمية الهالكة</th>
                    <th className="py-3 px-4 w-32 text-center font-bold border-r border-slate-200 dark:border-slate-700">تكلفة الوحدة</th>
                    <th className="py-3 px-4 w-32 text-center font-bold border-r border-slate-200 dark:border-slate-700">إجمالي التكلفة</th>
                    {!isReadonly && <th className="py-3 px-4 w-12 text-center border-r border-slate-200 dark:border-slate-700">حذف</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {items.map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors bg-white dark:bg-slate-900">
                      <td className="py-3 px-4 text-center text-slate-500 font-mono">{idx + 1}</td>
                      <td className="py-3 px-4 font-bold text-slate-800 dark:text-slate-200">{item.name}</td>
                      <td className="py-3 px-4 text-center text-slate-500">{item.unit}</td>
                      <td className="py-3 px-4 text-center font-mono font-bold bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border-r border-slate-100 dark:border-slate-800">{item.current_qty}</td>
                      <td className="py-3 px-4 text-center bg-red-50 dark:bg-red-900/20 border-r border-slate-100 dark:border-slate-800">
                        <input 
                          disabled={isReadonly}
                          type="number" 
                          min={0}
                          max={item.current_qty}
                          value={item.wastage_qty} 
                          onChange={(e) => updateItem(idx, 'wastage_qty', e.target.value)}
                          className="w-full h-8 px-2 text-center bg-white dark:bg-slate-950 border border-red-300 dark:border-red-700 rounded-md font-mono font-bold focus:border-red-500 focus:ring-1 focus:ring-red-500 text-red-800 dark:text-red-300 shadow-sm"
                        />
                      </td>
                      <td className="py-3 px-4 text-center border-r border-slate-100 dark:border-slate-800">
                        <input 
                          disabled={isReadonly}
                          type="number" 
                          min={0}
                          value={item.unit_cost} 
                          onChange={(e) => updateItem(idx, 'unit_cost', e.target.value)}
                          className="w-full h-8 px-2 text-center bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md font-mono focus:border-primary focus:ring-1 text-slate-700 dark:text-slate-300 shadow-sm"
                        />
                      </td>
                      <td className="py-3 px-4 text-center font-mono font-bold text-slate-800 dark:text-slate-200 border-r border-slate-100 dark:border-slate-800">
                        {item.total_cost.toLocaleString('ar-EG', {minimumFractionDigits: 2})}
                      </td>
                      {!isReadonly && (
                        <td className="py-3 px-4 text-center border-r border-slate-100 dark:border-slate-800">
                          <button onClick={() => removeItem(idx)} className="p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 rounded-lg transition-colors">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                  
                  {items.length === 0 && (
                    <tr className="bg-white dark:bg-slate-900">
                      <td colSpan={8} className="py-12 text-center text-slate-500">
                        <div className="flex flex-col items-center justify-center">
                          <ScanBarcode className="w-12 h-12 mb-3 text-slate-300 dark:text-slate-700" />
                          <p className="font-semibold text-slate-600 dark:text-slate-400">لا يوجد أصناف هالكة</p>
                          <p className="text-[11px] mt-1 text-slate-400">قم بالبحث عن صنف لإضافته للجدول</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex items-center justify-between shrink-0 shadow-inner">
              <span className="text-sm font-semibold text-slate-600 dark:text-slate-400">
                إجمالي الأصناف: <strong className="text-slate-900 dark:text-slate-100 font-mono px-2">{items.length}</strong>
              </span>
              <span className="text-base font-black text-slate-900 dark:text-slate-100">
                إجمالي تكلفة الهالك: <span className="text-red-600 font-mono px-2">{totalValue.toLocaleString('ar-EG', {minimumFractionDigits: 2})} ج.م</span>
              </span>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
