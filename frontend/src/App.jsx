import React, { useState, useEffect } from 'react';
import { Send, Activity, MessageSquare, Users, FileText, LogOut, Plus, Trash2, DollarSign, Route, UserPlus, Building2, BarChart3, FileText as InvoiceIcon, Wallet, History, Zap } from 'lucide-react';
import io from 'socket.io-client';
import axios from 'axios';

const API_URL = 'http://192.95.36.154:3001';
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
  const [transactions, setTransactions] = useState([]);
  const [toast, setToast] = useState(null);
  const [loginError, setLoginError] = useState('');

  // Send SMS
  const [sendTo, setSendTo] = useState('');
  const [sendMsg, setSendMsg] = useState('');
  const [sendClientId, setSendClientId] = useState('');
  const [sendSupplierId, setSendSupplierId] = useState('');
  const [sendResult, setSendResult] = useState(null);

  // Forms
  const [showAddClient, setShowAddClient] = useState(false);
  const [showAddSupplier, setShowAddSupplier] = useState(false);
  const [showAddRoute, setShowAddRoute] = useState(false);
  const [showAddRate, setShowAddRate] = useState(false);
  const [showTopup, setShowTopup] = useState(null);
  const [showTx, setShowTx] = useState(null);

  const [newClient, setNewClient] = useState({name:'',balance:100,dailyLimit:10000,connectionType:'SMPP',smppSystemId:'',smppPassword:'',smppHost:'',smppPort:2775,httpApiKey:'',httpBaseUrl:''});
  const [newSupplier, setNewSupplier] = useState({name:'',type:'SMPP',host:'',port:2775,systemId:'',password:''});
  const [newRoute, setNewRoute] = useState({name:'',prefix:'',supplierId:'',priority:1});
  const [newRate, setNewRate] = useState({country:'',countryCode:'',price:0.05,type:'SENDING'});
  const [topupAmt, setTopupAmt] = useState({amount:100,description:'',method:'BANK_TRANSFER'});

  const auth = () => ({ headers: { Authorization: `Bearer ${token}` } });
  const toastMsg = (m) => setToast({msg:m});

  useEffect(() => {
    if (token) { fetchAll(); }
    socket.on('live-log', (log) => setLiveLogs(prev => [log, ...prev].slice(0, 100)));
    return () => { socket.off(); };
  }, [token]);

  const fetchAll = () => { fetchStats(); fetchMsgs(); fetchClients(); fetchRoutes(); fetchRates(); fetchSuppliers(); fetchInvoices(); };
  const fetchStats = async () => { try { const r = await axios.get(API_URL+'/api/dashboard/stats', auth()); setStats(r.data); } catch(e) {} };
  const fetchMsgs = async () => { try { const r = await axios.get(API_URL+'/api/messages?limit=200', auth()); setMessages(r.data.messages||[]); } catch(e) {} };
  const fetchClients = async () => { try { const r = await axios.get(API_URL+'/api/clients', auth()); setClients(r.data.clients||[]); } catch(e) {} };
  const fetchRoutes = async () => { try { const r = await axios.get(API_URL+'/api/routes', auth()); setRoutes(r.data.routes||[]); } catch(e) {} };
  const fetchRates = async () => { try { const r = await axios.get(API_URL+'/api/rates', auth()); setRates(r.data.rates||[]); } catch(e) {} };
  const fetchSuppliers = async () => { try { const r = await axios.get(API_URL+'/api/suppliers', auth()); setSuppliers(r.data.suppliers||[]); } catch(e) {} };
  const fetchInvoices = async () => { try { const r = await axios.get(API_URL+'/api/invoices', auth()); setInvoices(r.data.invoices||[]); } catch(e) {} };
  const fetchTx = async (cid) => { try { const r = await axios.get(API_URL+'/api/clients/'+cid+'/transactions', auth()); setTransactions(r.data.transactions||[]); } catch(e) {} };

  const login = async () => {
    try { const r = await axios.post(API_URL+'/api/auth/login', { email: 'admin@smsgateway.com', password: 'admin123' }); localStorage.setItem('token', r.data.token); setToken(r.data.token); }
    catch(e) { setLoginError('Cannot connect to ' + API_URL); }
  };

  const logout = () => { localStorage.removeItem('token'); setToken(null); };

  const addClient = async () => {
    if (!newClient.name) return toastMsg('Name required');
    try {
      const data = { name: newClient.name, balance: parseFloat(newClient.balance), dailyLimit: parseInt(newClient.dailyLimit) };
      if (newClient.connectionType === 'SMPP') Object.assign(data, { smppSystemId: newClient.smppSystemId, smppPassword: newClient.smppPassword, smppHost: newClient.smppHost, smppPort: parseInt(newClient.smppPort) });
      else Object.assign(data, { httpApiKey: newClient.httpApiKey, httpBaseUrl: newClient.httpBaseUrl });
      await axios.post(API_URL+'/api/clients', data, auth());
      setShowAddClient(false); fetchClients(); toastMsg('Client added!');
    } catch(e) { toastMsg('Error: '+(e.response?.data?.error||e.message)); }
  };

  const addSupplier = async () => {
    try { await axios.post(API_URL+'/api/suppliers', newSupplier, auth()); setShowAddSupplier(false); fetchSuppliers(); toastMsg('Supplier added!'); }
    catch(e) { toastMsg('Error: '+(e.response?.data?.error||e.message)); }
  };

  const addRoute = async () => {
    try { await axios.post(API_URL+'/api/routes', newRoute, auth()); setShowAddRoute(false); fetchRoutes(); toastMsg('Route added!'); }
    catch(e) { toastMsg('Error: '+(e.response?.data?.error||e.message)); }
  };

  const addRate = async () => {
    try { await axios.post(API_URL+'/api/rates', newRate, auth()); setShowAddRate(false); fetchRates(); toastMsg('Rate added!'); }
    catch(e) { toastMsg('Error: '+(e.response?.data?.error||e.message)); }
  };

  const topupClient = async () => {
    try {
      await axios.post(API_URL+'/api/clients/'+showTopup+'/topup', { amount: parseFloat(topupAmt.amount), description: topupAmt.description, paymentMethod: topupAmt.method }, auth());
      setShowTopup(null); fetchClients(); toastMsg('Funds added!');
    } catch(e) { toastMsg('Error: '+(e.response?.data?.error||e.message)); }
  };

  const doSendSms = async () => {
    if (!sendTo || !sendMsg) return toastMsg('Fill all fields');
    if (!sendClientId) return toastMsg('Select client');
    try {
      const url = sendSupplierId ? API_URL+'/api/messages/send-via/'+sendSupplierId : API_URL+'/api/messages/send';
      const r = await axios.post(url, { to: sendTo, content: sendMsg, clientId: sendClientId }, auth());
      setSendResult({ ok: true, msg: `Sent! Cost: $${r.data.cost?.toFixed(4)} | Via: ${r.data.supplier||'Auto'}` });
      setSendTo(''); setSendMsg(''); fetchMsgs(); fetchStats();
    } catch(e) { setSendResult({ ok: false, msg: e.response?.data?.error||e.message }); }
  };

  const genInvoice = async (cid) => { try { await axios.post(API_URL+'/api/invoices/generate',{clientId:cid},auth()); fetchInvoices(); toastMsg('Invoice done!'); } catch(e) {} };
  const delClient = async (id) => { if(confirm('Delete?')){ await axios.delete(API_URL+'/api/clients/'+id,auth()); fetchClients(); } };
  const delSupplier = async (id) => { if(confirm('Delete?')){ await axios.delete(API_URL+'/api/suppliers/'+id,auth()); fetchSuppliers(); } };

  if (!token) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="bg-gray-900 p-10 rounded-2xl border border-gray-700 max-w-sm w-full text-center"><Zap className="w-16 h-16 text-emerald-400 mx-auto mb-4"/><h1 className="text-3xl font-bold text-white mb-2">SMS Gateway</h1><p className="text-gray-400 text-sm mb-4">Production Core v2.0</p>{loginError&&<div className="bg-red-900/50 text-red-300 p-3 rounded-xl mb-4 text-xs">{loginError}</div>}<button onClick={login} className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 rounded-xl">LOGIN AS DEMO ADMIN</button><p className="text-xs text-gray-500 mt-4">admin@smsgateway.com / admin123</p></div></div>;
  }

  const tabs = [{id:'dashboard',l:'Dashboard',i:<BarChart3 className="w-3 h-3"/>},{id:'send',l:'Send SMS',i:<Send className="w-3 h-3"/>},{id:'messages',l:'Messages',i:<FileText className="w-3 h-3"/>},{id:'live',l:'Live Logs',i:<Activity className="w-3 h-3"/>},{id:'clients',l:'Clients',i:<Users className="w-3 h-3"/>},{id:'suppliers',l:'Suppliers',i:<Building2 className="w-3 h-3"/>},{id:'routes',l:'Routes',i:<Route className="w-3 h-3"/>},{id:'rates',l:'Rates',i:<DollarSign className="w-3 h-3"/>},{id:'invoices',l:'Invoices',i:<InvoiceIcon className="w-3 h-3"/>}];

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {toast && <Toast msg={toast.msg} onClose={() => setToast(null)} />}
      <nav className="bg-black border-b border-gray-800 px-4 py-2 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-2"><Zap className="w-5 h-5 text-emerald-400"/><span className="font-bold text-lg">SMS<span className="text-emerald-400">GW</span></span></div>
        <div className="flex gap-1 overflow-x-auto">{tabs.map(t=>(<button key={t.id} onClick={()=>setActiveTab(t.id)} className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs whitespace-nowrap transition-all ${activeTab===t.id?'bg-emerald-600 text-white':'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>{t.i}{t.l}</button>))}</div>
        <button onClick={logout} className="text-gray-400 hover:text-red-400"><LogOut className="w-4 h-4"/></button>
      </nav>

      <div className="p-4">
        {/* DASHBOARD */}
        {activeTab==='dashboard'&&<div><div className="grid grid-cols-4 gap-3 mb-4">{[{l:'Messages',v:stats.totalMessages||0},{l:'Delivery Rate',v:(stats.deliveredRate||0)+'%'},{l:'Clients',v:clients.length},{l:'Suppliers',v:suppliers.length},{l:'Routes',v:routes.length},{l:'Revenue',v:'$'+(stats.totalRevenue||0).toFixed(2)},{l:'Today',v:stats.todayMessages||0},{l:'Rates',v:rates.length}].map((s,i)=>(<div key={i} className="bg-gray-900 p-4 rounded-2xl border border-gray-800"><div className="text-gray-500 text-xs">{s.l}</div><div className="text-2xl font-bold mt-1">{s.v}</div></div>))}</div><div className="bg-black border border-gray-800 rounded-2xl p-3 h-48 overflow-auto font-mono text-xs"><div className="text-gray-500 mb-2">Live Feed</div>{liveLogs.slice(0,10).map((l,i)=>(<div key={i} className="py-1 border-b border-gray-900"><span className="text-gray-600">{new Date(l.timestamp).toLocaleTimeString()}</span> <span className="text-blue-400">{l.type}</span> <span className="text-gray-400">{l.message||l.content||''}</span></div>))}</div></div>}

        {/* SEND SMS */}
        {activeTab==='send'&&<div className="max-w-lg mx-auto"><h2 className="text-xl font-bold mb-3">Send SMS</h2><div className="bg-gray-900 p-6 rounded-2xl space-y-3"><div><label className="text-xs text-gray-400 mb-1 block">From Client</label><select className="w-full bg-black border border-gray-700 rounded-xl px-4 py-2 text-sm text-white" value={sendClientId} onChange={e=>setSendClientId(e.target.value)}><option value="">Select Client</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name} (${c.balance?.toFixed(2)})</option>)}</select></div><div><label className="text-xs text-gray-400 mb-1 block">Route via Supplier</label><select className="w-full bg-black border border-gray-700 rounded-xl px-4 py-2 text-sm text-white" value={sendSupplierId} onChange={e=>setSendSupplierId(e.target.value)}><option value="">Auto (best route)</option>{suppliers.filter(s=>s.status==='ACTIVE').map(s=><option key={s.id} value={s.id}>{s.name} ({s.type})</option>)}</select></div><div><label className="text-xs text-gray-400 mb-1 block">To (Destination)</label><input value={sendTo} onChange={e=>setSendTo(e.target.value)} placeholder="+15551234567" className="w-full bg-black border border-gray-700 rounded-xl px-4 py-2 text-sm text-white"/></div><div><label className="text-xs text-gray-400 mb-1 block">Message</label><textarea value={sendMsg} onChange={e=>setSendMsg(e.target.value)} placeholder="Type your message..." className="w-full bg-black border border-gray-700 rounded-xl px-4 py-2 text-sm text-white h-24"/><div className="text-right text-xs text-gray-500">{sendMsg.length}/160</div></div><button onClick={doSendSms} className="w-full bg-emerald-600 hover:bg-emerald-500 py-2.5 rounded-xl text-sm font-semibold transition-all">SEND SMS</button>{sendResult&&<div className={`p-3 rounded-xl text-xs ${sendResult.ok?'bg-emerald-900/50 text-emerald-400':'bg-red-900/50 text-red-400'}`}>{sendResult.msg}</div>}</div></div>}

        {/* MESSAGES */}
        {activeTab==='messages'&&<div className="bg-gray-900 rounded-2xl overflow-x-auto"><table className="w-full text-xs"><thead><tr className="border-b border-gray-800 text-gray-400"><th className="p-2 text-left">To</th><th className="p-2 text-left">Content</th><th className="p-2 text-left">Supplier</th><th className="p-2 text-left">Cost</th><th className="p-2 text-left">Status</th></tr></thead><tbody>{messages.map((m,i)=>(<tr key={i} className="border-b border-gray-800 hover:bg-gray-800/50"><td className="p-2 text-emerald-300">{m.to}</td><td className="p-2">{m.content?.substring(0,30)}</td><td className="p-2 text-gray-400">{m.supplier?.name||'Auto'}</td><td className="p-2 text-amber-400">${m.cost?.toFixed(4)}</td><td className="p-2"><span className="px-2 py-0.5 rounded-full bg-emerald-900 text-emerald-400 text-xs">{m.status}</span></td></tr>))}</tbody></table></div>}

        {/* LIVE LOGS */}
        {activeTab==='live'&&<div className="bg-black border border-gray-800 rounded-2xl p-3 h-96 overflow-auto font-mono text-xs">{liveLogs.map((l,i)=>(<div key={i} className="py-1 border-b border-gray-900 flex gap-2"><span className="text-gray-500 w-16 shrink-0">{new Date(l.timestamp).toLocaleTimeString()}</span><span className="text-blue-400">{l.type}</span><span className="text-emerald-300">{l.to||''}</span><span className="text-gray-400 flex-1">{l.content||l.message||''}</span></div>))}</div>}

        {/* CLIENTS */}
        {activeTab==='clients'&&<div><div className="flex justify-between mb-3"><h2 className="text-xl font-bold">Clients</h2><button onClick={()=>setShowAddClient(!showAddClient)} className="bg-emerald-600 px-3 py-1.5 rounded-lg text-xs flex items-center gap-1"><UserPlus className="w-3 h-3"/>Add</button></div>{showAddClient&&<div className="bg-gray-900 p-4 rounded-2xl mb-3 border border-emerald-500/30"><h3 className="font-semibold text-sm mb-2">New Client</h3><div className="grid grid-cols-3 gap-2 mb-2"><input placeholder="Name*" className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={newClient.name} onChange={e=>setNewClient({...newClient,name:e.target.value})}/><input type="number" placeholder="Balance" className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={newClient.balance} onChange={e=>setNewClient({...newClient,balance:e.target.value})}/><input type="number" placeholder="Daily Limit" className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={newClient.dailyLimit} onChange={e=>setNewClient({...newClient,dailyLimit:e.target.value})}/></div><div className="mb-2"><label className="text-xs text-gray-400 mr-2">Type:</label><select className="bg-black border border-gray-700 rounded-lg px-3 py-1 text-sm" value={newClient.connectionType} onChange={e=>setNewClient({...newClient,connectionType:e.target.value})}><option value="SMPP">SMPP</option><option value="HTTP">HTTP</option></select></div>{newClient.connectionType==='SMPP'?<div className="grid grid-cols-4 gap-2"><input placeholder="System ID" className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={newClient.smppSystemId} onChange={e=>setNewClient({...newClient,smppSystemId:e.target.value})}/><input placeholder="Password" className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={newClient.smppPassword} onChange={e=>setNewClient({...newClient,smppPassword:e.target.value})}/><input placeholder="Host" className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={newClient.smppHost} onChange={e=>setNewClient({...newClient,smppHost:e.target.value})}/><input type="number" placeholder="Port" className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={newClient.smppPort} onChange={e=>setNewClient({...newClient,smppPort:e.target.value})}/></div>:<div className="grid grid-cols-2 gap-2"><input placeholder="API Key" className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={newClient.httpApiKey} onChange={e=>setNewClient({...newClient,httpApiKey:e.target.value})}/><input placeholder="Base URL" className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={newClient.httpBaseUrl} onChange={e=>setNewClient({...newClient,httpBaseUrl:e.target.value})}/></div>}<div className="flex gap-2 mt-3"><button onClick={addClient} className="bg-emerald-600 px-4 py-2 rounded-lg text-xs">Save</button><button onClick={()=>setShowAddClient(false)} className="bg-gray-700 px-4 py-2 rounded-lg text-xs">Cancel</button></div></div>}<div className="bg-gray-900 rounded-2xl overflow-x-auto"><table className="w-full text-xs"><thead><tr className="border-b border-gray-800 text-gray-400"><th className="p-2">Account ID</th><th className="p-2">Name</th><th className="p-2">Connection</th><th className="p-2">Balance</th><th className="p-2">Actions</th></tr></thead><tbody>{clients.map(c=>(<tr key={c.id} className="border-b border-gray-800 hover:bg-gray-800/50"><td className="p-2 text-emerald-400 font-mono text-xs">{c.accountId}</td><td className="p-2">{c.name}</td><td className="p-2">{c.smppAccounts?.length>0?<span className="px-2 py-0.5 rounded bg-blue-900 text-blue-400 text-xs">SMPP</span>:c.httpConnections?.length>0?<span className="px-2 py-0.5 rounded bg-purple-900 text-purple-400 text-xs">HTTP</span>:<span className="text-gray-500">-</span>}</td><td className="p-2 font-mono">${c.balance?.toFixed(2)}</td><td className="p-2 flex gap-1"><button onClick={()=>{setShowTopup(c.id);setTopupAmt({amount:100,description:'',method:'BANK_TRANSFER'});}} className="bg-amber-600 text-white px-2 py-0.5 rounded text-xs flex items-center gap-1"><Wallet className="w-3 h-3"/>Topup</button><button onClick={()=>{setShowTx(c.id);fetchTx(c.id);}} className="bg-blue-600 text-white px-2 py-0.5 rounded text-xs flex items-center gap-1"><History className="w-3 h-3"/>History</button><button onClick={()=>genInvoice(c.id)} className="bg-emerald-600 text-white px-2 py-0.5 rounded text-xs">Invoice</button><button onClick={()=>delClient(c.id)} className="text-red-400"><Trash2 className="w-3 h-3"/></button></td></tr>))}</tbody></table></div></div>}

        {/* TOPUP MODAL */}
        {showTopup&&<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"><div className="bg-gray-900 p-6 rounded-2xl border border-gray-700 w-96"><h3 className="font-semibold text-lg mb-4">Add Funds</h3><div className="space-y-3"><input type="number" placeholder="Amount" className="w-full bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={topupAmt.amount} onChange={e=>setTopupAmt({...topupAmt,amount:e.target.value})}/><input placeholder="Description" className="w-full bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={topupAmt.description} onChange={e=>setTopupAmt({...topupAmt,description:e.target.value})}/><select className="w-full bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={topupAmt.method} onChange={e=>setTopupAmt({...topupAmt,method:e.target.value})}><option value="BANK_TRANSFER">Bank Transfer</option><option value="CREDIT_CARD">Credit Card</option><option value="PAYPAL">PayPal</option><option value="CRYPTO">Crypto</option><option value="MANUAL">Manual</option></select></div><div className="flex gap-2 mt-4"><button onClick={topupClient} className="bg-emerald-600 px-4 py-2 rounded-lg text-sm flex-1">Confirm</button><button onClick={()=>setShowTopup(null)} className="bg-gray-700 px-4 py-2 rounded-lg text-sm">Cancel</button></div></div></div>}

        {/* TX MODAL */}
        {showTx&&<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"><div className="bg-gray-900 p-6 rounded-2xl border border-gray-700 w-[600px] max-h-[500px] overflow-auto"><h3 className="font-semibold text-lg mb-4">Payment History</h3><table className="w-full text-xs"><thead><tr className="border-b border-gray-800 text-gray-400"><th className="p-2 text-left">Date</th><th className="p-2 text-left">Type</th><th className="p-2 text-left">Amount</th><th className="p-2 text-left">Method</th><th className="p-2 text-left">Description</th></tr></thead><tbody>{transactions.map(tx=>(<tr key={tx.id} className="border-b border-gray-800"><td className="p-2 text-gray-400">{new Date(tx.createdAt).toLocaleString()}</td><td className="p-2"><span className={`px-2 py-0.5 rounded text-xs ${tx.type==='TOPUP'?'bg-emerald-900 text-emerald-400':'bg-red-900 text-red-400'}`}>{tx.type}</span></td><td className={`p-2 font-mono ${tx.amount>0?'text-emerald-400':'text-red-400'}`}>${tx.amount?.toFixed(2)}</td><td className="p-2 text-gray-400">{tx.paymentMethod||'AUTO'}</td><td className="p-2 text-gray-300">{tx.description}</td></tr>))}</tbody></table><button onClick={()=>setShowTx(null)} className="mt-4 bg-gray-700 px-4 py-2 rounded-lg text-sm w-full">Close</button></div></div>}

        {/* SUPPLIERS */}
        {activeTab==='suppliers'&&<div><div className="flex justify-between mb-3"><h2 className="text-xl font-bold">Suppliers</h2><button onClick={()=>setShowAddSupplier(!showAddSupplier)} className="bg-emerald-600 px-3 py-1.5 rounded-lg text-xs flex items-center gap-1"><Plus className="w-3 h-3"/>Add</button></div>{showAddSupplier&&<div className="bg-gray-900 p-4 rounded-2xl mb-3 grid grid-cols-3 gap-2"><input placeholder="Name*" className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={newSupplier.name} onChange={e=>setNewSupplier({...newSupplier,name:e.target.value})}/><select className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={newSupplier.type} onChange={e=>setNewSupplier({...newSupplier,type:e.target.value})}><option>SMPP</option><option>HTTP</option></select><input placeholder="Host" className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={newSupplier.host} onChange={e=>setNewSupplier({...newSupplier,host:e.target.value})}/><input type="number" placeholder="Port" className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={newSupplier.port} onChange={e=>setNewSupplier({...newSupplier,port:e.target.value})}/><input placeholder="System ID" className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={newSupplier.systemId} onChange={e=>setNewSupplier({...newSupplier,systemId:e.target.value})}/><input placeholder="Password" type="password" className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={newSupplier.password} onChange={e=>setNewSupplier({...newSupplier,password:e.target.value})}/><div className="col-span-3 flex gap-2"><button onClick={addSupplier} className="bg-emerald-600 px-4 py-2 rounded-lg text-xs">Save</button><button onClick={()=>setShowAddSupplier(false)} className="bg-gray-700 px-4 py-2 rounded-lg text-xs">Cancel</button></div></div>}<div className="grid grid-cols-2 gap-3">{suppliers.map(s=>(<div key={s.id} className="bg-gray-900 p-4 rounded-2xl border border-gray-800"><div className="flex justify-between"><h3 className="font-semibold text-sm">{s.name}</h3><span className="text-emerald-400 text-xs">● {s.status}</span></div><div className="text-xs text-gray-400 mt-1">{s.type} | {s.throughput} msg/s</div>{s.smppConnections?.[0]&&<div className="text-xs text-gray-500 mt-1">{s.smppConnections[0].host}:{s.smppConnections[0].port}</div>}{s.httpEndpoints?.[0]&&<div className="text-xs text-gray-500 mt-1">{s.httpEndpoints[0].baseUrl}</div>}<button onClick={()=>delSupplier(s.id)} className="text-red-400 text-xs mt-2">Remove</button></div>))}</div></div>}

        {/* ROUTES */}
        {activeTab==='routes'&&<div><div className="flex justify-between mb-3"><h2 className="text-xl font-bold">Routes</h2><button onClick={()=>setShowAddRoute(!showAddRoute)} className="bg-emerald-600 px-3 py-1.5 rounded-lg text-xs flex items-center gap-1"><Route className="w-3 h-3"/>Add</button></div>{showAddRoute&&<div className="bg-gray-900 p-4 rounded-2xl mb-3 grid grid-cols-2 gap-2"><input placeholder="Name" className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={newRoute.name} onChange={e=>setNewRoute({...newRoute,name:e.target.value})}/><input placeholder="Prefix (1,44,*)" className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={newRoute.prefix} onChange={e=>setNewRoute({...newRoute,prefix:e.target.value})}/><select className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={newRoute.supplierId} onChange={e=>setNewRoute({...newRoute,supplierId:e.target.value})}><option value="">Select Supplier</option>{suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select><input type="number" placeholder="Priority" className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={newRoute.priority} onChange={e=>setNewRoute({...newRoute,priority:e.target.value})}/><div className="col-span-2 flex gap-2"><button onClick={addRoute} className="bg-emerald-600 px-4 py-2 rounded-lg text-xs">Save</button><button onClick={()=>setShowAddRoute(false)} className="bg-gray-700 px-4 py-2 rounded-lg text-xs">Cancel</button></div></div>}<div className="bg-gray-900 rounded-2xl overflow-x-auto"><table className="w-full text-xs"><thead><tr className="border-b border-gray-800 text-gray-400"><th className="p-2">Priority</th><th className="p-2">Name</th><th className="p-2">Prefix</th><th className="p-2">Supplier</th></tr></thead><tbody>{routes.map(r=>(<tr key={r.id} className="border-b border-gray-800"><td className="p-2"><span className={`px-2 py-0.5 rounded text-xs ${r.priority===1?'bg-amber-900 text-amber-400':'bg-gray-800'}`}>P{r.priority}</span></td><td className="p-2">{r.name}</td><td className="p-2 text-emerald-400 font-mono">{r.prefix}</td><td className="p-2">{r.supplier?.name||'-'}</td></tr>))}</tbody></table></div></div>}

        {/* RATES */}
        {activeTab==='rates'&&<div><div className="flex justify-between mb-3"><h2 className="text-xl font-bold">Rates</h2><button onClick={()=>setShowAddRate(!showAddRate)} className="bg-emerald-600 px-3 py-1.5 rounded-lg text-xs flex items-center gap-1"><DollarSign className="w-3 h-3"/>Add</button></div>{showAddRate&&<div className="bg-gray-900 p-4 rounded-2xl mb-3 grid grid-cols-3 gap-2"><input placeholder="Country" className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={newRate.country} onChange={e=>setNewRate({...newRate,country:e.target.value})}/><input placeholder="Code (1,44)" className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={newRate.countryCode} onChange={e=>setNewRate({...newRate,countryCode:e.target.value})}/><input type="number" step="0.001" placeholder="Price" className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm" value={newRate.price} onChange={e=>setNewRate({...newRate,price:e.target.value})}/><div className="col-span-3 flex gap-2"><button onClick={addRate} className="bg-emerald-600 px-4 py-2 rounded-lg text-xs">Save</button><button onClick={()=>setShowAddRate(false)} className="bg-gray-700 px-4 py-2 rounded-lg text-xs">Cancel</button></div></div>}<div className="bg-gray-900 rounded-2xl overflow-x-auto"><table className="w-full text-xs"><thead><tr className="border-b border-gray-800 text-gray-400"><th className="p-2">Country</th><th className="p-2">Code</th><th className="p-2">Type</th><th className="p-2">Price/SMS</th></tr></thead><tbody>{rates.map(r=>(<tr key={r.id} className="border-b border-gray-800"><td className="p-2">{r.country}</td><td className="p-2 text-emerald-400">+{r.countryCode}</td><td className="p-2"><span className={`px-2 py-0.5 rounded text-xs ${r.type==='SUPPLIER'?'bg-purple-900 text-purple-400':'bg-blue-900 text-blue-400'}`}>{r.type}</span></td><td className="p-2 text-amber-400 font-mono">${r.price?.toFixed(4)}</td></tr>))}</tbody></table></div></div>}

        {/* INVOICES */}
        {activeTab==='invoices'&&<div><h2 className="text-xl font-bold mb-3">Invoices</h2><div className="bg-gray-900 rounded-2xl overflow-x-auto"><table className="w-full text-xs"><thead><tr className="border-b border-gray-800 text-gray-400"><th className="p-2">Invoice #</th><th className="p-2">Client</th><th className="p-2">Period</th><th className="p-2">Amount</th><th className="p-2">Status</th></tr></thead><tbody>{invoices.map(inv=>(<tr key={inv.id} className="border-b border-gray-800"><td className="p-2 text-emerald-400 font-mono text-xs">{inv.invoiceNumber}</td><td className="p-2">{inv.client?.name}</td><td className="p-2 text-gray-500 text-xs">{inv.period}</td><td className="p-2 text-amber-400 font-mono">${inv.totalAmount?.toFixed(2)}</td><td className="p-2"><span className="px-2 py-0.5 rounded-full bg-emerald-900 text-emerald-400 text-xs">{inv.status}</span></td></tr>))}</tbody></table></div></div>}
      </div>
    </div>
  );
}

export default App;
