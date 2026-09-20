import React, { useEffect, useMemo, useState } from "react";
import { api } from "../utils/api";
import { useAuth } from "../contexts/AuthContext";
import {
  Landmark, Plus, RefreshCw, Search, ArrowDownLeft, ArrowUpRight,
  ArrowRightLeft, Settings, FileText, Download, Printer, Save, X,
  CheckCircle2, AlertTriangle, Wallet, TrendingUp, TrendingDown
} from "lucide-react";

interface BankAccount {
  id: number; name: string; bank_name?: string; account_number?: string;
  iban?: string; swift_code?: string; currency?: string; account_type?: string;
  balance: number; opening_balance?: number; branch_id?: number | null; is_active?: boolean;
}
interface BankTx { id:number; account_id:number; transaction_date:string; description?:string; reference?:string; amount:number; type:string; status:string; source:string; created_by_name?:string; }

const money = (n:number) => Number(n||0).toLocaleString("ar-EG", {minimumFractionDigits:2, maximumFractionDigits:2});

export const BankManagement: React.FC<{onBack:()=>void; initialTab?:string}> = ({onBack, initialTab}) => {
  const { user } = useAuth();
  const normalizeTab = (value?: string) => {
    if (value === "bank_settings" || value === "bank_accounting") return "settings";
    if (value && ["bank_balances","bank_transactions","bank_reconciliation","bank_flow"].includes(value)) return "reports";
    return value || "accounts";
  };
  const [tab,setTab] = useState(normalizeTab(initialTab));
  const [accounts,setAccounts] = useState<BankAccount[]>([]);
  const [transactions,setTransactions] = useState<BankTx[]>([]);
  const [loading,setLoading] = useState(true);
  const [showAccount,setShowAccount] = useState(false);
  const [showTx,setShowTx] = useState(false);
  const [showTransfer,setShowTransfer] = useState(false);
  const [transfer,setTransfer] = useState<any>({from_account_id:"",to_account_id:"",amount:"",transaction_date:new Date().toISOString().slice(0,10),description:"",reference:""});
  const [editing,setEditing] = useState<BankAccount|null>(null);
  const [search,setSearch] = useState("");
  const [form,setForm] = useState<any>({name:"",bank_name:"",account_number:"",iban:"",swift_code:"",currency:"EGP",account_type:"current",opening_balance:"0",branch_id:"",is_active:true});
  const [txForm,setTxForm] = useState<any>({account_id:"",transaction_date:new Date().toISOString().slice(0,10),description:"",reference:"",amount:"",type:"credit"});
  const [settings,setSettings] = useState<any>({default_currency:"EGP",reconciliation_tolerance:"0.01",allow_negative_balance:false,require_approval_over:"50000",auto_post_to_accounting:true});

  const load = async()=>{
    setLoading(true);
    try {
      const [a,t,s] = await Promise.all([api.get("/api/banks/accounts"),api.get("/api/banks/transactions"),api.get("/api/banks/settings")]);
      if(a.ok) setAccounts(await a.json());
      if(t.ok) setTransactions(await t.json());
      if(s.ok) setSettings(await s.json());
    } finally { setLoading(false); }
  };
  useEffect(()=>{setTab(normalizeTab(initialTab));},[initialTab]);
  useEffect(()=>{load();},[]);

  const totals = useMemo(()=>({balance:accounts.reduce((s,a)=>s+Number(a.balance||0),0), credit:transactions.filter(t=>t.type==='credit').reduce((s,t)=>s+Math.abs(Number(t.amount||0)),0), debit:transactions.filter(t=>t.type==='debit').reduce((s,t)=>s+Math.abs(Number(t.amount||0)),0)}),[accounts,transactions]);
  const filtered = accounts.filter(a=>`${a.name} ${a.bank_name||""} ${a.account_number||""} ${a.iban||""}`.toLowerCase().includes(search.toLowerCase()));

  const openEdit=(a?:BankAccount)=>{setEditing(a||null);setForm(a?{...a,opening_balance:a.opening_balance??0,branch_id:a.branch_id??""}:{name:"",bank_name:"",account_number:"",iban:"",swift_code:"",currency:"EGP",account_type:"current",opening_balance:"0",branch_id:"",is_active:true});setShowAccount(true)};
  const saveAccount=async(e:React.FormEvent)=>{e.preventDefault(); const payload={...form,opening_balance:Number(form.opening_balance||0),branch_id:form.branch_id?Number(form.branch_id):null}; const res=editing?await api.put(`/api/banks/accounts/${editing.id}`,payload):await api.post("/api/banks/accounts",payload); if(res.ok){setShowAccount(false);await load();}else alert((await res.json()).error||"تعذر حفظ الحساب");};
  const saveTx=async(e:React.FormEvent)=>{e.preventDefault(); const res=await api.post("/api/banks/transactions",{...txForm,account_id:Number(txForm.account_id),amount:Number(txForm.amount||0)}); if(res.ok){setShowTx(false);await load();}else alert((await res.json()).error||"تعذر حفظ الحركة");};
  const saveTransfer=async(e:React.FormEvent)=>{e.preventDefault();const res=await api.post("/api/banks/transfers",{...transfer,from_account_id:Number(transfer.from_account_id),to_account_id:Number(transfer.to_account_id),amount:Number(transfer.amount||0)});if(res.ok){setShowTransfer(false);await load();}else alert((await res.json()).error||"تعذر تنفيذ التحويل")};
  const saveSettings=async()=>{const res=await api.put("/api/banks/settings",settings); if(!res.ok) alert("تعذر حفظ الإعدادات"); else alert("تم حفظ إعدادات البنوك");};
  const exportCsv=()=>{const rows=[["التاريخ","الحساب","البيان","المرجع","النوع","المبلغ","الحالة"],...transactions.map(t=>[t.transaction_date,accounts.find(a=>a.id===t.account_id)?.name||t.account_id,t.description||"",t.reference||"",t.type,money(t.amount),t.status])]; const csv="\uFEFF"+rows.map(r=>r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(",")).join("\n"); const blob=new Blob([csv],{type:"text/csv;charset=utf-8"}); const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="bank-transactions.csv";a.click();URL.revokeObjectURL(url);};

  return <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900" dir="rtl">
    <div className="sticky top-0 z-40 flex flex-col shadow-md">
      <div className="p-5 border-b border-slate-200 bg-white flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition-all shadow-sm"><span className="text-lg">‹</span></button>
          <div className="w-11 h-11 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-sm"><Landmark className="w-6 h-6"/></div>
          <div><h1 className="text-2xl font-black text-slate-900">إدارة البنوك</h1><p className="text-sm text-slate-500 mt-0.5 font-medium">إدارة الحسابات البنكية، الحركات، التحويلات، التسويات والتقارير المالية</p></div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-300 hover:bg-slate-50 rounded-xl font-bold text-sm shadow-sm"><RefreshCw className={`w-4 h-4 ${loading?'animate-spin':''}`}/> تحديث</button>
          {tab==='accounts' && <button onClick={()=>openEdit()} className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm shadow-sm"><Plus className="w-5 h-5"/> إضافة حساب</button>}
        </div>
      </div>
      <div className="bg-white/95 backdrop-blur-md border-b border-slate-200 px-4 py-3">
        <div className="flex flex-row-reverse items-center justify-center gap-2 md:gap-3 overflow-x-auto custom-scrollbar">
          <Tab active={tab==='accounts'} onClick={()=>setTab('accounts')} icon={<Landmark/>} text="الحسابات البنكية"/>
          <Tab active={tab==='transactions'} onClick={()=>setTab('transactions')} icon={<ArrowRightLeft/>} text="الحركات"/>
          <Tab active={tab==='reconciliation'} onClick={()=>setTab('reconciliation')} icon={<CheckCircle2/>} text="التسوية البنكية"/>
          <Tab active={tab==='reports'} onClick={()=>setTab('reports')} icon={<FileText/>} text="التقارير"/>
          <Tab active={tab==='settings'} onClick={()=>setTab('settings')} icon={<Settings/>} text="الإعدادات"/>
        </div>
        {tab==='accounts' && <div className="mt-3 bg-slate-50 border-t border-slate-200 px-2 py-3 flex flex-col lg:flex-row-reverse items-center gap-3">
          <div className="flex w-full lg:flex-1 max-w-2xl bg-white border border-slate-300 rounded-lg overflow-hidden focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 shadow-sm">
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="بحث باسم البنك أو الحساب أو رقم الحساب أو IBAN" className="flex-1 px-4 py-2.5 outline-none text-xs font-medium text-right" dir="rtl"/>
            <div className="bg-blue-500 px-3 flex items-center justify-center text-white"><Search className="w-4 h-4"/></div>
          </div>
          <button onClick={()=>setSearch('')} className="px-5 py-2.5 bg-white border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 font-bold text-xs">مسح</button>
        </div>}
      </div>
    </div>
    <div className="flex-1 px-4 md:px-6 pt-4 pb-6">
      <div className="max-w-[1500px] mx-auto">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4"><Kpi title="إجمالي أرصدة البنوك" value={totals.balance} icon={<Wallet/>}/><Kpi title="إجمالي الإيداعات" value={totals.credit} icon={<TrendingUp/>}/><Kpi title="إجمالي المسحوبات" value={totals.debit} icon={<TrendingDown/>}/><Kpi title="الحسابات النشطة" value={accounts.filter(a=>a.is_active!==false).length} icon={<Landmark/>} plain/></div>
      <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
      {loading ? <div className="py-20 flex flex-col items-center justify-center text-slate-400"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-500 mb-4"></div><span className="font-bold text-sm">جاري تحميل بيانات البنوك...</span></div> : null}
      {!loading && tab==='accounts' && <div className="p-4"><div className="flex items-center justify-between mb-4"><div><h2 className="text-lg font-black text-slate-800">الحسابات البنكية</h2><p className="text-xs text-slate-500 mt-1">إدارة ومتابعة جميع الحسابات والأرصدة</p></div><span className="text-xs font-bold text-slate-500">{filtered.length} حساب</span></div><div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">{filtered.map(a=><div key={a.id} className="border border-slate-200 rounded-xl p-4 hover:shadow-md hover:border-indigo-200 transition bg-white"><div className="flex justify-between"><div className="flex gap-3"><div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center border border-indigo-100"><Landmark/></div><div><div className="font-black">{a.name}</div><div className="text-xs text-slate-500">{a.bank_name||'بنك'} • {a.account_type||'حساب'}</div></div></div><button onClick={()=>openEdit(a)} className="text-indigo-600 font-bold text-xs">تعديل</button></div><div className="mt-4 text-xs text-slate-500">الحساب: <b>{a.account_number||'—'}</b></div><div className="text-xs text-slate-500">IBAN: <b>{a.iban||'—'}</b></div><div className="mt-3 text-2xl font-black text-slate-800">{money(a.balance)} <span className="text-xs">{a.currency||'EGP'}</span></div><div className="mt-3"><span className={`text-[10px] px-2 py-1 rounded-full ${a.is_active===false?'bg-rose-50 text-rose-700':'bg-emerald-50 text-emerald-700'}`}>{a.is_active===false?'موقوف':'نشط'}</span></div></div>)}{!filtered.length&&!loading&&<Empty text="لا توجد حسابات بنكية"/>}</div></div>}
      {tab==='transactions' && <div className="p-4"><div className="flex justify-between mb-4"><h2 className="font-black text-lg">حركات الحسابات البنكية</h2><div className="flex gap-2"><button onClick={exportCsv} className="px-3 py-2 border rounded-xl font-bold flex gap-2"><Download className="w-4 h-4"/> تصدير</button><button onClick={()=>{setTxForm({...txForm,account_id:accounts[0]?.id||''});setShowTx(true)}} className="px-4 py-2 bg-indigo-600 text-white rounded-xl font-bold flex gap-2"><Plus className="w-4 h-4"/> حركة جديدة</button><button onClick={()=>{setTransfer({...transfer,from_account_id:accounts[0]?.id||'',to_account_id:accounts[1]?.id||''});setShowTransfer(true)}} className="px-4 py-2 bg-slate-800 text-white rounded-xl font-bold flex gap-2"><ArrowRightLeft className="w-4 h-4"/> تحويل بنكي</button></div></div><div className="overflow-auto"><table className="w-full text-sm min-w-[900px]"><thead><tr className="bg-slate-100 border-b-2 border-slate-200 text-slate-700"><th className="p-3 text-right">التاريخ</th><th className="p-3 text-right">الحساب</th><th className="p-3 text-right">البيان</th><th className="p-3">المرجع</th><th className="p-3">النوع</th><th className="p-3">المبلغ</th><th className="p-3">الحالة</th></tr></thead><tbody>{transactions.map(t=><tr key={t.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors"><td className="p-3">{t.transaction_date}</td><td className="p-3 font-bold">{accounts.find(a=>a.id===t.account_id)?.name||t.account_id}</td><td className="p-3">{t.description||'—'}</td><td className="p-3">{t.reference||'—'}</td><td className="p-3">{t.type==='credit'?<span className="text-emerald-700 flex items-center gap-1"><ArrowDownLeft className="w-4"/> إيداع</span>:<span className="text-rose-700 flex items-center gap-1"><ArrowUpRight className="w-4"/> سحب</span>}</td><td className="p-3 font-black">{money(t.amount)}</td><td className="p-3">{t.status}</td></tr>)}</tbody></table></div></div>}
      {tab==='reconciliation' && <div className="p-4"><div className="p-5 rounded-2xl bg-indigo-50 border border-indigo-100"><h2 className="font-black text-lg">التسوية البنكية</h2><p className="text-sm text-slate-600 mt-1">مطابقة حركات النظام مع كشف البنك باستخدام نفس محرك التسوية الموجود في النظام.</p><button onClick={()=>setTab('reports')} className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-xl font-bold">عرض مؤشرات التسوية</button></div><div className="grid md:grid-cols-3 gap-3 mt-4"><Kpi title="حركات النظام" value={transactions.filter(t=>t.source==='system').length} plain/><Kpi title="كشف البنك" value={transactions.filter(t=>t.source==='bank_statement').length} plain/><Kpi title="غير مسواة" value={transactions.filter(t=>t.status!=='matched').length} plain/></div></div>}
      {tab==='settings' && <div className="p-5 max-w-3xl"><h2 className="font-black text-xl mb-4">إعدادات البنوك</h2><div className="grid md:grid-cols-2 gap-4">{[['default_currency','العملة الافتراضية'],['reconciliation_tolerance','هامش فرق التسوية'],['require_approval_over','طلب اعتماد للحركات فوق'],['allow_negative_balance','السماح برصيد سالب'],['auto_post_to_accounting','الترحيل التلقائي للمحاسبة']].map(([k,l])=><label key={k} className="border rounded-xl p-4 flex flex-col gap-2"><span className="text-xs font-black text-slate-500">{l}</span>{typeof settings[k]==='boolean'?<input type="checkbox" checked={!!settings[k]} onChange={e=>setSettings({...settings,[k]:e.target.checked})}/>:<input value={settings[k]??''} onChange={e=>setSettings({...settings,[k]:e.target.value})} className="p-2 border rounded-lg"/>}</label>)}</div><button onClick={saveSettings} className="mt-5 px-5 py-3 bg-indigo-600 text-white rounded-xl font-black flex gap-2"><Save className="w-4"/> حفظ الإعدادات</button></div>}
      {tab==='reports' && <div className="p-4"><h2 className="font-black text-xl mb-4">تقارير البنوك</h2><div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">{[['bank_balances','أرصدة الحسابات البنكية'],['bank_transactions','كشف حركات البنك'],['bank_reconciliation','تقرير التسوية البنكية'],['bank_flow','التدفق النقدي البنكي']].map(([id,title])=><button key={id} onClick={id==='bank_transactions'?exportCsv:undefined} className="text-right border rounded-2xl p-5 hover:shadow-md"><FileText className="w-6 h-6 text-indigo-600 mb-3"/><div className="font-black">{title}</div><div className="text-xs text-slate-500 mt-1">عرض وطباعة وتصدير</div></button>)}</div><div className="mt-5 border rounded-2xl overflow-hidden"><div className="p-4 bg-slate-50 font-black">ملخص الأرصدة</div>{accounts.map(a=><div key={a.id} className="p-4 border-t flex justify-between"><span>{a.name}</span><b>{money(a.balance)} {a.currency||'EGP'}</b></div>)}</div></div>}
      </div>
    </div>
    </div>
    {showAccount&&<Modal title={editing?'تعديل حساب بنكي':'إضافة حساب بنكي'} close={()=>setShowAccount(false)}><form onSubmit={saveAccount} className="grid md:grid-cols-2 gap-3">{[['name','اسم الحساب'],['bank_name','اسم البنك'],['account_number','رقم الحساب'],['iban','IBAN'],['swift_code','SWIFT'],['currency','العملة'],['account_type','نوع الحساب'],['opening_balance','الرصيد الافتتاحي'],['branch_id','رقم الفرع']].map(([k,l])=><label key={k} className="text-xs font-bold"><span>{l}</span><input required={k==='name'} value={form[k]??''} onChange={e=>setForm({...form,[k]:e.target.value})} className="mt-1 w-full p-2.5 border rounded-lg"/></label>)}<label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={!!form.is_active} onChange={e=>setForm({...form,is_active:e.target.checked})}/> الحساب نشط</label><div className="md:col-span-2 flex justify-end gap-2"><button type="button" onClick={()=>setShowAccount(false)} className="px-4 py-2 border rounded-xl">إلغاء</button><button className="px-5 py-2 bg-indigo-600 text-white rounded-xl font-bold">حفظ</button></div></form></Modal>}
    {showTransfer&&<Modal title="تحويل بين الحسابات البنكية" close={()=>setShowTransfer(false)}><form onSubmit={saveTransfer} className="grid gap-3"><div className="grid md:grid-cols-2 gap-3"><select value={transfer.from_account_id} onChange={e=>setTransfer({...transfer,from_account_id:e.target.value})} className="p-3 border rounded-xl" required><option value="">من حساب</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select><select value={transfer.to_account_id} onChange={e=>setTransfer({...transfer,to_account_id:e.target.value})} className="p-3 border rounded-xl" required><option value="">إلى حساب</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></div><div className="grid grid-cols-2 gap-3"><input type="date" value={transfer.transaction_date} onChange={e=>setTransfer({...transfer,transaction_date:e.target.value})} className="p-3 border rounded-xl" required/><input type="number" min="0" step="0.01" placeholder="المبلغ" value={transfer.amount} onChange={e=>setTransfer({...transfer,amount:e.target.value})} className="p-3 border rounded-xl" required/></div><input placeholder="البيان" value={transfer.description} onChange={e=>setTransfer({...transfer,description:e.target.value})} className="p-3 border rounded-xl"/><input placeholder="المرجع" value={transfer.reference} onChange={e=>setTransfer({...transfer,reference:e.target.value})} className="p-3 border rounded-xl"/><button className="p-3 bg-indigo-600 text-white rounded-xl font-black">تنفيذ التحويل</button></form></Modal>}
    {showTx&&<Modal title="إضافة حركة بنكية" close={()=>setShowTx(false)}><form onSubmit={saveTx} className="grid gap-3"><select value={txForm.account_id} onChange={e=>setTxForm({...txForm,account_id:e.target.value})} className="p-3 border rounded-xl" required><option value="">اختر الحساب</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name} — {a.account_number}</option>)}</select><div className="grid grid-cols-2 gap-3"><input type="date" value={txForm.transaction_date} onChange={e=>setTxForm({...txForm,transaction_date:e.target.value})} className="p-3 border rounded-xl" required/><select value={txForm.type} onChange={e=>setTxForm({...txForm,type:e.target.value})} className="p-3 border rounded-xl"><option value="credit">إيداع</option><option value="debit">سحب</option></select></div><input placeholder="المبلغ" type="number" min="0" step="0.01" value={txForm.amount} onChange={e=>setTxForm({...txForm,amount:e.target.value})} className="p-3 border rounded-xl" required/><input placeholder="البيان" value={txForm.description} onChange={e=>setTxForm({...txForm,description:e.target.value})} className="p-3 border rounded-xl"/><input placeholder="المرجع" value={txForm.reference} onChange={e=>setTxForm({...txForm,reference:e.target.value})} className="p-3 border rounded-xl"/><button className="p-3 bg-indigo-600 text-white rounded-xl font-black">حفظ الحركة</button></form></Modal>}
  </div>
};
const Kpi=({title,value,icon,plain}:{title:string,value:number,icon?:React.ReactNode,plain?:boolean})=><div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs"><div className="flex justify-between text-slate-500 text-xs font-bold"><span>{title}</span>{icon&&<span className="text-indigo-600">{icon}</span>}</div><div className="text-xl font-black mt-2">{plain?value:money(value)}</div></div>;
const Tab=({active,onClick,icon,text}:{active:boolean;onClick:()=>void;icon:React.ReactNode;text:string})=><button onClick={onClick} className={`px-4 py-2.5 rounded-xl font-black text-xs flex gap-2 items-center ${active?'bg-indigo-600 text-white shadow-sm':'bg-white border border-slate-300 text-slate-600 hover:bg-slate-50'}`}>{icon}{text}</button>;
const Empty=({text}:{text:string})=><div className="col-span-full p-12 text-center text-slate-400 font-bold">{text}</div>;
const Modal=({title,close,children}:{title:string;close:()=>void;children:React.ReactNode})=><div className="fixed inset-0 z-50 bg-slate-950/40 flex items-center justify-center p-4"><div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-auto shadow-2xl"><div className="p-4 border-b flex justify-between"><h3 className="font-black">{title}</h3><button onClick={close}><X/></button></div><div className="p-5">{children}</div></div></div>;
