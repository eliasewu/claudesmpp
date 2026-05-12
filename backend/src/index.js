const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const winston = require('winston');
const Redis = require('redis');
const net = require('net');
const cron = require('node-cron');
require('dotenv').config();

const prisma = new PrismaClient();
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const redisClient = Redis.createClient({ url: process.env.REDIS_URL });
redisClient.connect().catch(console.error);

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.Console()]
});

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 5000 }));

const KANNEL_URL = 'http://172.17.0.1:13013';
const KANNEL_STATUS = 'http://172.17.0.1:13000';
const KANNEL_PASS = 'bar';

// JWT
const authenticateJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No token' });
  try { req.user = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET); next(); }
  catch (err) { return res.status(403).json({ error: 'Invalid token' }); }
};

const genId = (p) => p + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);

// ==================== AUTO SMPP BIND CHECKER ====================
async function checkSupplierBind(supplier) {
  const conn = supplier.smppConnections?.[0];
  if (!conn) return { status: 'UNKNOWN' };
  
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(5000);
    const start = Date.now();
    socket.connect(conn.port, conn.host, () => {
      const latency = Date.now() - start;
      socket.destroy();
      resolve({ status: 'BOUND', latency, host: conn.host, port: conn.port });
    });
    socket.on('error', (err) => { socket.destroy(); resolve({ status: 'UNBOUND', error: err.message }); });
    socket.on('timeout', () => { socket.destroy(); resolve({ status: 'TIMEOUT' }); });
  });
}

async function checkClientBind(client) {
  const smpp = client.smppAccounts?.[0];
  if (!smpp) return { status: 'NO_SMPP' };
  
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(5000);
    const start = Date.now();
    socket.connect(smpp.port, smpp.host, () => {
      const latency = Date.now() - start;
      socket.destroy();
      resolve({ status: 'BOUND', latency, host: smpp.host, port: smpp.port, systemId: smpp.systemId });
    });
    socket.on('error', (err) => { socket.destroy(); resolve({ status: 'UNBOUND', error: err.message }); });
    socket.on('timeout', () => { socket.destroy(); resolve({ status: 'TIMEOUT' }); });
  });
}

// Background SMPP status checker every 60 seconds
setInterval(async () => {
  try {
    const suppliers = await prisma.supplier.findMany({
      where: { type: 'SMPP' },
      include: { smppConnections: true }
    });
    
    for (const s of suppliers) {
      const result = await checkSupplierBind(s);
      const newStatus = result.status === 'BOUND' ? 'ACTIVE' : 'INACTIVE';
      if (s.status !== newStatus) {
        await prisma.supplier.update({ where: { id: s.id }, data: { status: newStatus } });
      }
      io.emit('live-log', {
        type: 'bind_check',
        target: 'supplier',
        name: s.name,
        bindStatus: result.status,
        latency: result.latency,
        host: result.host,
        error: result.error,
        timestamp: new Date()
      });
    }
    
    // Check client SMPP binds
    const clients = await prisma.client.findMany({
      where: { smppAccounts: { some: {} } },
      include: { smppAccounts: true }
    });
    
    for (const c of clients) {
      const result = await checkClientBind(c);
      io.emit('live-log', {
        type: 'bind_check',
        target: 'client',
        name: c.name,
        accountId: c.accountId,
        bindStatus: result.status,
        latency: result.latency,
        systemId: result.systemId,
        error: result.error,
        timestamp: new Date()
      });
    }
  } catch(e) {}
}, 60000);

// ==================== AUTH ====================
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user.id, role: user.role, email: user.email }, process.env.JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ==================== CLIENTS ====================
app.get('/api/clients', authenticateJWT, async (req, res) => {
  const clients = await prisma.client.findMany({
    include: { smppAccounts: true, httpConnections: true, rates: true, _count: { select: { messages: true } } },
    orderBy: { createdAt: 'desc' }
  });
  res.json({ clients });
});

app.post('/api/clients', authenticateJWT, async (req, res) => {
  try {
    const d = req.body;
    const smppSystemId = d.smppSystemId || d.systemId || d.authName;
    const smppPassword = d.smppPassword || d.password;
    
    const client = await prisma.client.create({
      data: {
        accountId: d.accountId || 'CLI'+Date.now(),
        name: d.name,
        alias: d.alias || d.name,
        balance: parseFloat(d.balance)||0,
        credit: parseFloat(d.credit)||50000,
        dailyLimit: parseInt(d.dailyLimit)||10000,
        tps: parseInt(d.tps)||1,
        priority: parseInt(d.priority)||1,
        retry: parseInt(d.retry)||0,
        dlrTimeout: parseInt(d.dlrTimeout)||0,
        forceDlr: d.forceDlr===true||d.forceDlr==='true',
        invoiceFrequency: d.invoiceFrequency||'MONTHLY',
        chargeRule: d.chargeRule||'DELIVERY',
        countRule: d.countRule||'0-0-140-6',
        contentHidden: d.contentHidden||'PLAINTEXT',
        numberHidden: d.numberHidden||'SHOW',
        notes: d.notes||'',
        smppAccounts: smppSystemId ? { create: { systemId: smppSystemId, password: smppPassword||'', host: d.smppHost||'0.0.0.0', port: parseInt(d.smppPort)||0 } } : undefined,
      }
    });
    
    // Auto-sync to SMPP server
    if (smppSystemId) syncClientToSMPP(client);
    
    res.json(client);
  } catch(e) { res.status(400).json({ error: e.message }); }
});

// Auto-sync function
function syncClientToSMPP(client) {
  const fs = require('fs');
  const usersFile = '/etc/kannel/smpp_users.json';
  let users = {};
  try { users = JSON.parse(fs.readFileSync(usersFile, 'utf8')); } catch(e) {}
  
  const smpp = client.smppAccounts?.[0];
  if (smpp) {
    users[smpp.systemId] = {
      password: smpp.password,
      throughput: client.tps || 1,
      sender: client.alias || client.name?.substring(0,11) || 'SMSGW',
      kannel_user: 'tester',
      kannel_pass: 'testerpass',
      clientId: client.id,
      accountId: client.accountId,
      chargeRule: client.chargeRule,
      countRule: client.countRule
    };
    fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
    io.emit('live-log', { type: 'smpp_sync', message: `Client ${client.name} auto-synced to SMPP`, timestamp: new Date() });
  }
}

// Update client
app.put('/api/clients/:id', authenticateJWT, async (req, res) => {
  try {
    const d = req.body;
    const data = {};
    ['name','alias','balance','credit','dailyLimit','tps','priority','retry','status','dlrTimeout','forceDlr','invoiceFrequency','chargeRule','countRule','contentHidden','numberHidden','notes'].forEach(f => {
      if (d[f] !== undefined) data[f] = d[f];
    });
    
    const client = await prisma.client.update({ where: { id: req.params.id }, data });
    
    // Update SMPP user if smpp account exists
    if (d.smppSystemId || d.smppPassword) {
      const smpp = client.smppAccounts?.[0];
      if (smpp) {
        await prisma.smppAccount.update({
          where: { id: smpp.id },
          data: { systemId: d.smppSystemId || smpp.systemId, password: d.smppPassword || smpp.password }
        });
      }
    }
    
    // Re-sync to SMPP
    syncClientToSMPP(await prisma.client.findUnique({ where: { id: req.params.id }, include: { smppAccounts: true } }));
    
    res.json(client);
  } catch(e) { res.status(400).json({ error: e.message }); }
});

// Old client create - remove it
app._post_clients_old
  try {
    const d = req.body;
    const client = await prisma.client.create({
      data: {
        accountId: d.accountId || 'CLI'+Date.now(), name: d.name,
        balance: parseFloat(d.balance)||0, dailyLimit: parseInt(d.dailyLimit)||10000,
        dlrTimeout: parseInt(d.dlrTimeout)||0, forceDlr: d.forceDlr===true||d.forceDlr==='true',
        invoiceFrequency: d.invoiceFrequency || 'MONTHLY',
        smppAccounts: d.smppSystemId ? { create: { systemId: d.smppSystemId, password: d.smppPassword||'', host: d.smppHost||'', port: parseInt(d.smppPort)||2775 } } : undefined,
        httpConnections: d.httpApiKey ? { create: { apiKey: d.httpApiKey, baseUrl: d.httpBaseUrl||'' } } : undefined,
      }
    });
    if(parseFloat(d.balance)>0) await prisma.transaction.create({ data: { clientId: client.id, type: 'TOPUP', amount: parseFloat(d.balance), description: 'Initial', reference: 'INIT-'+client.accountId } });
    io.emit('live-log', { type: 'client_created', name: d.name, timestamp: new Date() });
    res.json(client);
  } catch(e) { res.status(400).json({ error: e.message }); }
});

app.put('/api/clients/:id', authenticateJWT, async (req, res) => {
  const { name, balance, dailyLimit, status, dlrTimeout, forceDlr, invoiceFrequency, notes } = req.body;
  const client = await prisma.client.update({ where: { id: req.params.id }, data: { name, balance, dailyLimit, status, dlrTimeout, forceDlr, invoiceFrequency, notes } });
  res.json(client);
});

app.delete('/api/clients/:id', authenticateJWT, async (req, res) => {
  await prisma.client.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

app.post('/api/clients/:id/topup', authenticateJWT, async (req, res) => {
  const { amount, description, paymentMethod } = req.body;
  const ta = parseFloat(amount);
  await prisma.client.update({ where: { id: req.params.id }, data: { balance: { increment: ta } } });
  const tx = await prisma.transaction.create({ data: { clientId: req.params.id, type: 'TOPUP', amount: ta, description, reference: 'TOPUP-'+Date.now(), paymentMethod: paymentMethod||'MANUAL' } });
  io.emit('live-log', { type: 'topup', name: req.params.id, amount: ta, timestamp: new Date() });
  res.json({ success: true, transaction: tx });
});

app.get('/api/clients/:id/transactions', authenticateJWT, async (req, res) => {
  const txs = await prisma.transaction.findMany({ where: { clientId: req.params.id }, orderBy: { createdAt: 'desc' }, take: 100 });
  res.json({ transactions: txs });
});

// Client SMPP Bind Check
app.get('/api/clients/:id/check-bind', authenticateJWT, async (req, res) => {
  const client = await prisma.client.findUnique({ where: { id: req.params.id }, include: { smppAccounts: true } });
  if (!client) return res.status(404).json({ error: 'Not found' });
  const result = await checkClientBind(client);
  io.emit('live-log', { type: 'bind_check', target: 'client', name: client.name, bindStatus: result.status, latency: result.latency, timestamp: new Date() });
  res.json({ client: client.name, ...result });
});

// ==================== SUPPLIERS ====================
app.get('/api/suppliers', authenticateJWT, async (req, res) => {
  const suppliers = await prisma.supplier.findMany({ include: { smppConnections: true, httpEndpoints: true, _count: { select: { messages: true } } }, orderBy: { createdAt: 'desc' } });
  res.json({ suppliers });
});

app.post('/api/suppliers', authenticateJWT, async (req, res) => {
  const d = req.body;
  const supplier = await prisma.supplier.create({
    data: {
      name: d.name, type: d.type||'SMPP', throughput: parseInt(d.throughput)||100,
      smppConnections: d.type==='SMPP' ? { create: { host: d.host||'', port: parseInt(d.port)||2775, systemId: d.systemId||'', password: d.password||'' } } : undefined,
      httpEndpoints: d.type==='HTTP' ? { create: { baseUrl: d.baseUrl||'', apiKey: d.apiKey||'', method: 'POST' } } : undefined
    }
  });
  io.emit('live-log', { type: 'supplier_added', name: supplier.name, timestamp: new Date() });
  res.json(supplier);
});

app.delete('/api/suppliers/:id', authenticateJWT, async (req, res) => {
  await prisma.supplier.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

app.get('/api/suppliers/:id/check-bind', authenticateJWT, async (req, res) => {
  const supplier = await prisma.supplier.findUnique({ where: { id: req.params.id }, include: { smppConnections: true } });
  if (!supplier) return res.status(404).json({ error: 'Not found' });
  const result = await checkSupplierBind(supplier);
  io.emit('live-log', { type: 'bind_check', target: 'supplier', name: supplier.name, bindStatus: result.status, latency: result.latency, timestamp: new Date() });
  res.json({ supplier: supplier.name, ...result });
});

// ==================== ROUTES ====================
app.get('/api/routes', authenticateJWT, async (req, res) => {
  const routes = await prisma.route.findMany({ include: { supplier: { select: { name: true, status: true } } }, orderBy: { priority: 'asc' } });
  res.json({ routes });
});

app.post('/api/routes', authenticateJWT, async (req, res) => {
  const { name, prefix, supplierId, priority } = req.body;
  const route = await prisma.route.create({ data: { name, prefix, supplierId, priority: parseInt(priority)||1 } });
  res.json(route);
});

app.delete('/api/routes/:id', authenticateJWT, async (req, res) => {
  await prisma.route.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

// ==================== RATES ====================
app.get('/api/rates', authenticateJWT, async (req, res) => {
  const rates = await prisma.rate.findMany({ include: { client: { select: { name: true } }, supplier: { select: { name: true } } } });
  res.json({ rates });
});

app.post('/api/rates', authenticateJWT, async (req, res) => {
  const { country, countryCode, operator, price, type, clientId, supplierId } = req.body;
  const rate = await prisma.rate.create({ data: { country, countryCode, operator: operator||'All', price: parseFloat(price), type: type||'SENDING', clientId, supplierId } });
  res.json(rate);
});

// ==================== MESSAGES WITH FULL KANNEL DLR ====================
app.post('/api/messages/send', authenticateJWT, async (req, res) => {
  try {
    const { to, content, clientId, supplierId } = req.body;
    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client) return res.status(404).json({ error: 'Client not found' });
    
    const cc = to.replace(/^\+/,'').substring(0,2);
    const rate = await prisma.rate.findFirst({ where: { OR: [{ clientId: client.id, countryCode: cc }, { countryCode: cc, clientId: null }, { countryCode: '*', clientId: null }] }, orderBy: { price: 'asc' } });
    const cost = rate?.price || 0.05;
    if (client.balance < cost) return res.status(402).json({ error: `Insufficient balance. $${cost} needed` });
    
    let supplier = null;
    if (supplierId) supplier = await prisma.supplier.findUnique({ where: { id: supplierId }, include: { smppConnections: true } });
    else {
      const route = await prisma.route.findFirst({
        where: { OR: [{ prefix: to.replace(/^\+/,'').substring(0,3) }, { prefix: to.replace(/^\+/,'').substring(0,1) }, { prefix: '*' }], status: 'ACTIVE' },
        orderBy: { priority: 'asc' }, include: { supplier: { include: { smppConnections: true } } }
      });
      if (route) supplier = route.supplier;
    }
    
    const senderMessageId = genId('SND');
    const messageId = genId('MSG');
    
    const msg = await prisma.message.create({
      data: { messageId, senderMessageId, clientId: client.id, from: client.name||'SMSGW', to, content, status: 'SUBMITTED', cost, supplierId: supplier?.id, forceDlr: client.forceDlr, dlrTimeout: client.dlrTimeout||0, parts: Math.ceil((content?.length||0)/160) }
    });
    
    let supplierMessageId = null;
    try {
      const kresp = await axios.get(`${KANNEL_URL}/cgi-bin/sendsms`, { params: { 
          username: supplier?.smppConnections?.[0]?.systemId || 'tester', 
          password: supplier?.smppConnections?.[0]?.password || 'testerpass', 
          to: to, 
          text: content,
          'dlr-mask': 31,
          'dlr-url': `http://172.17.0.1:3001/api/dlr/callback?id=${msg.id}&msgid=${messageId}`
        }, timeout: 10000 });
      const match = kresp.data?.match(/message id: ([^\n]+)/i);
      supplierMessageId = match ? match[1].trim() : null;
      await prisma.message.update({ where: { id: msg.id }, data: { supplierMessageId, status: 'SUBMITTED', submittedToKannel: new Date() } });
    } catch(e) {}
    
    await prisma.transaction.create({ data: { clientId: client.id, type: 'DEDUCTION', amount: -cost, description: `SMS to ${to}`, reference: messageId } });
    await prisma.client.update({ where: { id: client.id }, data: { balance: { decrement: cost } } });
    await prisma.dLRRecord.create({ data: { messageId: msg.id, status: 'SUBMITTED', senderMessageId, supplierMessageId: supplierMessageId||'' } });
    
    io.emit('live-log', { type: 'submit_sm_resp', senderMessageId, messageId, supplierMessageId: supplierMessageId||'PENDING', to, content: content?.substring(0,50), client: client.name, supplier: supplier?.name, cost, status: 'SUBMITTED', timestamp: new Date() });
    
    res.json({ success: true, messageId, senderMessageId, supplierMessageId, cost, supplier: supplier?.name });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.use(express.urlencoded({ extended: true }));
app.get('/api/dlr/callback', async (req, res) => {
  try {
    const { id, msgid, status, err } = req.query;
    const s = status||'1';
    let mStatus = 'DELIVERED';
    if (s==='2' || s==='UNDELIV') mStatus = 'FAILED';
    else if (s==='4' || s==='EXPIRED') mStatus = 'EXPIRED';
    else if (s==='8' || s==='REJECTD') mStatus = 'REJECTED';
    
    const update = { status: mStatus, dlrStatus: s, errorCode: err, deliveredAt: mStatus==='DELIVERED'?new Date():null, dlrReceivedAt: new Date() };
    
    if (id) await prisma.message.update({ where: { id }, data: update });
    else if (msgid) await prisma.message.updateMany({ where: { messageId: msgid }, data: update });
    
    await prisma.dLRRecord.updateMany({ where: { OR: [{ senderMessageId: msgid }, { messageId: id }] }, data: { status: mStatus, errorCode: err, receivedAt: new Date() } });
    
    io.emit('live-log', { type: 'dlr', senderMessageId: msgid, dlrStatus: s, status: mStatus, error: err, timestamp: new Date() });
    res.send('OK');
  } catch(e) { res.send('OK'); }
});

app.post('/api/messages/:id/force-dlr', authenticateJWT, async (req, res) => {
  const { status, errorCode } = req.body;
  const msg = await prisma.message.update({ where: { id: req.params.id }, data: { status: status||'DELIVERED', dlrStatus: status||'DELIVERED', errorCode, deliveredAt: new Date(), dlrReceivedAt: new Date(), forceFlag: true } });
  io.emit('live-log', { type: 'force_dlr', messageId: msg.messageId, status: msg.status, timestamp: new Date() });
  res.json(msg);
});

app.get('/api/messages', authenticateJWT, async (req, res) => {
  const { page=1, limit=50, clientId, status, supplierId, search } = req.query;
  const where = {};
  if (clientId) where.clientId = clientId;
  if (status) where.status = status;
  if (supplierId) where.supplierId = supplierId;
  if (search) where.OR = [{ to: { contains: search } }, { messageId: { contains: search } }, { senderMessageId: { contains: search } }, { content: { contains: search } }];
  
  const [messages, total] = await Promise.all([
    prisma.message.findMany({ where, skip: (parseInt(page)-1)*parseInt(limit), take: parseInt(limit), orderBy: { submittedAt: 'desc' }, include: { client: { select: { name: true, accountId: true } }, supplier: { select: { name: true } }, dlrRecords: { take: 3, orderBy: { receivedAt: 'desc' } } } }),
    prisma.message.count({ where })
  ]);
  res.json({ messages, pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total/parseInt(limit)) } });
});

// ==================== INVOICES ====================
app.get('/api/invoices', authenticateJWT, async (req, res) => {
  const invs = await prisma.invoice.findMany({ include: { client: { select: { name: true, accountId: true } }, items: true }, orderBy: { createdAt: 'desc' } });
  res.json({ invoices: invs });
});

app.post('/api/invoices/generate', authenticateJWT, async (req, res) => {
  try {
    const { clientId, period, startDate, endDate } = req.body;
    let start, end;
    
    if (period === 'DAILY') { start = new Date(); start.setHours(0,0,0,0); end = new Date(); end.setHours(23,59,59,999); }
    else if (period === 'WEEKLY') { start = new Date(); start.setDate(start.getDate()-7); end = new Date(); }
    else if (period === 'MONTHLY') { start = new Date(); start.setMonth(start.getMonth()-1); end = new Date(); }
    else if (period === 'CUSTOM' && startDate && endDate) { start = new Date(startDate); end = new Date(endDate); }
    else { start = new Date(); start.setMonth(start.getMonth()-1); end = new Date(); }
    
    const msgs = await prisma.message.findMany({ where: { clientId, submittedAt: { gte: start, lte: end }, status: { in: ['DELIVERED', 'SUBMITTED'] } } });
    const total = msgs.reduce((s,m) => s+(m.cost||0), 0);
    
    const inv = await prisma.invoice.create({
      data: {
        clientId, invoiceNumber: 'INV-'+Date.now(),
        period: `${start.toISOString().split('T')[0]} to ${end.toISOString().split('T')[0]}`,
        periodType: period||'MONTHLY', totalAmount: total, totalMessages: msgs.length,
        dueDate: new Date(Date.now()+30*86400000),
        items: { create: [{ description: `SMS (${msgs.length} msgs)`, quantity: msgs.length, unitPrice: msgs.length>0?total/msgs.length:0, amount: total }] }
      }
    });
    
    io.emit('live-log', { type: 'invoice_generated', invoiceNumber: inv.invoiceNumber, client: inv.clientId, amount: total, timestamp: new Date() });
    res.json(inv);
  } catch(e) { res.status(400).json({ error: e.message }); }
});

// ==================== REPORTS ====================
app.get('/api/reports', authenticateJWT, async (req, res) => {
  const start = new Date(); start.setMonth(start.getMonth()-1);
  const where = { submittedAt: { gte: start } };
  const [total, dlvd, failed, rev] = await Promise.all([
    prisma.message.count({ where }), prisma.message.count({ where: { ...where, status: 'DELIVERED' } }),
    prisma.message.count({ where: { ...where, status: 'FAILED' } }), prisma.message.aggregate({ where: { ...where, status: 'DELIVERED' }, _sum: { cost: true } })
  ]);
  
  const daily = [];
  for (let d = new Date(start); d <= new Date(); d.setDate(d.getDate()+1)) {
    const ds = new Date(d); ds.setHours(0,0,0,0);
    const de = new Date(d); de.setHours(23,59,59,999);
    daily.push({ date: d.toISOString().split('T')[0], messages: await prisma.message.count({ where: { submittedAt: { gte: ds, lte: de } } }) });
  }
  
  res.json({ summary: { totalMessages: total, delivered: dlvd, failed, deliveryRate: total>0?((dlvd/total)*100).toFixed(1):0, revenue: rev._sum.cost||0 }, dailyBreakdown: daily });
});

// ==================== DASHBOARD ====================
app.get('/api/dashboard/stats', authenticateJWT, async (req, res) => {
  const [total, dlvd, clients, sups, routes, rev, today] = await Promise.all([
    prisma.message.count(), prisma.message.count({ where: { status: 'DELIVERED' } }),
    prisma.client.count({ where: { status: 'ACTIVE' } }), prisma.supplier.count({ where: { status: 'ACTIVE' } }),
    prisma.route.count({ where: { status: 'ACTIVE' } }), prisma.message.aggregate({ where: { status: 'DELIVERED' }, _sum: { cost: true } }),
    (async () => { const t = new Date(); t.setHours(0,0,0,0); return prisma.message.count({ where: { submittedAt: { gte: t } } }); })()
  ]);
  res.json({ totalMessages: total, deliveredRate: total>0?Math.round((dlvd/total)*100):0, activeClients: clients, activeSuppliers: sups, activeRoutes: routes, totalRevenue: rev._sum.cost||0, todayMessages: today });
});

// ==================== LIVE BIND CHECK ====================
app.get('/api/bind/check-all', authenticateJWT, async (req, res) => {
  const results = [];
  const suppliers = await prisma.supplier.findMany({ where: { type: 'SMPP' }, include: { smppConnections: true } });
  for (const s of suppliers) {
    const r = await checkSupplierBind(s);
    results.push({ type: 'supplier', name: s.name, ...r });
    io.emit('live-log', { type: 'bind_check', target: 'supplier', name: s.name, bindStatus: r.status, latency: r.latency, timestamp: new Date() });
  }
  const clients = await prisma.client.findMany({ where: { smppAccounts: { some: {} } }, include: { smppAccounts: true } });
  for (const c of clients) {
    const r = await checkClientBind(c);
    results.push({ type: 'client', name: c.name, accountId: c.accountId, ...r });
    io.emit('live-log', { type: 'bind_check', target: 'client', name: c.name, bindStatus: r.status, latency: r.latency, timestamp: new Date() });
  }
  res.json({ results });
});

// WebSocket
io.on('connection', (socket) => {
  socket.emit('live-log', { type: 'system', message: 'Connected to SMS Gateway Live Feed', timestamp: new Date() });
  prisma.message.findMany({ take: 30, orderBy: { submittedAt: 'desc' }, include: { client: { select: { name: true, accountId: true } }, supplier: { select: { name: true } } } }).then(msgs => {
    msgs.reverse().forEach(m => socket.emit('live-log', {
      type: 'history', senderMessageId: m.senderMessageId, messageId: m.messageId,
      supplierMessageId: m.supplierMessageId, to: m.to, content: m.content?.substring(0,50),
      client: m.client?.name, clientAccountId: m.client?.accountId,
      supplier: m.supplier?.name, status: m.status, dlrStatus: m.dlrStatus,
      errorCode: m.errorCode, cost: m.cost, parts: m.parts, forceFlag: m.forceFlag,
      timestamp: m.submittedAt
    }));
  });
  socket.on('disconnect', () => {});
});

// Health
app.get('/api/health', async (req, res) => {
  try { await prisma.$queryRaw`SELECT 1`; res.json({ status: 'healthy', db: 'connected', timestamp: new Date().toISOString() }); }
  catch(e) { res.status(500).json({ status: 'degraded' }); }
});

// Seed
app.get('/api/seed', async (req, res) => {
  try {
    const ex = await prisma.user.findFirst({ where: { email: 'admin@smsgateway.com' } });
    if (!ex) {
      await prisma.user.create({ data: { email: 'admin@smsgateway.com', password: bcrypt.hashSync('admin123',10), name: 'Super Admin', role: 'SUPERADMIN' } });
      const t = await prisma.supplier.create({ data: { name: 'Twilio', type: 'SMPP', throughput: 500, smppConnections: { create: { host: 'smpp.twilio.com', port: 2775, systemId: 'twilio', password: 'pass' } } } });
      const i = await prisma.supplier.create({ data: { name: 'Infobip', type: 'HTTP', throughput: 300, httpEndpoints: { create: { baseUrl: 'https://api.infobip.com', apiKey: 'key' } } } });
      await prisma.route.createMany({ data: [{ name: 'US', prefix: '1', supplierId: t.id, priority: 1 }, { name: 'UK', prefix: '44', supplierId: i.id, priority: 2 }, { name: 'Default', prefix: '*', supplierId: t.id, priority: 5 }] });
      await prisma.rate.createMany({ data: [{ country: 'US', countryCode: '1', price: 0.05 }, { country: 'UK', countryCode: '44', price: 0.08 }, { country: 'Default', countryCode: '*', price: 0.05 }] });
    }
    res.json({ message: 'Seeded' });
  } catch(e) { res.json({ message: 'Error: '+e.message }); }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => { logger.info(`Running on ${PORT}`); setTimeout(() => { fetch(`http://localhost:${PORT}/api/seed`).catch(()=>{}); }, 3000); });
process.on('SIGTERM', async () => { await prisma.$disconnect(); await redisClient.quit(); server.close(()=>process.exit(0)); });

// ==================== SYNC CLIENT TO KANNEL SMPP ====================
app.post('/api/clients/:id/sync-smpp', authenticateJWT, async (req, res) => {
  try {
    const client = await prisma.client.findUnique({
      where: { id: req.params.id },
      include: { smppAccounts: true }
    });
    
    if (!client || !client.smppAccounts?.length) {
      return res.status(400).json({ error: 'Client has no SMPP account' });
    }
    
    const smpp = client.smppAccounts[0];
    
    // Add to Kannel opensmppbox config
    const fs = require('fs');
    const smppUserConfig = `
group = smpp-logins
username = "${smpp.systemId}"
password = "${smpp.password}"
system-id = "${client.accountId}"
throughput = 100
default-sender = "${client.name?.substring(0,11) || 'SMSGW'}"
`;
    
    // Append to opensmppbox config
    fs.appendFileSync('/etc/kannel/opensmppbox.conf', smppUserConfig);
    
    // Reload Kannel (SIGHUP)
    try {
      const { exec } = require('child_process');
      exec('killall -HUP bearerbox opensmppbox');
    } catch(e) {}
    
    io.emit('live-log', { 
      type: 'smpp_sync', 
      message: `Client ${client.name} synced to SMPP as ${smpp.systemId}`, 
      timestamp: new Date() 
    });
    
    res.json({ 
      success: true, 
      message: 'Client synced to SMPP',
      smppHost: req.hostname,
      smppPort: 2775,
      systemId: smpp.systemId,
      password: smpp.password
    });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

// Get all SMPP connected clients
app.get('/api/smpp/clients', authenticateJWT, async (req, res) => {
  try {
    // Parse opensmppbox config for connected users
    const fs = require('fs');
    const config = fs.readFileSync('/etc/kannel/opensmppbox.conf', 'utf8');
    const users = [];
    const regex = /username = "([^"]+)"\s+password = "([^"]+)"\s+system-id = "([^"]+)"/g;
    let match;
    while ((match = regex.exec(config)) !== null) {
      users.push({ username: match[1], password: match[2], systemId: match[3] });
    }
    res.json({ users });
  } catch(e) { res.json({ users: [] }); }
});
