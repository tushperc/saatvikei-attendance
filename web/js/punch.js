// Punch app for the store manager's phone. It can only punch; it cannot edit or view history.
// Flow: find your name → tap the button → take a photo.
import { call, ApiError, isMock } from './api.js';
import * as face from './face.js';
import { $, $$, esc, initials, toast, ACTION_PAST, fmtDay, getPosition, hideSplash } from './ui.js';
import { I, LOGO_URL } from './icons.js';

const TOKEN_KEY = 'saatvikei_device_token';
// One-time move from the earlier (misspelt) key so already-paired phones stay paired.
try {
  const old = localStorage.getItem('saativkei_device_token');
  if (old && !localStorage.getItem(TOKEN_KEY)) localStorage.setItem(TOKEN_KEY, old);
  localStorage.removeItem('saativkei_device_token');
} catch { /* private mode */ }
const app = $('#app');
let state = { init: null, query: '' };
let refreshTimer = null;

const store = {
  get token() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } },
  set token(v) { try { v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ } }
};

const BUTTONS = {
  IN: { label: 'Punch in', cls: 'primary', icon: I.login },
  BREAK_OUT: { label: 'Break', cls: 'gold', icon: I.coffee },
  BREAK_IN: { label: 'Back from break', cls: 'primary', icon: I.back },
  OUT: { label: 'Punch out', cls: 'wine', icon: I.logout }
};

const logoImg = (cls = 'p-logo') => `<img class="${cls}" src="${LOGO_URL}" alt="Saatvikei" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'serif',style:'font-size:28px;font-style:italic',textContent:'Saatvikei'}))">`;

function clockHtml() {
  const t = new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
  const [hm, ap] = t.split(' ');
  const [h, m] = hm.split(':');
  return `${h}<span class="colon">:</span>${m} <small style="font-size:14px;font-weight:500">${(ap || '').toUpperCase()}</small>`;
}

/* ---------------- Pairing (one time, done with the owner) ---------------- */
function renderPairing(message = '') {
  hideSplash();
  app.innerHTML = `
    <div class="p-head">${logoImg()}</div>
    <div class="card stack rise" style="padding:24px">
      <div class="ornament">${I.lotus}</div>
      <h2 class="center">Set up this phone</h2>
      <p class="muted center" style="margin-top:6px">Ask the owner for the 6-digit code from the owner app. This is needed only once.</p>
      ${message ? `<div class="banner bad">${I.alert}<span>${esc(message)}</span></div>` : ''}
      <input class="input code-input" id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••">
      <button class="btn primary block big" id="pair">Register this phone</button>
    </div>`;
  const input = $('#code');
  $('#pair').onclick = async () => {
    const code = input.value.replace(/\D/g, '');
    if (code.length !== 6) return toast('Enter the 6-digit code');
    $('#pair').disabled = true;
    try {
      const r = await call('device.pair', { code, user_agent: navigator.userAgent });
      store.token = r.device_token;
      toast('Phone registered');
      boot();
    } catch (e) { renderPairing(e.message); }
  };
}

/* ---------------- Home: search + list ---------------- */
async function loadInit() {
  state.init = await call('kiosk.init', { device_token: store.token });
  return state.init;
}

function statusLine(e) {
  switch (e.state) {
    case 'IN': return `<span class="st ok"><i class="live-dot"></i>In since ${esc(e.last_time)}</span>`;
    case 'BREAK': return `<span class="st warn"><i class="live-dot"></i>On break since ${esc(e.last_time)}</span>`;
    case 'DONE': return `<span class="st">${I.check} Left at ${esc(e.last_time)}</span>`;
    default: return `<span class="st">Not in yet</span>`;
  }
}

function personCard(e, open, i) {
  const buttons = open && e.state !== 'DONE'
    ? `<div class="p-actions">${e.allowed.map((a) => `<button class="btn pbtn ${BUTTONS[a].cls}" data-emp="${esc(e.emp_id)}" data-act="${a}">${BUTTONS[a].icon}<span>${BUTTONS[a].label}</span></button>`).join('')}</div>`
    : '';
  return `
    <div class="glass person rise ${e.state === 'DONE' ? 'is-done' : ''}" style="animation-delay:${Math.min(i, 8) * 45}ms" data-name="${esc(e.name.toLowerCase())}">
      <div class="person-top">
        <div class="avatar" data-st="${esc(e.state)}">${esc(initials(e.name))}</div>
        <div class="grow"><div class="pname">${esc(e.name)}</div>${statusLine(e)}</div>
      </div>
      ${buttons}
    </div>`;
}

function renderHome() {
  const r = state.init;
  const w = r.window;
  app.innerHTML = `
    <div class="p-head">
      ${logoImg()}
      <div class="p-clock"><b id="clock">${clockHtml()}</b><span>${fmtDay()}</span></div>
    </div>
    ${w.is_open
      ? `<div class="status-pill open"><i class="live-dot"></i>Punching open · until ${esc(to12(w.close_time))}</div>`
      : `<div class="status-pill closed">${I.clock}${esc(w.reason)}</div>`}
    ${isMock() ? '<div class="banner info">Demo mode: sample data, nothing is saved.</div>' : ''}
    <div class="glass search-wrap">
      ${I.search}
      <input class="search" id="q" type="search" placeholder="Type your name" autocomplete="off" autocorrect="off" spellcheck="false" value="${esc(state.query)}">
      <button class="search-clear" id="qclear" aria-label="Clear" ${state.query ? '' : 'hidden'}>${I.x}</button>
    </div>
    <div class="steps"><span>Find your name</span><i></i><span>Tap the button</span><i></i><span>Take a photo</span></div>
    <div id="list">
      ${r.employees.length ? r.employees.map((e, i) => personCard(e, w.is_open, i)).join('') : '<div class="card muted center">No staff added yet. The owner adds staff in the owner app.</div>'}
      <div class="card muted center" id="nomatch" hidden>No one found with that name.</div>
    </div>
    <div class="ornament" style="margin-top:22px">${I.lotus}</div>`;
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
}

function to12(hm) {
  const [h, m] = String(hm).split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
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
  const cam = document.createElement('div');
  cam.className = 'camera';
  cam.innerHTML = `
    <video autoplay playsinline muted></video>
    <div class="frame"></div>
    <div class="top">
      <div><div class="who">${esc(emp.name)}</div><div class="what">${BUTTONS[action].icon}${BUTTONS[action].label}${override ? ' · for owner approval' : ''}</div></div>
      <button class="btn sm" data-cancel>${I.x}Cancel</button>
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
    return showResult('bad', I.camera, 'Camera problem', e.message || 'Could not open the camera.', [{ label: 'Back', fn: backHome }]);
  }
  if (closed) return;
  if (face.simulated) { video.remove(); cam.insertAdjacentHTML('afterbegin', `<div class="fake-video">${I.user}</div>`); }
  prompt.textContent = 'Look at the camera';
  hint.textContent = 'Keep your face inside the frame, then tap the button';
  shoot.disabled = false;

  shoot.onclick = async () => {
    shoot.disabled = true;
    if (navigator.vibrate) navigator.vibrate(30);
    let photo, descriptor = null;
    if (faceOn) {
      const shot = await face.capture(video).catch(() => ({ photo: null, descriptor: null, faces: 0 }));
      photo = shot.photo; descriptor = shot.descriptor;
      if (!descriptor) {
        cleanup();
        return showResult('bad', I.user, 'Try again', shot.faces > 1 ? 'Only the person punching should be in the photo.' : 'Face not clear. Face the light and try again.',
          [{ label: 'Try again', fn: () => startPunch(emp, action, { override }) }, { label: 'Cancel', ghost: true, fn: backHome }]);
      }
    } else {
      photo = face.capturePhoto(video);
    }
    face.stopCamera(video);
    cam.innerHTML = `<div class="saving"><img src="${photo}" alt=""><div class="spinner"></div><div>Saving…</div></div>`;
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
      return showResult('bad', I.alert, 'Not saved', e.message, [{ label: 'Try again', fn: () => startPunch(emp, action, { override }) }, { label: 'Back', ghost: true, fn: backHome }]);
    }
    cleanup();
    handlePunchResult(emp, action, r, photo);
  };
}

const HELLO = {
  IN: (n) => ['Namaste', `Have a lovely day, ${n}`],
  BREAK_OUT: (n) => ['Enjoy your break', `See you soon, ${n}`],
  BREAK_IN: (n) => ['Welcome back', `Good to have you back, ${n}`],
  OUT: (n) => ['Dhanyavaad', `See you tomorrow, ${n}`]
};

function handlePunchResult(emp, action, r, photo) {
  const first = String(r.name || emp.name).split(' ')[0];
  if (r.ok && r.status === 'OK') {
    const [hello, line] = HELLO[action](first);
    return showResult('ok', I.check, `${ACTION_PAST[action]} · ${r.time}`, line, [{ label: 'Done', fn: backHome }], 3500, photo, hello);
  }
  if (r.ok && r.status === 'PENDING') {
    return showResult('warn', I.clock, 'Sent to owner', `${r.name}'s punch at ${r.time} is waiting for the owner's approval.`, [{ label: 'Done', fn: backHome }], 5000, photo);
  }
  const retries = state.init?.face_retries || 3;
  if (r.code === 'FACE_MISMATCH') {
    const n = r.face_fail_count || 1;
    const buttons = [{ label: 'Try again', fn: () => startPunch(emp, action) }];
    if (n >= retries) buttons.unshift({ label: 'Send to owner', fn: () => startPunch(emp, action, { override: true }) });
    buttons.push({ label: 'Cancel', ghost: true, fn: backHome });
    return showResult('bad', I.x, 'Face did not match', n >= retries ? `Tried ${n} times. You can send it to the owner to approve.` : `Try again in good light (${n}/${retries}).`, buttons);
  }
  const retry = ['GPS_WEAK', 'GPS_REQUIRED', 'NO_FACE', 'NO_PHOTO'].includes(r.code);
  return showResult('bad', r.code && r.code.startsWith('GPS') || r.code === 'AWAY_FROM_STORE' ? I.pin : I.x, 'Not accepted', r.message, [
    ...(retry ? [{ label: 'Try again', fn: () => startPunch(emp, action) }] : []),
    { label: 'Back', ghost: retry, fn: backHome }
  ]);
}

function showResult(kind, icon, title, text, buttons, autoMs, photo, hello) {
  const el = document.createElement('div');
  el.className = `result ${kind}`;
  el.innerHTML = `
    ${photo ? `<div class="result-photo"><img src="${photo}" alt=""><span class="badge-ico">${icon}</span></div>` : `<div class="big-icon">${icon}</div>`}
    ${hello ? `<div class="hello">${esc(hello)}</div>` : ''}
    <h1>${esc(title)}</h1><p>${esc(text)}</p>
    <div class="stack" style="margin-top:20px;width:100%;max-width:320px">${buttons.map((b, i) => `<button class="btn big block ${b.ghost ? 'ghost' : ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div>
    <div class="ornament">${I.lotus}</div>
    ${autoMs ? `<div class="countdown" style="animation-duration:${autoMs}ms"></div>` : ''}`;
  document.body.appendChild(el);
  let timer;
  const close = () => { clearTimeout(timer); el.remove(); };
  $$('[data-i]', el).forEach((b) => b.addEventListener('click', () => { close(); buttons[Number(b.dataset.i)].fn(); }));
  if (autoMs) timer = setTimeout(() => { close(); buttons[0].fn(); }, autoMs);
}

async function backHome() {
  try { await loadInit(); } catch (e) { /* keep old data */ }
  if (state.init) renderHome();
  scheduleRefresh();
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
  try {
    await loadInit();
    renderHome();
    scheduleRefresh();
    if (state.init.face_check) face.loadModels().catch(() => {});
  } catch (e) {
    hideSplash();
    if (e instanceof ApiError && e.code === 'DEVICE_NOT_PAIRED') { store.token = ''; return renderPairing(e.message); }
    app.innerHTML = `<div class="card stack center" style="margin-top:40px">${I.alert}<h2>Can't reach the server</h2><p class="muted">${esc(e.message)}</p><button class="btn primary block" id="retry">Try again</button></div>`;
    $('#retry').onclick = boot;
  }
}

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && store.token && !document.querySelector('.camera, .result')) loadInit().then(renderHome).catch(() => {});
});
boot();
