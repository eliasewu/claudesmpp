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

const KANNEL_URL = process.env.KANNEL_SMSBOX_URL || 'http://172.17.0.1:13013';
const KANNEL_STATUS_URL = 'http://172.17.0.1:13000';
const KANNEL_PASSWORD = 'bar';

const authenticateJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No token' });
  try { req.user = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET); next(); }
  catch (err) { return res.status(403).json({ error: 'Invalid token' }); }
};

// Helper: Generate unique IDs
const genId = (prefix) => prefix + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);

// ==================== AUTH ====================
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user.id, role: user.role, email: user.email }, process.env.JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== CLIENTS ====================
app.get('/api/clients', authenticateJWT, async (req, res) => {
  const clients = await prisma.client.findMany({
    include: { 
      smppAccounts: true, httpConnections: true, rates: true,
      _count: { select: { messages: true } },
      messages: { take: 5, orderBy: { submittedAt: 'desc' }, select: { messageId: true, to: true, status: true, submittedAt: true } }
    },
    orderBy: { createdAt: 'desc' }
  });
  res.json({ clients });
});

app.post('/api/clients', authenticateJWT, async (req, res) => {
  try {
    const { name, accountId, balance, dailyLimit, smppSystemId, smppPassword, smppHost, smppPort, httpApiKey, httpBaseUrl, dlrTimeout, forceDlr, notes } = req.body;
    const client = await prisma.client.create({
      data: {
        accountId: accountId || 'CLI' + Date.now(), name, balance: parseFloat(balance) || 0, dailyLimit: parseInt(dailyLimit) || 10000,
        dlrTimeout: parseInt(dlrTimeout) || 0, forceDlr: forceDlr === true || forceDlr === 'true',
        notes: notes || '',
        smppAccounts: smppSystemId ? { create: { systemId: smppSystemId, password: smppPassword || '', host: smppHost || '', port: parseInt(smppPort) || 2775 } } : undefined,
        httpConnections: httpApiKey ? { create: { apiKey: httpApiKey, baseUrl: httpBaseUrl || '' } } : undefined,
      }
    });
    if (parseFloat(balance) > 0) {
      await prisma.transaction.create({ data: { clientId: client.id, type: 'TOPUP', amount: parseFloat(balance), description: 'Initial balance', reference: 'INIT-' + client.accountId } });
    }
    io.emit('live-log', { type: 'client_created', message: `Client ${name} created`, timestamp: new Date() });
    res.json(client);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put('/api/clients/:id', authenticateJWT, async (req, res) => {
  const { name, balance, dailyLimit, status, dlrTimeout, forceDlr, notes, smppSystemId, smppPassword, smppHost, smppPort } = req.body;
  const data = { name, balance, dailyLimit, status, dlrTimeout, forceDlr, notes };
  Object.keys(data).forEach(k => data[k] === undefined && delete data[k]);
  const client = await prisma.client.update({ where: { id: req.params.id }, data });
  if (smppSystemId) {
    await prisma.smppAccount.upsert({
      where: { clientId: req.params.id },
      update: { systemId: smppSystemId, password: smppPassword, host: smppHost, port: parseInt(smppPort) || 2775 },
      create: { clientId: req.params.id, systemId: smppSystemId, password: smppPassword, host: smppHost, port: parseInt(smppPort) || 2775 }
    });
  }
  res.json(client);
});

app.delete('/api/clients/:id', authenticateJWT, async (req, res) => {
  await prisma.client.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

// Client Topup
app.post('/api/clients/:id/topup', authenticateJWT, async (req, res) => {
  try {
    const { amount, description, paymentMethod } = req.body;
    const ta = parseFloat(amount);
    await prisma.client.update({ where: { id: req.params.id }, data: { balance: { increment: ta } } });
    const tx = await prisma.transaction.create({ data: { clientId: req.params.id, type: 'TOPUP', amount: ta, description: description || 'Funds added', reference: 'TOPUP-' + Date.now(), paymentMethod: paymentMethod || 'MANUAL' } });
    io.emit('live-log', { type: 'topup', message: `$${ta} added`, timestamp: new Date() });
    res.json({ success: true, transaction: tx });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/clients/:id/transactions', authenticateJWT, async (req, res) => {
  const txs = await prisma.transaction.findMany({ where: { clientId: req.params.id }, orderBy: { createdAt: 'desc' }, take: 100 });
  res.json({ transactions: txs });
});

// ==================== SUPPLIERS ====================
app.get('/api/suppliers', authenticateJWT, async (req, res) => {
  const suppliers = await prisma.supplier.findMany({
    include: { smppConnections: true, httpEndpoints: true, routes: true, _count: { select: { messages: true } } },
    orderBy: { createdAt: 'desc' }
  });
  res.json({ suppliers });
});

app.post('/api/suppliers', authenticateJWT, async (req, res) => {
  try {
    const { name, type, host, port, systemId, password, apiKey, baseUrl, throughput } = req.body;
    const supplier = await prisma.supplier.create({
      data: {
        name, type: type || 'SMPP', throughput: parseInt(throughput) || 100,
        smppConnections: type === 'SMPP' ? { create: { host: host || '', port: parseInt(port) || 2775, systemId: systemId || '', password: password || '' } } : undefined,
        httpEndpoints: type === 'HTTP' ? { create: { baseUrl: baseUrl || '', apiKey: apiKey || '', method: 'POST' } } : undefined
      }
    });
    res.json(supplier);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.delete('/api/suppliers/:id', authenticateJWT, async (req, res) => {
  await prisma.supplier.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

// Supplier Bind Check
app.get('/api/suppliers/:id/check', authenticateJWT, async (req, res) => {
  const supplier = await prisma.supplier.findUnique({ where: { id: req.params.id }, include: { smppConnections: true } });
  if (!supplier) return res.status(404).json({ error: 'Not found' });
  let status = 'UNKNOWN', latency = null;
  if (supplier.smppConnections?.length > 0) {
    const c = supplier.smppConnections[0];
    try {
      const start = Date.now();
      await new Promise((resolve, reject) => {
        const socket = new net.Socket();
        socket.setTimeout(5000);
        socket.connect(c.port, c.host, () => { latency = Date.now() - start; socket.destroy(); resolve(); });
        socket.on('error', () => { socket.destroy(); resolve(); });
        socket.on('timeout', () => { socket.destroy(); resolve(); });
      });
      status = latency ? 'REACHABLE' : 'UNREACHABLE';
    } catch (e) { status = 'ERROR'; }
  }
  res.json({ supplier: supplier.name, bindStatus: status, latency, checkedAt: new Date() });
});

// ==================== ROUTES ====================
app.get('/api/routes', authenticateJWT, async (req, res) => {
  const routes = await prisma.route.findMany({ include: { supplier: { select: { name: true, status: true } } }, orderBy: { priority: 'asc' } });
  res.json({ routes });
});

app.post('/api/routes', authenticateJWT, async (req, res) => {
  const { name, prefix, supplierId, priority } = req.body;
  const route = await prisma.route.create({ data: { name, prefix, supplierId, priority: parseInt(priority) || 1 } });
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
  const rate = await prisma.rate.create({ data: { country, countryCode, operator: operator || 'All', price: parseFloat(price), type: type || 'SENDING', clientId, supplierId } });
  res.json(rate);
});

// ==================== MESSAGES - FULL KANNEL INTEGRATION ====================
// Send SMS via Kannel
app.post('/api/messages/send', authenticateJWT, async (req, res) => {
  try {
    const { to, content, clientId, supplierId, forceDlr, dlrTimeout } = req.body;
    
    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client) return res.status(404).json({ error: 'Client not found' });
    
    // Find rate
    const cc = to.replace(/^\+/, '').substring(0, 2);
    const rate = await prisma.rate.findFirst({
      where: { OR: [{ clientId: client.id, countryCode: cc }, { clientId: null, countryCode: cc }, { clientId: null, countryCode: '*' }] },
      orderBy: { price: 'asc' }
    });
    const cost = rate?.price || 0.05;
    
    if (client.balance < cost) return res.status(402).json({ error: `Insufficient balance. Need $${cost}` });
    
    // Find route/supplier
    let supplier = null;
    if (supplierId) {
      supplier = await prisma.supplier.findUnique({ where: { id: supplierId }, include: { smppConnections: true } });
    } else {
      const prefix = to.replace(/^\+/, '').substring(0, 3);
      const route = await prisma.route.findFirst({
        where: { OR: [{ prefix }, { prefix: to.replace(/^\+/, '').substring(0, 1) }, { prefix: '*' }], status: 'ACTIVE' },
        orderBy: { priority: 'asc' },
        include: { supplier: { include: { smppConnections: true } } }
      });
      if (route) supplier = route.supplier;
    }
    
    // Generate message IDs
    const senderMessageId = genId('SND');
    const messageId = genId('MSG');
    
    // Create message record
    const message = await prisma.message.create({
      data: {
        messageId, senderMessageId, clientId: client.id, from: client.name || 'SMSGW', to, content,
        status: 'SUBMITTED', cost, supplierId: supplier?.id, routeId: null,
        forceDlr: forceDlr !== undefined ? forceDlr : client.forceDlr,
        dlrTimeout: dlrTimeout || client.dlrTimeout || 0,
        parts: Math.ceil((content?.length || 0) / 160)
      }
    });
    
    // Send via Kannel
    let kannelResponse = null;
    let supplierMessageId = null;
    try {
      const params = {
        username: supplier?.smppConnections?.[0]?.systemId || 'tester',
        password: supplier?.smppConnections?.[0]?.password || 'testerpass',
        from: client.name?.substring(0, 11) || 'SMSGW',
        to: to,
        text: content,
        coding: 0,
        charset: 'UTF-8',
        'dlr-mask': 31,
        'dlr-url': `http://172.17.0.1:3001/api/dlr/callback?id=${message.id}&msgid=${messageId}`
      };
      
      const kresp = await axios.get(`${KANNEL_URL}/cgi-bin/sendsms`, { params, timeout: 10000 });
      kannelResponse = kresp.data;
      
      // Parse Kannel response for supplier message ID
      const match = kannelResponse?.match(/message id: ([^\n]+)/i);
      supplierMessageId = match ? match[1].trim() : null;
      
      await prisma.message.update({
        where: { id: message.id },
        data: { supplierMessageId, status: 'SUBMITTED', submittedToKannel: new Date() }
      });
    } catch (kerr) {
      await prisma.message.update({
        where: { id: message.id },
        data: { status: 'FAILED', errorCode: 'KANNEL_ERR', errorDescription: kerr.message, dlrStatus: 'FAILED' }
      });
    }
    
    // Deduct balance
    await prisma.transaction.create({
      data: { clientId: client.id, type: 'DEDUCTION', amount: -cost, description: `SMS to ${to}`, reference: messageId }
    });
    await prisma.client.update({ where: { id: client.id }, data: { balance: { decrement: cost } } });
    
    // Create DLR record
    await prisma.dLRRecord.create({
      data: { messageId: message.id, status: 'SUBMITTED', senderMessageId, supplierMessageId: supplierMessageId || '' }
    });
    
    // Emit live log with full details
    io.emit('live-log', {
      type: 'submit_sm_resp',
      senderMessageId, messageId, supplierMessageId: supplierMessageId || 'PENDING',
      from: client.name, to, content: content?.substring(0, 50),
      supplier: supplier?.name || 'Kannel', cost,
      status: kannelResponse ? 'SUBMITTED' : 'FAILED',
      kannelResponse: kannelResponse?.substring(0, 100),
      timestamp: new Date()
    });
    
    res.json({
      success: true,
      messageId,
      senderMessageId,
      supplierMessageId: supplierMessageId || null,
      status: 'SUBMITTED',
      cost,
      supplier: supplier?.name || 'Kannel',
      newBalance: client.balance - cost
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DLR Callback from Kannel
app.get('/api/dlr/callback', async (req, res) => {
  try {
    const { id, msgid, status, err, dlr_status } = req.query;
    
    const dlrStatus = dlr_status || status;
    let messageStatus = 'DELIVERED';
    if (dlrStatus === '1' || dlrStatus === 'DELIVRD') messageStatus = 'DELIVERED';
    else if (dlrStatus === '2' || dlrStatus === 'UNDELIV') messageStatus = 'FAILED';
    else if (dlrStatus === '4' || dlrStatus === 'EXPIRED') messageStatus = 'EXPIRED';
    else if (dlrStatus === '8' || dlrStatus === 'REJECTD') messageStatus = 'REJECTED';
    
    const updateData = {
      status: messageStatus,
      dlrStatus: dlrStatus,
      errorCode: err || null,
      deliveredAt: messageStatus === 'DELIVERED' ? new Date() : null,
      dlrReceivedAt: new Date()
    };
    
    if (id) {
      await prisma.message.update({ where: { id }, data: updateData });
    } else if (msgid) {
      await prisma.message.updateMany({ where: { messageId: msgid }, data: updateData });
    }
    
    // Update DLR record
    await prisma.dLRRecord.updateMany({
      where: { OR: [{ senderMessageId: msgid }, { messageId: id }] },
      data: { status: messageStatus, errorCode: err, receivedAt: new Date() }
    });
    
    io.emit('live-log', {
      type: 'dlr',
      senderMessageId: msgid,
      status: messageStatus,
      dlrStatus: dlrStatus,
      error: err || '',
      timestamp: new Date()
    });
    
    res.send('OK');
  } catch (e) {
    logger.error('DLR callback error', { error: e.message });
    res.send('OK');
  }
});

// Force DLR
app.post('/api/messages/:id/force-dlr', authenticateJWT, async (req, res) => {
  try {
    const { status, errorCode } = req.body;
    const message = await prisma.message.update({
      where: { id: req.params.id },
      data: {
        status: status || 'DELIVERED',
        dlrStatus: status || 'DELIVERED',
        errorCode: errorCode || null,
        deliveredAt: status === 'DELIVERED' ? new Date() : null,
        dlrReceivedAt: new Date(),
        forceFlag: true
      }
    });
    
    await prisma.dLRRecord.updateMany({
      where: { messageId: message.id },
      data: { status: message.status, errorCode: message.errorCode, receivedAt: new Date() }
    });
    
    io.emit('live-log', { type: 'force_dlr', messageId: message.messageId, status: message.status, timestamp: new Date() });
    res.json(message);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Get messages with full details
app.get('/api/messages', authenticateJWT, async (req, res) => {
  const { page = 1, limit = 50, clientId, status, supplierId, search } = req.query;
  const where = {};
  if (clientId) where.clientId = clientId;
  if (status) where.status = status;
  if (supplierId) where.supplierId = supplierId;
  if (search) where.OR = [{ to: { contains: search } }, { messageId: { contains: search } }, { senderMessageId: { contains: search } }, { content: { contains: search } }];
  
  const [messages, total] = await Promise.all([
    prisma.message.findMany({
      where, skip: (parseInt(page) - 1) * parseInt(limit), take: parseInt(limit),
      orderBy: { submittedAt: 'desc' },
      include: {
        client: { select: { name: true, accountId: true } },
        supplier: { select: { name: true, type: true } },
        dlrRecords: { take: 5, orderBy: { receivedAt: 'desc' } }
      }
    }),
    prisma.message.count({ where })
  ]);
  
  res.json({ messages, pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) } });
});

// Get single message detail
app.get('/api/messages/:id', authenticateJWT, async (req, res) => {
  const message = await prisma.message.findUnique({
    where: { id: req.params.id },
    include: {
      client: true, supplier: true, route: true,
      dlrRecords: { orderBy: { receivedAt: 'desc' } }
    }
  });
  if (!message) return res.status(404).json({ error: 'Not found' });
  res.json(message);
});

// ==================== INVOICES ====================
app.get('/api/invoices', authenticateJWT, async (req, res) => {
  const invoices = await prisma.invoice.findMany({ include: { client: { select: { name: true } }, items: true }, orderBy: { createdAt: 'desc' } });
  res.json({ invoices });
});

app.post('/api/invoices/generate', authenticateJWT, async (req, res) => {
  const { clientId } = req.body;
  const start = new Date(); start.setMonth(start.getMonth() - 1);
  const msgs = await prisma.message.findMany({ where: { clientId, submittedAt: { gte: start }, status: { in: ['DELIVERED', 'SUBMITTED'] } } });
  const total = msgs.reduce((s, m) => s + (m.cost || 0), 0);
  const inv = await prisma.invoice.create({
    data: {
      clientId, invoiceNumber: 'INV-' + Date.now(),
      period: `${start.toISOString().split('T')[0]} to ${new Date().toISOString().split('T')[0]}`,
      totalAmount: total, totalMessages: msgs.length, dueDate: new Date(Date.now() + 30*86400000),
      items: { create: [{ description: `SMS (${msgs.length} msgs)`, quantity: msgs.length, unitPrice: msgs.length > 0 ? total/msgs.length : 0, amount: total }] }
    }
  });
  res.json(inv);
});

// ==================== REPORTS ====================
app.get('/api/reports', authenticateJWT, async (req, res) => {
  const start = new Date(); start.setMonth(start.getMonth() - 1);
  const where = { submittedAt: { gte: start } };
  const [total, delivered, failed, revenue] = await Promise.all([
    prisma.message.count({ where }),
    prisma.message.count({ where: { ...where, status: 'DELIVERED' } }),
    prisma.message.count({ where: { ...where, status: 'FAILED' } }),
    prisma.message.aggregate({ where: { ...where, status: 'DELIVERED' }, _sum: { cost: true } })
  ]);
  
  const daily = [];
  for (let d = new Date(start); d <= new Date(); d.setDate(d.getDate()+1)) {
    const ds = new Date(d); ds.setHours(0,0,0,0);
    const de = new Date(d); de.setHours(23,59,59,999);
    daily.push({ date: d.toISOString().split('T')[0], messages: await prisma.message.count({ where: { submittedAt: { gte: ds, lte: de } } }) });
  }
  
  res.json({ summary: { totalMessages: total, delivered, failed, deliveryRate: total>0?((delivered/total)*100).toFixed(1):0, revenue: revenue._sum.cost||0 }, dailyBreakdown: daily });
});

// ==================== DASHBOARD ====================
app.get('/api/dashboard/stats', authenticateJWT, async (req, res) => {
  const [total, dlvd, clients, suppliers, routes, rev, today] = await Promise.all([
    prisma.message.count(),
    prisma.message.count({ where: { status: 'DELIVERED' } }),
    prisma.client.count({ where: { status: 'ACTIVE' } }),
    prisma.supplier.count({ where: { status: 'ACTIVE' } }),
    prisma.route.count({ where: { status: 'ACTIVE' } }),
    prisma.message.aggregate({ where: { status: 'DELIVERED' }, _sum: { cost: true } }),
    (async () => { const t = new Date(); t.setHours(0,0,0,0); return prisma.message.count({ where: { submittedAt: { gte: t } } }); })()
  ]);
  res.json({ totalMessages: total, deliveredRate: total>0?Math.round((dlvd/total)*100):0, activeClients: clients, activeSuppliers: suppliers, activeRoutes: routes, totalRevenue: rev._sum.cost||0, todayMessages: today });
});

// ==================== WEBSOCKET ====================
io.on('connection', (socket) => {
  socket.emit('live-log', { type: 'system', message: 'Connected', timestamp: new Date() });
  
  // Send recent messages on connect
  prisma.message.findMany({ take: 20, orderBy: { submittedAt: 'desc' }, include: { client: { select: { name: true } }, supplier: { select: { name: true } } } }).then(msgs => {
    msgs.reverse().forEach(m => {
      socket.emit('live-log', {
        type: 'history', senderMessageId: m.senderMessageId, messageId: m.messageId,
        supplierMessageId: m.supplierMessageId, to: m.to, content: m.content?.substring(0, 50),
        client: m.client?.name, supplier: m.supplier?.name, status: m.status,
        cost: m.cost, errorCode: m.errorCode, timestamp: m.submittedAt
      });
    });
  });
  
  socket.on('disconnect', () => {});
});

// ==================== HEALTH ====================
app.get('/api/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    let kstatus = 'unknown';
    try { await axios.get(`${KANNEL_STATUS_URL}/status?password=${KANNEL_PASSWORD}`, { timeout: 2000 }); kstatus = 'connected'; } catch(e) {}
    res.json({ status: 'healthy', database: 'connected', kannel: kstatus, timestamp: new Date().toISOString() });
  } catch(e) { res.status(500).json({ status: 'degraded', error: e.message }); }
});

// ==================== SEED ====================
app.get('/api/seed', async (req, res) => {
  try {
    const ex = await prisma.user.findFirst({ where: { email: 'admin@smsgateway.com' } });
    if (!ex) {
      const h = bcrypt.hashSync('admin123', 10);
      await prisma.user.create({ data: { email: 'admin@smsgateway.com', password: h, name: 'Super Admin', role: 'SUPERADMIN' } });
      
      const t = await prisma.supplier.create({ data: { name: 'Twilio', type: 'SMPP', throughput: 500, smppConnections: { create: { host: 'smpp.twilio.com', port: 2775, systemId: 'twilio', password: 'pass' } } } });
      const i = await prisma.supplier.create({ data: { name: 'Infobip', type: 'HTTP', throughput: 300, httpEndpoints: { create: { baseUrl: 'https://api.infobip.com', apiKey: 'key' } } } });
      
      await prisma.route.createMany({ data: [{ name: 'US', prefix: '1', supplierId: t.id, priority: 1 }, { name: 'UK', prefix: '44', supplierId: i.id, priority: 2 }, { name: 'Default', prefix: '*', supplierId: t.id, priority: 5 }] });
      await prisma.rate.createMany({ data: [{ country: 'US', countryCode: '1', price: 0.05 }, { country: 'UK', countryCode: '44', price: 0.08 }, { country: 'Default', countryCode: '*', price: 0.05 }] });
    }
    res.json({ message: 'Seeded. Login: admin@smsgateway.com / admin123' });
  } catch(e) { res.json({ message: 'Seed error: ' + e.message }); }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  logger.info(`SMS Gateway running on port ${PORT}`);
  setTimeout(() => { fetch(`http://localhost:${PORT}/api/seed`).catch(() => {}); }, 3000);
});

process.on('SIGTERM', async () => { await prisma.$disconnect(); await redisClient.quit(); server.close(() => process.exit(0)); });
