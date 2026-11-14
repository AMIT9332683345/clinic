require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { User, Counter, Token, getSettings } = require('./models');

const { MONGODB_URI, JWT_SECRET } = process.env;
if (!MONGODB_URI || !JWT_SECRET) {
  console.error('Missing MONGODB_URI or JWT_SECRET environment variable.');
  process.exit(1);
}

const app = express();
app.set('trust proxy', 1);
const origins = (process.env.CLIENT_ORIGIN || '*').split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean);
// Vercel creates a new hostname for every deployment, so accept the project's vercel.app
// sites and local development without needing an env update for each deploy.
const originOk = o => !o || origins.includes('*') || origins.includes(o) || /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(o) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);
app.use(cors({ origin: (o, cb) => cb(null, originOk(o)) }));
app.use(express.json({ limit: '100kb' }));

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
const TZ = process.env.CLINIC_TZ || 'Asia/Kolkata';
const dateStr = (off = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(Date.now() + off * 864e5));
const cleanPhone = p => String(p || '').replace(/\D/g, '').slice(-10);
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ALL = ['reception', 'doctor', 'owner'];

const auth = roles => (req, res, next) => {
  try {
    const u = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), JWT_SECRET);
    if (roles && !roles.includes(u.role)) return res.status(403).json({ error: 'Not allowed for your role' });
    req.user = u; next();
  } catch (e) { res.status(401).json({ error: 'Please sign in again' }); }
};

const fails = new Map();
const limited = ip => { const f = fails.get(ip); return f && f.n >= 8 && Date.now() - f.t < 9e5; };
const noteFail = ip => { const f = fails.get(ip) || { n: 0, t: Date.now() }; if (Date.now() - f.t > 9e5) { f.n = 0; f.t = Date.now(); } f.n++; fails.set(ip, f); };
const sign = u => ({
  token: jwt.sign({ id: u.id, role: u.role, name: u.name }, JWT_SECRET, { expiresIn: '30d' }),
  user: { id: u.id, name: u.name, role: u.role, phone: u.phone }
});

async function createToken({ name, phone, doctorId, day, source }, s) {
  name = String(name || '').trim().slice(0, 60);
  phone = cleanPhone(phone);
  if (!name) throw new HttpError(400, 'Please enter the patient name');
  if (phone.length < 10) throw new HttpError(400, 'Enter a valid 10-digit phone number');
  const doc = (doctorId && s.doctors.id(doctorId)) || s.doctors[0];
  if (!doc) throw new HttpError(400, 'No doctor is configured yet');
  const date = day === 'tomorrow' ? dateStr(1) : dateStr();
  const used = await Token.countDocuments({ date, status: { $ne: 'cancelled' } });
  if (used >= s.dailyLimit) throw new HttpError(409, 'Token limit reached for ' + (day === 'tomorrow' ? 'tomorrow' : 'today'));
  const dup = await Token.findOne({ date, phone, name, doctorId: doc.id, status: { $in: ['waiting', 'arrived', 'current', 'hold'] } });
  if (dup) return dup;
  const c = await Counter.findOneAndUpdate({ _id: date + ':' + doc.id }, { $inc: { seq: 1 } }, { upsert: true, new: true });
  return Token.create({ number: c.seq, name, phone, doctorId: doc.id, doctorName: doc.name, date, source, arrivedAt: source === 'walkin' ? new Date() : undefined });
}

async function publicView(t, s) {
  s = s || await getSettings();
  const base = { date: t.date, doctorId: t.doctorId };
  const [cur, ahead] = await Promise.all([
    Token.findOne({ ...base, status: 'current' }),
    Token.countDocuments({ ...base, number: { $lt: t.number }, status: { $in: ['waiting', 'arrived', 'current'] } })
  ]);
  const wait = ahead * s.minutesPerPatient;
  return {
    id: t.id, number: t.number, name: t.name, doctorName: t.doctorName, date: t.date,
    isToday: t.date === dateStr(), status: t.status, ahead,
    currentNumber: cur ? cur.number : null, waitMinutes: wait,
    etaISO: new Date(Date.now() + wait * 60000).toISOString(), clinicName: s.clinicName
  };
}

async function doctorState(doctorId) {
  const base = { date: dateStr(), doctorId };
  const [current, queue, hold] = await Promise.all([
    Token.findOne({ ...base, status: 'current' }),
    Token.find({ ...base, status: { $in: ['arrived', 'waiting'] } }).sort({ number: 1 }).limit(40),
    Token.find({ ...base, status: 'hold' }).sort({ number: 1 })
  ]);
  queue.sort((a, b) => (b.status === 'arrived') - (a.status === 'arrived') || a.number - b.number);
  const visits = current ? await Token.countDocuments({ phone: current.phone, status: 'done' }) : 0;
  return { current, next: queue.slice(0, 3), hold, visits };
}

/* ---------- health ---------- */
app.get('/health', (req, res) => res.json({ ok: true }));

/* ---------- public (patients, TV) ---------- */
app.get('/api/public/info', wrap(async (req, res) => {
  const s = await getSettings();
  const used = await Token.countDocuments({ date: dateStr(), status: { $ne: 'cancelled' } });
  res.json({
    clinicName: s.clinicName, opdTiming: s.opdTiming,
    online: s.onlineBooking && used < s.dailyLimit,
    doctors: s.doctors.map(d => ({ id: d.id, name: d.name }))
  });
}));

app.post('/api/public/tokens', wrap(async (req, res) => {
  const s = await getSettings();
  if (!s.onlineBooking) throw new HttpError(403, 'Online booking is currently closed');
  const t = await createToken({ ...req.body, source: 'online' }, s);
  res.status(201).json(await publicView(t, s));
}));

app.get('/api/public/tokens/:id', wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Token not found');
  const t = await Token.findById(req.params.id);
  if (!t) throw new HttpError(404, 'Token not found');
  res.json(await publicView(t));
}));

app.post('/api/public/tokens/:id/cancel', wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Token not found');
  const t = await Token.findById(req.params.id);
  if (!t) throw new HttpError(404, 'Token not found');
  if (!['waiting', 'arrived'].includes(t.status)) throw new HttpError(409, 'This token can no longer be cancelled');
  t.status = 'cancelled'; await t.save();
  res.json(await publicView(t));
}));

app.get('/api/public/display', wrap(async (req, res) => {
  const s = await getSettings();
  const doc = (req.query.doctorId && s.doctors.id(req.query.doctorId)) || s.doctors[0];
  if (!doc) return res.json({ clinicName: s.clinicName, doctorName: '', current: null, next: [] });
  const st = await doctorState(doc.id);
  res.json({ clinicName: s.clinicName, doctorName: doc.name, current: st.current ? st.current.number : null, next: st.next.map(t => t.number) });
}));

/* ---------- auth ---------- */
app.get('/api/auth/status', wrap(async (req, res) => res.json({ needsSetup: (await User.countDocuments()) === 0 })));

app.post('/api/auth/setup', wrap(async (req, res) => {
  if (await User.countDocuments()) throw new HttpError(403, 'Setup already completed');
  const { name, phone, pin } = req.body;
  if (!name || cleanPhone(phone).length < 10 || !/^\d{4,8}$/.test(String(pin))) throw new HttpError(400, 'Enter name, a 10-digit phone and a 4–8 digit PIN');
  const u = await User.create({ name: String(name).trim(), phone: cleanPhone(phone), pinHash: await bcrypt.hash(String(pin), 10), role: 'owner' });
  res.status(201).json(sign(u));
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  if (limited(req.ip)) throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
  const u = await User.findOne({ phone: cleanPhone(req.body.phone) });
  if (!u || !(await bcrypt.compare(String(req.body.pin || ''), u.pinHash))) { noteFail(req.ip); throw new HttpError(401, 'Incorrect phone number or PIN'); }
  res.json(sign(u));
}));

/* ---------- tokens (staff) ---------- */
app.get('/api/tokens', auth(ALL), wrap(async (req, res) => {
  const q = { date: req.query.date || dateStr() };
  if (req.query.doctorId) q.doctorId = req.query.doctorId;
  const term = String(req.query.q || '').trim();
  if (term) {
    q.$or = [{ phone: { $regex: escapeRe(term) } }, { name: { $regex: escapeRe(term), $options: 'i' } }];
    if (/^\d{1,3}$/.test(term)) q.$or.push({ number: +term });
  }
  res.json(await Token.find(q).sort({ number: 1 }));
}));

app.post('/api/tokens', auth(['reception', 'owner']), wrap(async (req, res) => {
  const t = await createToken({ ...req.body, day: 'today', source: 'walkin' }, await getSettings());
  res.status(201).json(t);
}));

app.patch('/api/tokens/:id/status', auth(['reception', 'owner']), wrap(async (req, res) => {
  const { status } = req.body;
  if (!['arrived', 'noshow', 'waiting'].includes(status)) throw new HttpError(400, 'Invalid status');
  const t = await Token.findById(req.params.id);
  if (!t) throw new HttpError(404, 'Token not found');
  t.status = status;
  if (status === 'arrived') t.arrivedAt = new Date();
  await t.save(); res.json(t);
}));

/* ---------- patients ---------- */
app.get('/api/patients/search', auth(ALL), wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  const re = { $regex: escapeRe(q), $options: 'i' };
  const rows = await Token.aggregate([
    { $match: { $or: [{ phone: re }, { name: re }] } },
    { $group: { _id: { phone: '$phone', name: '$name' }, visits: { $sum: { $cond: [{ $eq: ['$status', 'done'] }, 1, 0] } }, last: { $max: '$date' } } },
    { $sort: { last: -1 } }, { $limit: 30 }
  ]);
  res.json(rows.map(r => ({ phone: r._id.phone, name: r._id.name, visits: r.visits, lastVisit: r.last })));
}));

app.get('/api/patients/:phone/history', auth(ALL), wrap(async (req, res) => {
  const rows = await Token.find({ phone: cleanPhone(req.params.phone), status: 'done' }).sort({ date: -1, doneAt: -1 }).limit(60);
  res.json(rows.map(t => ({ date: t.date, name: t.name, doctorName: t.doctorName, notes: t.notes, number: t.number })));
}));

/* ---------- doctor ---------- */
app.get('/api/doctor/state', auth(['doctor', 'owner']), wrap(async (req, res) => res.json(await doctorState(String(req.query.doctorId || '')))));

app.post('/api/doctor/next', auth(['doctor', 'owner']), wrap(async (req, res) => {
  const { doctorId, notes, hold } = req.body;
  const base = { date: dateStr(), doctorId: String(doctorId || '') };
  const cur = await Token.findOne({ ...base, status: 'current' });
  if (cur) {
    cur.notes = String(notes || '').slice(0, 2000);
    if (hold) cur.status = 'hold'; else { cur.status = 'done'; cur.doneAt = new Date(); }
    await cur.save();
  }
  const nxt = (await Token.findOne({ ...base, status: 'arrived' }).sort({ number: 1 })) ||
              (await Token.findOne({ ...base, status: 'waiting' }).sort({ number: 1 }));
  if (nxt) { nxt.status = 'current'; nxt.calledAt = new Date(); await nxt.save(); }
  res.json(await doctorState(base.doctorId));
}));

/* ---------- reports ---------- */
app.get('/api/reports/summary', auth(['owner', 'doctor']), wrap(async (req, res) => {
  const date = dateStr();
  const todays = await Token.find({ date, status: { $ne: 'cancelled' } });
  const waits = todays.filter(t => t.arrivedAt && t.calledAt).map(t => t.calledAt - t.arrivedAt);
  const days = [...Array(7)].map((_, i) => dateStr(i - 6));
  const agg = await Token.aggregate([{ $match: { date: { $in: days }, status: { $ne: 'cancelled' } } }, { $group: { _id: '$date', n: { $sum: 1 } } }]);
  const m = Object.fromEntries(agg.map(a => [a._id, a.n]));
  res.json({
    today: {
      total: todays.length,
      done: todays.filter(t => t.status === 'done').length,
      waiting: todays.filter(t => ['waiting', 'arrived', 'hold'].includes(t.status)).length,
      noShow: todays.filter(t => t.status === 'noshow').length,
      avgWaitMin: waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length / 60000) : 0
    },
    week: days.map(d => ({ date: d, count: m[d] || 0 }))
  });
}));

app.get('/api/reports/export', auth(['owner']), wrap(async (req, res) => {
  const days = Math.min(Math.max(+req.query.days || 30, 1), 365);
  const rows = await Token.find({ date: { $gte: dateStr(1 - days) } }).sort({ date: 1, number: 1 });
  const csv = ['Date,Token,Name,Phone,Doctor,Status,Source'].concat(
    rows.map(t => [t.date, t.number, `"${t.name.replace(/"/g, '""')}"`, t.phone, `"${t.doctorName}"`, t.status, t.source].join(','))
  ).join('\n');
  res.type('text/csv').send(csv);
}));

/* ---------- settings & staff (owner) ---------- */
app.get('/api/settings', auth(ALL), wrap(async (req, res) => res.json(await getSettings())));

app.put('/api/settings', auth(['owner']), wrap(async (req, res) => {
  const s = await getSettings();
  const b = req.body;
  if (typeof b.clinicName === 'string' && b.clinicName.trim()) s.clinicName = b.clinicName.trim().slice(0, 80);
  if (typeof b.onlineBooking === 'boolean') s.onlineBooking = b.onlineBooking;
  if (+b.dailyLimit > 0) s.dailyLimit = Math.floor(+b.dailyLimit);
  if (typeof b.opdTiming === 'string') s.opdTiming = b.opdTiming.trim().slice(0, 80);
  if (+b.minutesPerPatient > 0) s.minutesPerPatient = Math.floor(+b.minutesPerPatient);
  await s.save(); res.json(s);
}));

app.post('/api/settings/doctors', auth(['owner']), wrap(async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 60);
  if (!name) throw new HttpError(400, 'Enter a doctor or OPD name');
  const s = await getSettings(); s.doctors.push({ name }); await s.save(); res.status(201).json(s);
}));

app.delete('/api/settings/doctors/:id', auth(['owner']), wrap(async (req, res) => {
  const s = await getSettings();
  if (s.doctors.length < 2) throw new HttpError(409, 'At least one doctor is required');
  s.doctors.pull({ _id: req.params.id }); await s.save(); res.json(s);
}));

app.get('/api/users', auth(['owner']), wrap(async (req, res) => res.json(await User.find({}, 'name phone role').sort({ createdAt: 1 }))));

app.post('/api/users', auth(['owner']), wrap(async (req, res) => {
  const { name, phone, pin, role } = req.body;
  if (!name || cleanPhone(phone).length < 10 || !/^\d{4,8}$/.test(String(pin)) || !ALL.includes(role)) throw new HttpError(400, 'Enter name, a 10-digit phone, a 4–8 digit PIN and a role');
  const u = await User.create({ name: String(name).trim(), phone: cleanPhone(phone), pinHash: await bcrypt.hash(String(pin), 10), role });
  res.status(201).json({ id: u.id, name: u.name, phone: u.phone, role: u.role });
}));

app.delete('/api/users/:id', auth(['owner']), wrap(async (req, res) => {
  if (req.params.id === req.user.id) throw new HttpError(409, 'You cannot remove your own account');
  await User.findByIdAndDelete(req.params.id); res.json({ ok: true });
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  if (err.code === 11000) return res.status(409).json({ error: 'That already exists' });
  if (!err.status) console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Server error' });
});

const PORT = process.env.PORT || 5000;
mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 15000 })
  .then(async () => { await getSettings(); await Token.init(); app.listen(PORT, () => console.log('API running on port ' + PORT)); })
  .catch(e => { console.error('MongoDB connection failed:', e.message); process.exit(1); });
