// Punch app for the store manager's phone. It can only punch; it cannot edit or view history.
// Flow: find your name → tap the button → take a photo.
import { call, ApiError, isMock } from './api.js';
import * as face from './face.js';
import { $, $$, esc, initials, toast, getPosition, hideSplash, snap, longDay } from './ui.js';
import { I, PHOTOS, lockup } from './icons.js';

const TOKEN_KEY = 'saatvikei_device_token';
// One-time move from the earlier (misspelt) key so already-paired phones stay paired.
try {
  const old = localStorage.getItem('saativkei_device_token');
  if (old && !localStorage.getItem(TOKEN_KEY)) localStorage.setItem(TOKEN_KEY, old);
  localStorage.removeItem('saativkei_device_token');
} catch { /* private mode */ }
const app = $('#app');
let state = { init: null, query: '', animated: false };
let refreshTimer = null;

const store = {
  get token() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } },
  set token(v) { try { v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ } }
};

const BUTTONS = {
  IN: { en: 'Punch in', cls: 'primary', icon: I.login },
  BREAK_OUT: { en: 'Break', cls: 'gold', icon: I.coffee },
  BREAK_IN: { en: 'Back from break', cls: 'primary', icon: I.back },
  OUT: { en: 'Punch out', cls: 'wine', icon: I.logout }
};
const DONE = { IN: 'Punched in', BREAK_OUT: 'On break', BREAK_IN: 'Back from break', OUT: 'Punched out' };
const HELLO = {
  IN: (n) => ['Namaste', `Have a lovely day, ${n}`],
  BREAK_OUT: (n) => ['Enjoy your break', `See you soon, ${n}`],
  BREAK_IN: (n) => ['Welcome back', `Good to have you back, ${n}`],
  OUT: (n) => ['Dhanyavaad', `See you tomorrow, ${n}`]
};

function clockHtml() {
  const t = new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
  const [hm, ap] = t.split(' ');
  const [h, m] = hm.split(':');
  return `${h}<span class="colon" aria-label=":"></span>${m}<small>${(ap || '').toLowerCase()}</small>`;
}

function to12(hm) {
  const [h, m] = String(hm).split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function todayPhoto() { return PHOTOS[new Date().getDate() % PHOTOS.length]; }

/* ---------------- Pairing ---------------- */
function renderPairing(message = '') {
  hideSplash();
  app.innerHTML = `
    <header class="band p-band welcome">
      <div class="band-bg" style="background-image:url('${todayPhoto()}')"></div>
      ${lockup(true, 'lg')}
      <h1 class="welcome-title">Welcome</h1>
    </header>
    <div class="zari"></div>
    <section class="pair-card">
      <p class="pair-ask">Ask for the 6-digit code.</p>
      ${message ? `<div class="banner bad">${I.alert}<span>${esc(message)}</span></div>` : ''}
      <input class="input code-input" id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••" aria-label="6-digit code">
      <button class="btn primary block big pill" id="pair">Continue</button>
    </section>`;
  const input = $('#code');
  $('#pair').onclick = async () => {
    const code = input.value.replace(/\D/g, '');
    if (code.length !== 6) return toast('Enter all 6 digits');
    $('#pair').disabled = true;
    try {
      const r = await call('device.pair', { code, user_agent: navigator.userAgent });
      store.token = r.device_token;
      toast('This phone is ready');
      boot();
    } catch (e) { renderPairing(e.message); }
  };
}

/* ---------------- Home: search + list ---------------- */
async function loadInit() {
  state.init = await call('kiosk.init', { device_token: store.token });
  snap.set('kiosk', state.init);
  return state.init;
}

function statusLine(e) {
  const t = esc(e.last_time);
  switch (e.state) {
    case 'IN': return `<span class="st ok"><i class="live-dot"></i>In since ${t}</span>`;
    case 'BREAK': return `<span class="st warn"><i class="live-dot"></i>On break since ${t}</span>`;
    case 'DONE': return `<span class="st">${I.check}Left at ${t}</span>`;
    default: return `<span class="st">Not in yet</span>`;
  }
}

function personCard(e, open, i) {
  const buttons = open && e.state !== 'DONE'
    ? `<div class="p-actions">${e.allowed.map((a) => `<button class="btn pbtn ${BUTTONS[a].cls}" data-emp="${esc(e.emp_id)}" data-act="${a}"><span class="pico">${BUTTONS[a].icon}</span><span class="lbl">${esc(BUTTONS[a].en)}</span></button>`).join('')}</div>`
    : '';
  return `
    <div class="glass person ${state.animated ? '' : 'rise'} ${e.state === 'DONE' ? 'is-done' : ''}" style="animation-delay:${Math.min(i, 8) * 40}ms" data-name="${esc(e.name.toLowerCase())}">
      <div class="person-top">
        <div class="avatar" data-st="${esc(e.state)}">${esc(initials(e.name))}</div>
        <div class="grow"><div class="pname">${esc(e.name)}</div>${statusLine(e)}</div>
      </div>
      ${buttons}
    </div>`;
}

function windowLine(w) {
  if (w.is_open) return `<div class="status-pill open"><i class="live-dot"></i><span>Open until ${esc(to12(w.close_time))}</span></div>`;
  return `<div class="status-pill closed">${I.clock}<span>${esc(w.reason)}</span></div>`;
}

function renderHome() {
  const r = state.init;
  const w = r.window;
  const day = longDay();
  app.innerHTML = `
    <header class="band p-band">
      <div class="band-bg" style="background-image:url('${todayPhoto()}')"></div>
      ${lockup(true)}
      <div class="big-clock" id="clock">${clockHtml()}</div>
      <div class="band-date">${esc(day.en)}</div>
      ${windowLine(w)}
    </header>
    <div class="zari"></div>
    ${isMock() ? '<div class="banner info">Demo mode: sample data, nothing is saved.</div>' : ''}
    <div class="glass search-wrap">
      ${I.search}
      <input class="search" id="q" type="search" placeholder="Type your name" autocomplete="off" autocorrect="off" spellcheck="false" value="${esc(state.query)}">
      <button class="search-clear" id="qclear" aria-label="Clear" ${state.query ? '' : 'hidden'}>${I.x}</button>
    </div>
    <div class="steps"><span>Find your name</span><i></i><span>Tap the button</span><i></i><span>Take a photo</span></div>
    <div id="list">
      ${r.employees.length ? r.employees.map((e, i) => personCard(e, w.is_open, i)).join('') : '<div class="card muted center">No staff added yet.</div>'}
      <div class="card muted center" id="nomatch" hidden>No one found with that name.</div>
    </div>`;
  const q = $('#q');
  q.oninput = () => { state.query = q.value; filter(); };
  $('#qclear').onclick = () => { state.query = ''; q.value = ''; filter(); q.focus(); };
  $$('[data-act]').forEach((b) => b.addEventListener('click', () => {
    const emp = state.init.employees.find((x) => x.emp_id === b.dataset.emp);
    state.query = '';
    startPunch(emp, b.dataset.act);
  }));
  filter();
  hideSplash();
  state.animated = true;
}

function filter() {
  const term = state.query.trim().toLowerCase();
  let shown = 0;
  $$('.person').forEach((el) => {
    const hit = !term || el.dataset.name.includes(term);
    el.hidden = !hit;
    if (hit) shown++;
  });
  const nm = $('#nomatch'); if (nm) nm.hidden = shown > 0 || !state.init.employees.length;
  const c = $('#qclear'); if (c) c.hidden = !term;
}

/* ---------------- Camera ---------------- */
async function startPunch(emp, action, { override = false } = {}) {
  clearInterval(refreshTimer);
  const faceOn = !!state.init.face_check;
  const b = BUTTONS[action];
  const cam = document.createElement('div');
  cam.className = 'camera';
  cam.innerHTML = `
    <video autoplay playsinline muted></video>
    <div class="frame"></div>
    <div class="top">
      <div><div class="who">${esc(emp.name)}</div><div class="what">${b.icon}<span>${esc(b.en)}${override ? ' (for approval)' : ''}</span></div></div>
      <button class="btn sm pill" data-cancel>${I.x}Cancel</button>
    </div>
    <div class="bottom">
      <div class="prompt">Opening camera…</div>
      <div class="hint"></div>
      <button class="shutter" data-shoot disabled aria-label="Take photo"><span></span></button>
      <div class="shutter-label">Take photo</div>
    </div>`;
  document.body.appendChild(cam);
  const video = $('video', cam);
  const prompt = $('.prompt', cam), hint = $('.hint', cam), shoot = $('[data-shoot]', cam);
  let closed = false;
  const cleanup = () => { closed = true; face.stopCamera(video); cam.remove(); };
  $('[data-cancel]', cam).onclick = () => { cleanup(); backHome(); };

  const gpsPromise = getPosition();
  try {
    const jobs = [face.startCamera(video, { allowSimulated: isMock() })];
    if (faceOn) jobs.push(face.loadModels().catch((e) => { if (!isMock()) throw e; }));
    await Promise.all(jobs);
  } catch (e) {
    cleanup();
    return showResult('bad', I.camera, 'Camera problem', e.message || 'Could not open the camera.', [{ en: 'Back', fn: backHome }]);
  }
  if (closed) return;
  if (face.simulated) { video.remove(); cam.insertAdjacentHTML('afterbegin', `<div class="fake-video">${I.user}</div>`); }
  prompt.textContent = 'Look at the camera';
  hint.textContent = 'Keep your face inside the frame, then tap the button';
  shoot.disabled = false;

  shoot.onclick = async () => {
    shoot.disabled = true;
    if (navigator.vibrate) { try { navigator.vibrate(30); } catch { /* ignore */ } }
    let photo, descriptor = null;
    if (faceOn) {
      const shot = await face.capture(video).catch(() => ({ photo: null, descriptor: null, faces: 0 }));
      photo = shot.photo; descriptor = shot.descriptor;
      if (!descriptor) {
        cleanup();
        return showResult('bad', I.user, 'Try again',
          shot.faces > 1 ? 'Only the person punching should be in the photo.' : 'Face not clear. Face the light and try again.',
          [{ en: 'Try again', fn: () => startPunch(emp, action, { override }) }, { en: 'Cancel', ghost: true, fn: backHome }]);
      }
    } else {
      photo = face.capturePhoto(video);
    }
    face.stopCamera(video);
    cam.innerHTML = `<div class="saving"><img src="${photo}" alt=""><div class="spinner"></div><div class="center">Saving…</div></div>`;
    const gps = await gpsPromise;
    let r;
    try {
      r = await call('kiosk.punch', {
        device_token: store.token, emp_id: emp.emp_id, punch: action, override, descriptor, photo,
        lat: gps.lat ?? null, lng: gps.lng ?? null, accuracy: gps.accuracy ?? null, phone_time: new Date().toISOString()
      });
    } catch (e) {
      cleanup();
      if (e instanceof ApiError && e.code === 'DEVICE_NOT_PAIRED') { store.token = ''; return renderPairing(e.message); }
      return showResult('bad', I.alert, 'Not saved', e.message,
        [{ en: 'Try again', fn: () => startPunch(emp, action, { override }) }, { en: 'Back', ghost: true, fn: backHome }]);
    }
    cleanup();
    handlePunchResult(emp, action, r, photo);
  };
}

function handlePunchResult(emp, action, r, photo) {
  const first = String(r.name || emp.name).split(' ')[0];
  if (r.ok && r.status === 'OK') {
    const [hello, line] = HELLO[action](first);
    const kind = action === 'OUT' ? 'bye' : action === 'BREAK_OUT' ? 'brk' : 'ok';
    return showResult(kind, I.check, `${DONE[action]} · ${r.time}`, line, [{ en: 'Done', fn: backHome }], 8000, photo, hello);
  }
  if (r.ok && r.status === 'PENDING') {
    return showResult('warn', I.clock, 'Sent for approval', `${r.name}'s punch at ${r.time} will count once it is approved.`, [{ en: 'Done', fn: backHome }], 9000, photo);
  }
  const retries = state.init?.face_retries || 3;
  if (r.code === 'FACE_MISMATCH') {
    const n = r.face_fail_count || 1;
    const buttons = [{ en: 'Try again', fn: () => startPunch(emp, action) }];
    if (n >= retries) buttons.unshift({ en: 'Send for approval', fn: () => startPunch(emp, action, { override: true }) });
    buttons.push({ en: 'Cancel', ghost: true, fn: backHome });
    return showResult('bad', I.x, 'Face did not match',
      n >= retries ? `Tried ${n} times. You can send it for approval.` : `Try again in good light (${n}/${retries}).`, buttons);
  }
  const retry = ['GPS_WEAK', 'GPS_REQUIRED', 'NO_FACE', 'NO_PHOTO'].includes(r.code);
  const icon = (r.code && r.code.startsWith('GPS')) || r.code === 'AWAY_FROM_STORE' ? I.pin : I.x;
  return showResult('bad', icon, 'Not accepted', r.message, [
    ...(retry ? [{ en: 'Try again', fn: () => startPunch(emp, action) }] : []),
    { en: 'Back', ghost: retry, fn: backHome }
  ]);
}

/** Full-screen result after a punch. Stays until Done/✕ or the timer runs out. */
function showResult(kind, icon, title, text, buttons, autoMs, photo, hello) {
  const el = document.createElement('div');
  el.className = `result ${kind}`;
  el.innerHTML = `
    ${photo ? `<div class="result-photo"><img src="${photo}" alt=""><span class="badge-ico">${icon}</span></div>` : `<div class="big-icon">${icon}</div>`}
    ${hello ? `<div class="hello">${esc(hello)}</div>` : ''}
    <h1>${esc(title)}</h1><p>${esc(text)}</p>
    <div class="stack" style="margin-top:22px;width:100%;max-width:320px">${buttons.map((b, i) => `<button class="btn big block pill ${b.ghost ? 'ghost' : ''}" data-i="${i}">${esc(b.en)}</button>`).join('')}</div>
    <button class="result-close" aria-label="Close">${I.x}</button>
    ${autoMs ? `<div class="countdown" style="animation-duration:${autoMs}ms"></div>` : ''}`;
  document.body.appendChild(el);
  let timer;
  const close = () => { clearTimeout(timer); el.remove(); };
  $$('[data-i]', el).forEach((btn) => btn.addEventListener('click', () => { close(); buttons[Number(btn.dataset.i)].fn(); }));
  $('.result-close', el).onclick = () => { close(); buttons[buttons.length - 1].fn(); };
  if (autoMs) timer = setTimeout(() => { close(); buttons[0].fn(); }, autoMs);
}

async function backHome() {
  if (state.init) renderHome();   // show the list right away, then refresh it
  scheduleRefresh();
  try { await loadInit(); if (!document.querySelector('.camera, .result') && document.activeElement?.id !== 'q') renderHome(); } catch { /* keep old data */ }
}

/** Clock every 15 s; staff status every minute while idle (not while someone is typing). */
function scheduleRefresh() {
  clearInterval(refreshTimer);
  let ticks = 0;
  refreshTimer = setInterval(() => {
    const busy = document.querySelector('.camera, .result') || document.activeElement?.id === 'q';
    const c = $('#clock'); if (c) c.innerHTML = clockHtml();
    if (++ticks % 4 === 0 && !busy && document.visibilityState === 'visible') {
      loadInit().then(() => { if (!document.querySelector('.camera, .result') && document.activeElement?.id !== 'q') renderHome(); }).catch(() => {});
    }
  }, 15000);
}

/* ---------------- Boot ---------------- */
async function boot() {
  if (!store.token) return renderPairing();
  // Show the last known list straight away (same day only), then refresh from the server.
  const cached = snap.get('kiosk', 6 * 3600e3);
  const shownCached = !!(cached && cached.window && cached.window.date === new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10));
  if (shownCached) { state.init = cached; renderHome(); }
  try {
    await loadInit();
    if (!document.querySelector('.camera, .result') && document.activeElement?.id !== 'q') renderHome();
    scheduleRefresh();
    if (state.init.face_check) face.loadModels().catch(() => {});
  } catch (e) {
    hideSplash();
    if (e instanceof ApiError && e.code === 'DEVICE_NOT_PAIRED') { store.token = ''; return renderPairing(e.message); }
    if (shownCached) { toast('Offline. Showing the last saved list.', 4000); scheduleRefresh(); return; }
    app.innerHTML = `<div class="card stack center" style="margin-top:40px">${I.alert}<h2>Can't reach the server</h2><p class="muted">${esc(e.message)}</p><button class="btn primary block pill" id="retry">Try again</button></div>`;
    $('#retry').onclick = boot;
  }
}

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && store.token && !document.querySelector('.camera, .result')) loadInit().then(renderHome).catch(() => {});
});
boot();
