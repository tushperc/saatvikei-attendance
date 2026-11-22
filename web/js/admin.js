// Owner / developer app. Works on iPhone, Android and laptops. Sign-in is with Google;
// only emails on the admin list get in.
import { call, ApiError, isMock } from './api.js';
import * as face from './face.js';
import { $, $$, esc, initials, sheet, toast, ACTION_LABEL, ACTION_PAST, istNow, getPosition, hideSplash, ago, snap } from './ui.js';
import { I, LOGO_URL, PHOTOS } from './icons.js';

const app = $('#app');
const tabbar = $('#tabbar');
const TOKEN_KEY = 'saatvikei_id_token';
const SEEN_KEY = 'saatvikei_seen_ts';
let me = null;
let badges = { pending: 0, new_activity: 0 };
let badgeTimer = null;
let currentView = 'today';

const session = {
  get token() { try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } },
  set token(v) { try { v ? sessionStorage.setItem(TOKEN_KEY, v) : sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } }
};
const seen = {
  get() { try { return Number(localStorage.getItem(SEEN_KEY)) || 0; } catch { return 0; } },
  set(v) { try { localStorage.setItem(SEEN_KEY, String(v)); } catch { /* ignore */ } }
};

const ACT_ICON = { IN: I.login, BREAK_OUT: I.coffee, BREAK_IN: I.back, OUT: I.logout };
const ACT_VERB = { IN: 'punched in', BREAK_OUT: 'went on break', BREAK_IN: 'came back from break', OUT: 'punched out' };
const logo = (cls) => `<img class="${cls}" src="${LOGO_URL}" alt="Saatvikei">`;

async function api(action, body = {}) {
  try {
    return await call(action, { ...body, id_token: session.token });
  } catch (e) {
    if (e instanceof ApiError && (e.code === 'AUTH_REQUIRED' || e.code === 'NOT_ADMIN')) {
      session.token = '';
      try { sessionStorage.removeItem('saatvikei_me'); } catch { /* ignore */ }
      renderSignIn(e.message);
    }
    throw e;
  }
}

/* ================= Sign in ================= */
function renderSignIn(message = '') {
  tabbar.hidden = true;
  clearInterval(badgeTimer);
  hideSplash();
  app.innerHTML = `
    <div class="signin">
      <div class="glass signin-card rise">
        <div class="photo" style="background-image:url('${PHOTOS[0]}')"></div>
        <div class="body stack">
          ${logo('logo')}
          <div class="muted small" style="letter-spacing:.22em;text-transform:uppercase">Owner studio</div>
          <p class="muted" style="margin:10px 0 4px">Attendance, photos and fixes, all in one place.</p>
          ${message ? `<div class="banner bad">${I.alert}<span>${esc(message)}</span></div>` : ''}
          <div class="gbtn-wrap" id="gbtn"></div>
          <p class="muted small" style="margin-top:14px">Only the owners and the developer can sign in.</p>
        </div>
      </div>
    </div>`;
  if (isMock()) {
    $('#gbtn').innerHTML = `<button class="btn primary big">${I.sparkle} Continue in demo mode</button>`;
    $('#gbtn button').onclick = () => { session.token = 'demo'; start(); };
    return;
  }
  const cid = window.APP_CONFIG.GOOGLE_CLIENT_ID;
  if (!cid) { $('#gbtn').innerHTML = '<div class="banner warn">GOOGLE_CLIENT_ID is missing in js/config.js</div>'; return; }
  const init = () => {
    google.accounts.id.initialize({ client_id: cid, callback: (r) => { session.token = r.credential; start(); }, auto_select: true, ux_mode: 'popup' });
    google.accounts.id.renderButton($('#gbtn'), { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', logo_alignment: 'left' });
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

/* ================= Shell, tabs & badges ================= */
const TABS = [
  { id: 'today', icon: I.today, label: 'Today' },
  { id: 'approvals', icon: I.approvals, label: 'Approvals' },
  { id: 'records', icon: I.records, label: 'Records' },
  { id: 'staff', icon: I.staff, label: 'Staff' },
  { id: 'setup', icon: I.setup, label: 'Setup' }
];

function tabBadge(id) {
  if (id === 'approvals' && badges.pending) return `<span class="badge tab-badge pulse">${badges.pending}</span>`;
  if (id === 'today' && badges.new_activity && currentView !== 'today') return `<span class="badge tab-badge pulse">${badges.new_activity > 99 ? '99+' : badges.new_activity}</span>`;
  return '';
}

function renderTabs() {
  tabbar.hidden = false;
  tabbar.innerHTML = `<span class="side-brand">${logo('')}<small>Owner studio</small></span>` + TABS.map((t) => `
    <button class="${t.id === currentView ? 'active' : ''}" data-tab="${t.id}" aria-label="${t.label}">
      ${t.icon}<span>${t.label}</span>${tabBadge(t.id)}
    </button>`).join('');
  $$('[data-tab]', tabbar).forEach((b) => b.onclick = () => {
    if (b.dataset.tab === currentView && b.dataset.tab === 'today') return route(true);
    location.hash = b.dataset.tab;
  });
}

async function refreshBadges() {
  try {
    const b = await api('admin.badges', { since: seen.get() });
    const changed = b.pending !== badges.pending || b.new_activity !== badges.new_activity;
    const gotNew = b.new_activity > 0;
    badges = b;
    if (changed) renderTabs();
    // On the Today screen, new punches appear live.
    if (gotNew && currentView === 'today' && !document.querySelector('.overlay') && !location.hash.startsWith('#day=')) viewToday(null, { quiet: true });
  } catch { /* ignore */ }
}

function route(force) {
  const h = location.hash.replace(/^#/, '');
  let view = 'today', arg = null;
  if (h.startsWith('day=')) { view = 'today'; arg = h.slice(4); }
  else if (TABS.some((t) => t.id === h)) view = h;
  currentView = view;
  renderTabs();
  if (!force) window.scrollTo(0, 0);
  const views = { today: viewToday, approvals: viewApprovals, records: viewRecords, staff: viewStaff, setup: viewSetup };
  views[view](arg).catch((e) => {
    if (e instanceof ApiError && (e.code === 'AUTH_REQUIRED' || e.code === 'NOT_ADMIN')) return;
    app.innerHTML = `${head()}<div class="banner bad">${I.alert}<span>${esc(e.message)}</span></div><button class="btn" onclick="location.reload()">${I.refresh} Reload</button>`;
  });
}

function head(right = '') {
  const name = me?.name || me?.email?.split('@')[0] || '';
  return `<div class="a-head">${logo('logo-sm')}<div class="row" style="margin-left:auto">${right}
    <button class="glass me-pill" id="mepill">${esc(name)}<span class="avatar">${esc(initials(name))}</span></button></div></div>`;
}
function bindHead() {
  const b = $('#mepill');
  if (b) b.onclick = () => {
    const s = sheet(`<div class="stack"><div class="row"><div class="avatar">${esc(initials(me.name || me.email))}</div><div class="grow"><b>${esc(me.name || '')}</b><div class="muted small">${esc(me.email)}</div></div></div>
      <button class="btn block" id="so">${I.logout} Sign out</button><button class="btn ghost block" data-close>Close</button></div>`);
    $('#so', s.el).onclick = () => { session.token = ''; try { sessionStorage.removeItem('saatvikei_me'); } catch { /* ignore */ } window.google?.accounts?.id?.disableAutoSelect(); s.close(); renderSignIn(); };
  };
}

function skeleton() {
  app.innerHTML = `${head()}<div class="skeleton" style="height:70px;margin-bottom:14px"></div><div class="skeleton" style="height:220px;margin-bottom:14px"></div><div class="skeleton" style="height:120px"></div>`;
  bindHead();
}

function to12(hm) {
  if (!hm) return '';
  const [h, m] = String(hm).split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}
function addDays(date, n) { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function greeting() { const h = Number(istNow().hm.slice(0, 2)); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }

/* ================= Today ================= */
const FLAG_TEXT = { MISSING_OUT: ['bad', 'No punch out'], LATE: ['warn', 'Late'], NEEDS_APPROVAL: ['bad', 'Needs approval'], CORRECTED: ['info', 'Corrected'], LEFT_DURING_BREAK: ['warn', 'Left during break'] };
const STATUS = { ABSENT: ['', 'Not in'], IN: ['ok', 'In store'], ON_BREAK: ['warn', 'On break'], DONE: ['info', 'Left'] };

async function viewToday(dateArg, { quiet = false } = {}) {
  const today = istNow().date;
  const date = dateArg || today;
  const lastSeen = seen.get();
  const snapKey = 'day_' + date;
  const cachedDay = snap.get(snapKey, 2 * 3600e3);
  if (!quiet) { if (cachedDay) renderDay(cachedDay, date, dateArg, lastSeen, true); else skeleton(); }
  const r = await api('admin.day', { date });
  snap.set(snapKey, r);
  if (currentView !== 'today') return;
  renderDay(r, date, dateArg, lastSeen, false);
}

function renderDay(r, date, dateArg, lastSeen, fromCache) {
  const today = istNow().date;
  if (date === today && !fromCache) { seen.set(Date.now()); badges.new_activity = 0; renderTabs(); }

  const emps = r.employees;
  const missing = (e) => e.summary.flags.includes('MISSING_OUT');
  const count = (st) => emps.filter((e) => e.summary.status === st && !missing(e)).length;
  const active = emps.filter((e) => e.active).length || emps.length;
  const inNow = count('IN') + count('ON_BREAK');
  const cameIn = active - count('ABSENT');
  const isToday = date === today;
  const closedDay = !r.window.is_open && r.window.reason.includes('closed on');

  // Feed: every punch and rejected attempt, newest first
  const feed = [];
  emps.forEach((e) => {
    e.punches.forEach((p) => feed.push({ kind: 'p', e, p, ts: p.ts }));
    e.attempts.forEach((a) => feed.push({ kind: 'a', e, p: a, ts: a.ts }));
  });
  feed.sort((a, b) => b.ts - a.ts);
  const last = feed.find((f) => f.kind === 'p');

  // Needs attention
  const alerts = [];
  emps.forEach((e) => {
    if (missing(e)) alerts.push({ cls: '', icon: I.logout, title: `${e.name} has no punch out`, sub: `In at ${e.summary.first_in_text}`, btn: 'Fix', fn: () => correctionForm({ type: 'ADD_PUNCH', emp: e, date, preset: 'OUT', reload: () => viewToday(dateArg) }) });
    e.punches.filter((p) => p.status === 'PENDING').forEach((p) => alerts.push({ cls: '', icon: I.approvals, title: `${e.name} needs approval`, sub: `${ACTION_PAST[p.action]} at ${p.time}`, btn: 'Review', fn: () => { location.hash = 'approvals'; } }));
    e.attempts.forEach((a) => alerts.push({ cls: 'warn', icon: I.alert, title: `${e.name}: punch not accepted`, sub: `${reasonText(a.reason)} · ${a.time}`, btn: 'Photo', fn: () => a.selfie_id && showPhoto(a.selfie_id) }));
  });

  const ringLen = 2 * Math.PI * 48;
  const pct = active ? (isToday ? inNow : cameIn) / active : 0;
  const photo = PHOTOS[Number(date.slice(8)) % PHOTOS.length];

  // Week strip: the last 7 days up to today (or around the chosen date)
  const anchor = date < addDays(today, -5) ? addDays(date, 3) : today;
  const days = [];
  for (let i = 6; i >= 0; i--) { const d = addDays(anchor, -i); if (d <= today) days.push(d); }
  const wd = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' });

  app.innerHTML = `
    ${head(`<button class="btn icon sm" id="reload" aria-label="Refresh">${I.refresh}</button>`)}
    <div class="hello-block rise">
      <div class="eyebrow">${esc(r.date_text)}</div>
      <h1>${isToday ? greeting() + ',' : 'Looking back,'} <span class="serif">${esc(me.name || 'there')}</span></h1>
    </div>
    <div class="week-strip">
      ${days.map((d) => `<button class="day-pill ${d === date ? 'active' : ''}" data-day="${d}"><small>${d === today ? 'Today' : wd(d)}</small><b>${Number(d.slice(8))}</b></button>`).join('')}
      <label class="day-pill" style="cursor:pointer;position:relative"><span class="cal">${I.calendar}</span><input type="date" id="pick" max="${today}" value="${date}" style="position:absolute;inset:0;opacity:0"></label>
    </div>

    <div class="hero rise" style="animation-delay:60ms">
      <div class="photo" style="background-image:url('${photo}')"></div>
      <div class="hero-top">
        ${closedDay ? `<span class="glass-pill closed">${I.clock} Weekly off</span>`
          : isToday ? (r.window.is_open ? `<span class="glass-pill ok"><i class="live-dot"></i> Store open · until ${esc(to12(r.window.close_time))}</span>` : `<span class="glass-pill closed">${I.clock} ${esc(r.window.reason.replace(' It opens again tomorrow.', ''))}</span>`)
          : `<span class="glass-pill">${I.calendar} Past day</span>`}
      </div>
      <div class="hero-main">
        <div class="ring">
          <svg viewBox="0 0 112 112"><defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f0dcaf"/><stop offset="1" stop-color="#b7cf9f"/></linearGradient></defs>
            <circle class="track" cx="56" cy="56" r="48" fill="none" stroke-width="9"/>
            <circle class="val" id="ringval" cx="56" cy="56" r="48" fill="none" stroke-width="9" stroke-dasharray="${ringLen}" stroke-dashoffset="${ringLen}"/></svg>
          <div class="num"><div><b>${isToday ? inNow : cameIn}</b><span>of ${active}</span></div></div>
        </div>
        <div class="hero-text">
          <h2>${isToday ? (inNow === 1 ? '1 person in the store' : `${inNow} people in the store`) : `${cameIn} came in`}</h2>
          <p>${last ? `Last: ${esc(last.e.name.split(' ')[0])} ${ACT_VERB[last.p.action]} · ${esc(last.p.time)}` : 'No punches yet'}</p>
        </div>
      </div>
      <div class="hero-chips">
        <div class="hero-chip"><b>${count('ON_BREAK')}</b><span>On break</span></div>
        <div class="hero-chip"><b>${count('DONE')}</b><span>Left</span></div>
        <div class="hero-chip"><b>${count('ABSENT')}</b><span>Not in</span></div>
      </div>
    </div>

    ${alerts.length ? `<div class="section-title"><h3>Needs attention <span class="badge" style="position:relative;margin-left:6px">${alerts.length}</span></h3></div>
      ${alerts.map((a, i) => `<div class="alert-card ${a.cls} rise" style="animation-delay:${80 + i * 40}ms"><div class="ico-wrap">${a.icon}</div><div class="grow"><b>${esc(a.title)}</b><span>${esc(a.sub)}</span></div><button class="btn sm" data-alert="${i}">${a.btn}</button></div>`).join('')}` : ''}

    <div class="today-grid">
      <div>
        <div class="section-title"><h3>Team</h3><span class="muted">${emps.length} people</span></div>
        <div class="team-grid">
          ${emps.length ? emps.map((e, i) => memberCard(e, i)).join('') : '<div class="card muted">No staff yet. Add them in the Staff tab.</div>'}
        </div>
      </div>
      <div>
        <div class="section-title"><h3>${isToday ? '<span class="live-dot" style="color:var(--ok);margin-right:8px"></span>Live activity' : 'Activity'}</h3><span class="muted">${feed.length} events</span></div>
        <div class="glass feed">
          ${feed.length ? feed.slice(0, 40).map((f) => feedItem(f, isToday && lastSeen > 0 && f.ts > lastSeen)).join('') : '<div class="muted center" style="padding:28px 0">Nothing yet. Punches will appear here as they happen.</div>'}
        </div>
      </div>
    </div>

    ${r.corrections.length ? `<div class="section-title"><h3>Changes by owners</h3></div>
      <div class="glass feed">${r.corrections.map((c) => `<div class="feed-item"><div class="act" style="background:var(--info-soft);color:var(--info)">${I.edit}</div><div class="txt"><b>${esc(c.name)}</b> · ${esc(correctionText(c))}<small>${esc(c.reason)} · by ${esc(c.by)}</small></div></div>`).join('')}</div>` : ''}
    <div class="ornament" style="margin-top:26px">${I.lotus}</div>`;

  bindHead();
  const strip = $('.week-strip'); if (strip) strip.scrollLeft = strip.scrollWidth;
  requestAnimationFrame(() => setTimeout(() => { const v = $('#ringval'); if (v) v.style.strokeDashoffset = String(ringLen * (1 - pct)); }, 60));
  $('#reload').onclick = () => viewToday(dateArg);
  $$('[data-day]').forEach((b) => b.onclick = () => {
    const target = b.dataset.day === today ? 'today' : 'day=' + b.dataset.day;
    if (location.hash.replace('#', '') === target || (target === 'today' && !location.hash)) viewToday(dateArg); else location.hash = target;
  });
  $('#pick').onchange = (e) => { if (e.target.value) location.hash = e.target.value === today ? 'today' : 'day=' + e.target.value; };
  $$('[data-alert]').forEach((b) => b.onclick = () => alerts[Number(b.dataset.alert)].fn());
  $$('[data-member]').forEach((b) => b.onclick = () => memberSheet(emps.find((x) => x.emp_id === b.dataset.member), date, () => viewToday(dateArg)));
  $$('[data-feedphoto]').forEach((b) => b.onclick = () => showPhoto(b.dataset.feedphoto));
}

function memberCard(e, i) {
  const s = e.summary;
  const miss = s.flags.includes('MISSING_OUT');
  const [cls, label] = miss ? ['bad', 'No punch out'] : (STATUS[s.status] || ['', s.status]);
  const st = miss ? 'MISSING' : s.status === 'ON_BREAK' ? 'BREAK' : s.status;
  return `<div class="glass member rise" style="animation-delay:${100 + Math.min(i, 10) * 35}ms" data-member="${esc(e.emp_id)}">
    <div class="avatar" data-st="${st}">${esc(initials(e.name))}</div>
    <b>${esc(e.name)}</b>
    <span class="times">${s.first_in_text ? `${esc(s.first_in_text)} – ${esc(s.last_out_text || 'now')}` : '—'}</span>
    <span class="chip ${cls}">${s.status === 'IN' && !miss ? '<i class="live-dot"></i>' : ''}${label}</span>
  </div>`;
}

function feedItem(f, isNew) {
  const name = esc(f.e.name);
  const newTag = isNew ? '<span class="new-tag"><i class="live-dot"></i>New</span>' : '';
  if (f.kind === 'a') {
    return `<div class="feed-item"><div class="act FAIL">${I.alert}</div>
      <div class="txt"><b>${name}</b> · not accepted${newTag}<small>${esc(reasonText(f.p.reason))}${f.p.distance_m ? ' · ' + esc(f.p.distance_m) + ' m away' : ''}</small></div>
      <div class="time">${esc(f.p.time)}<small>${ago(f.ts)}</small></div>
      ${f.p.selfie_id ? `<button class="icon-btn" data-feedphoto="${esc(f.p.selfie_id)}" aria-label="Photo">${I.image}</button>` : ''}</div>`;
  }
  const p = f.p;
  const meta = [];
  if (p.status === 'PENDING') meta.push('waiting for approval');
  if (p.source === 'CORRECTION') meta.push('added by owner');
  else if (p.edited) meta.push('time corrected');
  if (p.distance_m) meta.push(`${p.distance_m} m from store`);
  return `<div class="feed-item"><div class="act ${p.action}">${ACT_ICON[p.action]}</div>
    <div class="txt"><b>${name}</b> ${ACT_VERB[p.action]}${newTag}<small>${esc(meta.join(' · ') || 'with photo')}</small></div>
    <div class="time">${esc(p.time)}<small>${ago(f.ts)}</small></div>
    ${p.selfie_id ? `<button class="icon-btn" data-feedphoto="${esc(p.selfie_id)}" aria-label="Photo">${I.image}</button>` : ''}</div>`;
}

function reasonText(code) {
  return ({ FACE_MISMATCH: 'Face did not match', OUTSIDE_HOURS: 'Outside store hours', AWAY_FROM_STORE: 'Away from store', GPS_REQUIRED: 'Location off', GPS_WEAK: 'Weak GPS', WRONG_ORDER: 'Wrong order', TOO_SOON: 'Double tap', NOT_ENROLLED: 'Face not enrolled', NO_FACE: 'No face in photo', NO_BLINK: 'No blink', NO_PHOTO: 'No photo' })[code] || code;
}

function correctionText(c) {
  switch (c.type) {
    case 'ADD_PUNCH': return `added ${(ACTION_LABEL[c.action] || c.action).toLowerCase()} at ${to12(c.new_value)}`;
    case 'CHANGE_TIME': return `time ${to12(c.old_value)} → ${to12(c.new_value)}`;
    case 'VOID': return `removed punch at ${to12(c.old_value)}`;
    case 'APPROVE': return `approved punch at ${to12(c.old_value)}`;
    case 'REJECT': return `rejected punch at ${to12(c.old_value)}`;
  }
  return c.type;
}

function memberSheet(e, date, reload) {
  const s = e.summary;
  const sh = sheet(`
    <div class="stack">
      <div class="row"><div class="avatar" data-st="${s.status === 'ON_BREAK' ? 'BREAK' : s.status}">${esc(initials(e.name))}</div>
        <div class="grow"><h2>${esc(e.name)}</h2><div class="muted small">${s.first_in_text ? `${esc(s.first_in_text)} – ${esc(s.last_out_text || 'now')}${s.worked_text ? ' · ' + esc(s.worked_text) : ''}${s.break_min ? ' · break ' + s.break_min + 'm' : ''}` : 'No punch this day'}</div></div></div>
      ${s.flags.length ? `<div class="flags">${s.flags.map((f) => `<span class="chip ${(FLAG_TEXT[f] || [''])[0]}">${esc((FLAG_TEXT[f] || [0, f])[1])}</span>`).join('')}</div>` : ''}
      <div class="glass" style="padding:4px 16px">
        <ul class="timeline">
          ${e.punches.map((p) => `<li><span class="t">${esc(p.time)}</span><span class="a">${esc(ACTION_PAST[p.action])}<small>${p.status === 'PENDING' ? 'Waiting for approval' : p.source === 'CORRECTION' ? 'Added by owner' + (p.reason ? ': ' + esc(p.reason) : '') : p.edited ? 'Time corrected by owner' : (p.distance_m ? esc(p.distance_m) + ' m from store' : 'With photo')}</small></span>
            ${p.selfie_id ? `<button class="icon-btn" data-photo="${esc(p.selfie_id)}" aria-label="Photo">${I.image}</button>` : ''}
            <button class="icon-btn" data-fix="${esc(p.id)}" aria-label="Fix">${I.edit}</button></li>`).join('')}
          ${e.attempts.map((a) => `<li class="failed"><span class="t">${esc(a.time)}</span><span class="a">Not accepted<small>${esc(reasonText(a.reason))}</small></span>${a.selfie_id ? `<button class="icon-btn" data-photo="${esc(a.selfie_id)}">${I.image}</button>` : ''}</li>`).join('')}
          ${!e.punches.length && !e.attempts.length ? '<li class="muted">No punches this day.</li>' : ''}
        </ul>
      </div>
      <button class="btn block" id="addp">${I.plus} Add a missing punch</button>
      <button class="btn ghost block" data-close>Close</button>
    </div>`);
  $$('[data-photo]', sh.el).forEach((b) => b.onclick = () => showPhoto(b.dataset.photo));
  $$('[data-fix]', sh.el).forEach((b) => b.onclick = () => { sh.close(); fixPunch(e, e.punches.find((p) => p.id === b.dataset.fix), date, reload); });
  $('#addp', sh.el).onclick = () => { sh.close(); correctionForm({ type: 'ADD_PUNCH', emp: e, date, reload }); };
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
      <p class="muted small" style="margin:4px 0 0">${esc(ACTION_PAST[p.action])}. The original record is kept. Your change is saved separately with your name and reason, and sent on Telegram.</p>
      ${p.status === 'PENDING' ? `<button class="btn ok block" data-t="APPROVE">${I.check} Approve this punch</button><button class="btn wine block" data-t="REJECT">${I.x} Reject this punch</button>` : ''}
      <button class="btn block" data-t="CHANGE_TIME">${I.clock} Change the time</button>
      <button class="btn block" data-t="VOID">${I.trash} Remove this punch</button>
      <button class="btn ghost block" data-close>Cancel</button>
    </div>`);
  $$('[data-t]', s.el).forEach((b) => b.onclick = () => {
    s.close();
    if (b.dataset.t === 'APPROVE') return submitCorrection({ type: 'APPROVE', emp_id: emp.emp_id, date, ref_log_id: p.id, reason: '' }, reload);
    correctionForm({ type: b.dataset.t, emp, date, punch: p, reload });
  });
}

function correctionForm({ type, emp, date, punch, reload, preset }) {
  const titles = { ADD_PUNCH: 'Add a missing punch', CHANGE_TIME: 'Change punch time', VOID: 'Remove punch', REJECT: 'Reject punch' };
  const s = sheet(`
    <form class="stack" id="cf">
      <h2>${titles[type]}</h2>
      <div class="muted small">${esc(emp.name)} · ${esc(date)}</div>
      ${type === 'ADD_PUNCH' ? `<label class="field"><span>Type</span><select class="input" name="punch">
        ${Object.keys(ACTION_LABEL).map((a) => `<option value="${a}" ${preset === a ? 'selected' : ''}>${ACTION_LABEL[a]}</option>`).join('')}</select></label>` : ''}
      ${type === 'ADD_PUNCH' || type === 'CHANGE_TIME' ? `<label class="field"><span>Time</span><input class="input" type="time" name="time" required value="${punch?.hm ? esc(punch.hm) : ''}"></label>` : ''}
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
    toast('Saved');
    reload();
    refreshBadges();
  } catch (e) { toast(e.message, 4000); }
}

/* ================= Approvals ================= */
async function viewApprovals() {
  skeleton();
  const r = await api('admin.pending');
  badges.pending = r.pending.length;
  renderTabs();
  app.innerHTML = `${head()}
    <h1 class="page-title">Approvals</h1>
    <p class="page-sub">Punches where the face did not match after several tries. They don't count until you approve them.</p>
    ${r.pending.length ? r.pending.map((p, i) => `
      <div class="glass pending-card rise" style="animation-delay:${i * 50}ms" data-id="${esc(p.id)}">
        <div class="photo-frame" data-ph="${esc(p.selfie_id)}"><div class="spinner"></div></div>
        <div class="stack">
          <div><b style="font-size:16px">${esc(p.name)}</b><div class="muted small">${esc(ACTION_PAST[p.action])} · ${esc(p.time)}<br>${esc(p.date_text)}${p.distance_m ? ' · ' + esc(p.distance_m) + ' m from store' : ''}</div></div>
          <button class="btn ok block" data-approve>${I.check} Approve</button>
          <button class="btn wine block" data-reject>${I.x} Reject</button>
        </div>
      </div>`).join('') : `<div class="card center rise" style="padding:36px 20px"><div class="ornament">${I.lotus}</div><h2 style="margin-top:8px">All clear</h2><p class="muted">Nothing is waiting for approval.</p></div>`}`;
  bindHead();
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
  const thisFrom = today.slice(0, 8) + '01';
  const lm = new Date(today + 'T12:00:00Z'); lm.setUTCDate(0);
  const lastTo = lm.toISOString().slice(0, 10), lastFrom = lastTo.slice(0, 8) + '01';
  let mode = sessionStorage.getItem('rec_mode') || 'this';
  app.innerHTML = `${head()}
    <h1 class="page-title">Records</h1>
    <p class="page-sub">Attendance by person, ready for salary.</p>
    <div class="glass segmented">
      <button data-mode="this">This month</button><button data-mode="last">Last month</button><button data-mode="custom">Custom</button>
    </div>
    <div class="glass card grid-2" id="custom" style="margin-bottom:14px" hidden>
      <label class="field"><span>From</span><input class="input" type="date" id="from" value="${sessionStorage.getItem('rec_from') || thisFrom}" max="${today}"></label>
      <label class="field"><span>To</span><input class="input" type="date" id="to" value="${sessionStorage.getItem('rec_to') || today}" max="${today}"></label>
    </div>
    <div id="out"></div>`;
  bindHead();
  const load = async () => {
    $$('[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    $('#custom').hidden = mode !== 'custom';
    sessionStorage.setItem('rec_mode', mode);
    const from = mode === 'this' ? thisFrom : mode === 'last' ? lastFrom : $('#from').value;
    const to = mode === 'this' ? today : mode === 'last' ? lastTo : $('#to').value;
    if (mode === 'custom') { sessionStorage.setItem('rec_from', from); sessionStorage.setItem('rec_to', to); }
    $('#out').innerHTML = '<div class="skeleton" style="height:150px;margin-bottom:10px"></div><div class="skeleton" style="height:150px"></div>';
    try { renderRecords(await api('admin.range', { from, to })); }
    catch (e) { $('#out').innerHTML = `<div class="banner bad">${I.alert}<span>${esc(e.message)}</span></div>`; }
  };
  $$('[data-mode]').forEach((b) => b.onclick = () => { mode = b.dataset.mode; load(); });
  $('#from').onchange = load; $('#to').onchange = load;
  load();
}

function renderRecords(r) {
  const today = istNow().date;
  const emps = r.days[r.days.length - 1]?.employees.map((e) => ({ emp_id: e.emp_id, name: e.name, since: e.created_on || '' })) || [];
  const totals = emps.map((e) => {
    const t = { ...e, present: 0, absent: 0, minutes: 0, late: 0, missingOut: 0, cells: [] };
    r.days.forEach((d) => {
      const s = d.employees.find((x) => x.emp_id === e.emp_id)?.summary;
      let c = '';
      if (d.date > today || d.date < e.since) c = 'f';
      else if (d.closed && (!s || s.status === 'ABSENT')) c = 'o';
      else if (!s || s.status === 'ABSENT') { if (d.date < today) t.absent++; }
      else {
        t.present++; t.minutes += s.worked_min;
        if (s.flags.includes('MISSING_OUT')) { t.missingOut++; c = 'm'; }
        else if (s.flags.includes('LATE')) { t.late++; c = 'l'; }
        else c = 'p';
      }
      t.cells.push(`<i class="${c}" title="${esc(d.date_text)}"></i>`);
    });
    return t;
  });
  const hrs = (m) => `${Math.floor(m / 60)}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}`;
  $('#out').innerHTML = `
    ${totals.map((t, i) => `<div class="glass rec-card rise" style="animation-delay:${i * 40}ms">
      <div class="top"><div class="avatar sm">${esc(initials(t.name))}</div><div class="grow"><b>${esc(t.name)}</b><div class="muted small">${hrs(t.minutes)} worked</div></div></div>
      <div class="nums"><div><b>${t.present}</b><span>Present</span></div><div><b>${t.absent}</b><span>Absent</span></div><div><b>${t.late}</b><span>Late</span></div><div><b style="${t.missingOut ? 'color:var(--bad)' : ''}">${t.missingOut}</b><span>No out</span></div></div>
      <div class="heat">${t.cells.join('')}</div>
    </div>`).join('') || '<div class="card muted">No staff yet.</div>'}
    <div class="legend"><span><i style="background:var(--sage)"></i>Present</span><span><i style="background:var(--gold)"></i>Late</span><span><i style="background:var(--bad)"></i>No punch out</span><span><i style="background:rgba(60,40,30,.07)"></i>Absent</span><span><i style="border:1px dashed rgba(60,40,30,.25)"></i>Weekly off</span></div>
    <p class="muted small">Absent counts past working days with no punch, from the day each person was added. Salary will be added once the owner's rules are confirmed.</p>
    <div class="section-title"><h3>Day by day</h3><button class="btn sm" id="csv">${I.download} Download CSV</button></div>
    <div class="glass table-wrap"><table class="data">
      <thead><tr><th>Date</th>${emps.map((e) => `<th>${esc(e.name.split(' ')[0])}</th>`).join('')}</tr></thead>
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
    a.download = `saatvikei_attendance_${r.from}_to_${r.to}.csv`;
    a.click();
  };
}

/* ================= Staff ================= */
async function viewStaff() {
  skeleton();
  const r = await api('admin.employees');
  const list = r.employees.sort((a, b) => (b.active === 'yes') - (a.active === 'yes') || a.name.localeCompare(b.name));
  app.innerHTML = `${head()}
    <div class="spread"><h1 class="page-title">Staff</h1><button class="btn primary sm" id="add">${I.plus} Add</button></div>
    <p class="page-sub">${list.filter((e) => e.active === 'yes').length} active · tap someone to edit</p>
    <div class="glass" style="padding:4px 16px">${list.length ? list.map((e, i) => `
      <div class="list-row rise" style="animation-delay:${i * 35}ms;cursor:pointer" data-emp="${esc(e.emp_id)}">
        <div class="avatar sm">${esc(initials(e.name))}</div>
        <div class="grow"><b>${esc(e.name)}</b>
          <div class="flags" style="margin-top:3px">
            <span class="chip ${e.role === 'manager' ? 'wine' : ''}">${e.role === 'manager' ? 'Store manager' : 'Staff'}</span>
            ${e.active !== 'yes' ? '<span class="chip">Inactive</span>' : ''}
            ${me.face_check ? (e.face_enrolled_on ? '<span class="chip ok">Face enrolled</span>' : '<span class="chip bad">Face not enrolled</span>') : ''}
            ${e.telegram_linked ? '<span class="chip info">Telegram receipts</span>' : ''}
          </div>
        </div><span class="muted">${I.right}</span>
      </div>`).join('') : '<div class="muted" style="padding:20px 0">No staff yet. Tap Add.</div>'}</div>`;
  bindHead();
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
      ${!isNew ? `<div class="toggle-row"><span>Active (shows on the punch phone)</span><label class="switch"><input type="checkbox" name="active" ${e.active === 'yes' ? 'checked' : ''}><span></span></label></div>` : ''}
      <button class="btn primary block big" type="submit">Save</button>
      ${!isNew ? `
        <div class="divider"><i class="diamond"></i><span>Telegram receipts</span><i class="diamond"></i></div>
        <p class="muted small" style="margin:0">Optional. If ${esc(e.name)} wants a copy of every punch, they install Telegram and open this link once.</p>
        ${e.telegram_linked ? `<div class="row"><span class="chip info grow">${I.telegram} Connected</span><button class="btn sm" type="button" id="tgoff">Turn off</button></div>`
          : `<button class="btn block" type="button" id="tglink">${I.telegram} Create Telegram link</button><div id="tgout"></div>`}
        <div class="divider"><i class="diamond"></i><span>Face check (optional${me.face_check ? '' : ', off'})</span><i class="diamond"></i></div>
        <p class="muted small" style="margin:0">${me.face_check ? 'Each punch photo is matched against this face.' : 'Face check is off, so only a photo is taken at each punch. You can enrol now and turn it on later in Setup.'}</p>
        <button class="btn block" type="button" id="enrol">${I.user} ${e.face_enrolled_on ? 'Re-enrol face' : 'Enrol face'}</button>
        <div class="divider"><i class="diamond"></i><span>Remove</span><i class="diamond"></i></div>
        <p class="muted small" style="margin:0">For test or mistaken entries. If someone has left the job, turn off <b>Active</b> above instead, which keeps them in Records for salary.</p>
        <button class="btn block" type="button" id="remove" style="color:var(--bad)">${I.trash} Remove ${esc(e.name)}</button>` : ''}
      <button class="btn ghost block" type="button" data-close>Close</button>
    </form>`);
  $('#ef', s.el).onsubmit = async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const body = { emp_id: e.emp_id, name: f.get('name'), role: f.get('role'), phone: f.get('phone'), monthly_salary: f.get('monthly_salary'), shift_start: f.get('shift_start'), shift_end: f.get('shift_end'), notes: f.get('notes') };
    if (!isNew) body.active = f.get('active') ? 'yes' : 'no';
    try { await api('admin.employee.save', { employee: body }); toast('Saved'); s.close(); viewStaff(); }
    catch (err) { toast(err.message, 4000); }
  };
  if (isNew) return;
  $('#enrol', s.el).onclick = () => { s.close(); enrolFace(e); };
  $('#remove', s.el).onclick = () => { s.close(); confirmRemove(e); };
  $('#tgoff', s.el)?.addEventListener('click', async () => { await api('admin.telegram.unlink', { emp_id: e.emp_id }); toast('Receipts turned off'); s.close(); viewStaff(); });
  $('#tglink', s.el)?.addEventListener('click', async () => {
    try {
      const r = await api('admin.telegram.link', { emp_id: e.emp_id });
      $('#tgout', s.el).innerHTML = `<div class="glass stack" style="padding:14px">
        <div class="small">Send this link to ${esc(e.name)}. It works for 30 minutes.</div>
        <input class="input" readonly value="${esc(r.url)}">
        <div class="row"><button class="btn sm grow" type="button" id="share">${I.link} Share</button><button class="btn sm grow" type="button" id="chk">${I.check} Check</button></div></div>`;
      $('#share', s.el).onclick = () => navigator.share ? navigator.share({ text: `Get your ${me.store_name} punch receipts on Telegram: ${r.url}` }).catch(() => {}) : navigator.clipboard.writeText(r.url).then(() => toast('Link copied'));
      $('#chk', s.el).onclick = async () => { const c = await api('admin.telegram.check'); toast(c.linked.length ? 'Connected' : 'Not yet. Ask them to press Start in Telegram.'); if (c.linked.length) { s.close(); viewStaff(); } };
    } catch (err) { toast(err.message, 4000); }
  });
}

function confirmRemove(e) {
  const s = sheet(`
    <div class="stack">
      <div class="center"><div class="avatar" style="margin:0 auto 10px;color:var(--bad)">${I.trash}</div><h2>Remove ${esc(e.name)}?</h2></div>
      <p class="muted small center" style="margin:0">They will disappear from the punch phone, Today, Records and Staff.<br>
        If they ever punched, those punches stay in the Google Sheet as proof (they can't be erased), but are hidden here.</p>
      <label class="field"><span>Type <b>${esc(e.name.split(' ')[0])}</b> to confirm</span><input class="input" id="confirmname" autocomplete="off"></label>
      <button class="btn bad block big" id="yes" disabled>${I.trash} Remove</button>
      <button class="btn ghost block" data-close>Cancel</button>
    </div>`);
  const want = e.name.split(' ')[0].toLowerCase();
  $('#confirmname', s.el).oninput = (ev) => { $('#yes', s.el).disabled = ev.target.value.trim().toLowerCase() !== want; };
  $('#yes', s.el).onclick = async () => {
    $('#yes', s.el).disabled = true;
    try {
      const r = await api('admin.employee.remove', { emp_id: e.emp_id });
      toast(r.mode === 'deleted' ? `${e.name} removed` : `${e.name} removed (past punches kept as proof)`, 4000);
      s.close(); viewStaff();
    } catch (err) { toast(err.message, 4000); $('#yes', s.el).disabled = false; }
  };
}

function enrolFace(e) {
  const NEED = 5;
  let stopped = false;
  let video;
  const s = sheet(`
    <div class="stack">
      <h2>Enrol face · ${esc(e.name)}</h2>
      <label class="check"><input type="checkbox" id="consent"> ${esc(e.name)} agrees to the face check for attendance only. The face data is deleted when they leave.</label>
      <div class="enroll-video"><video autoplay playsinline muted></video></div>
      <div class="progress"><div id="bar" style="width:0%"></div></div>
      <div class="center small" id="msg">Do this at the store with ${esc(e.name)} in good light.</div>
      <button class="btn primary block big" id="go">${I.camera} Start camera</button>
      <button class="btn ghost block" data-close>Cancel</button>
    </div>`, { onClose: () => { stopped = true; face.stopCamera(video); } });
  video = $('video', s.el);
  $('#go', s.el).onclick = async () => {
    if (!$('#consent', s.el).checked) return toast('Tick the consent box first');
    const go = $('#go', s.el); go.disabled = true; go.textContent = 'Loading face check…';
    try {
      await Promise.all([face.loadModels().catch((err) => { if (!isMock()) throw err; }), face.startCamera(video, { allowSimulated: isMock() })]);
    } catch (err) { go.disabled = false; go.textContent = 'Try again'; return toast(err.message, 4000); }
    if (face.simulated) $('.enroll-video', s.el).insertAdjacentHTML('beforeend', `<div class="fake-video">${I.user}</div>`);
    go.textContent = 'Capturing…';
    const samples = []; let photo = null;
    const msg = $('#msg', s.el);
    const prompts = ['Look straight at the camera', 'Turn your head slightly left', 'Turn your head slightly right', 'Tilt your chin up a little', 'Look straight again'];
    while (!stopped && samples.length < NEED) {
      msg.textContent = prompts[samples.length];
      await new Promise((r) => setTimeout(r, 900));
      const shot = await face.capture(video).catch(() => null);
      if (stopped) return;
      if (!shot || !shot.descriptor) { msg.textContent = shot && shot.faces > 1 ? 'Only one person in the frame please' : 'Face not found, hold still'; await new Promise((r) => setTimeout(r, 600)); continue; }
      if (samples.length && dist(shot.descriptor, samples[0]) > 0.6) { msg.textContent = 'That looked like a different face. Keep the same person in frame.'; continue; }
      samples.push(shot.descriptor);
      if (!photo) photo = shot.photo;
      $('#bar', s.el).style.width = `${(samples.length / NEED) * 100}%`;
    }
    face.stopCamera(video);
    msg.textContent = 'Saving…';
    try {
      await api('admin.face.enroll', { emp_id: e.emp_id, descriptors: samples, photo, consent: true });
      toast(`${e.name}'s face is enrolled`);
      s.close(); viewStaff();
    } catch (err) { msg.textContent = err.message; go.disabled = false; go.textContent = 'Try again'; }
  };
}
const dist = (a, b) => Math.sqrt(a.reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0));

/* ================= Setup ================= */
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const setHead = (icon, title, sub) => `<div class="set-head"><div class="ico-wrap">${icon}</div><div><h3>${title}</h3>${sub ? `<p>${sub}</p>` : ''}</div></div>`;

async function viewSetup() {
  skeleton();
  const [r, d] = await Promise.all([api('admin.settings'), api('admin.devices')]);
  const st = r.settings;
  const closed = String(st.closed_weekdays || '').split(',').map((x) => x.trim());
  const adminUrlDefault = location.href.split('#')[0].split('?')[0];
  app.innerHTML = `${head()}
    <h1 class="page-title">Setup</h1>
    <p class="page-sub">Alerts, phones, store hours and access.</p>

    <div class="glass card stack rise">
      ${setHead(I.telegram, 'Telegram alerts', 'Every punch with its photo, every rejected attempt and every change.')}
      ${r.telegram.configured ? `
        <div class="spread"><div class="small">Bot <b>@${esc(r.telegram.bot)}</b></div><span class="chip ok"><i class="live-dot"></i>Active</span></div>
        <div>${r.telegram.chats.length ? r.telegram.chats.map((c) => `<div class="list-row"><div class="avatar sm">${esc(initials(c.name || 'T'))}</div><div class="grow"><b>${esc(c.name || 'Chat')}</b><span class="muted small">${esc(c.email)} · since ${esc(c.linked_on)}</span></div><button class="btn sm" data-unlink="${esc(c.chat_id)}">Remove</button></div>`).join('') : '<div class="muted small">No one is getting alerts yet.</div>'}</div>
        <div class="row wrap"><button class="btn grow" id="tgme">${I.link} Connect my Telegram</button><button class="btn grow" id="tgtest" ${r.telegram.chats.length ? '' : 'disabled'}>${I.bell} Send test</button></div>
        <div id="tgmeout"></div>
        <details><summary class="small muted">Change bot token</summary><div class="row" style="margin-top:8px"><input class="input grow" id="tgtoken" placeholder="123456:ABC…"><button class="btn" id="tgsave">Save</button></div></details>`
      : `<p class="muted small" style="margin:0">Create a free bot: open Telegram, search <b>@BotFather</b>, send <code>/newbot</code>, follow the steps, then paste the token here.</p>
        <div class="row"><input class="input grow" id="tgtoken" placeholder="123456:ABC…" autocomplete="off"><button class="btn primary" id="tgsave">Save</button></div>`}
    </div>

    <div class="glass card stack rise" style="margin-top:14px;animation-delay:50ms">
      ${setHead(I.phone, 'Punch phones', 'Only these phones can punch.')}
      ${d.devices.filter((x) => x.active).map((x) => `<div class="list-row"><div class="avatar sm" style="color:var(--sage-deep)">${I.phone}</div><div class="grow"><b>${esc(x.name)}</b><span class="muted small">Added ${esc(x.created_on)} by ${esc(x.created_by)}</span></div><button class="btn sm" data-revoke="${esc(x.device_id)}">Remove</button></div>`).join('') || '<div class="muted small">No punch phone yet.</div>'}
      <div class="row"><input class="input grow" id="devname" placeholder="e.g. Rahul's phone"><button class="btn primary" id="paircode">Get code</button></div>
      <div id="codeout"></div>
    </div>

    <form class="glass card stack rise" id="sf" style="margin-top:14px;animation-delay:100ms">
      ${setHead(I.clock, 'Store, hours & rules', 'When and where punching works.')}
      <label class="field"><span>Store name</span><input class="input" name="store_name" value="${esc(st.store_name)}"></label>
      <div class="field"><span class="field-label">Store location</span>
        <div class="row"><div class="grow small" id="loc">${st.store_lat ? `${I.pin} ${esc(st.store_lat)}, ${esc(st.store_lng)} · <a target="_blank" rel="noopener" href="https://maps.google.com/?q=${esc(st.store_lat)},${esc(st.store_lng)}">map</a>` : '<span style="color:var(--bad)">Not set, so GPS is not checked.</span>'}</div>
          <button class="btn sm" type="button" id="here">${I.pin} Use my location</button></div>
        <small class="muted">Press this while standing inside the store.</small>
        <input type="hidden" name="store_lat" value="${esc(st.store_lat)}"><input type="hidden" name="store_lng" value="${esc(st.store_lng)}"></div>
      <label class="field"><span>Allowed distance from store (metres)</span><input class="input" name="store_radius_m" inputmode="numeric" value="${esc(st.store_radius_m)}"></label>
      <div class="grid-2">
        <label class="field"><span>Punching opens</span><input class="input" type="time" name="open_time" value="${esc(st.open_time)}"></label>
        <label class="field"><span>Punching closes</span><input class="input" type="time" name="close_time" value="${esc(st.close_time)}"></label>
      </div>
      <div class="field"><span class="field-label">Weekly off (no punching)</span>
        <div class="day-toggle">${DAYS.map((x) => `<label><input type="checkbox" data-day="${x}" ${closed.includes(x) ? 'checked' : ''}><span>${x}</span></label>`).join('')}</div></div>
      <div class="grid-2">
        <label class="field"><span>Default shift start</span><input class="input" type="time" name="default_shift_start" value="${esc(st.default_shift_start)}"></label>
        <label class="field"><span>Late after (minutes)</span><input class="input" name="late_grace_min" inputmode="numeric" value="${esc(st.late_grace_min)}"></label>
      </div>
      <div class="toggle-row"><div><b style="font-weight:600">Face check</b><div class="muted small">Off: a photo is taken at each punch. On: the photo must also match the enrolled face.</div></div>
        <label class="switch"><input type="checkbox" id="facecheck" ${st.face_check === 'yes' ? 'checked' : ''}><span></span></label></div>
      <div class="grid-2" id="facefields" ${st.face_check === 'yes' ? '' : 'hidden'}>
        <label class="field"><span>Face strictness</span><input class="input" name="face_threshold" inputmode="decimal" value="${esc(st.face_threshold)}"><small>Lower = stricter (0.45–0.55)</small></label>
        <label class="field"><span>Tries before approval</span><input class="input" name="face_retries" inputmode="numeric" value="${esc(st.face_retries)}"></label>
      </div>
      <label class="field"><span>Owner app link (for Telegram "Fix it")</span><input class="input" name="admin_url" value="${esc(st.admin_url || adminUrlDefault)}"></label>
      <button class="btn primary block big" type="submit">Save settings</button>
    </form>

    <div class="glass card stack rise" style="margin-top:14px;animation-delay:150ms">
      ${setHead(I.user, 'Admins', 'Admins can see everything and make fixes. Every change is logged by name.')}
      ${r.admins.map((a) => `<div class="list-row"><div class="avatar sm">${esc(initials(a))}</div><div class="grow"><b>${esc(a)}</b>${a === r.me ? '<span class="muted small">you</span>' : ''}</div>${a !== r.me ? `<button class="btn sm" data-rmadmin="${esc(a)}">Remove</button>` : ''}</div>`).join('')}
      <div class="row"><input class="input grow" id="newadmin" type="email" placeholder="owner@gmail.com"><button class="btn" id="addadmin">${I.plus} Add</button></div>
    </div>

    <div class="glass card stack rise" style="margin-top:14px;animation-delay:200ms">
      ${setHead(I.shield, 'Proof & data', 'Your records live in your own Google account.')}
      <div class="row wrap">
        <a class="link-tile" target="_blank" rel="noopener" href="${esc(r.links.sheet)}">${I.sheets}<div>Google Sheet<small>All punches and fixes</small></div></a>
        <a class="link-tile" target="_blank" rel="noopener" href="${esc(r.links.folder)}">${I.drive}<div>Drive folder<small>Punch photos by month</small></div></a>
      </div>
      <button class="btn block" id="integrity">${I.shield} Check records are untouched</button>
      <div id="intout"></div>
    </div>
    <div class="ornament" style="margin-top:26px">${I.lotus}</div>`;
  bindHead();

  // Telegram
  $('#tgsave')?.addEventListener('click', async () => {
    try { const x = await api('admin.telegram.token', { token: $('#tgtoken').value.trim() }); toast(`Bot @${x.bot} connected`); viewSetup(); } catch (e) { toast(e.message, 4000); }
  });
  $('#tgme')?.addEventListener('click', async () => {
    try {
      const x = await api('admin.telegram.link');
      $('#tgmeout').innerHTML = `<div class="stack"><a class="btn primary block" href="${esc(x.url)}" target="_blank" rel="noopener">${I.telegram} Open Telegram and press Start</a><button class="btn block" id="tgchk">${I.check} I pressed Start, check</button></div>`;
      $('#tgchk').onclick = async () => { const c = await api('admin.telegram.check'); if (c.linked.length) { toast('Connected'); viewSetup(); } else toast('Not yet. Press Start in Telegram, then check again.'); };
    } catch (e) { toast(e.message, 4000); }
  });
  $('#tgtest')?.addEventListener('click', async () => { try { await api('admin.telegram.test'); toast('Test sent'); } catch (e) { toast(e.message); } });
  $$('[data-unlink]').forEach((b) => b.onclick = async () => { if (!confirm('Stop sending alerts to this chat?')) return; await api('admin.telegram.unlink', { chat_id: b.dataset.unlink }); viewSetup(); });

  // Devices
  $('#paircode').onclick = async () => {
    const name = $('#devname').value.trim();
    if (!name) return toast('Name the phone first, e.g. "Rahul\'s phone"');
    const x = await api('admin.device.code', { name });
    $('#codeout').innerHTML = `<div class="glass rise" style="padding:16px"><div class="center small muted">On the punch phone, open the punch app and type this code:</div><div class="pair-code">${esc(x.code)}</div><div class="center small muted">Valid for ${x.expires_min} minutes. Works once.</div></div>`;
  };
  $$('[data-revoke]').forEach((b) => b.onclick = async () => { if (!confirm('Remove this phone? It will no longer be able to punch.')) return; await api('admin.device.revoke', { device_id: b.dataset.revoke }); toast('Phone removed'); viewSetup(); });

  // Settings
  $('#facecheck').onchange = (ev) => { $('#facefields').hidden = !ev.target.checked; };
  $('#here').onclick = async () => {
    $('#loc').textContent = 'Getting location…';
    const g = await getPosition(15000);
    if (g.error) { $('#loc').textContent = g.error; return; }
    $('[name=store_lat]').value = g.lat.toFixed(6); $('[name=store_lng]').value = g.lng.toFixed(6);
    $('#loc').innerHTML = `${I.pin} ${g.lat.toFixed(6)}, ${g.lng.toFixed(6)} (±${Math.round(g.accuracy)} m). Press Save.`;
  };
  $('#sf').onsubmit = async (ev) => {
    ev.preventDefault();
    const values = Object.fromEntries(new FormData(ev.target).entries());
    values.closed_weekdays = $$('[data-day]').filter((c) => c.checked).map((c) => c.dataset.day).join(',');
    values.face_check = $('#facecheck').checked ? 'yes' : 'no';
    try { const x = await api('admin.settings.save', { values }); me.face_check = values.face_check === 'yes'; me.store_name = values.store_name; toast(x.changes.length ? 'Settings saved' : 'Nothing changed'); } catch (e) { toast(e.message, 4000); }
  };

  // Admins
  $('#addadmin').onclick = async () => { try { await api('admin.admins.add', { email: $('#newadmin').value }); toast('Admin added'); viewSetup(); } catch (e) { toast(e.message, 4000); } };
  $$('[data-rmadmin]').forEach((b) => b.onclick = async () => { if (!confirm(`Remove ${b.dataset.rmadmin} as admin?`)) return; try { await api('admin.admins.remove', { email: b.dataset.rmadmin }); viewSetup(); } catch (e) { toast(e.message, 4000); } });

  // Integrity
  $('#integrity').onclick = async () => {
    $('#intout').innerHTML = '<div class="spinner"></div>';
    const x = await api('admin.integrity');
    $('#intout').innerHTML = x.results.map((res) => `<div class="banner ${res.ok ? 'ok' : 'bad'}">${res.ok ? I.check : I.alert}<span>${esc(res.sheet)}: ${res.ok ? `${res.rows} rows, untouched` : `changed at row ${res.broken_row}. ${esc(res.problem)}`}</span></div>`).join('');
  };
}

/* ================= Boot ================= */
async function start() {
  if (!session.token) return renderSignIn();
  // Known user on this device: open the app immediately and confirm the sign-in in the background.
  let cachedMe = null;
  try { cachedMe = JSON.parse(sessionStorage.getItem('saatvikei_me') || 'null'); } catch { /* ignore */ }
  if (cachedMe) {
    me = cachedMe;
    hideSplash();
    route();
    api('admin.me').then((m) => { me = m; try { sessionStorage.setItem('saatvikei_me', JSON.stringify(m)); } catch { /* ignore */ } }).catch(() => {});
    refreshBadges();
    clearInterval(badgeTimer);
    badgeTimer = setInterval(() => { if (document.visibilityState === 'visible') refreshBadges(); }, 45000);
    return;
  }
  try {
    me = await api('admin.me');
    try { sessionStorage.setItem('saatvikei_me', JSON.stringify(me)); } catch { /* ignore */ }
  } catch (e) {
    hideSplash();
    if (!(e instanceof ApiError && (e.code === 'AUTH_REQUIRED' || e.code === 'NOT_ADMIN'))) app.innerHTML = `<div class="banner bad">${I.alert}<span>${esc(e.message)}</span></div>`;
    return;
  }
  hideSplash();
  route();
  refreshBadges();
  clearInterval(badgeTimer);
  badgeTimer = setInterval(() => { if (document.visibilityState === 'visible') refreshBadges(); }, 45000);
}

window.addEventListener('hashchange', () => { if (me) route(); });
document.addEventListener('visibilitychange', () => { if (me && document.visibilityState === 'visible') refreshBadges(); });
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
start();
