import React, { useState, useEffect } from 'react';
import { Send, Activity, MessageSquare, Users, FileText, LogOut, Plus, Trash2, DollarSign, Route, UserPlus, Building2, BarChart3, Wallet, History, Zap, Wifi, WifiOff, RefreshCw, Calendar, FileText as InvoiceIcon, TrendingUp, PieChart } from 'lucide-react';
import io from 'socket.io-client';
import axios from 'axios';
import { Pie, Bar, Line } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title } from 'chart.js';

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title);

const API_URL = window.location.hostname === 'localhost' ? 'http://localhost:3001' : 'http://' + window.location.hostname + ':3001';
const socket = io(API_URL, { path: '/socket.io' });

function Toast({ msg, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t); }, []);
  return msg ? <div className="fixed top-4 right-4 z-50 bg-emerald-600 text-white px-6 py-3 rounded-xl shadow-lg text-sm">{msg}</div> : null;
}

function App() {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [activeTab, setActiveTab] = useState('dashboard');
  const [stats, setStats] = useState({});
  const [messages, setMessages] = useState([]);
  const [liveLogs, setLiveLogs] = useState([]);
  const [clients, setClients] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [rates, setRates] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [txs, setTxs] = useState([]);
  const [toast, setToast] = useState('');
  const [loginError, setLoginError] = useState('');
  const [reportData, setReportData] = useState(null);
  const [invoicePeriod, setInvoicePeriod] = useState('MONTHLY');
  const [invClientId, setInvClientId] = useState('');
  const [invStart, setInvStart] = useState('');
  const [invEnd, setInvEnd] = useState('');

  // Send SMS
  const [sTo, setSTo] = useState('');
  const [sMsg, setSMsg] = useState('');
  const [sCid, setSCid] = useState('');
  const [sSid, setSSid] = useState('');
  const [sRes, setSRes] = useState(null);

  // Forms
  const [showClient, setShowClient] = useState(false);
  const [showSupplier, setShowSupplier] = useState(false);
  const [showRoute, setShowRoute] = useState(false);
  const [showRate, setShowRate] = useState(false);
  const [showTopup, setShowTopup] = useState(null);
  const [showTx, setShowTx] = useState(null);

  const [newClient, setNewClient] = useState({name:'',balance:100,dailyLimit:10000,connectionType:'SMPP',smppSystemId:'',smppPassword:'',smppHost:'',smppPort:2775,httpApiKey:'',httpBaseUrl:'',dlrTimeout:0,forceDlr:false,invoiceFrequency:'MONTHLY'});
  const [newSupplier, setNewSupplier] = useState({name:'',type:'SMPP',host:'',port:2775,systemId:'',password:''});
  const [newRoute, setNewRoute] = useState({name:'',prefix:'',supplierId:'',priority:1});
  const [newRate, setNewRate] = useState({country:'',countryCode:'',price:0.05,type:'SENDING'});
  const [topupAmt, setTopupAmt] = useState({amount:100,description:'',method:'BANK_TRANSFER'});

  const auth = () => ({ headers: { Authorization: `Bearer ${token}` } });
  const showMsg = (m) => setToast(m);

  useEffect(() => {
    if (token) { fetchAll(); fetchReport(); }
    socket.on('live-log', (log) => setLiveLogs(prev => [log, ...prev].slice(0, 200)));
    return () => { socket.off(); };
  }, [token]);

  const fetchAll = () => { fetchStats(); fetchMsgs(); fetchClients(); fetchRoutes(); fetchRates(); fetchSuppliers(); fetchInvoices(); };
  const fetchStats = async () => { try { const r = await axios.get(API_URL+'/api/dashboard/stats', auth()); setStats(r.data); } catch(e) {} };
  const fetchMsgs = async () => { try { const r = await axios.get(API_URL+'/api/messages?limit=100', auth()); setMessages(r.data.messages||[]); } catch(e) {} };
  const fetchClients = async () => { try { const r = await axios.get(API_URL+'/api/clients', auth()); setClients(r.data.clients||[]); } catch(e) {} };
  const fetchRoutes = async () => { try { const r = await axios.get(API_URL+'/api/routes', auth()); setRoutes(r.data.routes||[]); } catch(e) {} };
  const fetchRates = async () => { try { const r = await axios.get(API_URL+'/api/rates', auth()); setRates(r.data.rates||[]); } catch(e) {} };
  const fetchSuppliers = async () => { try { const r = await axios.get(API_URL+'/api/suppliers', auth()); setSuppliers(r.data.suppliers||[]); } catch(e) {} };
  const fetchInvoices = async () => { try { const r = await axios.get(API_URL+'/api/invoices', auth()); setInvoices(r.data.invoices||[]); } catch(e) {} };
  const fetchTx = async (cid) => { try { const r = await axios.get(API_URL+'/api/clients/'+cid+'/transactions', auth()); setTxs(r.data.transactions||[]); } catch(e) {} };
  const fetchReport = async () => { try { const r = await axios.get(API_URL+'/api/reports', auth()); setReportData(r.data); } catch(e) {} };

  const login = async () => {
    try { const r = await axios.post(API_URL+'/api/auth/login', { email: 'admin@smsgateway.com', password: 'admin123' }); localStorage.setItem('token', r.data.token); setToken(r.data.token); }
    catch(e) { setLoginError('Cannot connect to ' + API_URL); }
  };

  const addClient = async () => {
    try {
      const d = { name: newClient.name, balance: parseFloat(newClient.balance), dailyLimit: parseInt(newClient.dailyLimit), dlrTimeout: parseInt(newClient.dlrTimeout), forceDlr: newClient.forceDlr, invoiceFrequency: newClient.invoiceFrequency };
      if (newClient.connectionType === 'SMPP') Object.assign(d, { smppSystemId: newClient.smppSystemId, smppPassword: newClient.smppPassword, smppHost: newClient.smppHost, smppPort: parseInt(newClient.smppPort) });
      else Object.assign(d, { httpApiKey: newClient.httpApiKey, httpBaseUrl: newClient.httpBaseUrl });
      await axios.post(API_URL+'/api/clients', d, auth());
      setShowClient(false); fetchClients(); showMsg('Client added!');
    } catch(e) { showMsg('Error: '+(e.response?.data?.error||e.message)); }
  };

  const addSupplier = async () => {
    try { await axios.post(API_URL+'/api/suppliers', newSupplier, auth()); setShowSupplier(false); fetchSuppliers(); showMsg('Supplier added!'); }
    catch(e) { showMsg('Error: '+(e.response?.data?.error||e.message)); }
  };

  const addRoute = async () => {
    try { await axios.post(API_URL+'/api/routes', newRoute, auth()); setShowRoute(false); fetchRoutes(); showMsg('Route added!'); }
    catch(e) { showMsg('Error: '+(e.response?.data?.error||e.message)); }
  };

  const addRate = async () => {
    try { await axios.post(API_URL+'/api/rates', newRate, auth()); setShowRate(false); fetchRates(); showMsg('Rate added!'); }
    catch(e) { showMsg('Error: '+(e.response?.data?.error||e.message)); }
  };

  const topupClient = async () => {
    try {
      await axios.post(API_URL+'/api/clients/'+showTopup+'/topup', { amount: parseFloat(topupAmt.amount), description: topupAmt.description, paymentMethod: topupAmt.method }, auth());
      setShowTopup(null); fetchClients(); showMsg('Funds added!');
    } catch(e) { showMsg('Error: '+(e.response?.data?.error||e.message)); }
  };

  const generateInvoice = async () => {
    if (!invClientId) return showMsg('Select a client');
    try {
      const d = { clientId: invClientId, period: invoicePeriod };
      if (invoicePeriod === 'CUSTOM') { d.startDate = invStart; d.endDate = invEnd; }
      await axios.post(API_URL+'/api/invoices/generate', d, auth());
      fetchInvoices(); showMsg('Invoice generated!');
    } catch(e) { showMsg('Error: '+(e.response?.data?.error||e.message)); }
  };

  const sendSms = async () => {
    if (!sTo || !sMsg || !sCid) return showMsg('Fill all fields');
    try {
      const url = sSid ? API_URL+'/api/messages/send-via/'+sSid : API_URL+'/api/messages/send';
      const r = await axios.post(url, { to: sTo, content: sMsg, clientId: sCid }, auth());
      setSRes({ ok: true, msg: `Sent! Cost: $${r.data.cost?.toFixed(4)} | ${r.data.supplier||'Auto'}` });
      setSTo(''); setSMsg(''); fetchMsgs(); fetchStats();
    } catch(e) { setSRes({ ok: false, msg: e.response?.data?.error||e.message }); }
  };

  const delClient = async (id) => { if(confirm('Delete?')){ await axios.delete(API_URL+'/api/clients/'+id,auth()); fetchClients(); } };
  const syncSmpp = async (cid) => {
    try { const r = await axios.post(API_URL+'/api/clients/'+cid+'/sync-smpp', {}, auth()); showMsg('SMPP Synced! Port: 2775'); }
    catch(e) { showMsg('Sync failed: '+(e.response?.data?.error||e.message)); }
  };


  const delSupplier = async (id) => { if(confirm('Delete?')){ await axios.delete(API_URL+'/api/suppliers/'+id,auth()); fetchSuppliers(); } };

  // Chart data
  const pieData = {
    labels: ['Delivered', 'Failed', 'Pending', 'Expired'],
    datasets: [{ data: [
      messages.filter(m=>m.status==='DELIVERED').length,
      messages.filter(m=>m.status==='FAILED').length,
      messages.filter(m=>m.status==='SUBMITTED').length,
      messages.filter(m=>m.status==='EXPIRED').length
    ], backgroundColor: ['#10b981','#ef4444','#f59e0b','#6b7280'] }]
  };

  const dailyData = {
    labels: reportData?.dailyBreakdown?.map(d=>d.date.substring(5)) || [],
    datasets: [{ label: 'Messages', data: reportData?.dailyBreakdown?.map(d=>d.messages) || [], borderColor: '#10b981', tension: 0.3, fill: false }]
  };

  const supplierData = {
    labels: suppliers.map(s=>s.name),
    datasets: [{ label: 'Messages', data: suppliers.map(s=>s._count?.messages||0), backgroundColor: '#3b82f6' }]
  };

  // Login page
  if (!token) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="bg-gray-900 p-10 rounded-2xl border border-gray-700 max-w-sm w-full text-center"><Zap className="w-16 h-16 text-emerald-400 mx-auto mb-4"/><h1 className="text-3xl font-bold text-white mb-2">SMS Gateway</h1><p className="text-gray-400 text-sm mb-4">Production v2.0</p>{loginError&&<div className="bg-red-900/50 text-red-300 p-3 rounded-xl mb-4 text-xs">{loginError}</div>}<button onClick={login} className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 rounded-xl">LOGIN AS DEMO ADMIN</button><p className="text-xs text-gray-500 mt-4">admin@smsgateway.com / admin123</p></div></div>;
  }

  const tabs = [
    {id:'dashboard',l:'Dashboard',i:<BarChart3 className="w-3 h-3"/>},{id:'send',l:'Send SMS',i:<Send className="w-3 h-3"/>},
    {id:'messages',l:'Messages',i:<FileText className="w-3 h-3"/>},{id:'live',l:'Live Logs',i:<Activity className="w-3 h-3"/>},
    {id:'clients',l:'Clients',i:<Users className="w-3 h-3"/>},{id:'suppliers',l:'Suppliers',i:<Building2 className="w-3 h-3"/>},
    {id:'routes',l:'Routes',i:<Route className="w-3 h-3"/>},{id:'rates',l:'Rates',i:<DollarSign className="w-3 h-3"/>},
    {id:'invoices',l:'Invoices',i:<InvoiceIcon className="w-3 h-3"/>},
  ];

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {toast && <Toast msg={toast} onClose={() => setToast('')} />}
      <nav className="bg-black border-b border-gray-800 px-4 py-2 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-2"><Zap className="w-5 h-5 text-emerald-400"/><span className="font-bold text-lg">SMS<span className="text-emerald-400">GW</span></span></div>
        <div className="flex gap-1 overflow-x-auto">{tabs.map(t=>(<button key={t.id} onClick={()=>setActiveTab(t.id)} className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs whitespace-nowrap ${activeTab===t.id?'bg-emerald-600 text-white':'bg-gray-800 text-gray-400'}`}>{t.i}{t.l}</button>))}</div>
        <button onClick={()=>{localStorage.removeItem('token');setToken(null);}} className="text-gray-400 hover:text-red-400"><LogOut className="w-4 h-4"/></button>
      </nav>

      <div className="p-4">
        {/* DASHBOARD WITH CHARTS */}
        {activeTab==='dashboard'&&<div>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="bg-emerald-900/30 border border-emerald-500/30 p-4 rounded-2xl">
              <div className="flex items-center gap-2"><Wifi className="w-4 h-4 text-emerald-400"/><span className="text-emerald-400 text-sm font-semibold">SMPP Server</span></div>
              <div className="text-xs text-gray-400 mt-2">Port: 2775 | Status: ONLINE</div>
              <div className="text-xs text-gray-500">Accepting external clients</div>
            </div>
            <div className="bg-emerald-900/30 border border-emerald-500/30 p-4 rounded-2xl">
              <div className="flex items-center gap-2"><Wifi className="w-4 h-4 text-emerald-400"/><span className="text-emerald-400 text-sm font-semibold">allsms SMSC</span></div>
              <div className="text-xs text-gray-400 mt-2">5.78.72.23:2775 | STATUS: BOUND</div>
              <div className="text-xs text-gray-500">Test1 / VMA / v3.4</div>
            </div>
            <div className="bg-emerald-900/30 border border-emerald-500/30 p-4 rounded-2xl">
              <div className="flex items-center gap-2"><Wifi className="w-4 h-4 text-emerald-400"/><span className="text-emerald-400 text-sm font-semibold">HTTP API</span></div>
              <div className="text-xs text-gray-400 mt-2">Port: 13013 | STATUS: ONLINE</div>
              <div className="text-xs text-gray-500">SMSBox sendsms</div>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-3 mb-4">
            {[{l:'Total Msgs',v:stats.totalMessages||0},{l:'Delivery',v:(stats.deliveredRate||0)+'%'},{l:'Clients',v:stats.activeClients||clients.length},{l:'Suppliers',v:stats.activeSuppliers||suppliers.length},{l:'Revenue',v:'$'+(stats.totalRevenue||0).toFixed(2)},{l:'Today',v:stats.todayMessages||0},{l:'Routes',v:stats.activeRoutes||0},{l:'Rates',v:rates.length}].map((s,i)=>(<div key={i} className="bg-gray-900 p-4 rounded-2xl border border-gray-800"><div className="text-gray-500 text-xs">{s.l}</div><div className="text-2xl font-bold mt-1">{s.v}</div></div>))}
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-gray-900 p-4 rounded-2xl"><h3 className="text-sm font-semibold mb-2">Message Status</h3><div className="h-48 flex items-center justify-center">{messages.length>0 ? <Pie data={pieData} options={{responsive:true,maintainAspectRatio:false}} /> : <span className="text-gray-500 text-xs">No data</span>}</div></div>
            <div className="bg-gray-900 p-4 rounded-2xl"><h3 className="text-sm font-semibold mb-2">Daily Traffic (30d)</h3><div className="h-48">{reportData?.dailyBreakdown ? <Line data={dailyData} options={{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}}}} /> : <span className="text-gray-500 text-xs">Loading...</span>}</div></div>
            <div className="bg-gray-900 p-4 rounded-2xl"><h3 className="text-sm font-semibold mb-2">By Supplier</h3><div className="h-48">{suppliers.length>0 ? <Bar data={supplierData} options={{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}}}} /> : <span className="text-gray-500 text-xs">No suppliers</span>}</div></div>
          </div>
          <div className="grid grid-cols-2 gap-4 mt-4">
            <div className="bg-gray-900 p-4 rounded-2xl"><h3 className="text-sm font-semibold mb-2">Recent Messages</h3><div className="space-y-1 max-h-48 overflow-auto">{messages.slice(0,8).map((m,i)=>(<div key={i} className="flex justify-between text-xs py-1 border-b border-gray-800"><span className="text-emerald-300">{m.to}</span><span className="text-gray-400">{m.content?.substring(0,25)}</span><span className={m.status==='DELIVERED'?'text-emerald-400':'text-yellow-400'}>{m.status}</span></div>))}</div></div>
            <div className="bg-gray-900 p-4 rounded-2xl"><h3 className="text-sm font-semibold mb-2">Live Feed</h3><div className="h-48 overflow-auto font-mono text-xs">{liveLogs.slice(0,12).map((l,i)=>(<div key={i} className="py-1 border-b border-gray-900"><span className="text-gray-600">{new Date(l.timestamp).toLocaleTimeString()}</span> <span className="text-blue-400">{l.type}</span> {(l.to||l.name)&&<span className="text-emerald-300">{(l.to||l.name)?.substring(0,20)}</span>} <span className="text-gray-400">{l.content||l.message||''}</span></div>))}</div></div>
          </div>
        </div>}

        {/* SEND SMS */}
        {activeTab==='send'&&<div className="max-w-lg mx-auto"><h2 className="text-xl font-bold mb-3">Send SMS</h2><div className="bg-gray-900 p-6 rounded-2xl space-y-3"><div><label className="text-xs text-gray-400 mb-1 block">Client</label><select className="w-full bg-black border border-gray-700 rounded-xl px-4 py-2 text-sm" value={sCid} onChange={e=>setSCid(e.target.value)}><option value="">Select</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name} (${c.balance?.toFixed(2)})</option>)}</select></div><div><label className="text-xs text-gray-400 mb-1 block">Supplier</label><select className="w-full bg-black border border-gray-700 rounded-xl px-4 py-2 text-sm" value={sSid} onChange={e=>setSSid(e.target.value)}><option value="">Auto</option>{suppliers.filter(s=>s.status==='ACTIVE').map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></div><div><label className="text-xs text-gray-400 mb-1 block">To</label><input className="w-full bg-black border border-gray-700 rounded-xl px-4 py-2 text-sm" value={sTo} onChange={e=>setSTo(e.target.value)} placeholder="+15551234567"/></div><div><label className="text-xs text-gray-400 mb-1 block">Message</label><textarea className="w-full bg-black border border-gray-700 rounded-xl px-4 py-2 text-sm h-24" value={sMsg} onChange={e=>setSMsg(e.target.value)} placeholder="Message..."/><div className="text-right text-xs text-gray-500">{sMsg.length}/160</div></div><button onClick={sendSms} className="w-full bg-emerald-600 py-2.5 rounded-xl text-sm font-semibold">SEND SMS</button>{sRes&&<div className={`p-3 rounded-xl text-xs ${sRes.ok?'bg-emerald-900/50 text-emerald-400':'bg-red-900/50 text-red-400'}`}>{sRes.msg}</div>}</div></div>}

        {/* MESSAGES */}
        {activeTab==='messages'&&<div className="bg-gray-900 rounded-2xl overflow-x-auto"><table className="w-full text-xs"><thead><tr className="border-b border-gray-800 text-gray-400"><th className="p-2">To</th><th className="p-2">Content</th><th className="p-2">Sender ID</th><th className="p-2">Supplier ID</th><th className="p-2">Supplier</th><th className="p-2">Cost</th><th className="p-2">Status</th></tr></thead><tbody>{messages.map(m=>(<tr key={m.id} className="border-b border-gray-800 hover:bg-gray-800/50"><td className="p-2 text-emerald-300">{m.to}</td><td className="p-2 max-w-[150px] truncate">{m.content}</td><td className="p-2 font-mono text-xs text-gray-500">{m.senderMessageId?.substring(0,10)}</td><td className="p-2 font-mono text-xs text-gray-500">{m.supplierMessageId?.substring(0,10)||'-'}</td><td className="p-2 text-gray-400">{m.supplier?.name||'-'}</td><td className="p-2 text-amber-400">${m.cost?.toFixed(4)}</td><td className="p-2"><span className={`px-2 py-0.5 rounded-full text-xs ${m.status==='DELIVERED'?'bg-emerald-900 text-emerald-400':m.status==='FAILED'?'bg-red-900 text-red-400':'bg-yellow-900 text-yellow-400'}`}>{m.status}{m.forceFlag?' ⚡':''}</span></td></tr>))}</tbody></table></div>}

        {/* LIVE LOGS */}
        {activeTab==='live'&&<div><h2 className="text-xl font-bold mb-3">Live SMPP Logs</h2><div className="bg-black border border-gray-800 rounded-2xl p-3 h-[70vh] overflow-auto font-mono text-xs">{liveLogs.map((l,i)=>(<div key={i} className="py-1 border-b border-gray-900 flex gap-2"><span className="text-gray-500 w-16 shrink-0">{new Date(l.timestamp).toLocaleTimeString()}</span><span className={`px-1 py-0.5 rounded text-xs ${l.type==='bind_check'?'bg-purple-900 text-purple-400':l.type==='dlr'?'bg-emerald-900 text-emerald-400':l.type==='submit_sm_resp'?'bg-blue-900 text-blue-400':'bg-gray-800 text-gray-400'}`}>{l.type}</span><span className="text-emerald-300">{l.to||l.name||''}</span><span className="text-gray-400 flex-1">{l.content||l.message||l.bindStatus||''}</span>{l.latency&&<span className="text-amber-400">{l.latency}ms</span>}</div>))}</div></div>}

        {/* CLIENTS */}
        {activeTab==='clients'&&<div><div className="flex justify-between mb-3"><h2 className="text-xl font-bold">Clients</h2><button onClick={()=>setShowClient(!showClient)} className="bg-emerald-600 px-3 py-1.5 rounded-lg text-xs flex items-center gap-1"><UserPlus className="w-3 h-3"/>Add</button></div>{showClient&&<div className="bg-gray-900 p-4 rounded-2xl mb-3 border border-emerald-500/30"><h3 className="font-semibold text-sm mb-2">New Client</h3><div className="grid grid-cols-3 gap-2 mb-2"><input placeholder="Name*" className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={newClient.name} onChange={e=>setNewClient({...newClient,name:e.target.value})}/><input type="number" placeholder="Balance" className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={newClient.balance} onChange={e=>setNewClient({...newClient,balance:e.target.value})}/><input type="number" placeholder="Daily Limit" className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={newClient.dailyLimit} onChange={e=>setNewClient({...newClient,dailyLimit:e.target.value})}/></div><div className="mb-2 flex gap-3"><label className="text-xs text-gray-400">Type:</label><select className="bg-black border border-gray-700 rounded-lg px-2 py-1 text-xs" value={newClient.connectionType} onChange={e=>setNewClient({...newClient,connectionType:e.target.value})}><option value="SMPP">SMPP</option><option value="HTTP">HTTP</option></select><label className="text-xs text-gray-400">Invoice:</label><select className="bg-black border border-gray-700 rounded-lg px-2 py-1 text-xs" value={newClient.invoiceFrequency} onChange={e=>setNewClient({...newClient,invoiceFrequency:e.target.value})}><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option></select><label className="text-xs text-gray-400 flex items-center gap-1"><input type="checkbox" checked={newClient.forceDlr} onChange={e=>setNewClient({...newClient,forceDlr:e.target.checked})} className="bg-black"/>Force DLR</label></div>{newClient.connectionType==='SMPP'?<div className="grid grid-cols-4 gap-2"><input placeholder="System ID" className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={newClient.smppSystemId} onChange={e=>setNewClient({...newClient,smppSystemId:e.target.value})}/><input placeholder="Password" className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={newClient.smppPassword} onChange={e=>setNewClient({...newClient,smppPassword:e.target.value})}/><input placeholder="Host" className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={newClient.smppHost} onChange={e=>setNewClient({...newClient,smppHost:e.target.value})}/><input type="number" placeholder="Port" className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={newClient.smppPort} onChange={e=>setNewClient({...newClient,smppPort:e.target.value})}/></div>:<div className="grid grid-cols-2 gap-2"><input placeholder="API Key" className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={newClient.httpApiKey} onChange={e=>setNewClient({...newClient,httpApiKey:e.target.value})}/><input placeholder="Base URL" className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={newClient.httpBaseUrl} onChange={e=>setNewClient({...newClient,httpBaseUrl:e.target.value})}/></div>}<div className="flex gap-2 mt-3"><button onClick={addClient} className="bg-emerald-600 px-4 py-2 rounded-lg text-xs">Save</button><button onClick={()=>setShowClient(false)} className="bg-gray-700 px-4 py-2 rounded-lg text-xs">Cancel</button></div></div>}<div className="bg-gray-900 rounded-2xl overflow-x-auto"><table className="w-full text-xs"><thead><tr className="border-b border-gray-800 text-gray-400"><th className="p-2">Account ID</th><th className="p-2">Name</th><th className="p-2">Conn</th><th className="p-2">Balance</th><th className="p-2">Invoice Freq</th><th className="p-2">Actions</th></tr></thead><tbody>{clients.map(c=>(<tr key={c.id} className="border-b border-gray-800 hover:bg-gray-800/50"><td className="p-2 text-emerald-400 font-mono text-xs">{c.accountId}</td><td className="p-2">{c.name}</td><td className="p-2">{c.smppAccounts?.length>0?<span className="px-2 py-0.5 rounded bg-blue-900 text-blue-400 text-xs">SMPP</span>:c.httpConnections?.length>0?<span className="px-2 py-0.5 rounded bg-purple-900 text-purple-400 text-xs">HTTP</span>:'-'}</td><td className="p-2 font-mono">${c.balance?.toFixed(2)}</td><td className="p-2 text-xs text-gray-400">{c.invoiceFrequency||'MONTHLY'}</td><td className="p-2 flex gap-1"><button onClick={()=>{setShowTopup(c.id);setTopupAmt({amount:100,description:'',method:'BANK_TRANSFER'});}} className="bg-amber-600 text-white px-2 py-0.5 rounded text-xs"><Wallet className="w-3 h-3"/></button><button onClick={()=>{setShowTx(c.id);fetchTx(c.id);}} className="bg-blue-600 text-white px-2 py-0.5 rounded text-xs"><History className="w-3 h-3"/></button><button onClick={()=>syncSmpp(c.id)} className="text-emerald-400 ml-1" title="Sync to SMPP"><RefreshCw className="w-3 h-3"/></button><button onClick={()=>delClient(c.id)} className="text-red-400 ml-1"><Trash2 className="w-3 h-3"/></button></td></tr>))}</tbody></table></div></div>}

        {/* SUPPLIERS */}
        {activeTab==='suppliers'&&<div><div className="flex justify-between mb-3"><h2 className="text-xl font-bold">Suppliers</h2><button onClick={()=>setShowSupplier(!showSupplier)} className="bg-emerald-600 px-3 py-1.5 rounded-lg text-xs flex items-center gap-1"><Plus className="w-3 h-3"/>Add</button></div>{showSupplier&&<div className="bg-gray-900 p-4 rounded-2xl mb-3 grid grid-cols-3 gap-2"><input placeholder="Name*" className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={newSupplier.name} onChange={e=>setNewSupplier({...newSupplier,name:e.target.value})}/><select className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={newSupplier.type} onChange={e=>setNewSupplier({...newSupplier,type:e.target.value})}><option>SMPP</option><option>HTTP</option></select><input placeholder="Host" className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={newSupplier.host} onChange={e=>setNewSupplier({...newSupplier,host:e.target.value})}/><input type="number" placeholder="Port" className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={newSupplier.port} onChange={e=>setNewSupplier({...newSupplier,port:e.target.value})}/><input placeholder="System ID" className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={newSupplier.systemId} onChange={e=>setNewSupplier({...newSupplier,systemId:e.target.value})}/><input placeholder="Password" type="password" className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={newSupplier.password} onChange={e=>setNewSupplier({...newSupplier,password:e.target.value})}/><div className="col-span-3 flex gap-2"><button onClick={addSupplier} className="bg-emerald-600 px-4 py-2 rounded-lg text-xs">Save</button><button onClick={()=>setShowSupplier(false)} className="bg-gray-700 px-4 py-2 rounded-lg text-xs">Cancel</button></div></div>}<div className="grid grid-cols-2 gap-3">{suppliers.map(s=>(<div key={s.id} className="bg-gray-900 p-4 rounded-2xl border border-gray-800"><div className="flex justify-between"><h3 className="font-semibold text-sm">{s.name}</h3><span className={`text-xs ${s.status==='ACTIVE'?'text-emerald-400':'text-red-400'}`}>{s.status==='ACTIVE'?<Wifi className="w-3 h-3 inline"/>:<WifiOff className="w-3 h-3 inline"/>} {s.status}</span></div><div className="text-xs text-gray-400 mt-1">{s.type} | {s.throughput} msg/s | {s._count?.messages||0} msgs</div>{s.smppConnections?.[0]&&<div className="text-xs text-gray-500">{s.smppConnections[0].host}:{s.smppConnections[0].port}</div>}<button onClick={()=>delSupplier(s.id)} className="text-red-400 text-xs mt-2">Remove</button></div>))}</div></div>}

        {/* ROUTES */}
        {activeTab==='routes'&&<div><div className="flex justify-between mb-3"><h2 className="text-xl font-bold">Routes</h2><button onClick={()=>setShowRoute(!showRoute)} className="bg-emerald-600 px-3 py-1.5 rounded-lg text-xs flex items-center gap-1"><Route className="w-3 h-3"/>Add</button></div>{showRoute&&<div className="bg-gray-900 p-4 rounded-2xl mb-3 grid grid-cols-2 gap-2"><input placeholder="Name" className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={newRoute.name} onChange={e=>setNewRoute({...newRoute,name:e.target.value})}/><input placeholder="Prefix" className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={newRoute.prefix} onChange={e=>setNewRoute({...newRoute,prefix:e.target.value})}/><select className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={newRoute.supplierId} onChange={e=>setNewRoute({...newRoute,supplierId:e.target.value})}><option value="">Select</option>{suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select><input type="number" placeholder="Priority" className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={newRoute.priority} onChange={e=>setNewRoute({...newRoute,priority:e.target.value})}/><div className="col-span-2 flex gap-2"><button onClick={addRoute} className="bg-emerald-600 px-4 py-2 rounded-lg text-xs">Save</button><button onClick={()=>setShowRoute(false)} className="bg-gray-700 px-4 py-2 rounded-lg text-xs">Cancel</button></div></div>}<div className="bg-gray-900 rounded-2xl overflow-x-auto"><table className="w-full text-xs"><thead><tr className="border-b border-gray-800 text-gray-400"><th className="p-2">Pri</th><th className="p-2">Name</th><th className="p-2">Prefix</th><th className="p-2">Supplier</th></tr></thead><tbody>{routes.map(r=>(<tr key={r.id} className="border-b border-gray-800"><td className="p-2">P{r.priority}</td><td className="p-2">{r.name}</td><td className="p-2 text-emerald-400">{r.prefix}</td><td className="p-2">{r.supplier?.name||'-'}</td></tr>))}</tbody></table></div></div>}

        {/* RATES */}
        {activeTab==='rates'&&<div><div className="flex justify-between mb-3"><h2 className="text-xl font-bold">Rates</h2><button onClick={()=>setShowRate(!showRate)} className="bg-emerald-600 px-3 py-1.5 rounded-lg text-xs flex items-center gap-1"><DollarSign className="w-3 h-3"/>Add</button></div>{showRate&&<div className="bg-gray-900 p-4 rounded-2xl mb-3 grid grid-cols-3 gap-2"><input placeholder="Country" className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={newRate.country} onChange={e=>setNewRate({...newRate,country:e.target.value})}/><input placeholder="Code" className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={newRate.countryCode} onChange={e=>setNewRate({...newRate,countryCode:e.target.value})}/><input type="number" step="0.001" placeholder="Price" className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={newRate.price} onChange={e=>setNewRate({...newRate,price:e.target.value})}/><div className="col-span-3 flex gap-2"><button onClick={addRate} className="bg-emerald-600 px-4 py-2 rounded-lg text-xs">Save</button><button onClick={()=>setShowRate(false)} className="bg-gray-700 px-4 py-2 rounded-lg text-xs">Cancel</button></div></div>}<div className="bg-gray-900 rounded-2xl overflow-x-auto"><table className="w-full text-xs"><thead><tr className="border-b border-gray-800 text-gray-400"><th className="p-2">Country</th><th className="p-2">Code</th><th className="p-2">Price</th></tr></thead><tbody>{rates.map(r=>(<tr key={r.id} className="border-b border-gray-800"><td className="p-2">{r.country}</td><td className="p-2 text-emerald-400">+{r.countryCode}</td><td className="p-2 text-amber-400">${r.price?.toFixed(4)}</td></tr>))}</tbody></table></div></div>}

        {/* INVOICES */}
        {activeTab==='invoices'&&<div>
          <h2 className="text-xl font-bold mb-3">Invoice Generator</h2>
          <div className="bg-gray-900 p-4 rounded-2xl mb-4 grid grid-cols-4 gap-3">
            <select className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={invClientId} onChange={e=>setInvClientId(e.target.value)}><option value="">Select Client</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <select className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={invoicePeriod} onChange={e=>setInvoicePeriod(e.target.value)}><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option><option value="CUSTOM">Custom Range</option></select>
            {invoicePeriod==='CUSTOM'&&<><input type="date" className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={invStart} onChange={e=>setInvStart(e.target.value)}/><input type="date" className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={invEnd} onChange={e=>setInvEnd(e.target.value)}/></>}
            <button onClick={generateInvoice} className="bg-emerald-600 px-4 py-2 rounded-lg text-sm col-span-1">Generate Invoice</button>
          </div>
          <div className="bg-gray-900 rounded-2xl overflow-x-auto"><table className="w-full text-xs"><thead><tr className="border-b border-gray-800 text-gray-400"><th className="p-2">Invoice #</th><th className="p-2">Client</th><th className="p-2">Period</th><th className="p-2">Type</th><th className="p-2">Messages</th><th className="p-2">Amount</th><th className="p-2">Status</th></tr></thead><tbody>{invoices.map(inv=>(<tr key={inv.id} className="border-b border-gray-800"><td className="p-2 text-emerald-400 font-mono text-xs">{inv.invoiceNumber}</td><td className="p-2">{inv.client?.name}</td><td className="p-2 text-gray-500 text-xs">{inv.period}</td><td className="p-2 text-xs">{inv.periodType||'MONTHLY'}</td><td className="p-2">{inv.totalMessages}</td><td className="p-2 text-amber-400">${inv.totalAmount?.toFixed(2)}</td><td className="p-2"><span className="px-2 py-0.5 rounded-full bg-emerald-900 text-emerald-400 text-xs">{inv.status}</span></td></tr>))}</tbody></table></div>
        </div>}

        {/* TOPUP MODAL */}
        {showTopup&&<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"><div className="bg-gray-900 p-6 rounded-2xl border border-gray-700 w-96"><h3 className="font-semibold text-lg mb-4">Add Funds</h3><div className="space-y-3"><input type="number" placeholder="Amount" className="w-full bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={topupAmt.amount} onChange={e=>setTopupAmt({...topupAmt,amount:e.target.value})}/><input placeholder="Description" className="w-full bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={topupAmt.description} onChange={e=>setTopupAmt({...topupAmt,description:e.target.value})}/><select className="w-full bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={topupAmt.method} onChange={e=>setTopupAmt({...topupAmt,method:e.target.value})}><option value="BANK_TRANSFER">Bank Transfer</option><option value="CREDIT_CARD">Credit Card</option><option value="PAYPAL">PayPal</option><option value="CRYPTO">Crypto</option><option value="MANUAL">Manual</option></select></div><div className="flex gap-2 mt-4"><button onClick={topupClient} className="bg-emerald-600 px-4 py-2 rounded-lg text-sm flex-1">Confirm</button><button onClick={()=>setShowTopup(null)} className="bg-gray-700 px-4 py-2 rounded-lg text-sm">Cancel</button></div></div></div>}

        {/* TX HISTORY MODAL */}
        {showTx&&<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"><div className="bg-gray-900 p-6 rounded-2xl border border-gray-700 w-[600px] max-h-[500px] overflow-auto"><h3 className="font-semibold text-lg mb-4">Payment History</h3><table className="w-full text-xs"><thead><tr className="border-b border-gray-800 text-gray-400"><th className="p-2">Date</th><th className="p-2">Type</th><th className="p-2">Amount</th><th className="p-2">Method</th><th className="p-2">Desc</th></tr></thead><tbody>{txs.map(t=>(<tr key={t.id} className="border-b border-gray-800"><td className="p-2 text-gray-400">{new Date(t.createdAt).toLocaleString()}</td><td className="p-2"><span className={`px-2 py-0.5 rounded text-xs ${t.type==='TOPUP'?'bg-emerald-900 text-emerald-400':'bg-red-900 text-red-400'}`}>{t.type}</span></td><td className={`p-2 font-mono ${t.amount>0?'text-emerald-400':'text-red-400'}`}>${t.amount?.toFixed(2)}</td><td className="p-2 text-gray-400">{t.paymentMethod||'AUTO'}</td><td className="p-2">{t.description}</td></tr>))}</tbody></table><button onClick={()=>setShowTx(null)} className="mt-4 bg-gray-700 px-4 py-2 rounded-lg text-sm w-full">Close</button></div></div>}
      </div>
    </div>
  );
}

export default App;
