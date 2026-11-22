// Owner / developer app. Works on iPhone, Android and laptops. Sign-in is with Google;
// only emails on the admin list get in.
import { call, ApiError, isMock } from './api.js';
import * as face from './face.js';
import { $, $$, esc, initials, sheet, toast, ACTION_LABEL, ACTION_PAST, ACTION_ICON, istNow, getPosition } from './ui.js';

const app = $('#app');
const tabbar = $('#tabbar');
const TOKEN_KEY = 'saativkei_id_token';
let me = null;
let pendingCount = 0;

const session = {
  get token() { try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } },
  set token(v) { try { v ? sessionStorage.setItem(TOKEN_KEY, v) : sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } }
};

async function api(action, body = {}) {
  try {
    return await call(action, { ...body, id_token: session.token });
  } catch (e) {
    if (e instanceof ApiError && (e.code === 'AUTH_REQUIRED' || e.code === 'NOT_ADMIN')) {
      session.token = '';
      renderSignIn(e.message);
      throw e;
    }
    throw e;
  }
}

/* ================= Sign in ================= */
function renderSignIn(message = '') {
  tabbar.hidden = true;
  app.innerHTML = `
    <div class="signin">
      <img src="icons/icon.svg" width="72" height="72" alt="">
      <div><h1 style="font-size:24px">Saativkei Owner</h1><p class="muted">Attendance records, fixes and settings</p></div>
      ${message ? `<div class="banner bad">${esc(message)}</div>` : ''}
      <div id="gbtn"></div>
      <p class="muted small" style="max-width:320px">Only the owners and the developer can sign in. Staff and the store manager do not have access.</p>
    </div>`;
  if (isMock()) {
    $('#gbtn').innerHTML = '<button class="btn primary big">Continue in demo mode</button>';
    $('#gbtn button').onclick = () => { session.token = 'demo'; start(); };
    return;
  }
  const cid = window.APP_CONFIG.GOOGLE_CLIENT_ID;
  if (!cid) { $('#gbtn').innerHTML = '<div class="banner warn">GOOGLE_CLIENT_ID is missing in js/config.js</div>'; return; }
  const init = () => {
    google.accounts.id.initialize({ client_id: cid, callback: (r) => { session.token = r.credential; start(); }, auto_select: true, ux_mode: 'popup' });
    google.accounts.id.renderButton($('#gbtn'), { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with' });
    if (!message) google.accounts.id.prompt();
  };
  if (window.google?.accounts?.id) init();
  else {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = init;
    document.head.appendChild(s);
  }
}

/* ================= Shell & routing ================= */
const TABS = [
  { id: 'today', icon: '📋', label: 'Today' },
  { id: 'approvals', icon: '⏳', label: 'Approvals' },
  { id: 'records', icon: '📊', label: 'Records' },
  { id: 'staff', icon: '👥', label: 'Staff' },
  { id: 'setup', icon: '⚙️', label: 'Setup' }
];

function renderTabs(active) {
  tabbar.hidden = false;
  tabbar.innerHTML = `<span class="side-brand">${esc(me?.store_name || 'Saativkei')}<small>Owner</small></span>` + TABS.map((t) => `
    <button class="${t.id === active ? 'active' : ''}" data-tab="${t.id}">
      <span class="ico">${t.icon}</span><span>${t.label}</span>
      ${t.id === 'approvals' && pendingCount ? `<span class="badge">${pendingCount}</span>` : ''}
    </button>`).join('');
  $$('[data-tab]', tabbar).forEach((b) => b.onclick = () => { location.hash = b.dataset.tab; });
}

function route() {
  const h = location.hash.replace(/^#/, '');
  let view = 'today', arg = null;
  if (h.startsWith('day=')) { view = 'today'; arg = h.slice(4); }
  else if (TABS.some((t) => t.id === h)) view = h;
  renderTabs(view);
  window.scrollTo(0, 0);
  const views = { today: viewToday, approvals: viewApprovals, records: viewRecords, staff: viewStaff, setup: viewSetup };
  views[view](arg).catch((e) => {
    if (e instanceof ApiError && (e.code === 'AUTH_REQUIRED' || e.code === 'NOT_ADMIN')) return;
    app.innerHTML = `<div class="banner bad">${esc(e.message)}</div><button class="btn" onclick="location.reload()">Reload</button>`;
  });
}

function loadingView() { app.innerHTML = '<div class="loading"><div class="spinner"></div></div>'; }

function header(title, right = '') {
  return `<div class="topbar"><div class="brand">${esc(title)}${me ? `<small>${esc(me.email)}</small>` : ''}</div>${right}</div>`;
}

async function refreshPending() {
  try { pendingCount = (await api('admin.pending')).pending.length; } catch { /* ignore */ }
  const active = $('.tabbar button.active')?.dataset.tab;
  if (active) renderTabs(active);
}

/* ================= Today / any day ================= */
const FLAG_TEXT = { MISSING_OUT: ['bad', 'No punch OUT'], LATE: ['warn', 'Late'], NEEDS_APPROVAL: ['bad', 'Needs approval'], CORRECTED: ['info', 'Corrected'], LEFT_DURING_BREAK: ['warn', 'Left during break'] };
const STATUS_CHIP = { ABSENT: ['', 'Not in'], IN: ['ok', 'In'], ON_BREAK: ['warn', 'On break'], DONE: ['info', 'Out'] };

function addDays(date, n) {
  const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}

async function viewToday(dateArg) {
  const today = istNow().date;
  const date = dateArg || today;
  loadingView();
  const r = await api('admin.day', { date });
  const emps = r.employees;
  const missingOut = (e) => e.summary.flags.includes('MISSING_OUT');
  const count = (st) => emps.filter((e) => e.summary.status === st && !missingOut(e)).length;
  const attention = emps.filter((e) => e.summary.flags.some((f) => ['MISSING_OUT', 'NEEDS_APPROVAL'].includes(f))).length;
  app.innerHTML = `
    ${header(date === today ? greeting() : 'Day view', `<button class="btn sm" id="reload">↻ Refresh</button>`)}
    <div class="datebar">
      <button class="btn" id="prev" aria-label="Previous day">‹</button>
      <input class="input" type="date" id="date" value="${date}" max="${today}">
      <button class="btn" id="next" aria-label="Next day" ${date >= today ? 'disabled' : ''}>›</button>
    </div>
    <div class="muted small" style="margin:-6px 4px 12px">${esc(r.date_text)}</div>
    ${!r.window.is_open && r.window.reason.includes('closed on') ? `<div class="banner info">Weekly off: the store is closed this day.</div>` : ''}
    <div class="stats">
      <div class="stat ok"><b>${count('IN')}</b><span>${date === today ? 'In the store now' : 'Still in'}</span></div>
      <div class="stat warn"><b>${count('ON_BREAK')}</b><span>On break</span></div>
      <div class="stat info"><b>${count('DONE')}</b><span>Left</span></div>
      <div class="stat"><b>${count('ABSENT')}</b><span>Not in</span></div>
      <div class="stat ${attention ? 'bad' : ''}"><b>${attention}</b><span>Need attention</span></div>
    </div>
    <div class="section-title">Staff</div>
    <div id="emps">${emps.length ? emps.map(empCard).join('') : '<div class="card muted">No staff yet. Add them in the Staff tab.</div>'}</div>
    ${r.corrections.length ? `<div class="section-title">Changes made by owner for this day</div>
      <div class="card">${r.corrections.map((c) => `<div class="list-row"><div class="grow"><b>${esc(c.name)} · ${esc(correctionText(c))}</b><span class="muted small">${esc(c.reason)} · by ${esc(c.by)} · ${esc(c.time)}</span></div></div>`).join('')}</div>` : ''}`;
  $('#prev').onclick = () => { location.hash = 'day=' + addDays(date, -1); };
  $('#next').onclick = () => { location.hash = addDays(date, 1) >= today ? 'today' : 'day=' + addDays(date, 1); };
  $('#date').onchange = (e) => { if (e.target.value) location.hash = e.target.value === today ? 'today' : 'day=' + e.target.value; };
  $('#reload').onclick = () => viewToday(dateArg);
  bindEmpCards(r, date, () => viewToday(dateArg));
  refreshPending();
}

function greeting() {
  const h = Number(istNow().hm.slice(0, 2));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function correctionText(c) {
  const t = (hm) => to12(hm);
  switch (c.type) {
    case 'ADD_PUNCH': return `added ${ACTION_LABEL[c.action] || c.action} at ${t(c.new_value)}`;
    case 'CHANGE_TIME': return `time changed ${t(c.old_value)} → ${t(c.new_value)}`;
    case 'VOID': return `removed punch at ${t(c.old_value)}`;
    case 'APPROVE': return `approved punch at ${t(c.old_value)}`;
    case 'REJECT': return `rejected punch at ${t(c.old_value)}`;
  }
  return c.type;
}

function to12(hm) {
  if (!hm) return '';
  const [h, m] = String(hm).split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function empCard(e) {
  const s = e.summary;
  const [cls, label] = s.flags.includes('MISSING_OUT') ? ['bad', 'No OUT'] : (STATUS_CHIP[s.status] || ['', s.status]);
  const times = s.first_in_text ? `${s.first_in_text} – ${s.last_out_text || '…'}${s.worked_text ? ' · ' + s.worked_text : ''}${s.break_min ? ' · break ' + s.break_min + 'm' : ''}` : 'No punch';
  const open = s.flags.length > 0 || e.attempts.length > 0;
  return `
    <div class="emp-card" data-emp="${esc(e.emp_id)}">
      <button class="emp-head" data-toggle>
        <div class="avatar">${esc(initials(e.name))}</div>
        <div class="info"><b>${esc(e.name)}</b><span>${esc(times)}</span>
          ${s.flags.length ? `<div class="flags">${s.flags.map((f) => `<span class="chip ${(FLAG_TEXT[f] || [''])[0]}">${esc((FLAG_TEXT[f] || [0, f])[1])}</span>`).join('')}</div>` : ''}
        </div>
        <span class="chip ${cls}">${label}</span>
      </button>
      <div class="emp-body" ${open ? '' : 'hidden'}>
        <ul class="timeline">
          ${e.punches.map((p) => `
            <li>
              <span class="t">${esc(p.time)}</span>
              <span class="a">${ACTION_ICON[p.action]} ${esc(ACTION_PAST[p.action])}
                <small>${punchMeta(p)}</small></span>
              ${p.selfie_id ? `<button class="icon-btn" data-photo="${esc(p.selfie_id)}" aria-label="See photo">📷</button>` : ''}
              <button class="icon-btn" data-fix="${esc(p.id)}" aria-label="Fix">✏️</button>
            </li>`).join('')}
          ${e.attempts.map((a) => `
            <li class="failed">
              <span class="t">${esc(a.time)}</span>
              <span class="a">⛔ Not accepted: ${esc(ACTION_LABEL[a.action] || a.action)}<small>${esc(reasonText(a.reason))}${a.distance_m ? ' · ' + esc(a.distance_m) + ' m away' : ''}</small></span>
              ${a.selfie_id ? `<button class="icon-btn" data-photo="${esc(a.selfie_id)}" aria-label="See photo">📷</button>` : ''}
            </li>`).join('')}
          ${!e.punches.length && !e.attempts.length ? '<li class="muted">No punches this day.</li>' : ''}
        </ul>
        <button class="btn sm" data-add style="margin-top:8px">＋ Add missing punch</button>
      </div>
    </div>`;
}

function punchMeta(p) {
  const bits = [];
  if (p.status === 'PENDING') bits.push('⚠️ waiting for approval');
  if (p.status === 'APPROVED') bits.push('approved by owner');
  if (p.source === 'CORRECTION') bits.push('added by owner' + (p.reason ? ': ' + esc(p.reason) : ''));
  else if (p.edited) bits.push('time corrected by owner');
  if (p.method === 'FACE') bits.push('face ✓');
  if (p.distance_m) bits.push(esc(p.distance_m) + ' m from store');
  return bits.join(' · ');
}

function reasonText(code) {
  return ({ FACE_MISMATCH: 'face did not match', OUTSIDE_HOURS: 'outside store hours', AWAY_FROM_STORE: 'away from store', GPS_REQUIRED: 'location off', GPS_WEAK: 'weak GPS', WRONG_ORDER: 'wrong order', TOO_SOON: 'double tap', NOT_ENROLLED: 'face not enrolled', NO_FACE: 'no face in photo', NO_BLINK: 'no blink', NO_PHOTO: 'no photo' })[code] || code;
}

function bindEmpCards(r, date, reload) {
  $$('.emp-card').forEach((card) => {
    const emp = r.employees.find((x) => x.emp_id === card.dataset.emp);
    $('[data-toggle]', card).onclick = () => { const b = $('.emp-body', card); b.hidden = !b.hidden; };
    $$('[data-photo]', card).forEach((b) => b.onclick = () => showPhoto(b.dataset.photo));
    $$('[data-fix]', card).forEach((b) => b.onclick = () => fixPunch(emp, emp.punches.find((p) => p.id === b.dataset.fix), date, reload));
    $('[data-add]', card).onclick = () => correctionForm({ type: 'ADD_PUNCH', emp, date, reload });
  });
}

async function showPhoto(fileId) {
  const s = sheet(`<div class="stack"><div class="photo-frame" id="ph"><div class="spinner"></div></div><button class="btn block" data-close>Close</button></div>`);
  try {
    const r = await api('admin.photo', { file_id: fileId });
    $('#ph', s.el).innerHTML = `<img src="${r.data}" alt="Punch photo">`;
  } catch (e) { $('#ph', s.el).innerHTML = `<div class="muted">${esc(e.message)}</div>`; }
}

function fixPunch(emp, p, date, reload) {
  const s = sheet(`
    <div class="stack">
      <h2>${esc(emp.name)} · ${esc(p.time)}</h2>
      <p class="muted">${ACTION_ICON[p.action]} ${esc(ACTION_PAST[p.action])}. The original record is kept; your change is saved separately with your name and reason.</p>
      ${p.status === 'PENDING' ? `<button class="btn ok block" data-t="APPROVE">✓ Approve this punch</button><button class="btn bad block" data-t="REJECT">✕ Reject this punch</button>` : ''}
      <button class="btn block" data-t="CHANGE_TIME">🕑 Change the time</button>
      <button class="btn block" data-t="VOID">🗑 Remove this punch</button>
      <button class="btn ghost block" data-close>Cancel</button>
    </div>`);
  $$('[data-t]', s.el).forEach((b) => b.onclick = () => {
    s.close();
    if (b.dataset.t === 'APPROVE') return submitCorrection({ type: 'APPROVE', emp_id: emp.emp_id, date, ref_log_id: p.id, reason: '' }, reload);
    correctionForm({ type: b.dataset.t, emp, date, punch: p, reload });
  });
}

function correctionForm({ type, emp, date, punch, reload }) {
  const titles = { ADD_PUNCH: 'Add a missing punch', CHANGE_TIME: 'Change punch time', VOID: 'Remove punch', REJECT: 'Reject punch' };
  const s = sheet(`
    <form class="stack" id="cf">
      <h2>${titles[type]}</h2>
      <div class="muted">${esc(emp.name)} · ${esc(date)}</div>
      ${type === 'ADD_PUNCH' ? `<label class="field"><span>Type</span><select class="input" name="punch">
        ${Object.keys(ACTION_LABEL).map((a) => `<option value="${a}">${ACTION_ICON[a]} ${ACTION_LABEL[a]}</option>`).join('')}</select></label>` : ''}
      ${type === 'ADD_PUNCH' || type === 'CHANGE_TIME' ? `<label class="field"><span>Time</span><input class="input" type="time" name="time" required value="${punch ? esc(punch.hm) : ''}"></label>` : ''}
      <label class="field"><span>Reason (required)</span><textarea class="input" name="reason" required minlength="3" placeholder="e.g. Forgot to punch out, left at 9 PM, confirmed on call"></textarea></label>
      <button class="btn primary block big" type="submit">Save change</button>
      <button class="btn ghost block" type="button" data-close>Cancel</button>
    </form>`);
  $('#cf', s.el).onsubmit = (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    s.close();
    submitCorrection({ type, emp_id: emp.emp_id, date, ref_log_id: punch?.id || '', punch: f.get('punch') || '', time: f.get('time') || '', reason: f.get('reason') }, reload);
  };
}

async function submitCorrection(body, reload) {
  try {
    await api('admin.correct', body);
    toast('Saved ✓');
    reload();
  } catch (e) { toast(e.message, 4000); }
}

/* ================= Approvals ================= */
async function viewApprovals() {
  loadingView();
  const r = await api('admin.pending');
  pendingCount = r.pending.length;
  renderTabs('approvals');
  app.innerHTML = `${header('Approvals')}
    <p class="muted" style="margin-top:0">Punches where the face did not match after several tries. They don't count until you approve them.</p>
    ${r.pending.length ? r.pending.map((p) => `
      <div class="card pending-card" data-id="${esc(p.id)}" style="margin-bottom:12px">
        <div class="photo-frame" data-ph="${esc(p.selfie_id)}"><div class="spinner"></div></div>
        <div class="stack">
          <div><b style="font-size:17px">${esc(p.name)}</b><div class="muted small">${ACTION_ICON[p.action]} ${esc(ACTION_PAST[p.action])} · ${esc(p.time)}<br>${esc(p.date_text)}${p.distance_m ? ' · ' + esc(p.distance_m) + ' m from store' : ''}</div></div>
          <button class="btn ok block" data-approve>✓ Approve</button>
          <button class="btn bad block" data-reject>✕ Reject</button>
        </div>
      </div>`).join('') : '<div class="card center muted" style="padding:32px">🎉 Nothing waiting for approval.</div>'}`;
  r.pending.forEach(async (p) => {
    const card = $(`[data-id="${CSS.escape(p.id)}"]`);
    $('[data-approve]', card).onclick = () => submitCorrection({ type: 'APPROVE', emp_id: p.emp_id, date: p.date, ref_log_id: p.id, reason: '' }, viewApprovals);
    $('[data-reject]', card).onclick = () => correctionForm({ type: 'REJECT', emp: { emp_id: p.emp_id, name: p.name }, date: p.date, punch: { id: p.id }, reload: viewApprovals });
    if (!p.selfie_id) return;
    try { const ph = await api('admin.photo', { file_id: p.selfie_id }); $('[data-ph]', card).innerHTML = `<img src="${ph.data}" alt="">`; }
    catch { $('[data-ph]', card).textContent = 'No photo'; }
  });
}

/* ================= Records ================= */
async function viewRecords() {
  const today = istNow().date;
  const from = sessionStorage.getItem('rec_from') || today.slice(0, 8) + '01';
  const to = sessionStorage.getItem('rec_to') || today;
  app.innerHTML = `${header('Records')}
    <div class="card stack">
      <div class="grid-2">
        <label class="field"><span>From</span><input class="input" type="date" id="from" value="${from}" max="${today}"></label>
        <label class="field"><span>To</span><input class="input" type="date" id="to" value="${to}" max="${today}"></label>
      </div>
      <div class="row wrap">
        <button class="btn primary grow" id="load">Show</button>
        <button class="btn sm" data-preset="this">This month</button>
        <button class="btn sm" data-preset="last">Last month</button>
      </div>
    </div>
    <div id="out"></div>`;
  $$('[data-preset]').forEach((b) => b.onclick = () => {
    const d = new Date(today + 'T12:00:00Z');
    if (b.dataset.preset === 'last') { d.setUTCDate(0); $('#from').value = d.toISOString().slice(0, 8) + '01'; $('#to').value = d.toISOString().slice(0, 10); }
    else { $('#from').value = today.slice(0, 8) + '01'; $('#to').value = today; }
    $('#load').click();
  });
  $('#load').onclick = async () => {
    sessionStorage.setItem('rec_from', $('#from').value); sessionStorage.setItem('rec_to', $('#to').value);
    $('#out').innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    try { renderRecords(await api('admin.range', { from: $('#from').value, to: $('#to').value })); }
    catch (e) { $('#out').innerHTML = `<div class="banner bad">${esc(e.message)}</div>`; }
  };
  $('#load').click();
}

function renderRecords(r) {
  const today = istNow().date;
  const emps = r.days[r.days.length - 1]?.employees.map((e) => ({ emp_id: e.emp_id, name: e.name, since: e.created_on || '' })) || [];
  const totals = emps.map((e) => {
    const t = { ...e, present: 0, absent: 0, minutes: 0, late: 0, missingOut: 0 };
    r.days.forEach((d) => {
      const s = d.employees.find((x) => x.emp_id === e.emp_id)?.summary;
      if (!s) return;
      if (s.status === 'ABSENT') { if (!d.closed && d.date < today && d.date >= e.since) t.absent++; return; }
      t.present++; t.minutes += s.worked_min;
      if (s.flags.includes('LATE')) t.late++;
      if (s.flags.includes('MISSING_OUT')) t.missingOut++;
    });
    return t;
  });
  const hrs = (m) => `${Math.floor(m / 60)}h ${m % 60}m`;
  $('#out').innerHTML = `
    <div class="section-title">Summary</div>
    <div class="table-wrap"><table class="data">
      <thead><tr><th>Name</th><th class="num">Present</th><th class="num">Absent</th><th class="num">Hours</th><th class="num">Late</th><th class="num">No OUT</th></tr></thead>
      <tbody>${totals.map((t) => `<tr><td><b>${esc(t.name)}</b></td><td class="num">${t.present}</td><td class="num">${t.absent}</td><td class="num">${hrs(t.minutes)}</td><td class="num">${t.late}</td><td class="num">${t.missingOut}</td></tr>`).join('')}</tbody>
    </table></div>
    <p class="muted small">Absent counts past working days with no punch, from the day each person was added (weekly off days are skipped). Salary calculation will be added once the owner's rules are confirmed.</p>
    <div class="spread"><div class="section-title" style="margin:16px 4px 10px">Day by day</div><button class="btn sm" id="csv">⬇ Download CSV</button></div>
    <div class="table-wrap"><table class="data">
      <thead><tr><th>Date</th>${emps.map((e) => `<th>${esc(e.name)}</th>`).join('')}</tr></thead>
      <tbody>${r.days.slice().reverse().map((d) => `<tr class="${d.closed ? 'closed' : ''}"><td><a href="#day=${d.date}">${esc(d.date_text.replace(/ \d{4}$/, ''))}</a></td>${emps.map((e) => {
        const s = d.employees.find((x) => x.emp_id === e.emp_id)?.summary;
        if (!s || s.status === 'ABSENT') return `<td class="muted">${d.closed ? 'Off' : d.date > today ? '' : '—'}</td>`;
        const warn = s.flags.some((f) => ['MISSING_OUT', 'NEEDS_APPROVAL'].includes(f));
        return `<td${warn ? ' style="color:var(--bad)"' : ''}>${esc(s.first_in_text)}–${esc(s.last_out_text || '?')}${s.worked_text ? `<br><small class="muted">${esc(s.worked_text)}</small>` : ''}</td>`;
      }).join('')}</tr>`).join('')}</tbody>
    </table></div>`;
  $('#csv').onclick = () => {
    const rows = [['Date', 'Employee ID', 'Name', 'Status', 'In', 'Out', 'Break (min)', 'Worked (min)', 'Worked', 'Flags']];
    r.days.forEach((d) => d.employees.forEach((e) => {
      const s = e.summary;
      rows.push([d.date, e.emp_id, e.name, d.closed && s.status === 'ABSENT' ? 'WEEKLY_OFF' : s.status, s.first_in_text, s.last_out_text, s.break_min, s.worked_min, s.worked_text, s.flags.join(' ')]);
    }));
    const csv = rows.map((row) => row.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `attendance_${r.from}_to_${r.to}.csv`;
    a.click();
  };
}

/* ================= Staff ================= */
async function viewStaff() {
  loadingView();
  const r = await api('admin.employees');
  const list = r.employees.sort((a, b) => (b.active === 'yes') - (a.active === 'yes') || a.name.localeCompare(b.name));
  app.innerHTML = `${header('Staff', '<button class="btn primary sm" id="add">＋ Add</button>')}
    <div class="card">${list.length ? list.map((e) => `
      <div class="list-row" data-emp="${esc(e.emp_id)}" style="cursor:pointer">
        <div class="avatar" style="width:42px;height:42px;font-size:16px">${esc(initials(e.name))}</div>
        <div class="grow"><b>${esc(e.name)}${e.active !== 'yes' ? ' <span class="chip">Inactive</span>' : ''}</b>
          <span class="muted small">${e.role === 'manager' ? 'Store manager' : 'Staff'} · ${e.shift_start ? esc(to12(e.shift_start)) + '–' + esc(to12(e.shift_end)) : 'default shift'}</span>
          <div class="flags">${me.face_check ? (e.face_enrolled_on ? '<span class="chip ok">Face ✓</span>' : '<span class="chip bad">Face not enrolled</span>') : ''}${e.telegram_linked ? '<span class="chip info">Telegram receipts</span>' : ''}</div>
        </div><span class="muted">›</span>
      </div>`).join('') : '<div class="muted">No staff yet. Tap ＋ Add.</div>'}</div>`;
  $('#add').onclick = () => editEmployee(null);
  $$('[data-emp]').forEach((row) => row.onclick = () => editEmployee(list.find((e) => e.emp_id === row.dataset.emp)));
}

function editEmployee(e) {
  const isNew = !e;
  e = e || { role: 'staff', active: 'yes' };
  const s = sheet(`
    <form class="stack" id="ef">
      <h2>${isNew ? 'Add staff member' : esc(e.name)}</h2>
      <label class="field"><span>Full name</span><input class="input" name="name" required value="${esc(e.name || '')}" autocomplete="off"></label>
      <label class="field"><span>Role</span><select class="input" name="role">
        <option value="staff" ${e.role === 'staff' ? 'selected' : ''}>Staff</option>
        <option value="manager" ${e.role === 'manager' ? 'selected' : ''}>Store manager (runs the punch phone)</option></select>
        <small>The manager can only punch people in and out. They can't edit or see records.</small></label>
      <label class="field"><span>Phone</span><input class="input" name="phone" type="tel" value="${esc(e.phone || '')}"></label>
      <label class="field"><span>Monthly salary (₹)</span><input class="input" name="monthly_salary" inputmode="numeric" value="${esc(e.monthly_salary || '')}"></label>
      <div class="grid-2">
        <label class="field"><span>Shift start</span><input class="input" type="time" name="shift_start" value="${esc(e.shift_start || '')}"></label>
        <label class="field"><span>Shift end</span><input class="input" type="time" name="shift_end" value="${esc(e.shift_end || '')}"></label>
      </div>
      <label class="field"><span>Notes</span><input class="input" name="notes" value="${esc(e.notes || '')}"></label>
      ${!isNew ? `<label class="check"><input type="checkbox" name="active" ${e.active === 'yes' ? 'checked' : ''}> Active (shows on the punch phone)</label>` : ''}
      <button class="btn primary block big" type="submit">Save</button>
      ${!isNew ? `
        <div class="section-title">Face check (optional${me.face_check ? '' : ', currently off'})</div>
        <p class="muted small" style="margin:0">${me.face_check ? 'Each punch photo is matched against this face.' : 'Face check is off, so only a photo is taken at each punch. You can still enrol now and turn it on later in Setup.'}</p>
        <button class="btn block" type="button" id="enrol">🙂 ${e.face_enrolled_on ? 'Re-enrol face' : 'Enrol face'}</button>
        ${e.face_enrolled_on ? `<div class="muted small">Enrolled on ${esc(e.face_enrolled_on)}</div>` : ''}
        <div class="section-title">Telegram receipts (optional)</div>
        <p class="muted small" style="margin:0">If ${esc(e.name)} wants a copy of every punch, they install Telegram and open the link below once.</p>
        ${e.telegram_linked ? `<div class="row"><span class="chip info grow">Connected</span><button class="btn sm" type="button" id="tgoff">Turn off</button></div>`
          : `<button class="btn block" type="button" id="tglink">🔗 Create Telegram link</button><div id="tgout"></div>`}` : ''}
      <button class="btn ghost block" type="button" data-close>Close</button>
    </form>`);
  $('#ef', s.el).onsubmit = async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const body = { emp_id: e.emp_id, name: f.get('name'), role: f.get('role'), phone: f.get('phone'), monthly_salary: f.get('monthly_salary'), shift_start: f.get('shift_start'), shift_end: f.get('shift_end'), notes: f.get('notes') };
    if (!isNew) body.active = f.get('active') ? 'yes' : 'no';
    try { await api('admin.employee.save', { employee: body }); toast('Saved ✓'); s.close(); viewStaff(); }
    catch (err) { toast(err.message, 4000); }
  };
  if (isNew) return;
  $('#enrol', s.el).onclick = () => { s.close(); enrolFace(e); };
  $('#tgoff', s.el)?.addEventListener('click', async () => { await api('admin.telegram.unlink', { emp_id: e.emp_id }); toast('Receipts turned off'); s.close(); viewStaff(); });
  $('#tglink', s.el)?.addEventListener('click', async () => {
    try {
      const r = await api('admin.telegram.link', { emp_id: e.emp_id });
      $('#tgout', s.el).innerHTML = `<div class="card stack" style="background:var(--surface-2);box-shadow:none">
        <div class="small">Send this link to ${esc(e.name)}. It works for 30 minutes.</div>
        <input class="input" readonly value="${esc(r.url)}">
        <div class="row"><button class="btn sm grow" type="button" id="share">Share</button><button class="btn sm grow" type="button" id="chk">They pressed Start, check</button></div></div>`;
      $('#share', s.el).onclick = () => navigator.share ? navigator.share({ text: `Get your ${me.store_name} punch receipts on Telegram: ${r.url}` }).catch(() => {}) : navigator.clipboard.writeText(r.url).then(() => toast('Link copied'));
      $('#chk', s.el).onclick = async () => { const c = await api('admin.telegram.check'); toast(c.linked.length ? 'Connected ✓' : 'Not yet. Ask them to press Start in Telegram.'); if (c.linked.length) { s.close(); viewStaff(); } };
    } catch (err) { toast(err.message, 4000); }
  });
}

function enrolFace(e) {
  const NEED = 5;
  const s = sheet(`
    <div class="stack">
      <h2>Enrol face · ${esc(e.name)}</h2>
      <label class="check"><input type="checkbox" id="consent"> ${esc(e.name)} agrees to the face check for attendance only. The face data is deleted when they leave.</label>
      <div class="enroll-video"><video autoplay playsinline muted></video></div>
      <div class="progress"><div id="bar" style="width:0%"></div></div>
      <div class="center" id="msg">Do this at the store with ${esc(e.name)} in good light.</div>
      <button class="btn primary block big" id="go">Start camera</button>
      <button class="btn ghost block" data-close>Cancel</button>
    </div>`, { onClose: () => { stopped = true; face.stopCamera(video); } });
  let stopped = false;
  const video = $('video', s.el);
  $('#go', s.el).onclick = async () => {
    if (!$('#consent', s.el).checked) return toast('Tick the consent box first');
    const go = $('#go', s.el); go.disabled = true; go.textContent = 'Loading face check…';
    try {
      await Promise.all([face.loadModels().catch((err) => { if (!isMock()) throw err; }), face.startCamera(video, { allowSimulated: isMock() })]);
    } catch (err) { go.disabled = false; go.textContent = 'Try again'; return toast(err.message, 4000); }
    if (face.simulated) $('.enroll-video', s.el).insertAdjacentHTML('beforeend', '<div class="fake-video">🙂</div>');
    go.textContent = 'Capturing…';
    const samples = []; let photo = null;
    const msg = $('#msg', s.el);
    const prompts = ['Look straight at the camera', 'Turn your head slightly left', 'Turn your head slightly right', 'Tilt your chin up a little', 'Look straight again'];
    while (!stopped && samples.length < NEED) {
      msg.textContent = prompts[samples.length];
      await new Promise((r) => setTimeout(r, 900));
      const shot = await face.capture(video).catch(() => null);
      if (stopped) return;
      if (!shot || !shot.descriptor) { msg.textContent = shot && shot.faces > 1 ? 'Only one person in the frame please' : 'Face not found, so hold still'; await new Promise((r) => setTimeout(r, 600)); continue; }
      if (samples.length && dist(shot.descriptor, samples[0]) > 0.6) { msg.textContent = 'That looked like a different face. Keep the same person in frame.'; continue; }
      samples.push(shot.descriptor);
      if (!photo) photo = shot.photo;
      $('#bar', s.el).style.width = `${(samples.length / NEED) * 100}%`;
    }
    face.stopCamera(video);
    msg.textContent = 'Saving…';
    try {
      await api('admin.face.enroll', { emp_id: e.emp_id, descriptors: samples, photo, consent: true });
      toast(`${e.name}'s face is enrolled ✓`);
      s.close(); viewStaff();
    } catch (err) { msg.textContent = err.message; go.disabled = false; go.textContent = 'Try again'; }
  };
}
const dist = (a, b) => Math.sqrt(a.reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0));

/* ================= Setup ================= */
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

async function viewSetup() {
  loadingView();
  const [r, d] = await Promise.all([api('admin.settings'), api('admin.devices')]);
  const st = r.settings;
  const closed = String(st.closed_weekdays || '').split(',').map((x) => x.trim());
  const adminUrlDefault = location.href.split('#')[0];
  app.innerHTML = `${header('Setup')}
    <div class="section-title">Telegram alerts</div>
    <div class="card stack">
      ${r.telegram.configured ? `
        <div class="spread"><div>Bot: <b>@${esc(r.telegram.bot)}</b></div><span class="chip ok">Active</span></div>
        <div>${r.telegram.chats.length ? r.telegram.chats.map((c) => `<div class="list-row"><div class="grow"><b>${esc(c.name || 'Chat')}</b><span class="muted small">${esc(c.email)} · since ${esc(c.linked_on)}</span></div><button class="btn sm" data-unlink="${esc(c.chat_id)}">Remove</button></div>`).join('') : '<div class="muted">No one is getting alerts yet.</div>'}</div>
        <button class="btn block" id="tgme">🔗 Connect my Telegram</button>
        <div id="tgmeout"></div>
        <button class="btn block" id="tgtest" ${r.telegram.chats.length ? '' : 'disabled'}>🔔 Send test message</button>
        <details><summary class="small muted">Change bot token</summary><div class="row" style="margin-top:8px"><input class="input grow" id="tgtoken" placeholder="123456:ABC…"><button class="btn" id="tgsave">Save</button></div></details>`
      : `<p class="muted" style="margin:0">Create a free bot: open Telegram → search <b>@BotFather</b> → send <code>/newbot</code> → follow the steps → paste the token here.</p>
        <div class="row"><input class="input grow" id="tgtoken" placeholder="123456:ABC…" autocomplete="off"><button class="btn primary" id="tgsave">Save</button></div>`}
      <p class="muted small" style="margin:0">Every punch (with its photo), every rejected attempt, every fix and settings change is sent here. Nothing is hidden.</p>
    </div>

    <div class="section-title">Punch phones</div>
    <div class="card stack">
      ${d.devices.filter((x) => x.active).map((x) => `<div class="list-row"><div class="grow"><b>📱 ${esc(x.name)}</b><span class="muted small">Added ${esc(x.created_on)} by ${esc(x.created_by)}</span></div><button class="btn sm" data-revoke="${esc(x.device_id)}">Remove</button></div>`).join('') || '<div class="muted">No punch phone yet.</div>'}
      <div class="row"><input class="input grow" id="devname" placeholder="e.g. Rahul's phone"><button class="btn primary" id="paircode">Get code</button></div>
      <div id="codeout"></div>
    </div>

    <div class="section-title">Store, hours & rules</div>
    <form class="card stack" id="sf">
      <label class="field"><span>Store name</span><input class="input" name="store_name" value="${esc(st.store_name)}"></label>
      <div class="field"><span style="display:block;font-size:14px;font-weight:600;color:var(--ink-2);margin-bottom:6px">Store location</span>
        <div class="row"><div class="grow small" id="loc">${st.store_lat ? `📍 ${esc(st.store_lat)}, ${esc(st.store_lng)} · <a target="_blank" rel="noopener" href="https://maps.google.com/?q=${esc(st.store_lat)},${esc(st.store_lng)}">map</a>` : '<span style="color:var(--bad)">Not set. GPS is not being checked.</span>'}</div>
          <button class="btn sm" type="button" id="here">Use my location</button></div>
        <small class="muted">Press this while standing inside the store.</small>
        <input type="hidden" name="store_lat" value="${esc(st.store_lat)}"><input type="hidden" name="store_lng" value="${esc(st.store_lng)}"></div>
      <label class="field"><span>Allowed distance from store (metres)</span><input class="input" name="store_radius_m" inputmode="numeric" value="${esc(st.store_radius_m)}"></label>
      <div class="grid-2">
        <label class="field"><span>Punching opens</span><input class="input" type="time" name="open_time" value="${esc(st.open_time)}"></label>
        <label class="field"><span>Punching closes</span><input class="input" type="time" name="close_time" value="${esc(st.close_time)}"></label>
      </div>
      <div class="field"><span style="display:block;font-size:14px;font-weight:600;color:var(--ink-2);margin-bottom:6px">Weekly off (no punching)</span>
        <div class="row wrap">${DAYS.map((x) => `<label class="chip" style="padding:8px 12px"><input type="checkbox" data-day="${x}" ${closed.includes(x) ? 'checked' : ''}> ${x}</label>`).join('')}</div></div>
      <div class="grid-2">
        <label class="field"><span>Default shift start</span><input class="input" type="time" name="default_shift_start" value="${esc(st.default_shift_start)}"></label>
        <label class="field"><span>Late after (minutes)</span><input class="input" name="late_grace_min" inputmode="numeric" value="${esc(st.late_grace_min)}"></label>
      </div>
      <div class="toggle-row"><div><b>Face check</b><div class="muted small">Off: a photo is taken at each punch. On: the photo must also match the person's enrolled face.</div></div>
        <label class="switch"><input type="checkbox" id="facecheck" ${st.face_check === 'yes' ? 'checked' : ''}><span></span></label></div>
      <div class="grid-2" id="facefields" ${st.face_check === 'yes' ? '' : 'hidden'}>
        <label class="field"><span>Face strictness</span><input class="input" name="face_threshold" inputmode="decimal" value="${esc(st.face_threshold)}"><small>Lower = stricter. 0.45–0.55</small></label>
        <label class="field"><span>Face tries before approval</span><input class="input" name="face_retries" inputmode="numeric" value="${esc(st.face_retries)}"></label>
      </div>
      <label class="field"><span>Owner app link (for Telegram "Fix it")</span><input class="input" name="admin_url" value="${esc(st.admin_url || adminUrlDefault)}"></label>
      <button class="btn primary block big" type="submit">Save settings</button>
    </form>

    <div class="section-title">Admins</div>
    <div class="card stack">
      ${r.admins.map((a) => `<div class="list-row"><div class="grow"><b>${esc(a)}</b>${a === r.me ? '<span class="muted small">you</span>' : ''}</div>${a !== r.me ? `<button class="btn sm" data-rmadmin="${esc(a)}">Remove</button>` : ''}</div>`).join('')}
      <div class="row"><input class="input grow" id="newadmin" type="email" placeholder="owner@gmail.com"><button class="btn" id="addadmin">Add</button></div>
      <p class="muted small" style="margin:0">Admins can see everything and make fixes. Every change is logged with who made it.</p>
    </div>

    <div class="section-title">Proof & data</div>
    <div class="card stack">
      <button class="btn block" id="integrity">🔒 Check records haven't been tampered with</button>
      <div id="intout"></div>
      <div class="row wrap"><a class="btn sm grow" target="_blank" rel="noopener" href="${esc(r.links.sheet)}">Open Google Sheet</a><a class="btn sm grow" target="_blank" rel="noopener" href="${esc(r.links.folder)}">Open Drive folder</a></div>
      <p class="muted small" style="margin:0">Punch selfies are saved in your Google Drive, in "Saativkei Attendance → Selfies", one folder per month.</p>
    </div>
    <button class="btn ghost block" id="signout" style="margin-top:20px">Sign out</button>`;

  // Telegram
  $('#tgsave')?.addEventListener('click', async () => {
    try { const x = await api('admin.telegram.token', { token: $('#tgtoken').value.trim() }); toast(`Bot @${x.bot} connected ✓`); viewSetup(); } catch (e) { toast(e.message, 4000); }
  });
  $('#tgme')?.addEventListener('click', async () => {
    try {
      const x = await api('admin.telegram.link');
      $('#tgmeout').innerHTML = `<div class="stack"><a class="btn primary block" href="${esc(x.url)}" target="_blank" rel="noopener">Open Telegram → press Start</a><button class="btn block" id="tgchk">I pressed Start, check</button></div>`;
      $('#tgchk').onclick = async () => { const c = await api('admin.telegram.check'); if (c.linked.length) { toast('Connected ✓'); viewSetup(); } else toast('Not yet. Press Start in Telegram, then check again.'); };
    } catch (e) { toast(e.message, 4000); }
  });
  $('#tgtest')?.addEventListener('click', async () => { try { await api('admin.telegram.test'); toast('Test sent ✓'); } catch (e) { toast(e.message); } });
  $$('[data-unlink]').forEach((b) => b.onclick = async () => { if (!confirm('Stop sending alerts to this chat?')) return; await api('admin.telegram.unlink', { chat_id: b.dataset.unlink }); viewSetup(); });

  // Devices
  $('#paircode').onclick = async () => {
    const name = $('#devname').value.trim();
    if (!name) return toast('Name the phone first, e.g. "Rahul\'s phone"');
    const x = await api('admin.device.code', { name });
    $('#codeout').innerHTML = `<div class="card" style="background:var(--surface-2);box-shadow:none"><div class="center small muted">On the punch phone, open the punch app and type this code:</div><div class="pair-code">${esc(x.code)}</div><div class="center small muted">Valid for ${x.expires_min} minutes. Works once.</div></div>`;
  };
  $$('[data-revoke]').forEach((b) => b.onclick = async () => { if (!confirm('Remove this phone? It will no longer be able to punch.')) return; await api('admin.device.revoke', { device_id: b.dataset.revoke }); toast('Phone removed'); viewSetup(); });

  // Settings
  $('#facecheck').onchange = (ev) => { $('#facefields').hidden = !ev.target.checked; };
  $('#here').onclick = async () => {
    $('#loc').textContent = 'Getting location…';
    const g = await getPosition(15000);
    if (g.error) { $('#loc').textContent = g.error; return; }
    $('[name=store_lat]').value = g.lat.toFixed(6); $('[name=store_lng]').value = g.lng.toFixed(6);
    $('#loc').innerHTML = `📍 ${g.lat.toFixed(6)}, ${g.lng.toFixed(6)} (±${Math.round(g.accuracy)} m). Press Save.`;
  };
  $('#sf').onsubmit = async (ev) => {
    ev.preventDefault();
    const values = Object.fromEntries(new FormData(ev.target).entries());
    values.closed_weekdays = $$('[data-day]').filter((c) => c.checked).map((c) => c.dataset.day).join(',');
    values.face_check = $('#facecheck').checked ? 'yes' : 'no';
    try { const x = await api('admin.settings.save', { values }); me.face_check = values.face_check === 'yes'; toast(x.changes.length ? 'Settings saved ✓' : 'Nothing changed'); } catch (e) { toast(e.message, 4000); }
  };

  // Admins
  $('#addadmin').onclick = async () => { try { await api('admin.admins.add', { email: $('#newadmin').value }); toast('Admin added ✓'); viewSetup(); } catch (e) { toast(e.message, 4000); } };
  $$('[data-rmadmin]').forEach((b) => b.onclick = async () => { if (!confirm(`Remove ${b.dataset.rmadmin} as admin?`)) return; try { await api('admin.admins.remove', { email: b.dataset.rmadmin }); viewSetup(); } catch (e) { toast(e.message, 4000); } });

  // Integrity
  $('#integrity').onclick = async () => {
    $('#intout').innerHTML = '<div class="spinner"></div>';
    const x = await api('admin.integrity');
    $('#intout').innerHTML = x.results.map((res) => `<div class="banner ${res.ok ? 'ok' : 'bad'}">${res.ok ? '✓' : '✕'} ${esc(res.sheet)}: ${res.ok ? `${res.rows} rows, untouched` : `changed at row ${res.broken_row}. ${esc(res.problem)}`}</div>`).join('');
  };
  $('#signout').onclick = () => { session.token = ''; window.google?.accounts?.id?.disableAutoSelect(); renderSignIn(); };
}

/* ================= Boot ================= */
async function start() {
  if (!session.token) return renderSignIn();
  try {
    me = await api('admin.me');
  } catch (e) {
    if (!(e instanceof ApiError && (e.code === 'AUTH_REQUIRED' || e.code === 'NOT_ADMIN'))) app.innerHTML = `<div class="banner bad">${esc(e.message)}</div>`;
    return;
  }
  route();
}

window.addEventListener('hashchange', () => { if (me) route(); });
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
start();
