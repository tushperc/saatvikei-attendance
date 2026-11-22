// Punch app for the store manager's phone. It can only punch; it cannot edit or view history.
// Flow: find your name → tap the button → take a photo. Every line is in English with Hindi below.
import { call, ApiError, isMock } from './api.js';
import * as face from './face.js';
import { $, $$, esc, initials, toast, fmtDay, getPosition, hideSplash, snap } from './ui.js';
import { I, LOGO_URL } from './icons.js';

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

/** English line with Hindi underneath. */
const bi = (en, hi) => `<span class="en">${esc(en)}</span><span class="hi" lang="hi">${esc(hi)}</span>`;

const BUTTONS = {
  IN: { en: 'Punch in', hi: 'पंच इन करें', cls: 'primary', icon: I.login },
  BREAK_OUT: { en: 'Break', hi: 'ब्रेक पर जाएँ', cls: 'gold', icon: I.coffee },
  BREAK_IN: { en: 'Back from break', hi: 'ब्रेक से वापस', cls: 'primary', icon: I.back },
  OUT: { en: 'Punch out', hi: 'पंच आउट करें', cls: 'wine', icon: I.logout }
};
const DONE = {
  IN: ['Punched in', 'पंच इन हो गया'],
  BREAK_OUT: ['On break', 'ब्रेक शुरू'],
  BREAK_IN: ['Back from break', 'ब्रेक से वापस'],
  OUT: ['Punched out', 'पंच आउट हो गया']
};
const HELLO = {
  IN: (n) => ['Namaste', 'नमस्ते', `Have a lovely day, ${n}`, `आपका दिन शुभ हो, ${n}`],
  BREAK_OUT: (n) => ['Enjoy your break', 'ब्रेक का आनंद लें', `See you soon, ${n}`, `जल्दी मिलते हैं, ${n}`],
  BREAK_IN: (n) => ['Welcome back', 'वापसी पर स्वागत है', `Good to have you back, ${n}`, `आपका फिर से स्वागत है, ${n}`],
  OUT: (n) => ['Dhanyavaad', 'धन्यवाद', `See you tomorrow, ${n}`, `कल मिलते हैं, ${n}`]
};
// Hindi for the server's "not accepted" reasons (the English comes from the server).
const REASON_HI = {
  OUTSIDE_HOURS: 'अभी हाज़िरी का समय नहीं है।',
  AWAY_FROM_STORE: 'यह फ़ोन दुकान से दूर है। हाज़िरी सिर्फ़ दुकान पर लगेगी।',
  GPS_REQUIRED: 'लोकेशन बंद है। लोकेशन चालू करके फिर कोशिश करें।',
  GPS_WEAK: 'GPS सिग्नल कमज़ोर है। दरवाज़े के पास जाकर फिर कोशिश करें।',
  WRONG_ORDER: 'यह पंच अभी नहीं हो सकता।',
  TOO_SOON: 'अभी-अभी पंच हुआ है। 2 मिनट रुकें।',
  NO_PHOTO: 'फ़ोटो नहीं ली गई।',
  NO_FACE: 'फ़ोटो में चेहरा साफ़ नहीं दिखा।',
  NOT_ENROLLED: 'चेहरा अभी रजिस्टर नहीं है। मालिक से कहें।'
};

const logoImg = (cls = 'p-logo') => `<img class="${cls}" src="${LOGO_URL}" alt="Saatvikei" fetchpriority="high" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'serif',style:'font-size:28px;font-style:italic',textContent:'Saatvikei'}))">`;

function clockHtml() {
  const t = new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
  const [hm, ap] = t.split(' ');
  const [h, m] = hm.split(':');
  return `${h}<span class="colon">:</span>${m} <small style="font-size:14px;font-weight:500">${(ap || '').toUpperCase()}</small>`;
}

function to12(hm) {
  const [h, m] = String(hm).split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

/* ---------------- Pairing (one time, done with the owner) ---------------- */
function renderPairing(message = '') {
  hideSplash();
  app.innerHTML = `
    <div class="p-head">${logoImg()}</div>
    <div class="card stack rise bil" style="padding:24px">
      <div class="ornament">${I.lotus}</div>
      <h2 class="center">${bi('Set up this phone', 'यह फ़ोन सेट करें')}</h2>
      <p class="muted center" style="margin-top:6px">${bi('Ask the owner for the 6-digit code from the owner app. This is needed only once.', 'मालिक से 6 अंकों का कोड लें। यह सिर्फ़ एक बार करना है।')}</p>
      ${message ? `<div class="banner bad">${I.alert}<span>${esc(message)}</span></div>` : ''}
      <input class="input code-input" id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••">
      <button class="btn primary block big two-line" id="pair">${bi('Register this phone', 'फ़ोन रजिस्टर करें')}</button>
    </div>`;
  const input = $('#code');
  $('#pair').onclick = async () => {
    const code = input.value.replace(/\D/g, '');
    if (code.length !== 6) return toast('Enter the 6-digit code · 6 अंकों का कोड डालें');
    $('#pair').disabled = true;
    try {
      const r = await call('device.pair', { code, user_agent: navigator.userAgent });
      store.token = r.device_token;
      toast('Phone registered · फ़ोन रजिस्टर हो गया');
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
    case 'IN': return `<span class="st ok"><i class="live-dot"></i><span>In since ${t}<span class="hi" lang="hi">${t} से अंदर</span></span></span>`;
    case 'BREAK': return `<span class="st warn"><i class="live-dot"></i><span>On break since ${t}<span class="hi" lang="hi">${t} से ब्रेक पर</span></span></span>`;
    case 'DONE': return `<span class="st">${I.check}<span>Left at ${t}<span class="hi" lang="hi">${t} बजे चले गए</span></span></span>`;
    default: return `<span class="st"><span>Not in yet<span class="hi" lang="hi">अभी नहीं आए</span></span></span>`;
  }
}

function personCard(e, open, i) {
  const buttons = open && e.state !== 'DONE'
    ? `<div class="p-actions">${e.allowed.map((a) => `<button class="btn pbtn two-line ${BUTTONS[a].cls}" data-emp="${esc(e.emp_id)}" data-act="${a}">${BUTTONS[a].icon}<span class="lbl">${bi(BUTTONS[a].en, BUTTONS[a].hi)}</span></button>`).join('')}</div>`
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
  if (w.is_open) return `<div class="status-pill open"><i class="live-dot"></i><span>Punching open · until ${esc(to12(w.close_time))}<span class="hi" lang="hi">हाज़िरी चालू है · ${esc(to12(w.close_time))} तक</span></span></div>`;
  let hi = 'अभी हाज़िरी बंद है।';
  if (/closed on/.test(w.reason)) hi = 'आज दुकान की छुट्टी है। हाज़िरी बंद है।';
  else if (/opens at/.test(w.reason)) hi = `हाज़िरी ${to12(w.open_time)} बजे शुरू होगी।`;
  else if (/closed at/.test(w.reason)) hi = 'आज की हाज़िरी बंद हो गई है। कल फिर खुलेगी।';
  return `<div class="status-pill closed">${I.clock}<span>${esc(w.reason)}<span class="hi" lang="hi">${hi}</span></span></div>`;
}

function renderHome() {
  const r = state.init;
  const w = r.window;
  app.innerHTML = `
    <div class="p-head">
      ${logoImg()}
      <div class="p-clock"><b id="clock">${clockHtml()}</b><span>${fmtDay()}</span></div>
    </div>
    ${windowLine(w)}
    ${isMock() ? '<div class="banner info">Demo mode: sample data, nothing is saved.</div>' : ''}
    <div class="glass search-wrap">
      ${I.search}
      <input class="search" id="q" type="search" placeholder="Type name · नाम लिखें" autocomplete="off" autocorrect="off" spellcheck="false" value="${esc(state.query)}">
      <button class="search-clear" id="qclear" aria-label="Clear" ${state.query ? '' : 'hidden'}>${I.x}</button>
    </div>
    <div class="steps">
      <span>${bi('Find your name', 'नाम ढूँढें')}</span><i></i>
      <span>${bi('Tap the button', 'बटन दबाएँ')}</span><i></i>
      <span>${bi('Take a photo', 'फ़ोटो लें')}</span>
    </div>
    <div id="list">
      ${r.employees.length ? r.employees.map((e, i) => personCard(e, w.is_open, i)).join('') : `<div class="card muted center">${bi('No staff added yet. The owner adds staff in the owner app.', 'अभी कोई स्टाफ़ नहीं जोड़ा गया है।')}</div>`}
      <div class="card muted center" id="nomatch" hidden>${bi('No one found with that name.', 'इस नाम से कोई नहीं मिला।')}</div>
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
      <div><div class="who">${esc(emp.name)}</div><div class="what">${b.icon}<span>${esc(b.en)} · <span lang="hi">${esc(b.hi)}</span>${override ? ' · for owner approval' : ''}</span></div></div>
      <button class="btn sm" data-cancel>${I.x}<span>Cancel<span class="hi" lang="hi">रद्द करें</span></span></button>
    </div>
    <div class="bottom">
      <div class="prompt">${bi('Opening camera…', 'कैमरा खुल रहा है…')}</div>
      <div class="hint"></div>
      <button class="shutter" data-shoot disabled aria-label="Take photo"><span></span></button>
      <div class="shutter-label">${bi('Take photo', 'फ़ोटो लें')}</div>
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
    return showResult('bad', I.camera, ['Camera problem', 'कैमरा नहीं खुला'], [e.message || 'Could not open the camera.', 'फ़ोन की सेटिंग में कैमरा की अनुमति दें।'], [{ en: 'Back', hi: 'वापस', fn: backHome }]);
  }
  if (closed) return;
  if (face.simulated) { video.remove(); cam.insertAdjacentHTML('afterbegin', `<div class="fake-video">${I.user}</div>`); }
  prompt.innerHTML = bi('Look at the camera', 'कैमरे की ओर देखें');
  hint.innerHTML = bi('Keep your face inside the frame, then tap the button', 'चेहरा फ्रेम के अंदर रखें, फिर बटन दबाएँ');
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
        return showResult('bad', I.user, ['Try again', 'फिर कोशिश करें'],
          shot.faces > 1 ? ['Only the person punching should be in the photo.', 'फ़ोटो में सिर्फ़ पंच करने वाला व्यक्ति हो।'] : ['Face not clear. Face the light and try again.', 'चेहरा साफ़ नहीं दिखा। रोशनी की ओर देखकर फिर कोशिश करें।'],
          [{ en: 'Try again', hi: 'फिर कोशिश करें', fn: () => startPunch(emp, action, { override }) }, { en: 'Cancel', hi: 'रद्द करें', ghost: true, fn: backHome }]);
      }
    } else {
      photo = face.capturePhoto(video);
    }
    face.stopCamera(video);
    cam.innerHTML = `<div class="saving"><img src="${photo}" alt=""><div class="spinner"></div><div class="center">${bi('Saving…', 'सेव हो रहा है…')}</div></div>`;
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
      return showResult('bad', I.alert, ['Not saved', 'सेव नहीं हुआ'], [e.message, 'इंटरनेट चेक करें और फिर कोशिश करें।'],
        [{ en: 'Try again', hi: 'फिर कोशिश करें', fn: () => startPunch(emp, action, { override }) }, { en: 'Back', hi: 'वापस', ghost: true, fn: backHome }]);
    }
    cleanup();
    handlePunchResult(emp, action, r, photo);
  };
}

function handlePunchResult(emp, action, r, photo) {
  const first = String(r.name || emp.name).split(' ')[0];
  if (r.ok && r.status === 'OK') {
    const [hEn, hHi, lEn, lHi] = HELLO[action](first);
    return showResult('ok', I.check, [`${DONE[action][0]} · ${r.time}`, `${DONE[action][1]} · ${r.time}`], [lEn, lHi], [{ en: 'Done', hi: 'ठीक है', fn: backHome }], 3500, photo, [hEn, hHi]);
  }
  if (r.ok && r.status === 'PENDING') {
    return showResult('warn', I.clock, ['Sent to owner', 'मालिक को भेजा गया'], [`${r.name}'s punch at ${r.time} is waiting for the owner's approval.`, 'मालिक की मंज़ूरी के बाद यह पंच गिना जाएगा।'], [{ en: 'Done', hi: 'ठीक है', fn: backHome }], 5000, photo);
  }
  const retries = state.init?.face_retries || 3;
  if (r.code === 'FACE_MISMATCH') {
    const n = r.face_fail_count || 1;
    const buttons = [{ en: 'Try again', hi: 'फिर कोशिश करें', fn: () => startPunch(emp, action) }];
    if (n >= retries) buttons.unshift({ en: 'Send to owner', hi: 'मालिक को भेजें', fn: () => startPunch(emp, action, { override: true }) });
    buttons.push({ en: 'Cancel', hi: 'रद्द करें', ghost: true, fn: backHome });
    return showResult('bad', I.x, ['Face did not match', 'चेहरा मेल नहीं खाया'],
      n >= retries ? [`Tried ${n} times. You can send it to the owner to approve.`, `${n} बार कोशिश हुई। मंज़ूरी के लिए मालिक को भेज सकते हैं।`] : [`Try again in good light (${n}/${retries}).`, `अच्छी रोशनी में फिर कोशिश करें (${n}/${retries})।`], buttons);
  }
  const retry = ['GPS_WEAK', 'GPS_REQUIRED', 'NO_FACE', 'NO_PHOTO'].includes(r.code);
  const icon = (r.code && r.code.startsWith('GPS')) || r.code === 'AWAY_FROM_STORE' ? I.pin : I.x;
  return showResult('bad', icon, ['Not accepted', 'पंच नहीं हुआ'], [r.message, REASON_HI[r.code] || ''], [
    ...(retry ? [{ en: 'Try again', hi: 'फिर कोशिश करें', fn: () => startPunch(emp, action) }] : []),
    { en: 'Back', hi: 'वापस', ghost: retry, fn: backHome }
  ]);
}

/** title/text/hello are [english, hindi] pairs; buttons have en + hi labels. */
function showResult(kind, icon, title, text, buttons, autoMs, photo, hello) {
  const el = document.createElement('div');
  el.className = `result ${kind}`;
  el.innerHTML = `
    ${photo ? `<div class="result-photo"><img src="${photo}" alt=""><span class="badge-ico">${icon}</span></div>` : `<div class="big-icon">${icon}</div>`}
    ${hello ? `<div class="hello">${esc(hello[0])}<span class="hi" lang="hi">${esc(hello[1])}</span></div>` : ''}
    <h1>${bi(title[0], title[1])}</h1><p>${text[1] ? bi(text[0], text[1]) : esc(text[0])}</p>
    <div class="stack" style="margin-top:20px;width:100%;max-width:320px">${buttons.map((b, i) => `<button class="btn big block two-line ${b.ghost ? 'ghost' : ''}" data-i="${i}">${bi(b.en, b.hi)}</button>`).join('')}</div>
    <div class="ornament">${I.lotus}</div>
    ${autoMs ? `<div class="countdown" style="animation-duration:${autoMs}ms"></div>` : ''}`;
  document.body.appendChild(el);
  let timer;
  const close = () => { clearTimeout(timer); el.remove(); };
  $$('[data-i]', el).forEach((btn) => btn.addEventListener('click', () => { close(); buttons[Number(btn.dataset.i)].fn(); }));
  if (autoMs) timer = setTimeout(() => { close(); buttons[0].fn(); }, autoMs);
}

async function backHome() {
  if (state.init) renderHome();   // instant: show the list right away…
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
    if (shownCached) { toast('Offline · इंटरनेट नहीं है', 4000); scheduleRefresh(); return; }
    app.innerHTML = `<div class="card stack center" style="margin-top:40px">${I.alert}<h2>${bi("Can't reach the server", 'सर्वर से जुड़ नहीं पाया')}</h2><p class="muted">${esc(e.message)}</p><button class="btn primary block two-line" id="retry">${bi('Try again', 'फिर कोशिश करें')}</button></div>`;
    $('#retry').onclick = boot;
  }
}

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && store.token && !document.querySelector('.camera, .result')) loadInit().then(renderHome).catch(() => {});
});
boot();
