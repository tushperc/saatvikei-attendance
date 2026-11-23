// Tiny DOM helpers shared by the punch app and the owner app.
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

let toastTimer;
export function toast(msg, ms = 3000) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), ms);
}

/** Bottom sheet on phones, centred dialog on laptops. Returns { el, close }. */
export function sheet(html, { onClose } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="grabber"></div>${html}</div>`;
  const panel = overlay.firstElementChild;
  // Keep the sheet inside the part of the screen the keyboard leaves visible (iPhone and Android).
  const vv = window.visualViewport;
  const fit = () => {
    if (!vv) return;
    overlay.style.height = `${vv.height}px`;
    overlay.style.top = `${vv.offsetTop}px`;
    // Little room (keyboard open): let the Save button scroll with the form instead of covering it.
    overlay.classList.toggle('tight', vv.height < 600);
  };
  if (vv) { vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); fit(); }
  // When a field is tapped, scroll it into the middle of the sheet once the keyboard has opened.
  panel.addEventListener('focusin', (e) => {
    if (!e.target.matches('input, select, textarea')) return;
    setTimeout(() => e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 320);
  });
  document.documentElement.classList.add('sheet-open');
  const close = () => {
    if (vv) { vv.removeEventListener('resize', fit); vv.removeEventListener('scroll', fit); }
    overlay.remove();
    if (!document.querySelector('.overlay')) document.documentElement.classList.remove('sheet-open');
    onClose && onClose();
  };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  document.body.appendChild(overlay);
  return { el: panel, close };
}

/*
 * Visible press feedback: the tapped button changes colour while touched, and keeps it for a
 * moment after, so it's obvious (also in screen recordings) which button was pressed.
 */
const PRESSABLE = '.btn, .pbtn, .day-pill, .tabbar button, .shutter, .icon-btn, .search-clear, .result-close, .member, .list-row[data-emp]';
export function enablePressFeedback() {
  document.addEventListener('touchstart', () => {}, { passive: true }); // lets iOS apply :active
  const press = (e) => {
    const el = e.target.closest(PRESSABLE);
    if (!el || el.disabled) return;
    el.classList.add('pressed');
    const release = () => setTimeout(() => el.classList.remove('pressed'), 220);
    el.addEventListener('pointerup', release, { once: true });
    el.addEventListener('pointercancel', release, { once: true });
    el.addEventListener('pointerleave', release, { once: true });
    setTimeout(() => el.classList.remove('pressed'), 1500);
  };
  document.addEventListener('pointerdown', press, { passive: true });
}

export const ACTION_LABEL = { IN: 'Punch IN', BREAK_OUT: 'Start break', BREAK_IN: 'Back from break', OUT: 'Punch OUT' };
export const ACTION_PAST = { IN: 'Punched IN', BREAK_OUT: 'Went on break', BREAK_IN: 'Back from break', OUT: 'Punched OUT' };
export const ACTION_ICON = { IN: '🟢', BREAK_OUT: '☕', BREAK_IN: '🔙', OUT: '🔴' };

export function istNow() {
  const d = new Date(Date.now() + 330 * 60000);
  return { date: d.toISOString().slice(0, 10), hm: d.toISOString().slice(11, 16) };
}

export function fmtClock(d = new Date()) {
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
}

export function fmtDay(d = new Date()) {
  return d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
}

export function getPosition(timeout = 12000) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({ error: 'This phone has no GPS support.' });
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (err) => resolve({ error: err.code === 1 ? 'Location is blocked. Allow it in phone settings.' : 'Could not get GPS location.' }),
      { enableHighAccuracy: true, timeout, maximumAge: 20000 }
    );
  });
}

/** Fades out the logo splash (kept on screen at least ~0.9 s so it doesn't flash). */
const splashStart = performance.now();
export function hideSplash() {
  const el = document.getElementById('splash');
  if (!el || el.classList.contains('out')) return;
  const wait = Math.max(0, 350 - (performance.now() - splashStart));
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 600); }, wait);
}

/** "12m ago" style text. */
export function ago(ms) {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60}m ago` : `${Math.floor(h / 24)}d ago`;
}

/** Tiny "last known screen" cache so screens can show instantly, then refresh. */
export const snap = {
  get(key, maxAgeMs = 12 * 3600e3) {
    try { const v = JSON.parse(localStorage.getItem('snap_' + key)); return v && Date.now() - v.t < maxAgeMs ? v.d : null; } catch { return null; }
  },
  set(key, data) { try { localStorage.setItem('snap_' + key, JSON.stringify({ t: Date.now(), d: data })); } catch { /* full or private */ } }
};

/** A portrait photo widened into a landscape band: blurred copy fills the sides, brand tint on top. */
export function bandMedia(url) {
  return `<div class="band-bg" style="background-image:url('${url}')"></div><img class="band-fig" src="${url}" alt="" decoding="async">`;
}

/** Long date, India time. */
export function longDay(d = new Date()) {
  const o = { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' };
  return { en: d.toLocaleDateString('en-IN', o) };
}
