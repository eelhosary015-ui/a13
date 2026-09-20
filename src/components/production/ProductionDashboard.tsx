import React, { useState, useEffect } from 'react';
import { Activity, Zap, ShieldCheck, Clock, TrendingUp, Layers, Package } from 'lucide-react';
import { motion } from 'motion/react';
import { databaseStorage } from '../../utils/databaseStorage';

export function ProductionDashboard() {
  const [ordersCount, setOrdersCount] = useState(0);
  const [completedOrders, setCompletedOrders] = useState(0);
  const [bomsCount, setBomsCount] = useState(0);
  const [workcentersCount, setWorkcentersCount] = useState(0);

  useEffect(() => {
    const load = async () => {
      const orders = await databaseStorage.getItem<any[]>('remo_production_orders', []);
      const cleanOrders = Array.isArray(orders) ? orders.filter(o => o && !['PRD-2026-001', 'PRD-2026-002', 'PRD-2026-003'].includes(o.orderNumber)) : [];
      setOrdersCount(cleanOrders.length);
      setCompletedOrders(cleanOrders.filter(o => o.status === 'completed').length);

      const boms = await databaseStorage.getItem<any[]>('remo_production_boms', []);
      const cleanBoms = Array.isArray(boms) ? boms.filter(b => b && !['bom-1', 'b1', 'bom1', 'bom2', 'BOM-2225'].includes(b.id)) : [];
      setBomsCount(cleanBoms.length);

      const centers = await databaseStorage.getItem<any[]>('remo_production_workcenters', []);
      const cleanCenters = Array.isArray(centers) ? centers.filter(c => c && !['MC-101', 'LN-001', 'LB-050'].includes(c.code)) : [];
      setWorkcentersCount(cleanCenters.length);
    };
    load();
  }, []);

  const hasData = ordersCount > 0;
  const oeeRate = hasData ? Math.round((completedOrders / ordersCount) * 100) : 0;

  const kpis = [
    { title: 'OEE (الكفاءة الكلية)', value: hasData ? `${oeeRate}%` : '0%', icon: Activity, color: 'text-indigo-600', bg: 'bg-indigo-100' },
    { title: 'أوامر التشغيل المنجزة', value: `${completedOrders} / ${ordersCount}`, icon: Clock, color: 'text-blue-600', bg: 'bg-blue-100' },
    { title: 'وصفات التصنيع (BOM)', value: `${bomsCount}`, icon: Layers, color: 'text-amber-600', bg: 'bg-amber-100' },
    { title: 'مراكز العمل النشطة', value: `${workcentersCount}`, icon: ShieldCheck, color: 'text-emerald-600', bg: 'bg-emerald-100' },
  ];

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {kpis.map((kpi, idx) => {
          const Icon = kpi.icon;
          return (
            <motion.div 
              key={idx}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
              className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4"
            >
              <div className={`p-4 rounded-xl ${kpi.bg}`}>
                <Icon className={`w-6 h-6 ${kpi.color}`} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-500 mb-1">{kpi.title}</h3>
                <p className="text-2xl font-bold text-slate-800">{kpi.value}</p>
              </div>
            </motion.div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm min-h-[260px] flex flex-col justify-between">
          <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-indigo-500" />
            حجم الإنتاج الشهري
          </h3>
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 py-10 gap-2">
            <Package className="w-8 h-8 text-slate-300" />
            <p className="text-xs font-semibold text-slate-400">لا توجد حركات إنتاجية مسجلة لهذا الشهر</p>
          </div>
        </div>
        
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm min-h-[260px] flex flex-col justify-between">
          <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
            <Activity className="w-4 h-4 text-rose-500" />
            أعطال الماكينات (Downtime)
          </h3>
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 py-10 gap-2">
            <Activity className="w-8 h-8 text-slate-300" />
            <p className="text-xs font-semibold text-slate-400">لا توجد بلاغات أعطال أو توقفات مسجلة</p>
          </div>
        </div>
      </div>
    </div>
  );
}
