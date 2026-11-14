/* Demo data seeder. Usage:
 *   npm run seed              -> only runs when the database has no tokens
 *   npm run seed -- --force   -> wipes tokens/counters for the seeded week and reseeds
 */
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { Settings, User, Counter, Token } = require('./models');

const { MONGODB_URI } = process.env;
if (!MONGODB_URI) {
  console.error('Missing MONGODB_URI. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const TZ = process.env.CLINIC_TZ || 'Asia/Kolkata';
const dateStr = (off = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(Date.now() + off * 864e5));
const ist = (date, h, m) => new Date(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+05:30`);
const mins = n => n * 60000;

const PATIENTS = [
  { name: 'Rahul Mehta', phone: '9812345601' },
  { name: 'Sunita Devi', phone: '9812345602' },
  { name: 'Imran Khan', phone: '9812345603' },
  { name: 'Kavita Rao', phone: '9812345604' },
  { name: 'Arjun Nair', phone: '9812345605' },
  { name: 'Meena Gupta', phone: '9812345606' },
  { name: 'Suresh Yadav', phone: '9812345607' },
  { name: 'Fatima Sheikh', phone: '9812345608' },
  { name: 'Rohit Das', phone: '9812345609' },
  { name: 'Anita Joshi', phone: '9812345610' },
  { name: 'Vikram Singh', phone: '9812345611' },
  { name: 'Pooja Kumari', phone: '9812345612' },
  { name: 'Sanjay Patel', phone: '9812345613' },
  { name: 'Neha Bansal', phone: '9812345614' },
  { name: 'Mohd Ali', phone: '9812345615' },
  { name: 'Rekha Sharma', phone: '9812345616' },
  { name: 'Deepak Verma', phone: '9812345617' },
  { name: 'Shalini Iyer', phone: '9812345618' },
  { name: 'Ravi Prasad', phone: '9812345619' },
  { name: 'Zoya Ansari', phone: '9812345620' },
  { name: 'Kabir Malhotra', phone: '9812345621' },
  { name: 'Lakshmi Menon', phone: '9812345622' },
  { name: 'Aman Sethi', phone: '9812345623' },
  { name: 'Tanya Roy', phone: '9812345624' }
];

const NOTES = [
  'Fever · paracetamol 500 mg, 3 days',
  'Follow-up · BP 130/85, continue medicine',
  'Cough and cold · syrup 5 ml twice daily',
  'Child checkup · weight normal, vitamin D drops',
  'Skin rash · antihistamine for 5 days',
  'Diabetes review · HbA1c 7.1, diet advice',
  'Body ache · rest and painkiller',
  'Stomach pain · acidity, pantoprazole 5 days',
  'Vaccination · next dose in 4 weeks',
  'Weakness · iron and B12 supplements',
  'Throat infection · antibiotic 5 days',
  'Knee pain · calcium and physiotherapy'
];

const STAFF = [
  { name: 'Amit Mandal', phone: '9876500001', pin: '1234', role: 'owner' },
  { name: 'Priya Nair', phone: '9876500002', pin: '1234', role: 'reception' },
  { name: 'Dr. Anita Sharma', phone: '9876500003', pin: '1234', role: 'doctor' }
];

const DOCTOR_NAMES = ['Dr. Anita Sharma · General Medicine', 'Dr. Rakesh Verma · Child Care'];
const PAST_DAYS = [[9, 6], [11, 7], [8, 5], [12, 8], [10, 6], [11, 7]];

function takePatients(start, count) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(PATIENTS[(start + i) % PATIENTS.length]);
  return out;
}

function dayPatients(dayIndex, doctorIndex, count) {
  const list = takePatients(dayIndex * 5 + doctorIndex * 13, count);
  if (doctorIndex === 1) {
    for (let i = 0; i < list.length; i++) if (list[i].phone === PATIENTS[0].phone) list[i] = PATIENTS[14];
  } else if ([0, 2, 4].includes(dayIndex)) {
    const out = [PATIENTS[0], ...list.filter(p => p.phone !== PATIENTS[0].phone)];
    for (let k = 0; out.length < count; k++) {
      const cand = PATIENTS[(dayIndex * 7 + 5 + k) % PATIENTS.length];
      if (!out.some(p => p.phone === cand.phone)) out.push(cand);
    }
    return out.slice(0, count);
  }
  return list;
}

async function seed() {
  await Token.init();
  const force = process.argv.includes('--force');
  const dates = [...Array(7)].map((_, i) => dateStr(i - 6));

  const existing = await Token.countDocuments({ date: { $in: dates } });
  if (existing && !force) {
    console.log(`Found ${existing} tokens in the last 7 days. Nothing changed.`);
    console.log('Run "npm run seed -- --force" to replace them with fresh demo data.');
    return;
  }
  if (existing) {
    await Token.deleteMany({ date: { $in: dates } });
    await Counter.deleteMany({ _id: { $regex: `^(${dates.join('|')}):` } });
    console.log(`Removed ${existing} old tokens from the demo week.`);
  }

  let s = await Settings.findOne({ key: 'main' });
  if (!s) s = new Settings({ key: 'main' });
  s.clinicName = 'Aarogya Family Clinic';
  s.onlineBooking = true;
  s.dailyLimit = 60;
  s.opdTiming = '10 AM – 2 PM · 5 PM – 9 PM';
  s.minutesPerPatient = 8;
  s.doctors = DOCTOR_NAMES.map(name => ({ name }));
  await s.save();
  const doctors = s.doctors.map(d => ({ id: String(d._id), name: d.name }));

  for (const u of STAFF) {
    const pinHash = await bcrypt.hash(u.pin, 10);
    await User.findOneAndUpdate({ phone: u.phone }, { name: u.name, phone: u.phone, pinHash, role: u.role }, { upsert: true, new: true });
  }

  const tokens = [];
  const counters = [];

  PAST_DAYS.forEach((counts, dayIndex) => {
    const date = dates[dayIndex];
    counts.forEach((count, di) => {
      const doc = doctors[di];
      const list = dayPatients(dayIndex, di, count);
      for (let i = 1; i <= count; i++) {
        const p = list[i - 1];
        const status = i % 9 === 0 ? 'noshow' : i % 13 === 0 ? 'cancelled' : 'done';
        const arrivedAt = status === 'cancelled' ? undefined : ist(date, 10, 0) + mins((i - 1) * 7 + ((i * 3) % 5));
        const calledAt = status === 'done' || status === 'noshow' ? arrivedAt + mins(9 + ((i * 5) % 17)) : undefined;
        const doneAt = status === 'done' ? calledAt + mins(6 + (i % 5)) : undefined;
        tokens.push({
          number: i, name: p.name, phone: p.phone,
          doctorId: doc.id, doctorName: doc.name, date, status,
          source: i % 3 === 0 ? 'walkin' : 'online',
          notes: status === 'done' ? NOTES[(dayIndex * 3 + i) % NOTES.length] : '',
          arrivedAt, calledAt, doneAt
        });
      }
      counters.push({ _id: `${date}:${doc.id}`, seq: count });
    });
  });

  const today = dates[6];
  const now = Date.now();
  const t0 = now - mins(115);
  const todayPlan = [
    { doc: doctors[0], start: 0, count: 16, statuses: [...Array(8).fill('done'), 'current', 'arrived', 'arrived', 'hold', 'waiting', 'waiting', 'waiting', 'waiting'] },
    { doc: doctors[1], start: 16, count: 9, statuses: [...Array(5).fill('done'), 'current', 'arrived', 'waiting', 'noshow'] }
  ];

  todayPlan.forEach((plan, di) => {
    const list = takePatients(plan.start, plan.count);
    plan.statuses.forEach((status, idx) => {
      const i = idx + 1;
      const p = list[idx];
      const base = t0 + mins(di * 10 + (i - 1) * 6 + (i % 4));
      let arrivedAt, calledAt, doneAt;
      if (status === 'done') { arrivedAt = new Date(base); calledAt = new Date(+base + mins(9 + ((i * 5) % 15))); doneAt = new Date(+calledAt + mins(7 + (i % 4))); }
      if (status === 'current') { arrivedAt = new Date(now - mins(50 + di * 6)); calledAt = new Date(now - mins(6 + di * 2)); }
      if (status === 'arrived') { arrivedAt = new Date(now - mins(20 - di * 6 + (i % 3))); }
      if (status === 'hold') { arrivedAt = new Date(now - mins(35)); calledAt = new Date(now - mins(18)); }
      tokens.push({
        number: i, name: p.name, phone: p.phone,
        doctorId: plan.doc.id, doctorName: plan.doc.name, date: today, status,
        source: i % 4 === 0 ? 'walkin' : 'online',
        notes: status === 'done' ? NOTES[(di * 5 + i) % NOTES.length] : '',
        arrivedAt, calledAt, doneAt
      });
    });
    counters.push({ _id: `${today}:${plan.doc.id}`, seq: plan.count });
  });

  await Token.insertMany(tokens);
  for (const c of counters) await Counter.findOneAndUpdate({ _id: c._id }, { seq: c.seq }, { upsert: true });

  const counts = await Token.aggregate([{ $match: { date: { $in: dates }, status: { $ne: 'cancelled' } } }, { $group: { _id: '$date', n: { $sum: 1 } } }, { $sort: { _id: 1 } }]);
  console.log('Clinic:', s.clinicName);
  console.log('Doctors:', doctors.map(d => d.name).join(' | '));
  console.log('Tokens created:', tokens.length);
  console.log('Per day:', counts.map(c => `${c._id}=${c.n}`).join(' '));
  console.log('\nStaff sign-in (phone / PIN):');
  STAFF.forEach(u => console.log(`  ${u.role.padEnd(9)} ${u.phone} / ${u.pin}  (${u.name})`));
}

mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 20000 })
  .then(seed)
  .then(() => mongoose.disconnect())
  .catch(e => { console.error('Seed failed:', e.message); process.exit(1); });