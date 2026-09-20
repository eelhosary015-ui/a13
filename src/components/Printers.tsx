import React, { useState, useEffect } from "react";
import {
  Printer,
  Plus,
  Edit,
  Trash2,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { api } from "../utils/api";

interface PrinterData {
  id: number;
  name: string;
  ip_address: string;
  port: number;
  is_active: number;
  category_ids?: number[];
  connection_type?: string;
  system_printer_name?: string;
}

interface PrintersProps {
  onBack: () => void;
  selectedBranch: any;
}

export const Printers: React.FC<PrintersProps> = ({
  onBack,
  selectedBranch,
}) => {
  const [printers, setPrinters] = useState<PrinterData[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [systemPrinters, setSystemPrinters] = useState<string[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPrinter, setEditingPrinter] = useState<PrinterData | null>(
    null,
  );
  const [formData, setFormData] = useState({
    name: "",
    ip_address: "",
    port: 9100,
    is_active: 1,
    branch_id: selectedBranch?.id || "",
    category_ids: [] as number[],
    connection_type: "local",
    system_printer_name: "",
  });

  const fetchPrinters = async () => {
    if (!selectedBranch?.id) return;
    try {
      const res = await api.get(`/api/printers?branch_id=${selectedBranch.id}`);
      const data = await res.json();
      setPrinters(data);
    } catch (error) {
      console.error("Failed to fetch printers", error);
    }
  };

  const fetchCategories = async () => {
    try {
      const res = await api.get("/api/pos/data");
      const data = await res.json();
      setCategories(data.categories || []);
    } catch (error) {
      console.error("Failed to fetch categories", error);
    }
  };

  const fetchSystemPrinters = async () => {
    try {
      const res = await api.get("/api/system-printers");
      const data = await res.json();
      setSystemPrinters(data || []);
    } catch (e) {
      console.error("Failed to fetch system printers", e);
    }
  };

  useEffect(() => {
    fetchPrinters();
    fetchCategories();
    fetchSystemPrinters();
  }, [selectedBranch]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingPrinter) {
        await api.put(`/api/printers/${editingPrinter.id}`, formData);
      } else {
        await api.post("/api/printers", formData);
      }
      setIsModalOpen(false);
      setEditingPrinter(null);
      setFormData({
        name: "",
        ip_address: "",
        port: 9100,
        is_active: 1,
        branch_id: selectedBranch?.id || "",
        category_ids: [],
        connection_type: "local",
        system_printer_name: "",
      });
      fetchPrinters();
    } catch (error) {
      console.error("Failed to save printer", error);
    }
  };

  const handleDelete = async (id: number) => {
    if (
      !confirm(
        "هل أنت متأكد من حذف هذه الطابعة؟ سيتم إزالتها من جميع الأقسام المرتبطة بها.",
      )
    )
      return;
    try {
      await api.delete(`/api/printers/${id}`);
      fetchPrinters();
    } catch (error) {
      console.error("Failed to delete printer", error);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="bg-slate-200 text-slate-700 px-4 py-2 rounded-lg hover:bg-slate-300"
          >
            رجوع
          </button>
          <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Printer className="w-6 h-6 text-indigo-600" />
            إدارة الطابعات
          </h2>
        </div>
        <button
          onClick={() => {
            setEditingPrinter(null);
            setFormData({
              name: "",
              ip_address: "",
              port: 9100,
              is_active: 1,
              branch_id: selectedBranch?.id || "",
              category_ids: [],
              connection_type: "local",
              system_printer_name: "",
            });
            setIsModalOpen(true);
          }}
          className="bg-indigo-600 text-white px-4 py-2 rounded-xl flex items-center gap-2 hover:bg-indigo-700 transition-colors"
        >
          <Plus className="w-5 h-5" />
          إضافة طابعة
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden overflow-x-auto">
        <table className="w-full text-right min-w-[800px]">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="p-4 font-semibold text-slate-600">اسم الطابعة</th>
              <th className="p-4 font-semibold text-slate-600">
                الأقسام (التصنيفات)
              </th>
              <th className="p-4 font-semibold text-slate-600">
                اسم الطابعة / مسار الشبكة
              </th>
              <th className="p-4 font-semibold text-slate-600">الحالة</th>
              <th className="p-4 font-semibold text-slate-600">الإجراءات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {printers.map((printer) => (
              <tr
                key={printer.id}
                className="hover:bg-slate-50 transition-colors"
              >
                <td className="p-4 font-medium text-slate-800">
                  {printer.name}
                </td>
                <td className="p-4 text-slate-600">
                  {printer.category_ids && printer.category_ids.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {printer.category_ids.map((id) => {
                        const cat = categories.find((c) => c.id === id);
                        return cat ? (
                          <span
                            key={id}
                            className="inline-block bg-indigo-50 text-indigo-700 px-2 py-1 rounded-md text-xs"
                          >
                            {cat.name}
                          </span>
                        ) : null;
                      })}
                    </div>
                  ) : (
                    <span className="text-slate-400 text-sm">
                      طابعة رئيسية (الفواتير)
                    </span>
                  )}
                </td>
                <td className="p-4 text-slate-600 dir-ltr text-right">
                  {printer.system_printer_name || "غير محدد"}
                </td>
                <td className="p-4">
                  {printer.is_active ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                      <CheckCircle2 className="w-3 h-3" /> نشط
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-rose-100 text-rose-800">
                      <XCircle className="w-3 h-3" /> غير نشط
                    </span>
                  )}
                </td>
                <td className="p-4">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setEditingPrinter(printer);
                        setFormData({
                          name: printer.name,
                          ip_address: printer.ip_address,
                          port: printer.port,
                          is_active: printer.is_active,
                          branch_id: selectedBranch?.id || "",
                          category_ids: printer.category_ids || [],
                          connection_type: printer.connection_type || "local",
                          system_printer_name:
                            printer.system_printer_name || "",
                        });
                        setIsModalOpen(true);
                      }}
                      className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(printer.id)}
                      className="p-2 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {printers.length === 0 && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-slate-500">
                  لا توجد طابعات مضافة بعد
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md">
            <h3 className="text-xl font-bold mb-4">
              {editingPrinter ? "تعديل طابعة" : "إضافة طابعة جديدة"}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  اسم الطابعة
                </label>
                <input
                  type="text"
                  required
                  value={formData.name ?? ""}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  className="w-full p-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500"
                  placeholder="مثال: طابعة المشروبات"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  الأقسام (التصنيفات)
                </label>
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 max-h-48 overflow-y-auto space-y-2">
                  <div className="flex items-center gap-2 pb-2 border-b border-slate-200 mb-2">
                    <input
                      type="checkbox"
                      id="cat_none"
                      checked={formData.category_ids.length === 0}
                      onChange={() =>
                        setFormData({ ...formData, category_ids: [] })
                      }
                      className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                    />
                    <label
                      htmlFor="cat_none"
                      className="text-sm font-medium text-slate-700"
                    >
                      طابعة رئيسية (بدون أقسام محددة)
                    </label>
                  </div>
                  {categories.map((c) => (
                    <div key={c.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id={`cat_${c.id}`}
                        checked={formData.category_ids.includes(c.id)}
                        onChange={(e) => {
                          const newIds = e.target.checked
                            ? [...formData.category_ids, c.id]
                            : formData.category_ids.filter((id) => id !== c.id);
                          setFormData({ ...formData, category_ids: newIds });
                        }}
                        className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                      />
                      <label
                        htmlFor={`cat_${c.id}`}
                        className="text-sm text-slate-700"
                      >
                        {c.name}
                      </label>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  اسم الطابعة أو مسار الشبكة
                </label>
                <input
                  type="text"
                  required={true}
                  list="printersList"
                  placeholder="مثال: طابعة_الكاشير أو \\PC-NAME\Kitchen"
                  value={formData.system_printer_name || ""}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      system_printer_name: e.target.value,
                    })
                  }
                  className="w-full p-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 bg-white dir-ltr text-right"
                />
                <datalist id="printersList">
                  {systemPrinters.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </datalist>
                <p className="text-xs text-slate-500 mt-2">
                  يمكنك اختيار طابعة من السيرفر مباشرة، أو كتابة مسار الطابعة
                  المشتركة من جهاز آخر على الشبكة.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is_active"
                  checked={formData.is_active === 1}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      is_active: e.target.checked ? 1 : 0,
                    })
                  }
                  className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                />
                <label
                  htmlFor="is_active"
                  className="text-sm font-medium text-slate-700"
                >
                  طابعة نشطة
                </label>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-colors"
                >
                  حفظ
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
