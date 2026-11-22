// Demo backend that runs in the browser, so the apps can be tried without Google.
// Only used when APP_CONFIG.API_URL === 'mock'. It reuses the real backend rules (logic.js).
const KEY = 'saativkei_mock_db_v1';
let L = null;

async function logic() {
  if (L) return L;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('./logic.js', import.meta.url).href;
    s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
  L = window; // logic.js defines plain global functions
  return L;
}

function seed() {
  const L = window;
  const today = L.istParts_(Date.now()).date;
  const yest = L.istParts_(Date.now() - 86400000).date;
  const at = (d, hm) => L.istToMs_(d, hm);
  const emps0 = [
    { emp_id: 'E01', name: 'Rahul Verma', role: 'manager', monthly_salary: '18000', shift_start: '10:00', shift_end: '21:00', active: 'yes', face_enrolled_on: yest, telegram_receipts: 'yes', telegram_chat_id: '1' },
    { emp_id: 'E02', name: 'Priya Sharma', role: 'staff', monthly_salary: '14000', shift_start: '10:00', shift_end: '21:00', active: 'yes', face_enrolled_on: yest },
    { emp_id: 'E03', name: 'Amit Kumar', role: 'staff', monthly_salary: '13000', shift_start: '10:00', shift_end: '21:00', active: 'yes', face_enrolled_on: yest },
    { emp_id: 'E04', name: 'Sunita Devi', role: 'staff', monthly_salary: '12000', shift_start: '11:00', shift_end: '20:00', active: 'yes', face_enrolled_on: '' }
  ];
  const emps = emps0.map((e) => ({ ...e, created_on: L.istParts_(Date.now() - 5 * 86400000).date }));
  let n = 0;
  const p = (date, emp, hm, action, status = 'OK') => ({ log_id: 'P-' + (++n), ts_ms: String(at(date, hm)), date, emp_id: emp, name: emps.find((e) => e.emp_id === emp).name, action, status, method: status === 'OK' ? 'FACE' : 'OVERRIDE', face_distance: '0.38', distance_m: '18', selfie_id: 'demo' });
  const log = [
    p(yest, 'E01', '09:52', 'IN'), p(yest, 'E01', '14:05', 'BREAK_OUT'), p(yest, 'E01', '14:48', 'BREAK_IN'), p(yest, 'E01', '21:04', 'OUT'),
    p(yest, 'E02', '10:14', 'IN'), p(yest, 'E02', '20:58', 'OUT'),
    p(yest, 'E03', '10:31', 'IN')
  ];
  const nowMin = L.istParts_(Date.now()).minutes;
  if (nowMin > 10 * 60) log.push(p(today, 'E01', '09:58', 'IN'));
  if (nowMin > 10 * 60 + 20) log.push(p(today, 'E02', '10:12', 'IN', 'PENDING'));
  return {
    employees: emps, log, corrections: [], attempts: [
      { attempt_id: 'A-1', ts_ms: String(at(yest, '10:29')), date: yest, emp_id: 'E03', name: 'Amit Kumar', action: 'IN', reason: 'FACE_MISMATCH', face_distance: '0.61', distance_m: '20', selfie_id: 'demo' }
    ],
    devices: [{ device_id: 'DEV-1', name: "Rahul's phone", active: 'yes', created_on: yest, created_by: 'owner@example.com' }],
    settings: { face_check: 'no', store_name: 'Saativkei', open_time: '00:00', close_time: '23:59', closed_weekdays: '', store_lat: '28.4595', store_lng: '77.0266', store_radius_m: '100', max_gps_accuracy_m: '200', face_threshold: '0.5', face_retries: '3', min_gap_minutes: '2', late_grace_min: '10', default_shift_start: '10:00', admin_url: '' },
    chats: [], admins: ['owner@example.com', 'developer@example.com']
  };
}

function load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } }
function save(db) { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* ignore */ } }

const photo = () => {
  const c = document.createElement('canvas'); c.width = 300; c.height = 400;
  const g = c.getContext('2d'); g.fillStyle = '#8a7461'; g.fillRect(0, 0, 300, 400);
  g.font = '140px serif'; g.textAlign = 'center'; g.fillText('🙂', 150, 250);
  return c.toDataURL('image/jpeg', 0.7);
};

export async function mockCall(req) {
  const L = await logic();
  await new Promise((r) => setTimeout(r, 250));
  let db = load();
  if (!db) { db = seed(); save(db); }
  const now = Date.now();
  const ist = L.istParts_(now);
  const s = db.settings;
  const day = (date) => L.effectivePunches_(db.log, db.corrections, date);
  const fail = (code, message) => ({ ok: false, code, message });

  switch (req.action) {
    case 'device.pair':
      if (!/^\d{6}$/.test(req.code || '')) return fail('BAD_CODE', 'Demo: any 6 digits work.');
      return { ok: true, device_token: 'demo-token', device_name: 'Demo phone' };
    case 'kiosk.init': {
      const punches = day(ist.date);
      return {
        ok: true, store_name: s.store_name, device_name: 'Demo phone', window: L.punchWindow_(now, s), face_retries: 3, face_check: s.face_check === 'yes',
        employees: db.employees.filter((e) => e.active === 'yes').map((e) => {
          const st = L.stateFromPunches_(punches.filter((p) => p.emp_id === e.emp_id));
          return { emp_id: e.emp_id, name: e.name, role: e.role, enrolled: !!e.face_enrolled_on, state: st.state, allowed: st.allowed, last_action: st.last?.action || '', last_time: st.last ? L.fmt12_(st.last.ts) : '' };
        })
      };
    }
    case 'kiosk.punch': {
      const e = db.employees.find((x) => x.emp_id === req.emp_id);
      const st = L.stateFromPunches_(day(ist.date).filter((p) => p.emp_id === e.emp_id));
      if (!st.allowed.includes(req.punch)) return { ok: false, code: 'WRONG_ORDER', message: e.name + ' cannot do that now.', face_fail_count: 0 };
      db.log.push({ log_id: 'P-' + now, ts_ms: String(now), date: ist.date, emp_id: e.emp_id, name: e.name, action: req.punch, status: req.override ? 'PENDING' : 'OK', method: req.override ? 'OVERRIDE' : 'FACE', face_distance: '0.36', distance_m: '15', selfie_id: 'demo' });
      save(db);
      return { ok: true, status: req.override ? 'PENDING' : 'OK', name: e.name, action: req.punch, time: L.fmt12_(now) };
    }
    case 'admin.me': return { ok: true, email: 'owner@example.com', store_name: s.store_name, face_check: s.face_check === 'yes' };
    case 'admin.day': {
      const date = req.date || ist.date;
      const punches = day(date);
      const closeMin = L.hmToMin_(s.close_time);
      const dayOver = date < ist.date || (date === ist.date && ist.minutes >= closeMin);
      return {
        ok: true, date, date_text: L.fmtDateLong_(date), window: L.punchWindow_(L.istToMs_(date, '12:00'), s),
        employees: db.employees.map((e) => {
          const mine = punches.filter((p) => p.emp_id === e.emp_id);
          return {
            emp_id: e.emp_id, name: e.name, active: e.active === 'yes',
            summary: L.summarizeDay_(mine, { shiftStart: e.shift_start, graceMin: s.late_grace_min, dayOver }),
            punches: mine.map((p) => ({ id: p.id, time: L.fmt12_(p.ts), hm: L.istParts_(p.ts).hm, action: p.action, status: p.status, method: p.method, source: p.source, edited: p.edited, face_distance: p.face_distance, distance_m: p.distance_m, selfie_id: p.selfie_id || '', reason: p.reason || '' })),
            attempts: db.attempts.filter((a) => a.date === date && a.emp_id === e.emp_id).map((a) => ({ id: a.attempt_id, time: L.fmt12_(Number(a.ts_ms)), action: a.action, reason: a.reason, distance_m: a.distance_m, selfie_id: a.selfie_id, face_distance: a.face_distance }))
          };
        }),
        corrections: db.corrections.filter((c) => c.date === date).map((c) => ({ ...c, id: c.corr_id, by: c.by_email }))
      };
    }
    case 'admin.pending': {
      const decided = new Set(db.corrections.filter((c) => ['APPROVE', 'REJECT', 'VOID'].includes(c.type)).map((c) => c.ref_log_id));
      return { ok: true, pending: db.log.filter((r) => r.status === 'PENDING' && !decided.has(r.log_id)).map((r) => ({ id: r.log_id, date: r.date, date_text: L.fmtDateLong_(r.date), time: L.fmt12_(Number(r.ts_ms)), emp_id: r.emp_id, name: r.name, action: r.action, face_distance: r.face_distance, distance_m: r.distance_m, selfie_id: r.selfie_id })) };
    }
    case 'admin.range': {
      const days = [];
      const closed = s.closed_weekdays.split(',').map((x) => x.trim());
      for (let ms = L.istToMs_(req.from, '12:00'); L.istParts_(ms).date <= req.to && days.length < 62; ms += 86400000) {
        const p = L.istParts_(ms);
        const punches = day(p.date);
        days.push({ date: p.date, date_text: L.fmtDateLong_(p.date), closed: closed.includes(p.weekday), employees: db.employees.map((e) => ({ emp_id: e.emp_id, name: e.name, created_on: e.created_on, summary: L.summarizeDay_(punches.filter((x) => x.emp_id === e.emp_id), { shiftStart: e.shift_start, graceMin: s.late_grace_min, dayOver: p.date < ist.date }) })) });
      }
      return { ok: true, from: req.from, to: req.to, days };
    }
    case 'admin.photo': return { ok: true, data: photo() };
    case 'admin.correct': {
      const e = db.employees.find((x) => x.emp_id === req.emp_id);
      const target = day(req.date).find((p) => p.id === req.ref_log_id);
      db.corrections.push({ corr_id: 'C-' + now, ts_ms: String(now), time: ist.date + ' ' + ist.hms, date: req.date, emp_id: e.emp_id, name: e.name, type: req.type, ref_log_id: req.ref_log_id || '', action: req.punch || '', old_value: target ? L.istParts_(target.ts).hm : '', new_value: req.time || '', reason: req.reason || 'Approved', by_email: 'owner@example.com' });
      save(db);
      return { ok: true };
    }
    case 'admin.employees': return { ok: true, employees: db.employees.map((e) => ({ ...e, face_samples: e.face_enrolled_on ? 5 : 0, telegram_linked: !!e.telegram_chat_id })) };
    case 'admin.employee.save': {
      const e = req.employee;
      if (!e.name) return fail('BAD_REQUEST', 'Name is required.');
      if (e.emp_id) Object.assign(db.employees.find((x) => x.emp_id === e.emp_id), e);
      else db.employees.push({ ...e, emp_id: 'E0' + (db.employees.length + 1), active: 'yes', face_enrolled_on: '' });
      save(db);
      return { ok: true };
    }
    case 'admin.face.enroll': {
      if (!req.consent) return fail('BAD_REQUEST', 'Confirm consent first.');
      db.employees.find((x) => x.emp_id === req.emp_id).face_enrolled_on = ist.date; save(db); return { ok: true };
    }
    case 'admin.face.delete': db.employees.find((x) => x.emp_id === req.emp_id).face_enrolled_on = ''; save(db); return { ok: true };
    case 'admin.devices': return { ok: true, devices: db.devices.map((d) => ({ ...d, active: d.active === 'yes' })) };
    case 'admin.device.code': return { ok: true, code: String(Math.floor(100000 + Math.random() * 900000)), expires_min: 15 };
    case 'admin.device.revoke': db.devices.find((d) => d.device_id === req.device_id).active = 'no'; save(db); return { ok: true };
    case 'admin.settings': return { ok: true, me: 'owner@example.com', settings: s, descriptions: {}, telegram: { configured: true, bot: 'SaativkeiAttendanceBot', chats: db.chats }, admins: db.admins, links: { sheet: '#', folder: '#' } };
    case 'admin.settings.save': Object.assign(db.settings, req.values); save(db); return { ok: true, changes: Object.keys(req.values) };
    case 'admin.telegram.token': return { ok: true, bot: 'SaativkeiAttendanceBot' };
    case 'admin.telegram.link': return { ok: true, url: 'https://t.me/SaativkeiAttendanceBot?start=demo', code: 'demo' };
    case 'admin.telegram.check':
      if (!req.emp_id && !db.chats.length) db.chats.push({ chat_id: 1, email: 'owner@example.com', name: 'Owner', linked_on: ist.date });
      save(db); return { ok: true, linked: [{ type: 'admin', name: 'Owner' }] };
    case 'admin.telegram.test': return { ok: true };
    case 'admin.telegram.unlink': db.chats = db.chats.filter((c) => String(c.chat_id) !== String(req.chat_id)); save(db); return { ok: true };
    case 'admin.admins.add': db.admins.push(req.email); save(db); return { ok: true, admins: db.admins };
    case 'admin.admins.remove': db.admins = db.admins.filter((x) => x !== req.email); save(db); return { ok: true, admins: db.admins };
    case 'admin.integrity': return { ok: true, all_ok: true, results: ['RawLog', 'Attempts', 'Corrections', 'AdminLog'].map((n) => ({ sheet: n, ok: true, rows: n === 'RawLog' ? db.log.length : 0 })) };
    default: return fail('UNKNOWN_ACTION', 'Unknown action ' + req.action);
  }
}

export function resetMock() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }
