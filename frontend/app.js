(() => {
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const read = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const store = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };
const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
const apiParam = new URLSearchParams(location.search).get('api');
if (apiParam) store('cq_api', apiParam);
const pick = v => String(v || '').trim().replace(/\/+$/, '');
const API = pick(apiParam) || (isLocal ? (pick(read('cq_api')) || 'http://localhost:5000') : (pick(window.CONFIG && window.CONFIG.API_URL) || pick(read('cq_api'))));
const API_BAD = !API || API === location.origin || (/localhost|127\.0\.0\.1/.test(API) && !isLocal) || /YOUR-BACKEND-NAME/.test(API);
let auth = null; try { auth = JSON.parse(read('cq_auth')); } catch (e) {}
let info = null, timer = null, docId = read('cq_doc') || '', deferred = null;

window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; const b = $('#inst'); if (b) b.hidden = false; });

const IC = {
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  play: '<path d="M6 4l14 8-14 8z"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  ticket: '<path d="M3 9a2 2 0 0 0 0 6v3h18v-3a2 2 0 0 1 0-6V6H3z"/><path d="M13 7v10"/>',
  pulse: '<path d="M3 12h4l3-8 4 16 3-8h4"/>'
};
const ic = n => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${IC[n]}</svg>`;
const go = h => { location.hash = '#/' + h; };
const view = h => { $('#view').innerHTML = h; };
const loading = () => view('<div class="loading">Connecting…</div>');
function toast(m, bad) { const t = $('#toast'); t.textContent = m; t.className = 'show' + (bad ? ' bad' : ''); clearTimeout(toast.t); toast.t = setTimeout(() => { t.className = ''; }, 3400); }

async function req(p, o = {}) {
  if (API_BAD) throw new Error('Backend URL is not set.');
  let r;
  try {
    r = await fetch(API + '/api' + p, { method: o.method || 'GET', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer ' + auth.token } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined });
  } catch (e) { throw new Error('Cannot reach the server. If it was idle, wait a few seconds and try again.'); }
  if (!r.ok) {
    let d = {}; try { d = await r.json(); } catch (e) {}
    if (r.status === 401 && auth) { auth = null; store('cq_auth', null); go('login'); }
    throw new Error(d.error || 'Something went wrong');
  }
  return o.text ? r.text() : r.json();
}
const api = (p, o) => req(p, o);
async function loadInfo() { if (!info) info = await api('/public/info'); }

const SL = { waiting: 'Waiting', arrived: 'Arrived', current: 'In consultation', done: 'Completed', noshow: 'No-show', cancelled: 'Cancelled', hold: 'On hold' };
const pill = s => `<span class="pill ${s}">${SL[s] || s}</span>`;
const fmtTime = iso => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const landing = () => (!auth ? 'login' : auth.user.role === 'reception' ? 'list' : auth.user.role === 'doctor' ? 'next' : 'report');
const pickDoc = () => { if (!info.doctors.find(d => d.id === docId)) docId = (info.doctors[0] || {}).id || ''; };
const docSel = () => info.doctors.length > 1 ? `<select id="doc">${info.doctors.map(d => `<option value="${d.id}" ${d.id === docId ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>` : '';
function bindDoc(cb) { const s = $('#doc'); if (s) s.onchange = () => { docId = s.value; store('cq_doc', docId); cb(); }; }
const poll = (fn, ms) => { clearInterval(timer); timer = setInterval(() => { if (!document.hidden) fn().catch(() => {}); }, ms); };
const busy = async (btn, fn) => { btn.disabled = true; try { await fn(); } catch (e) { toast(e.message, 1); } btn.disabled = false; };

/* ---------- chrome (header + bottom nav) ---------- */
const PATIENT = ['book', 'token', 'queue'];
const STAFF = ['list', 'walkin', 'search', 'next', 'history', 'report', 'settings'];
const TITLES = { book: 'Book a token', token: 'Token confirmed', queue: 'Live queue', login: 'Staff sign in', list: "Today's list", walkin: 'Walk-in entry', search: 'Patient search', next: 'Doctor panel', history: 'Patient history', report: 'Daily report', settings: 'Settings' };
const NAV = {
  reception: [['list', 'Queue', 'list'], ['walkin', 'Walk-in', 'plus'], ['search', 'Search', 'search']],
  doctor: [['next', 'Next', 'play'], ['history', 'History', 'history']],
  owner: [['report', 'Report', 'chart'], ['list', 'Queue', 'list'], ['next', 'Doctor', 'play'], ['settings', 'Settings', 'gear']]
};
function chrome(name) {
  $('#top').hidden = name === 'tv';
  $('#ttl').textContent = TITLES[name] || (info && info.clinicName) || 'Clinic Queue';
  $('#sub').textContent = (info && info.clinicName) || '';
  $('#who').innerHTML = auth && STAFF.includes(name) ? '<button class="out" id="lo">Sign out</button>' : (name ? '<a class="out" href="#/">Home</a>' : '');
  const lo = $('#lo'); if (lo) lo.onclick = () => { auth = null; store('cq_auth', null); go(''); };
  let items = [];
  if (PATIENT.includes(name)) items = [['book', 'Book', 'plus'], ['token', 'My token', 'ticket'], ['queue', 'Live', 'pulse']];
  else if (STAFF.includes(name) && auth) items = NAV[auth.user.role] || [];
  $('#nav').innerHTML = items.map(([k, l, i]) => `<a href="#/${k}" class="${k === name ? 'on' : ''}">${ic(i)}<span>${l}</span></a>`).join('');
}

/* ---------- patient screens ---------- */
async function home() {
  loading(); info = await api('/public/info'); chrome('');
  view(`<section class="hero"><div class="logo">${ic('plus')}</div><p class="eyebrow">Welcome to</p><h1>${esc(info.clinicName)}</h1>
  <p class="sub">Book your token online, follow the queue live and arrive just in time.</p>
  <span class="chip ${info.online ? '' : 'bad'}">${info.online ? 'Online booking open' : 'Online booking closed'} · ${esc(info.opdTiming)}</span></section>
  <a class="btn" href="#/book">Book a token</a>
  <a class="btn ghost" href="#/${auth ? landing() : 'login'}">${auth ? 'Open staff panel' : 'Staff sign in'}</a>
  <a class="btn ghost" href="#/tv">Waiting-room display</a>
  <button class="btn ghost" id="inst" ${deferred ? '' : 'hidden'}>Install app on this phone</button>`);
  $('#inst').onclick = async () => { if (deferred) { deferred.prompt(); await deferred.userChoice; deferred = null; $('#inst').hidden = true; } };
}

async function book() {
  loading(); info = await api('/public/info'); pickDoc(); chrome('book');
  if (!info.online) return view('<div class="card ctr"><h2>Booking is closed</h2><p class="mute">Today’s tokens are full or online booking is switched off. Please visit the clinic reception.</p></div>');
  view(`<p class="mute">${esc(info.clinicName)} · OPD ${esc(info.opdTiming)}</p>
  <form id="f" class="card">
  ${info.doctors.length > 1 ? `<label class="fl">Doctor / OPD</label><select name="doctorId">${info.doctors.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select>` : `<p><b>${esc((info.doctors[0] || {}).name)}</b></p>`}
  <label class="fl">Day</label><div class="seg"><input type="radio" id="d0" name="day" value="today" checked><label for="d0">Today</label><input type="radio" id="d1" name="day" value="tomorrow"><label for="d1">Tomorrow</label></div>
  <label class="fl">Patient name</label><input name="name" required maxlength="60" autocomplete="name" placeholder="Full name">
  <label class="fl">Phone number</label><input name="phone" type="tel" inputmode="numeric" required autocomplete="tel" placeholder="10-digit mobile number">
  <button class="btn" id="sb">Get my token</button></form>`);
  $('#f').onsubmit = e => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.target)); if (!b.doctorId) b.doctorId = (info.doctors[0] || {}).id;
    busy($('#sb'), async () => { const t = await api('/public/tokens', { method: 'POST', body: b }); store('cq_token', t.id); go('token/' + t.id); });
  };
}

async function token(id) {
  id = id || read('cq_token'); chrome('token');
  if (!id) return view('<div class="card ctr"><p class="mute">You have no token yet.</p><a class="btn" href="#/book">Book a token</a></div>');
  const draw = async () => {
    const t = await api('/public/tokens/' + id);
    view(`<div class="card ctr"><p class="eyebrow">Your token</p><div class="num">#${t.number}</div><b>${esc(t.name)}</b><div class="mute">${esc(t.doctorName)} · ${t.isToday ? 'Today' : esc(t.date)}</div>
    ${t.isToday && ['waiting', 'arrived'].includes(t.status) ? `<div class="eta">Estimated time: ${fmtTime(t.etaISO)}</div>` : `<p>${pill(t.status)}</p>`}
    <a class="btn" href="#/queue/${id}">View live queue →</a>
    ${['waiting', 'arrived'].includes(t.status) ? '<button class="btn ghost" id="cx">Cancel token</button>' : ''}</div>`);
    const cx = $('#cx'); if (cx) cx.onclick = () => { if (confirm('Cancel this token?')) busy(cx, async () => { await api('/public/tokens/' + id + '/cancel', { method: 'POST' }); toast('Token cancelled'); draw(); }); };
  };
  await draw();
}

async function queue(id) {
  id = id || read('cq_token'); chrome('queue');
  if (!id) return view('<div class="card ctr"><p class="mute">Book a token to follow the queue.</p><a class="btn" href="#/book">Book a token</a></div>');
  let max = 1;
  const draw = async () => {
    const t = await api('/public/tokens/' + id); max = Math.max(max, t.ahead);
    const state = t.status === 'current' ? 'It’s your turn!' : t.status === 'done' ? 'Visit complete' : ['cancelled', 'noshow'].includes(t.status) ? SL[t.status] : t.ahead + ' ahead of you';
    view(`<div class="card dark ctr"><p class="eyebrow">Now serving</p><div class="num">${t.currentNumber ? '#' + t.currentNumber : '–'}</div></div>
    <div class="card"><div class="row2"><b>Your token: #${t.number}</b><b style="color:var(--brand2)">${state}</b></div>
    <div class="prog"><i style="width:${t.status === 'done' || t.status === 'current' ? 100 : Math.round(100 * (1 - t.ahead / max))}%"></i></div>
    ${['waiting', 'arrived'].includes(t.status) && t.isToday ? `<div class="eta">About ${t.waitMinutes} min · around ${fmtTime(t.etaISO)}</div>` : ''}
    <p class="mute ctr">● Live · updates every 4 seconds</p></div>`);
  };
  await draw(); poll(draw, 4000);
}

/* ---------- staff login ---------- */
async function login() {
  loading(); chrome('login'); const s = await api('/auth/status');
  view(`<div class="card"><div class="logo" style="width:56px;height:56px;border-radius:18px">${ic('plus')}</div>
  <h2 class="ctr">${s.needsSetup ? 'Create owner account' : 'Welcome back'}</h2>
  <p class="mute ctr">${s.needsSetup ? 'First-time setup. This account will manage the clinic.' : 'Sign in with your mobile number and PIN.'}</p>
  <form id="f">${s.needsSetup ? '<label class="fl">Your name</label><input name="name" required>' : ''}
  <label class="fl">Mobile number</label><input name="phone" type="tel" inputmode="numeric" required placeholder="10-digit mobile number">
  <label class="fl">PIN (4–8 digits)</label><input name="pin" type="password" inputmode="numeric" required maxlength="8" placeholder="••••">
  <button class="btn" id="sb">${s.needsSetup ? 'Create account' : 'Sign in'}</button></form></div>`);
  $('#f').onsubmit = e => { e.preventDefault(); busy($('#sb'), async () => { auth = await api(s.needsSetup ? '/auth/setup' : '/auth/login', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); store('cq_auth', JSON.stringify(auth)); go(landing()); }); };
}

/* ---------- reception ---------- */
const rowHtml = t => `<div class="item"><div class="tn">#${t.number}</div><div class="grow"><b>${esc(t.name)}</b><div class="mute">${esc(t.phone)} · ${t.source === 'walkin' ? 'Walk-in' : 'Online'}</div></div>
<div class="end">${pill(t.status)}${['waiting', 'hold'].includes(t.status) ? `<div class="acts"><button data-id="${t._id}" data-s="arrived">Arrived</button><button class="soft" data-id="${t._id}" data-s="noshow">No-show</button></div>` : ''}</div></div>`;

async function list() {
  loading(); info = await api('/public/info'); pickDoc(); chrome('list');
  view(`<div class="bar">${docSel()}<input id="q" class="grow" type="search" placeholder="Name, phone or token"></div><p id="meta" class="mute"></p><div id="rows"></div>`);
  const load = async () => {
    const rows = await api(`/tokens?doctorId=${docId}&q=${encodeURIComponent($('#q').value.trim())}`);
    $('#meta').textContent = `Today · ${rows.length} patient${rows.length === 1 ? '' : 's'}`;
    $('#rows').innerHTML = rows.map(rowHtml).join('') || '<p class="empty">No tokens yet today.</p>';
  };
  let d; $('#q').oninput = () => { clearTimeout(d); d = setTimeout(() => load().catch(e => toast(e.message, 1)), 250); };
  $('#rows').onclick = async e => { const b = e.target.closest('button[data-id]'); if (b) busy(b, async () => { await api(`/tokens/${b.dataset.id}/status`, { method: 'PATCH', body: { status: b.dataset.s } }); await load(); }); };
  bindDoc(load); await load(); poll(load, 5000);
}

async function walkin() {
  loading(); info = await api('/public/info'); pickDoc(); chrome('walkin');
  view(`<form id="f" class="card"><label class="fl">Patient name</label><input name="name" required maxlength="60" placeholder="New patient">
  <label class="fl">Phone number</label><input name="phone" type="tel" inputmode="numeric" required placeholder="10-digit mobile number">
  ${info.doctors.length > 1 ? `<label class="fl">Doctor / OPD</label>${docSel()}` : ''}<button class="btn" id="sb">Create token</button></form><div id="res"></div>`);
  bindDoc(() => {});
  $('#f').onsubmit = e => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.target)); b.doctorId = docId;
    busy($('#sb'), async () => {
      const t = await api('/tokens', { method: 'POST', body: b });
      $('#res').innerHTML = `<div class="card ctr"><p class="eyebrow">New token</p><div class="num">#${t.number}</div><b>${esc(t.name)}</b><div class="mute">${esc(t.doctorName)} · joined the live queue</div><button class="btn ghost" onclick="window.print()">Print slip</button></div>`;
      e.target.reset();
    });
  };
}

async function search() {
  await loadInfo(); chrome('search');
  view('<input id="q" type="search" placeholder="Phone number or name" autofocus><div id="res" style="margin-top:14px"></div>');
  let d; $('#q').oninput = () => { clearTimeout(d); d = setTimeout(async () => {
    try {
      const q = $('#q').value.trim(); const r = await api('/patients/search?q=' + encodeURIComponent(q));
      $('#res').innerHTML = r.map(p => `<a class="item" style="text-decoration:none;color:inherit" href="#/history?phone=${p.phone}"><div class="grow"><b>${esc(p.name)}</b><div class="mute">${esc(p.phone)} · ${p.visits} visit${p.visits === 1 ? '' : 's'} · Last: ${esc(p.lastVisit)}</div></div><span class="mute">›</span></a>`).join('') || (q.length > 1 ? '<p class="empty">No patients found.</p>' : '');
    } catch (e) { toast(e.message, 1); }
  }, 300); };
}

/* ---------- doctor ---------- */
async function next() {
  loading(); info = await api('/public/info'); pickDoc(); chrome('next');
  view(`${docSel() ? `<div class="bar">${docSel()}</div>` : ''}<div class="card ctr" id="cur"></div>
  <div id="nb" hidden><label class="fl">Visit notes and medicine</label><textarea id="notes" rows="3" placeholder="Diagnosis, medicine, advice…"></textarea></div>
  <p id="up" class="mute ctr"></p><button class="btn big" id="nx">Next patient ▶</button><button class="btn ghost" id="hd" hidden>Skip / hold current</button>`);
  let last = null;
  const draw = s => {
    const c = s.current;
    $('#cur').innerHTML = `<p class="eyebrow">Now serving</p>` + (c ? `<div class="num">#${c.number}</div><b>${esc(c.name)}</b><div class="mute">Visit #${s.visits + 1} · ${esc(c.phone)}</div>` : '<div class="num dim">–</div><div class="mute">No patient inside</div>');
    if ((c && c._id) !== last) { $('#notes').value = ''; last = c && c._id; }
    $('#nb').hidden = !c; $('#hd').hidden = !c;
    $('#up').innerHTML = 'Up next: ' + (s.next.map(t => '#' + t.number).join(' · ') || '—') + (s.hold.length ? '<br>On hold: ' + s.hold.map(t => '#' + t.number).join(', ') : '');
  };
  const load = async () => draw(await api('/doctor/state?doctorId=' + docId));
  const act = (btn, hold) => busy(btn, async () => { draw(await api('/doctor/next', { method: 'POST', body: { doctorId: docId, notes: $('#notes').value, hold } })); });
  $('#nx').onclick = () => act($('#nx'), false); $('#hd').onclick = () => act($('#hd'), true);
  bindDoc(() => { last = null; load(); }); await load(); poll(load, 5000);
}

async function history(_, p) {
  await loadInfo(); chrome('history'); let phone = p.get('phone') || '';
  if (!phone && auth.user.role !== 'reception') { try { pickDoc(); const s = await api('/doctor/state?doctorId=' + docId); if (s.current) phone = s.current.phone; } catch (e) {} }
  view(`<div class="bar"><input id="ph" class="grow" type="tel" inputmode="numeric" placeholder="Patient phone number" value="${esc(phone)}"><button class="btn sm" id="go">Show</button></div><div id="tl"></div>`);
  const show = async () => {
    const ph = $('#ph').value.replace(/\D/g, '').slice(-10);
    if (ph.length < 10) { $('#tl').innerHTML = '<p class="empty">Enter a 10-digit phone number.</p>'; return; }
    const h = await api(`/patients/${ph}/history`);
    $('#tl').innerHTML = `<p class="mute">${h.length} completed visit${h.length === 1 ? '' : 's'}</p><div class="timeline">` +
      h.map(v => `<div class="tl"><i></i><div class="card"><div class="mute">${esc(v.date)} · ${esc(v.doctorName)}</div><b>${esc(v.name)}</b><p>${esc(v.notes || 'No notes recorded')}</p></div></div>`).join('') + '</div>';
  };
  $('#go').onclick = () => busy($('#go'), show); if (phone.length === 10) await show();
}

/* ---------- owner ---------- */
async function report() {
  loading(); await loadInfo(); chrome('report');
  const r = await api('/reports/summary'), mx = Math.max(1, ...r.week.map(d => d.count));
  const day = d => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' });
  view(`<div class="stats"><div class="stat"><span class="mute">Patients</span><b>${r.today.total}</b></div><div class="stat"><span class="mute">Avg wait</span><b>${r.today.avgWaitMin}m</b></div><div class="stat"><span class="mute">No-shows</span><b>${r.today.noShow}</b></div></div>
  <div class="stats"><div class="stat"><span class="mute">Completed</span><b>${r.today.done}</b></div><div class="stat"><span class="mute">Waiting</span><b>${r.today.waiting}</b></div><div class="stat"><span class="mute">Limit</span><b>${(await api('/settings')).dailyLimit}</b></div></div>
  <div class="card"><b>Last 7 days</b><div class="chart" style="margin-top:14px">${r.week.map((d, i) => `<div class="${i === 6 ? 't' : ''}" title="${d.count}" style="height:${Math.max(4, 100 * d.count / mx)}%"></div>`).join('')}</div>
  <div class="lbls">${r.week.map((d, i) => `<span>${i === 6 ? 'Today' : day(d.date)}</span>`).join('')}</div></div>
  ${auth.user.role === 'owner' ? '<button class="btn ghost" id="ex">Download last 30 days (CSV)</button>' : ''}`);
  const ex = $('#ex'); if (ex) ex.onclick = () => busy(ex, async () => {
    const t = await req('/reports/export?days=30', { text: true });
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([t], { type: 'text/csv' })); a.download = 'clinic-report.csv'; a.click();
  });
}

async function settings() {
  loading(); await loadInfo(); chrome('settings');
  const [s, u] = await Promise.all([api('/settings'), api('/users')]);
  view(`<div class="card"><div class="row2"><div><b>Online booking</b><div class="mute">Patients can book from their phone</div></div><button class="switch ${s.onlineBooking ? 'on' : ''}" id="sw" aria-label="Toggle online booking"></button></div></div>
  <div class="card"><label class="fl" style="margin-top:0">Clinic name</label><input id="cn" value="${esc(s.clinicName)}">
  <label class="fl">Daily token limit</label><input id="dl" type="number" min="1" value="${s.dailyLimit}">
  <label class="fl">OPD timing</label><input id="ot" value="${esc(s.opdTiming)}">
  <label class="fl">Average minutes per patient</label><input id="mp" type="number" min="1" value="${s.minutesPerPatient}">
  <button class="btn" id="sv">Save changes</button></div>
  <div class="card"><b>Doctors</b>${s.doctors.map(d => `<div class="row2"><span>${esc(d.name)}</span><span><a class="link" href="#/tv?doc=${d._id}">TV</a>${s.doctors.length > 1 ? `<button class="link" data-dd="${d._id}">Remove</button>` : ''}</span></div>`).join('')}
  <div class="bar" style="margin-top:10px"><input id="nd" class="grow" placeholder="Doctor or OPD name"><button class="btn sm" id="ad">Add</button></div></div>
  <div class="card"><b>Staff accounts</b>${u.map(x => `<div class="row2"><span>${esc(x.name)}<div class="mute">${esc(x.phone)} · ${esc(x.role)}</div></span>${x._id === auth.user.id ? '' : `<button class="link" data-du="${x._id}">Remove</button>`}</div>`).join('')}
  <label class="fl">Add staff member</label><input id="un" placeholder="Name"><input id="up" type="tel" inputmode="numeric" placeholder="Mobile number" style="margin-top:8px"><input id="upin" type="password" inputmode="numeric" maxlength="8" placeholder="PIN (4–8 digits)" style="margin-top:8px">
  <select id="ur" style="margin-top:8px"><option value="reception">Reception</option><option value="doctor">Doctor</option><option value="owner">Owner</option></select><button class="btn" id="au">Add staff</button></div>`);
  const again = () => settings();
  $('#sw').onclick = () => busy($('#sw'), async () => { await api('/settings', { method: 'PUT', body: { onlineBooking: !s.onlineBooking } }); again(); });
  $('#sv').onclick = () => busy($('#sv'), async () => { await api('/settings', { method: 'PUT', body: { clinicName: $('#cn').value, dailyLimit: $('#dl').value, opdTiming: $('#ot').value, minutesPerPatient: $('#mp').value } }); toast('Settings saved'); });
  $('#ad').onclick = () => busy($('#ad'), async () => { await api('/settings/doctors', { method: 'POST', body: { name: $('#nd').value } }); again(); });
  $('#au').onclick = () => busy($('#au'), async () => { await api('/users', { method: 'POST', body: { name: $('#un').value, phone: $('#up').value, pin: $('#upin').value, role: $('#ur').value } }); toast('Staff added'); again(); });
  $('#view').onclick = e => {
    const d = e.target.closest('[data-dd]'), x = e.target.closest('[data-du]');
    if (d && confirm('Remove this doctor?')) busy(d, async () => { await api('/settings/doctors/' + d.dataset.dd, { method: 'DELETE' }); again(); });
    if (x && confirm('Remove this staff account?')) busy(x, async () => { await api('/users/' + x.dataset.du, { method: 'DELETE' }); again(); });
  };
}

/* ---------- waiting-room TV ---------- */
async function tv(_, p) {
  info = await api('/public/info'); chrome('tv'); const d = p.get('doc') || (info.doctors[0] || {}).id || '';
  view(`<div class="tv"><a href="#/" class="tvx">Exit</a><div class="tvh">${esc(info.clinicName)} · <span id="td"></span></div>
  <div class="tvb"><div><div class="tvl">NOW SERVING</div><div class="tvn" id="tn">–</div></div><div class="tvq"><div class="tvl">UP NEXT</div><div id="tq"></div></div></div></div>`);
  const load = async () => { const s = await api('/public/display?doctorId=' + d); $('#td').textContent = s.doctorName; $('#tn').textContent = s.current ? '#' + s.current : '–'; $('#tq').innerHTML = s.next.map(n => `<div class="tvi">#${n}</div>`).join(''); };
  await load(); poll(load, 3000);
}

/* ---------- backend connection ---------- */
function connectBackend() {
  chrome('');
  view(`<div class="card"><h2>Connect your backend</h2>
  <p class="mute">Paste the Render service URL for this clinic once. It is saved on this device only.</p>
  <label class="fl">Backend URL</label><input id="apiurl" placeholder="https://your-api.onrender.com" value="${API && !API_BAD ? esc(API) : ''}">
  <button class="btn" id="apisave">Save and reload</button>
  <a class="btn ghost" href="#/">Back to home</a></div>`);
  $('#apisave').onclick = () => {
    let u = $('#apiurl').value.trim().replace(/\/+$/, '');
    if (!u) return toast('Enter the backend URL', 1);
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    store('cq_api', u); location.reload();
  };
}

/* ---------- router ---------- */
const routes = { '': home, book, token, queue, login, list, walkin, search, next, history, report, settings, tv };
function route() {
  clearInterval(timer);
  const [path, qs] = location.hash.slice(2).split('?'); const [name, arg] = path.split('/');
  if (STAFF.includes(name) && !auth) return go('login');
  const fn = routes[name] || home; window.scrollTo(0, 0);
  if (!(name in routes)) return go('');
  fn(arg, new URLSearchParams(qs || '')).catch(e => {
    if (API_BAD) return connectBackend();
    view(`<div class="card ctr"><h2>Something went wrong</h2><p class="mute">${esc(e.message)}</p><button class="btn" onclick="location.reload()">Try again</button></div>`);
  });
}

$('#app').innerHTML = '<header class="top" id="top"><div><b id="ttl"></b><small id="sub"></small></div><div id="who"></div></header><main id="view"></main><nav id="nav"></nav>';
window.addEventListener('hashchange', route);
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
route();
})();
