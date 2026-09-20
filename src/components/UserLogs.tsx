import React, { useState, useEffect } from "react";
import {
  Shield,
  Search,
  Filter,
  Calendar,
  User,
  Clock,
  FileText,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { motion } from "motion/react";
import { api } from "../utils/api";

interface UserLog {
  id: number;
  user_id: number;
  username: string;
  action: string;
  details: string;
  timestamp: string;
}

interface User {
  id: number;
  username: string;
}

interface UserLogsProps {
  onBack: () => void;
}

export const UserLogs: React.FC<UserLogsProps> = ({ onBack }) => {
  const [logs, setLogs] = useState<UserLog[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    userId: "",
    startDate: new Date().toISOString().split("T")[0],
    endDate: new Date().toISOString().split("T")[0],
  });

  useEffect(() => {
    fetchUsers();
    fetchLogs();
  }, []);

  const fetchUsers = async () => {
    try {
      const res = await api.get("/api/users");
      const data = await res.json();
      setUsers(data);
    } catch (error) {
      console.error("Failed to fetch users", error);
    }
  };

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const queryParams = new URLSearchParams();
      if (filters.userId) queryParams.append("userId", filters.userId);
      if (filters.startDate) queryParams.append("startDate", filters.startDate);
      if (filters.endDate) queryParams.append("endDate", filters.endDate);

      const res = await api.get(`/api/user-logs?${queryParams.toString()}`);
      const data = await res.json();
      setLogs(data);
    } catch (error) {
      console.error("Failed to fetch logs", error);
    } finally {
      setLoading(false);
    }
  };

  const handleFilterChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    setFilters((prev) => ({ ...prev, [name]: value }));
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-orange-500 rounded-2xl flex items-center justify-center shadow-lg shadow-orange-500/20">
            <Shield className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              سجل حركات المستخدمين
            </h1>
            <p className="text-slate-500 text-sm">
              مراقبة جميع العمليات التي تمت على النظام
            </p>
          </div>
        </div>
        <button
          onClick={onBack}
          className="bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-2 rounded-xl transition-all flex items-center gap-2"
        >
          <span>رجوع</span>
        </button>
      </div>

      <div className="bg-white p-6 rounded-3xl shadow-xl border border-slate-200 mb-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 mr-2 flex items-center gap-1">
              <User className="w-3 h-3" />
              المستخدم
            </label>
            <select
              name="userId"
              value={filters.userId}
              onChange={handleFilterChange}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 focus:outline-none focus:border-orange-500"
            >
              <option value="">جميع المستخدمين</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.username}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 mr-2 flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              من تاريخ
            </label>
            <input
              type="date"
              name="startDate"
              value={filters.startDate}
              onChange={handleFilterChange}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 focus:outline-none focus:border-orange-500 text-sm font-bold"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 mr-2 flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              إلى تاريخ
            </label>
            <input
              type="date"
              name="endDate"
              value={filters.endDate}
              onChange={handleFilterChange}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 focus:outline-none focus:border-orange-500 text-sm font-bold"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={fetchLogs}
              className="flex-1 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-xl font-bold shadow-lg shadow-orange-500/20 flex items-center justify-center gap-2 transition-all text-sm"
            >
              <Search className="w-4 h-4" />
              <span>بحث وتطبيق</span>
            </button>
            <button
              onClick={() => {
                const emptyFilters = { userId: "", startDate: "", endDate: "" };
                setFilters(emptyFilters);
                setLoading(true);
                api.get("/api/user-logs").then(res => res.json()).then(data => setLogs(data)).catch(()=>{}).finally(()=>setLoading(false));
              }}
              className="bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-2 rounded-xl font-bold text-xs transition-all"
            >
              عرض الكل
            </button>
          </div>
        </div>

        {/* Quick Date Presets */}
        <div className="mt-4 pt-3 border-t border-slate-100 flex items-center gap-2 flex-wrap text-xs">
          <span className="font-bold text-slate-400 text-xs">اختصارات الفلترة الزمنية:</span>
          <button
            onClick={() => {
              const today = new Date().toISOString().split("T")[0];
              const f = { ...filters, startDate: today, endDate: today };
              setFilters(f);
              setLoading(true);
              api.get(`/api/user-logs?startDate=${today}&endDate=${today}`)
                .then(r => r.json()).then(d => setLogs(d)).finally(()=>setLoading(false));
            }}
            className="px-3 py-1 bg-orange-50 hover:bg-orange-100 text-orange-600 rounded-lg font-bold transition-all"
          >
            حركات اليوم
          </button>
          <button
            onClick={() => {
              const today = new Date();
              const weekAgo = new Date();
              weekAgo.setDate(today.getDate() - 7);
              const start = weekAgo.toISOString().split("T")[0];
              const end = today.toISOString().split("T")[0];
              const f = { ...filters, startDate: start, endDate: end };
              setFilters(f);
              setLoading(true);
              api.get(`/api/user-logs?startDate=${start}&endDate=${end}`)
                .then(r => r.json()).then(d => setLogs(d)).finally(()=>setLoading(false));
            }}
            className="px-3 py-1 bg-orange-50 hover:bg-orange-100 text-orange-600 rounded-lg font-bold transition-all"
          >
            آخر 7 أيام
          </button>
          <button
            onClick={() => {
              const today = new Date();
              const monthAgo = new Date();
              monthAgo.setMonth(today.getMonth() - 1);
              const start = monthAgo.toISOString().split("T")[0];
              const end = today.toISOString().split("T")[0];
              const f = { ...filters, startDate: start, endDate: end };
              setFilters(f);
              setLoading(true);
              api.get(`/api/user-logs?startDate=${start}&endDate=${end}`)
                .then(r => r.json()).then(d => setLogs(d)).finally(()=>setLoading(false));
            }}
            className="px-3 py-1 bg-orange-50 hover:bg-orange-100 text-orange-600 rounded-lg font-bold transition-all"
          >
            آخر 30 يوم
          </button>
        </div>
      </div>

      <div className="bg-white rounded-3xl shadow-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="bg-slate-50 border-bottom border-slate-100">
                <th className="p-4 font-bold text-slate-600 text-sm">
                  التاريخ والوقت
                </th>
                <th className="p-4 font-bold text-slate-600 text-sm">
                  المستخدم
                </th>
                <th className="p-4 font-bold text-slate-600 text-sm">
                  العملية
                </th>
                <th className="p-4 font-bold text-slate-600 text-sm">
                  التفاصيل
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="p-12 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-10 h-10 border-4 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
                      <span className="text-slate-500 font-bold">
                        جاري تحميل السجلات...
                      </span>
                    </div>
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-12 text-center">
                    <div className="flex flex-col items-center gap-3 opacity-30">
                      <FileText className="w-16 h-16" />
                      <span className="text-xl font-bold">
                        لا توجد سجلات تطابق البحث
                      </span>
                    </div>
                  </td>
                </tr>
              ) : (
                logs.map((log, index) => (
                  <motion.tr
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.02 }}
                    key={log.id}
                    className="border-bottom border-slate-50 hover:bg-slate-50 transition-colors"
                  >
                    <td className="p-4">
                      <div className="flex items-center gap-2 text-slate-600">
                        <Clock className="w-4 h-4 text-slate-400" />
                        <span className="text-sm font-medium">
                          {new Date((log.timestamp) || 0).toLocaleString("ar-EG")}
                        </span>
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-slate-500 font-bold text-xs">
                          {log.username?.substring(0, 1).toUpperCase()}
                        </div>
                        <span className="font-bold text-slate-700">
                          {log.username}
                        </span>
                      </div>
                    </td>
                    <td className="p-4">
                      <span className="px-3 py-1 bg-orange-100 text-orange-600 rounded-full text-xs font-bold">
                        {log.action}
                      </span>
                    </td>
                    <td className="p-4">
                      <p
                        className="text-sm text-slate-500 max-w-md truncate"
                        title={log.details}
                      >
                        {log.details || "-"}
                      </p>
                    </td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
