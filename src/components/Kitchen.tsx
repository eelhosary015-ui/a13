import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ChefHat,
  Clock,
  CheckCircle2,
  Timer,
  ChevronLeft,
  Utensils,
  Truck,
  User,
} from "lucide-react";
import { io } from "socket.io-client";
import { api, getBaseUrl } from "../utils/api";

import { useAuth } from "../contexts/AuthContext";

interface KitchenOrder {
  id: number;
  branch_id: number;
  branch_name: string;
  table_number: number | null;
  customer_name: string | null;
  order_type: "dine_in" | "takeaway" | "delivery";
  status: "pending" | "preparing" | "ready" | "completed";
  timestamp: string;
  notes: string | null;
  items: {
    id: number;
    product_name: string;
    quantity: number;
  }[];
}

interface KitchenProps {
  onBack: () => void;
  selectedBranch: any | null;
  subView?: string;
}

export const Kitchen: React.FC<KitchenProps> = ({
  onBack,
  selectedBranch,
  subView,
}) => {
  if (subView === "kitchen_report") {
    return (
      <KitchenReportView selectedBranch={selectedBranch} onBack={onBack} />
    );
  }

  const { user } = useAuth();
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kitchenWarningTime, setKitchenWarningTime] = useState<number>(30); // in minutes
  const [now, setNow] = useState<number>(Date.now());

  useEffect(() => {
    fetchOrders();
    fetchKitchenWarningTime();

    const intervalId = setInterval(() => {
      setNow(Date.now());
    }, 10000); // 10 seconds

    const socket = io(getBaseUrl());

    socket.on("new_order", (newOrder: KitchenOrder) => {
      // Add if it belongs to selectedBranch (or if no branch selected, user's branch, or admin)
      const targetBranchId = selectedBranch?.id || user?.branch_id;
      if (!targetBranchId || newOrder.branch_id === targetBranchId) {
        setOrders((prev) => {
          if (prev.find((o) => o.id === newOrder.id)) return prev;
          return [...prev, newOrder];
        });
        // Play sound notification
        const audio = new Audio(
          "https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3",
        );
        audio.play().catch(() => {});
      }
    });

    socket.on(
      "order_status_updated",
      ({ id, status }: { id: string; status: string }) => {
        if (status === "ready" || status === "completed") {
          setOrders((prev) => prev.filter((o) => o.id !== parseInt(id)));
        } else {
          setOrders((prev) =>
            prev.map((o) =>
              o.id === parseInt(id) ? { ...o, status: status as any } : o,
            ),
          );
        }
      },
    );

    socket.on("order_updated", (updatedOrder: KitchenOrder) => {
      setOrders((prev) =>
        prev.map((o) => (o.id === updatedOrder.id ? updatedOrder : o)),
      );
    });

    return () => {
      socket.disconnect();
      clearInterval(intervalId);
    };
  }, [user, selectedBranch]);

  const fetchKitchenWarningTime = async () => {
    try {
      const res = await api.get("/api/settings/kitchen_warning_time");
      if (res.ok) {
        const data = await res.json();
        if (data.value) setKitchenWarningTime(parseInt(data.value, 10));
      }
    } catch {}
  };

  const fetchOrders = async () => {
    try {
      setError(null);
      const branchId = selectedBranch?.id || user?.branch_id || "all";
      const res = await api.get(`/api/kitchen/orders?branchId=${branchId}`);
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to fetch");
      }
      const data = await res.json();
      setOrders(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Failed to fetch kitchen orders:", error);
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (id: number, status: string) => {
    try {
      await api.post(`/api/kitchen/orders/${id}/status`, { status });
    } catch (error) {
      console.error("Failed to update status");
    }
  };

  const getOrderTypeIcon = (type: string) => {
    switch (type) {
      case "dine_in":
        return <Utensils className="w-3.5 h-3.5" />;
      case "takeaway":
        return <User className="w-3.5 h-3.5" />;
      case "delivery":
        return <Truck className="w-3.5 h-3.5" />;
      default:
        return null;
    }
  };

  const getOrderTypeLabel = (type: string) => {
    switch (type) {
      case "dine_in":
        return "طاولة";
      case "takeaway":
        return "استلام";
      case "delivery":
        return "توصيل";
      default:
        return "";
    }
  };

  return (
    <div
      className="min-h-screen bg-slate-50 flex flex-col overflow-hidden text-slate-900"
      dir="rtl"
    >
      {/* Header */}
      <div className="p-6 border-b border-slate-200 flex items-center justify-between bg-white shadow-sm">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-slate-500 hover:text-slate-900 transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
          <span className="text-lg font-bold">العودة</span>
        </button>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-teal-50 rounded-xl flex items-center justify-center">
            <ChefHat className="w-5 h-5 text-teal-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">طلبات المطبخ</h1>
            <p className="text-slate-500 text-sm">متابعة الطلبات الجارية</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="bg-slate-100 px-4 py-2 rounded-xl flex items-center gap-2 border border-slate-200">
            <span className="w-2 h-2 bg-teal-500 rounded-full animate-pulse"></span>
            <span className="text-sm font-bold text-slate-700">مباشر</span>
          </div>
        </div>
      </div>

      {/* Orders Grid */}
      <div className="flex-1 overflow-x-auto p-8">
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600"></div>
          </div>
        ) : error ? (
          <div className="h-full flex flex-col items-center justify-center text-red-600 gap-4">
            <p className="text-xl font-bold">خطأ في تحميل الطلبات</p>
            <p className="text-sm opacity-70">{error}</p>
            <button
              onClick={fetchOrders}
              className="px-6 py-2 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors shadow-sm"
            >
              إعادة المحاولة
            </button>
          </div>
        ) : (
          <div className="flex gap-6 h-full min-w-max">
            <AnimatePresence mode="popLayout">
              {orders.map((order) => {
                const orderTime = new Date(order.timestamp).getTime();
                const elapsedMinutes = Math.floor((now - orderTime) / 60000);
                const isLate = elapsedMinutes >= kitchenWarningTime;

                return (
                  <motion.div
                    key={order.id}
                    layout
                    initial={{ opacity: 0, scale: 0.9, x: 50 }}
                    animate={{ opacity: 1, scale: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.9, x: -50 }}
                    className={
                      isLate
                        ? "w-80 bg-red-50 rounded-3xl border border-red-300 flex flex-col overflow-hidden shadow-xl shadow-red-500/20 h-fit max-h-full transition-all"
                        : "w-80 bg-white rounded-3xl border border-slate-200 flex flex-col overflow-hidden shadow-xl h-fit max-h-full hover:border-teal-500/30 transition-all"
                    }
                  >
                    {/* Order Header */}
                    <div
                      className={
                        isLate
                          ? "p-4 bg-red-100 border-b border-red-200"
                          : `p-4 ${order.status === "preparing" ? "bg-orange-50" : "bg-teal-50"} border-b border-slate-100`
                      }
                    >
                      <div className="flex justify-between items-start mb-2">
                        <span
                          className={`text-xs font-bold ${isLate ? "text-red-500" : "text-slate-400"}`}
                        >
                          #{order.id}
                        </span>
                        <div
                          className={`flex items-center gap-1 text-xs font-bold ${isLate ? "text-red-700 animate-pulse" : "text-teal-600"}`}
                        >
                          <Clock className="w-2.5 h-2.5" />
                          <span>{elapsedMinutes} دقيقة</span>
                          <span className="opacity-50">
                            (
                            {new Date(order.timestamp).toLocaleTimeString(
                              "ar-EG",
                              { hour: "2-digit", minute: "2-digit" },
                            )}
                            )
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div
                            className={`w-8 h-8 rounded-lg bg-white border ${isLate ? "border-red-200 text-red-600" : "border-slate-100 text-slate-600"} flex items-center justify-center shadow-sm`}
                          >
                            {getOrderTypeIcon(order.order_type)}
                          </div>
                          <div>
                            <h3
                              className={`font-bold text-sm ${isLate ? "text-red-900" : "text-slate-900"}`}
                            >
                              {order.order_type === "dine_in"
                                ? `طاولة ${order.table_number}`
                                : order.customer_name || "عميل"}
                            </h3>
                            <p
                              className={`text-[10px] ${isLate ? "text-red-700" : "text-slate-500"}`}
                            >
                              {order.branch_name}
                            </p>
                          </div>
                        </div>
                        <span
                          className={`px-2 py-1 rounded-lg text-[10px] font-bold ${isLate ? "bg-red-200 text-red-800" : order.status === "preparing" ? "bg-orange-100 text-orange-600" : "bg-teal-100 text-teal-600"}`}
                        >
                          {order.status === "pending"
                            ? "قيد الانتظار"
                            : "جاري التحضير"}
                        </span>
                      </div>
                    </div>

                    {/* Order Items */}
                    <div
                      className={`flex-1 overflow-y-auto p-4 space-y-3 ${isLate ? "bg-red-50/50" : "bg-white"}`}
                    >
                      {order.notes && (
                        <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-xl mb-4">
                          <p className="text-xs font-bold text-yellow-800 mb-1">
                            ملاحظات الطلب:
                          </p>
                          <p className="text-sm text-yellow-900 whitespace-pre-wrap">
                            {order.notes}
                          </p>
                        </div>
                      )}
                      {order.items.map((item, idx) => (
                        <div
                          key={item.id || (item as any).menu_item_id || idx}
                          className="flex items-center justify-between group"
                        >
                          <div className="flex items-center gap-3">
                            <span className="w-6 h-6 rounded bg-teal-50 flex items-center justify-center text-xs font-bold text-teal-600 border border-teal-100">
                              {item.quantity}
                            </span>
                            <span className="text-sm font-medium text-slate-700">
                              {item.product_name}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Order Footer / Actions */}
                    <div
                      className={`p-4 ${isLate ? "bg-red-50/80" : "bg-slate-50"} border-t ${isLate ? "border-red-100" : "border-slate-100"} space-y-2`}
                    >
                      {order.status === "pending" ? (
                        <button
                          onClick={() => updateStatus(order.id, "preparing")}
                          className={`w-full ${isLate ? "bg-red-600 hover:bg-red-700 shadow-red-600/20" : "bg-orange-500 hover:bg-orange-600 shadow-orange-500/20"} text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg`}
                        >
                          <Timer className="w-3.5 h-3.5" />
                          بدء التحضير
                        </button>
                      ) : (
                        <button
                          onClick={() => updateStatus(order.id, "ready")}
                          className={`w-full ${isLate ? "bg-red-700 hover:bg-red-800 shadow-red-700/20" : "bg-teal-600 hover:bg-teal-700 shadow-teal-600/20"} text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg`}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          جاهز للتسليم
                        </button>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>

            {orders.length === 0 && (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-300 gap-4">
                <ChefHat className="w-20 h-20 opacity-20" />
                <p className="text-xl font-bold">لا توجد طلبات جارية</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const KitchenReportView: React.FC<{
  selectedBranch: any | null;
  onBack: () => void;
}> = ({ selectedBranch, onBack }) => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const res = await api.get("/api/reports/branch/kitchen");
        if (res.ok) {
          const result = await res.json();
          setData(Array.isArray(result) ? result : []);
        }
      } catch (error) {
        console.error("Failed to fetch report", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [selectedBranch]);

  return (
    <div
      className="flex flex-col h-screen bg-slate-50 p-6 overflow-y-auto"
      dir="rtl"
    >
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={onBack}
          className="p-2 bg-white rounded-xl shadow-sm border border-slate-200 hover:bg-slate-50"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="text-2xl font-bold text-slate-900">
          تقارير طلبات المطبخ
        </h1>
      </div>
      {loading ? (
        <div className="text-center py-10 text-slate-500">جاري التحميل...</div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right">
              <thead className="bg-slate-50 text-slate-600 font-medium">
                <tr>
                  {data.length > 0 &&
                    Object.keys(data[0]).map((key, i) => (
                      <th key={i} className="p-4 border-b border-slate-200">
                        {key}
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.map((row, i) => (
                  <tr key={i} className="hover:bg-slate-50/50">
                    {Object.values(row).map((val: any, j) => (
                      <td key={j} className="p-4">
                        {typeof val === "object"
                          ? JSON.stringify(val)
                          : String(val || "-")}
                      </td>
                    ))}
                  </tr>
                ))}
                {data.length === 0 && (
                  <tr>
                    <td colSpan={10} className="p-8 text-center text-slate-500">
                      لا توجد بيانات
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
