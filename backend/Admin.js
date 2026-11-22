/**
 * Owner / developer API. Requires a Google sign-in (ID token) from an email in ADMIN_EMAILS.
 */

function adminEmails_() {
  return prop_('ADMIN_EMAILS').split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
}

function requireAdmin_(req) {
  var tok = String(req.id_token || '');
  if (!tok) throw apiError_('AUTH_REQUIRED', 'Please sign in with Google.');
  var cache = CacheService.getScriptCache();
  var key = 'idt_' + sha256Hex_(tok).slice(0, 40);
  var email = cache.get(key);
  if (!email) {
    var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(tok), { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw apiError_('AUTH_REQUIRED', 'Your sign-in has expired. Please sign in again.');
    var info = JSON.parse(res.getContentText());
    var clientId = prop_('GOOGLE_CLIENT_ID') || SETUP_CONFIG.GOOGLE_CLIENT_ID;
    if (!clientId || info.aud !== clientId) throw apiError_('AUTH_REQUIRED', 'This sign-in is not for this app.');
    if (String(info.email_verified) !== 'true') throw apiError_('AUTH_REQUIRED', 'Google email not verified.');
    var secsLeft = Number(info.exp) - Math.floor(Date.now() / 1000);
    if (secsLeft <= 0) throw apiError_('AUTH_REQUIRED', 'Your sign-in has expired. Please sign in again.');
    email = String(info.email).toLowerCase();
    cache.put(key, email, Math.max(30, Math.min(600, secsLeft)));
    if (info.given_name) cache.put('name_' + email, String(info.given_name), 21600);
  }
  if (adminEmails_().indexOf(email) < 0) throw apiError_('NOT_ADMIN', email + ' is not an admin of this attendance system.');
  return email;
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ---------- Views ---------- */

function adminMe_(req) {
  var email = requireAdmin_(req);
  try { fixBrandName_(); } catch (e) { console.warn(e); }
  var name = CacheService.getScriptCache().get('name_' + email) || '';
  return { ok: true, email: email, name: name, store_name: settings_().store_name, face_check: isYes_(settings_().face_check) };
}

function dayReport_(date, rawAll, corrAll, attAll, emps, s) {
  var punches = effectivePunches_(rawAll, corrAll, date);
  var todayDate = istParts_(Date.now()).date;
  var closeMin = hmToMin_(s.close_time);
  var dayOver = date < todayDate || (date === todayDate && closeMin != null && istParts_(Date.now()).minutes >= closeMin);
  var rawById = {};
  rawAll.forEach(function (r) { if (r.date === date) rawById[r.log_id] = r; });
  return emps.map(function (e) {
    var mine = punches.filter(function (p) { return p.emp_id === e.emp_id; });
    var sum = summarizeDay_(mine, { shiftStart: e.shift_start || s.default_shift_start, graceMin: s.late_grace_min, dayOver: dayOver });
    return {
      emp_id: e.emp_id, name: e.name, active: isYes_(e.active), created_on: e.created_on,
      summary: sum,
      punches: mine.map(function (p) {
        return {
          id: p.id, ts: p.ts, time: fmt12_(p.ts), hm: istParts_(p.ts).hm, action: p.action, status: p.status, method: p.method,
          source: p.source, edited: p.edited, face_distance: p.face_distance, distance_m: p.distance_m,
          selfie_id: p.selfie_id || (rawById[p.id] ? rawById[p.id].selfie_id : ''), reason: p.reason || ''
        };
      }),
      attempts: attAll.filter(function (a) { return a.date === date && a.emp_id === e.emp_id; }).map(function (a) {
        return { id: a.attempt_id, ts: Number(a.ts_ms), time: fmt12_(Number(a.ts_ms)), action: a.action, reason: a.reason, distance_m: a.distance_m, selfie_id: a.selfie_id, face_distance: a.face_distance };
      })
    };
  }).filter(function (r) { return r.active || r.punches.length; });
}

function adminDay_(req) {
  requireAdmin_(req);
  var date = String(req.date || istParts_(Date.now()).date);
  var s = settings_();
  var rows = dayReport_(date, readObjects_(SHEET.LOG), readObjects_(SHEET.CORR), readObjects_(SHEET.ATT), employees_(), s);
  var corrections = readObjects_(SHEET.CORR).filter(function (c) { return c.date === date; }).map(function (c) {
    return { id: c.corr_id, time: c.time, emp_id: c.emp_id, name: c.name, type: c.type, action: c.action, old_value: c.old_value, new_value: c.new_value, reason: c.reason, by: c.by_email };
  });
  return { ok: true, date: date, date_text: fmtDateLong_(date), window: punchWindow_(istToMs_(date, '12:00'), s), employees: rows, corrections: corrections };
}

function adminPending_(req) {
  requireAdmin_(req);
  var corr = readObjects_(SHEET.CORR);
  var decided = {};
  corr.forEach(function (c) { if (c.type === 'APPROVE' || c.type === 'REJECT' || c.type === 'VOID') decided[c.ref_log_id] = true; });
  var list = readObjects_(SHEET.LOG).filter(function (r) { return r.status === 'PENDING' && !decided[r.log_id]; }).map(function (r) {
    return { id: r.log_id, date: r.date, date_text: fmtDateLong_(r.date), time: fmt12_(Number(r.ts_ms)), emp_id: r.emp_id, name: r.name, action: r.action, face_distance: r.face_distance, distance_m: r.distance_m, selfie_id: r.selfie_id };
  });
  return { ok: true, pending: list.reverse() };
}

/** Small counts for the tab badges: pending approvals, new activity since a time, open problems today. */
function adminBadges_(req) {
  requireAdmin_(req);
  var since = Number(req.since) || 0;
  var today = istParts_(Date.now()).date;
  var raw = readLastObjects_(SHEET.LOG, 600), corr = readObjects_(SHEET.CORR), att = readLastObjects_(SHEET.ATT, 300);
  var decided = {};
  corr.forEach(function (c) { if (c.type === 'APPROVE' || c.type === 'REJECT' || c.type === 'VOID') decided[c.ref_log_id] = true; });
  var pending = readObjects_(SHEET.LOG).filter(function (r) { return r.status === 'PENDING' && !decided[r.log_id]; }).length;
  var fresh = raw.filter(function (r) { return r.date === today && Number(r.ts_ms) > since; }).length +
    att.filter(function (a) { return a.date === today && Number(a.ts_ms) > since; }).length;
  return { ok: true, pending: pending, new_activity: fresh, server_time: Date.now() };
}

function adminRange_(req) {
  requireAdmin_(req);
  var from = String(req.from), to = String(req.to);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw apiError_('BAD_REQUEST', 'Pick a valid date range.');
  var s = settings_();
  var raw = readObjects_(SHEET.LOG), corr = readObjects_(SHEET.CORR), emps = employees_();
  var closed = String(s.closed_weekdays || '').split(',').map(function (x) { return x.trim(); });
  var days = [];
  for (var ms = istToMs_(from, '12:00'); istParts_(ms).date <= to; ms += 86400000) {
    var p = istParts_(ms);
    var rows = dayReport_(p.date, raw, corr, [], emps, s);
    days.push({
      date: p.date, date_text: fmtDateLong_(p.date), closed: closed.indexOf(p.weekday) >= 0,
      employees: rows.map(function (r) { return { emp_id: r.emp_id, name: r.name, created_on: r.created_on, summary: r.summary }; })
    });
    if (days.length > 62) break;
  }
  return { ok: true, from: from, to: to, days: days };
}

function adminPhoto_(req) {
  requireAdmin_(req);
  var file = DriveApp.getFileById(String(req.file_id));
  if (String(file.getMimeType()).indexOf('image/') !== 0) throw apiError_('BAD_REQUEST', 'Not a photo.');
  return { ok: true, data: 'data:' + file.getMimeType() + ';base64,' + Utilities.base64Encode(file.getBlob().getBytes()) };
}

/* ---------- Corrections & approvals (never touch the raw log) ---------- */

function adminCorrect_(req) {
  var email = requireAdmin_(req);
  var type = String(req.type || '');
  var reason = String(req.reason || '').trim();
  if (['ADD_PUNCH', 'CHANGE_TIME', 'VOID', 'APPROVE', 'REJECT'].indexOf(type) < 0) throw apiError_('BAD_REQUEST', 'Unknown correction.');
  if (reason.length < 3 && type !== 'APPROVE') throw apiError_('BAD_REQUEST', 'Please write a short reason.');
  var emp = employeeById_(String(req.emp_id || ''));
  if (!emp) throw apiError_('BAD_REQUEST', 'Employee not found.');
  var date = String(req.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw apiError_('BAD_REQUEST', 'Bad date.');
  var hm = String(req.time || '');
  if ((type === 'ADD_PUNCH' || type === 'CHANGE_TIME') && hmToMin_(hm) == null) throw apiError_('BAD_REQUEST', 'Pick a time.');
  if (type === 'ADD_PUNCH' && !ACTIONS[req.punch]) throw apiError_('BAD_REQUEST', 'Pick IN, OUT or break.');

  var now = Date.now();
  var ref = String(req.ref_log_id || '');
  var oldValue = '';
  var punches = effectivePunches_(readObjects_(SHEET.LOG), readObjects_(SHEET.CORR), date);
  if (type !== 'ADD_PUNCH') {
    var target = punches.filter(function (p) { return p.id === ref; })[0];
    if (!target) throw apiError_('BAD_REQUEST', 'That punch was not found (maybe already removed).');
    oldValue = istParts_(target.ts).hm;
    if (type === 'APPROVE' && target.status !== 'PENDING') throw apiError_('BAD_REQUEST', 'This punch does not need approval.');
  }
  var corr = withLock_(function () {
    return appendChained_(SHEET.CORR, {
      corr_id: newId_('C'), ts_ms: now, time: istParts_(now).date + ' ' + istParts_(now).hms, date: date,
      emp_id: emp.emp_id, name: emp.name, type: type, ref_log_id: ref, action: type === 'ADD_PUNCH' ? req.punch : '',
      old_value: oldValue, new_value: hm, reason: reason || 'Approved', by_email: email
    });
  });
  var labels = { ADD_PUNCH: 'added a punch', CHANGE_TIME: 'changed a punch time', VOID: 'removed a punch', APPROVE: 'approved a punch', REJECT: 'rejected a punch' };
  var detail = type === 'ADD_PUNCH' ? (ACTIONS[req.punch].label + ' at ' + fmtHm12_(hm)) :
    type === 'CHANGE_TIME' ? (fmtHm12_(oldValue) + ' → ' + fmtHm12_(hm)) : ('punch at ' + fmtHm12_(oldValue));
  notifyOwners_('✏️ ' + email + ' ' + labels[type] + '\n' + emp.name + ' · ' + fmtDateLong_(date) + '\n' + detail + '\nReason: ' + corr.reason);
  try { recomputeDaily_(date); } catch (e) { console.warn(e); }
  return { ok: true, correction_id: corr.corr_id };
}

/* ---------- Employees & faces ---------- */

function adminEmployees_(req) {
  requireAdmin_(req);
  var faces = {};
  readObjects_(SHEET.FACES).forEach(function (f) { faces[f.emp_id] = f; });
  return {
    ok: true, employees: employees_().map(function (e) {
      var o = {};
      SCHEMA.Employees.forEach(function (h) { o[h] = e[h]; });
      o.face_samples = faces[e.emp_id] ? JSON.parse(faces[e.emp_id].descriptors || '[]').length : 0;
      o.face_photo_id = faces[e.emp_id] ? faces[e.emp_id].photo_id : '';
      o.telegram_linked = !!e.telegram_chat_id;
      delete o.telegram_chat_id;
      return o;
    })
  };
}

function adminSaveEmployee_(req) {
  var email = requireAdmin_(req);
  var e = req.employee || {};
  var name = String(e.name || '').trim();
  if (!name) throw apiError_('BAD_REQUEST', 'Name is required.');
  ['shift_start', 'shift_end'].forEach(function (k) { if (e[k] && hmToMin_(e[k]) == null) throw apiError_('BAD_REQUEST', 'Shift times must look like 10:00'); });
  return withLock_(function () {
    ensureHeaders_(SHEET.EMP);
    var all = employees_(true);
    var row = e.emp_id ? all.filter(function (x) { return x.emp_id === e.emp_id && !x.removed_on; })[0] : null;
    var fields = ['name', 'role', 'phone', 'monthly_salary', 'shift_start', 'shift_end', 'active', 'notes', 'telegram_receipts'];
    if (row) {
      var changes = [];
      fields.forEach(function (k) {
        if (e[k] === undefined) return;
        var v = String(e[k]).trim();
        if (row[k] !== v) { changes.push(k + ': "' + row[k] + '" → "' + v + '"'); row[k] = v; }
      });
      updateObject_(SHEET.EMP, row._row, row);
      if (changes.length) audit_(email, 'EMPLOYEE_UPDATED', { emp_id: row.emp_id, changes: changes });
      return { ok: true, emp_id: row.emp_id };
    }
    var maxNum = all.reduce(function (m, x) { var n = Number(String(x.emp_id).replace(/\D/g, '')); return n > m ? n : m; }, 0);
    var id = 'E' + (maxNum + 1 < 10 ? '0' : '') + (maxNum + 1);
    var obj = { emp_id: id, created_on: istParts_(Date.now()).date, active: 'yes', role: 'staff', telegram_receipts: 'no' };
    fields.forEach(function (k) { if (e[k] !== undefined) obj[k] = String(e[k]).trim(); });
    appendObject_(SHEET.EMP, obj);
    audit_(email, 'EMPLOYEE_ADDED', { emp_id: id, name: name });
    return { ok: true, emp_id: id };
  });
}

/**
 * Removes a staff member (for test or mistaken entries).
 * - Never punched: the row is deleted completely.
 * - Has punches: hidden from every screen, but the punch log stays untouched (it is evidence
 *   and is hash-chained). Their ID is never reused.
 */
function adminRemoveEmployee_(req) {
  var email = requireAdmin_(req);
  var empId = String(req.emp_id || '');
  var result = withLock_(function () {
    ensureHeaders_(SHEET.EMP);
    var emp = employees_(true).filter(function (x) { return x.emp_id === empId && !x.removed_on; })[0];
    if (!emp) throw apiError_('BAD_REQUEST', 'Staff member not found.');
    var used = readObjects_(SHEET.LOG).some(function (r) { return r.emp_id === empId; }) ||
      readObjects_(SHEET.ATT).some(function (r) { return r.emp_id === empId; }) ||
      readObjects_(SHEET.CORR).some(function (r) { return r.emp_id === empId; });
    var face = readObjects_(SHEET.FACES).filter(function (f) { return f.emp_id === empId; })[0];
    if (face) sheet_(SHEET.FACES).deleteRow(face._row);
    var mode;
    if (used) {
      emp.active = 'no';
      emp.removed_on = istParts_(Date.now()).date;
      emp.face_enrolled_on = '';
      emp.telegram_chat_id = '';
      emp.telegram_receipts = 'no';
      updateObject_(SHEET.EMP, emp._row, emp);
      mode = 'hidden';
    } else {
      sheet_(SHEET.EMP).deleteRow(emp._row);
      mode = 'deleted';
    }
    audit_(email, 'EMPLOYEE_REMOVED', { emp_id: empId, name: emp.name, mode: mode });
    return { name: emp.name, mode: mode };
  });
  notifyOwners_('🗑 ' + email + ' removed ' + result.name + ' from staff.' +
    (result.mode === 'hidden' ? '\nTheir past punches stay in the records sheet as proof but are hidden from the app.' : ''));
  return { ok: true, mode: result.mode };
}

function adminEnrollFace_(req) {
  var email = requireAdmin_(req);
  if (!req.consent) throw apiError_('BAD_REQUEST', 'Confirm the employee has agreed to face check first.');
  var samples = req.descriptors || [];
  if (samples.length < 3 || samples.some(function (d) { return !d || d.length !== 128; })) throw apiError_('BAD_REQUEST', 'Need at least 3 good face samples.');
  var emp = employeeById_(String(req.emp_id || ''));
  if (!emp) throw apiError_('BAD_REQUEST', 'Employee not found.');
  var clean = samples.map(function (d) { return d.map(function (x) { return Math.round(Number(x) * 1e5) / 1e5; }); });
  var photoId = '';
  if (req.photo) {
    var bytes = Utilities.base64Decode(String(req.photo).replace(/^data:image\/\w+;base64,/, ''));
    var root = DriveApp.getFolderById(prop_('FOLDER_ID'));
    var it = root.getFoldersByName('Face enrolment photos');
    var folder = it.hasNext() ? it.next() : root.createFolder('Face enrolment photos');
    photoId = folder.createFile(Utilities.newBlob(bytes, 'image/jpeg', emp.emp_id + '_' + emp.name.replace(/[^\w]+/g, '') + '_' + istParts_(Date.now()).date + '.jpg')).getId();
  }
  withLock_(function () {
    var existing = readObjects_(SHEET.FACES).filter(function (f) { return f.emp_id === emp.emp_id; })[0];
    var obj = { emp_id: emp.emp_id, descriptors: JSON.stringify(clean), photo_id: photoId, enrolled_on: istParts_(Date.now()).date, enrolled_by: email };
    if (existing) updateObject_(SHEET.FACES, existing._row, obj); else appendObject_(SHEET.FACES, obj);
    var fresh = employeeById_(emp.emp_id);
    fresh.face_enrolled_on = obj.enrolled_on;
    if (!fresh.consent_on) fresh.consent_on = obj.enrolled_on;
    updateObject_(SHEET.EMP, fresh._row, fresh);
    audit_(email, existing ? 'FACE_RE_ENROLLED' : 'FACE_ENROLLED', { emp_id: emp.emp_id, samples: clean.length });
  });
  notifyOwners_('🙂 Face ' + 'enrolled for ' + emp.name + ' by ' + email);
  return { ok: true };
}

function adminDeleteFace_(req) {
  var email = requireAdmin_(req);
  var emp = employeeById_(String(req.emp_id || ''));
  if (!emp) throw apiError_('BAD_REQUEST', 'Employee not found.');
  withLock_(function () {
    var f = readObjects_(SHEET.FACES).filter(function (x) { return x.emp_id === emp.emp_id; })[0];
    if (f) sheet_(SHEET.FACES).deleteRow(f._row);
    var fresh = employeeById_(emp.emp_id);
    fresh.face_enrolled_on = '';
    updateObject_(SHEET.EMP, fresh._row, fresh);
    audit_(email, 'FACE_DELETED', { emp_id: emp.emp_id });
  });
  return { ok: true };
}

/* ---------- Punch phones ---------- */

function adminDevices_(req) {
  requireAdmin_(req);
  return { ok: true, devices: readObjects_(SHEET.DEV).map(function (d) { return { device_id: d.device_id, name: d.name, active: isYes_(d.active), created_on: d.created_on, created_by: d.created_by, revoked_on: d.revoked_on }; }) };
}

function adminPairCode_(req) {
  var email = requireAdmin_(req);
  var name = String(req.name || '').trim() || 'Punch phone';
  var code = String(Math.floor(100000 + Math.random() * 900000));
  CacheService.getScriptCache().put('pair_' + code, JSON.stringify({ name: name, by: email }), 900);
  return { ok: true, code: code, expires_min: 15 };
}

function adminRevokeDevice_(req) {
  var email = requireAdmin_(req);
  withLock_(function () {
    var d = readObjects_(SHEET.DEV).filter(function (x) { return x.device_id === req.device_id; })[0];
    if (!d) throw apiError_('BAD_REQUEST', 'Phone not found.');
    d.active = 'no';
    d.revoked_on = istParts_(Date.now()).date;
    updateObject_(SHEET.DEV, d._row, d);
    audit_(email, 'DEVICE_REVOKED', { device_id: d.device_id, name: d.name });
  });
  return { ok: true };
}

/* ---------- Settings, Telegram, admins, integrity ---------- */

function adminSettings_(req) {
  var email = requireAdmin_(req);
  var tgUser = prop_('TELEGRAM_BOT_USERNAME');
  return {
    ok: true, me: email, settings: settings_(),
    descriptions: SETTING_DEFAULTS.reduce(function (o, d) { o[d[0]] = d[2]; return o; }, {}),
    telegram: { configured: !!tgToken_(), bot: tgUser, chats: ownerChats_() },
    admins: adminEmails_(),
    links: { sheet: ss_().getUrl(), folder: DriveApp.getFolderById(prop_('FOLDER_ID')).getUrl() }
  };
}

function adminSaveSettings_(req) {
  var email = requireAdmin_(req);
  var v = req.values || {};
  if (v.open_time && hmToMin_(v.open_time) == null) throw apiError_('BAD_REQUEST', 'Open time must look like 09:30');
  if (v.close_time && hmToMin_(v.close_time) == null) throw apiError_('BAD_REQUEST', 'Close time must look like 21:30');
  var changes = withLock_(function () {
    var c = saveSettings_(v);
    if (c.length) audit_(email, 'SETTINGS_CHANGED', c);
    return c;
  });
  if (changes.length) notifyOwners_('⚙️ Settings changed by ' + email + ':\n' + changes.join('\n'));
  return { ok: true, changes: changes };
}

function adminTelegramToken_(req) {
  var email = requireAdmin_(req);
  var token = String(req.token || '').trim();
  var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/getMe', { muteHttpExceptions: true });
  var body = JSON.parse(res.getContentText() || '{}');
  if (!body.ok) throw apiError_('BAD_REQUEST', 'Telegram did not accept that bot token.');
  setProp_('TELEGRAM_BOT_TOKEN', token);
  setProp_('TELEGRAM_BOT_USERNAME', body.result.username);
  withLock_(function () { audit_(email, 'TELEGRAM_BOT_SET', { bot: body.result.username }); });
  return { ok: true, bot: body.result.username };
}

function adminTelegramLink_(req) {
  var email = requireAdmin_(req);
  var target = req.emp_id ? { type: 'staff', emp_id: String(req.emp_id) } : { type: 'admin', email: email };
  return Object.assign({ ok: true }, tgLinkCode_(target));
}

function adminTelegramCheck_(req) {
  requireAdmin_(req);
  return { ok: true, linked: withLock_(tgPollLinks_) };
}

function adminTelegramTest_(req) {
  var email = requireAdmin_(req);
  if (!ownerChats_().length) throw apiError_('BAD_REQUEST', 'No Telegram chat is connected yet.');
  notifyOwners_('🔔 Test message from ' + settings_().store_name + ' attendance (sent by ' + email + ').');
  return { ok: true };
}

function adminTelegramUnlink_(req) {
  var email = requireAdmin_(req);
  if (req.emp_id) {
    withLock_(function () {
      var e = employeeById_(String(req.emp_id));
      if (e) { e.telegram_chat_id = ''; e.telegram_receipts = 'no'; updateObject_(SHEET.EMP, e._row, e); }
      audit_(email, 'STAFF_TELEGRAM_REMOVED', { emp_id: req.emp_id });
    });
  } else {
    saveOwnerChats_(ownerChats_().filter(function (c) { return String(c.chat_id) !== String(req.chat_id); }));
    withLock_(function () { audit_(email, 'OWNER_TELEGRAM_REMOVED', { chat_id: req.chat_id }); });
  }
  return { ok: true };
}

function adminAddAdmin_(req) {
  var email = requireAdmin_(req);
  var add = String(req.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(add)) throw apiError_('BAD_REQUEST', 'Enter a valid Google email.');
  var list = adminEmails_();
  if (list.indexOf(add) < 0) list.push(add);
  setProp_('ADMIN_EMAILS', list.join(','));
  try { ss_().addEditor(add); DriveApp.getFolderById(prop_('FOLDER_ID')).addEditor(add); } catch (e) { console.warn('Share failed: ' + e); }
  withLock_(function () { audit_(email, 'ADMIN_ADDED', { email: add }); });
  notifyOwners_('👤 ' + email + ' added ' + add + ' as an admin.');
  return { ok: true, admins: list };
}

function adminRemoveAdmin_(req) {
  var email = requireAdmin_(req);
  var rm = String(req.email || '').trim().toLowerCase();
  if (rm === email) throw apiError_('BAD_REQUEST', 'You cannot remove yourself.');
  var list = adminEmails_().filter(function (x) { return x !== rm; });
  if (!list.length) throw apiError_('BAD_REQUEST', 'At least one admin is needed.');
  setProp_('ADMIN_EMAILS', list.join(','));
  try { ss_().removeEditor(rm); DriveApp.getFolderById(prop_('FOLDER_ID')).removeEditor(rm); } catch (e) { console.warn('Unshare failed: ' + e); }
  withLock_(function () { audit_(email, 'ADMIN_REMOVED', { email: rm }); });
  notifyOwners_('👤 ' + email + ' removed ' + rm + ' as an admin.');
  return { ok: true, admins: list };
}

function adminIntegrity_(req) {
  requireAdmin_(req);
  var results = CHAINED.map(verifyChain_);
  return { ok: true, all_ok: results.every(function (r) { return r.ok; }), results: results };
}
