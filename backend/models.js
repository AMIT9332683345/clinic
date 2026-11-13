const mongoose = require('mongoose');
const { Schema } = mongoose;

const Settings = mongoose.model('Settings', new Schema({
  key: { type: String, default: 'main', unique: true },
  clinicName: { type: String, default: 'My Clinic' },
  onlineBooking: { type: Boolean, default: true },
  dailyLimit: { type: Number, default: 60 },
  opdTiming: { type: String, default: '10 AM – 2 PM · 5 PM – 9 PM' },
  minutesPerPatient: { type: Number, default: 5 },
  doctors: [{ name: { type: String, required: true } }]
}));

const User = mongoose.model('User', new Schema({
  name: { type: String, required: true },
  phone: { type: String, required: true, unique: true },
  pinHash: { type: String, required: true },
  role: { type: String, enum: ['reception', 'doctor', 'owner'], required: true }
}, { timestamps: true }));

const Counter = mongoose.model('Counter', new Schema({ _id: String, seq: { type: Number, default: 0 } }));

const tokenSchema = new Schema({
  number: Number,
  name: String,
  phone: String,
  doctorId: String,
  doctorName: String,
  date: String,
  status: { type: String, enum: ['waiting', 'arrived', 'current', 'done', 'noshow', 'cancelled', 'hold'], default: 'waiting' },
  source: { type: String, enum: ['online', 'walkin'], default: 'online' },
  notes: { type: String, default: '' },
  arrivedAt: Date,
  calledAt: Date,
  doneAt: Date
}, { timestamps: true });
tokenSchema.index({ date: 1, doctorId: 1, number: 1 }, { unique: true });
tokenSchema.index({ phone: 1 });
const Token = mongoose.model('Token', tokenSchema);

async function getSettings() {
  let s = await Settings.findOne({ key: 'main' });
  if (!s) {
    try { s = await Settings.create({ key: 'main', doctors: [{ name: 'General OPD' }] }); }
    catch (e) { s = await Settings.findOne({ key: 'main' }); }
  }
  return s;
}

module.exports = { Settings, User, Counter, Token, getSettings };
