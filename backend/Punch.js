/**
 * Punch phone (kiosk) API. Every request must carry the device token that was
 * issued when the owner paired the phone. The manager has no other powers.
 */

function requireDevice_(req) {
  var token = String(req.device_token || '');
  if (!token) throw apiError_('DEVICE_NOT_PAIRED', 'This phone is not registered for punching. Ask the owner for a pairing code.');
  var hash = sha256Hex_(token);
  var d = readObjects_(SHEET.DEV).filter(function (x) { return x.token_hash === hash; })[0];
  if (!d || !isYes_(d.active)) throw apiError_('DEVICE_NOT_PAIRED', 'This phone is no longer allowed to punch. Ask the owner for a new pairing code.');
  return d;
}

/** Owner creates a 6-digit code in the owner app; the manager types it once on the punch phone. */
function devicePair_(req) {
  var code = String(req.code || '').replace(/\D/g, '');
  var cache = CacheService.getScriptCache();
  var raw = code ? cache.get('pair_' + code) : null;
  if (!raw) throw apiError_('BAD_CODE', 'That code is wrong or has expired. Ask the owner for a new one.');
  cache.remove('pair_' + code);
  var info = JSON.parse(raw);
  var token = randomToken_();
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var dev = { device_id: newId_('DEV'), name: info.name, token_hash: sha256Hex_(token), active: 'yes',
      created_on: istParts_(Date.now()).date, created_by: info.by, revoked_on: '' };
    appendObject_(SHEET.DEV, dev);
    audit_(info.by, 'DEVICE_PAIRED', { device_id: dev.device_id, name: dev.name, user_agent: String(req.user_agent || '').slice(0, 200) });
  } finally { lock.releaseLock(); }
  notifyOwners_('📱 New punch phone registered: "' + info.name + '"\nIf you did not expect this, remove it in the owner app → Setup → Punch phones.');
  return { ok: true, device_token: token, device_name: info.name };
}

function employeeStatusList_(now) {
  var date = istParts_(now).date;
  var punches = dayPunches_(date, { recentOnly: true });
  return employees_()
    .filter(function (e) { return isYes_(e.active); })
    .map(function (e) {
      var mine = punches.filter(function (p) { return p.emp_id === e.emp_id; });
      var st = stateFromPunches_(mine);
      return {
        emp_id: e.emp_id, name: e.name, role: e.role,
        enrolled: !!e.face_enrolled_on,
        state: st.state, allowed: st.allowed,
        last_action: st.last ? st.last.action : '', last_time: st.last ? fmt12_(st.last.ts) : ''
      };
    })
    .sort(function (a, b) { return a.name.localeCompare(b.name); });
}

function kioskInit_(req) {
  var dev = requireDevice_(req);
  var now = Date.now();
  var s = settings_();
  return {
    ok: true,
    store_name: s.store_name,
    device_name: dev.name,
    window: punchWindow_(now, s),
    server_time: now,
    face_retries: Number(s.face_retries) || 3,
    face_check: isYes_(s.face_check),
    employees: employeeStatusList_(now)
  };
}

/**
 * The punch itself. Every check happens here on the server, so the phone can't skip them:
 * hours, GPS, punch order, double-tap gap and face match.
 */
function kioskPunch_(req) {
  var dev = requireDevice_(req);
  var s = settings_();
  var now = Date.now();
  var ist = istParts_(now);
  var emp = employeeById_(String(req.emp_id || ''));
  if (!emp || !isYes_(emp.active)) throw apiError_('UNKNOWN_EMPLOYEE', 'Employee not found.');
  var action = String(req.punch || '');
  if (!ACTIONS[action]) throw apiError_('BAD_ACTION', 'Unknown punch type.');

  var lat = req.lat === '' || req.lat == null ? null : Number(req.lat);
  var lng = req.lng === '' || req.lng == null ? null : Number(req.lng);
  var acc = req.accuracy == null ? null : Math.round(Number(req.accuracy));
  var distance = null;
  if (lat != null && lng != null && s.store_lat && s.store_lng) {
    distance = Math.round(haversineM_(lat, lng, Number(s.store_lat), Number(s.store_lng)));
  }

  // Save the photo first (outside the lock) so even rejected attempts leave a photo.
  var photoBlob = null, selfieId = '';
  if (req.photo) {
    var bytes = Utilities.base64Decode(String(req.photo).replace(/^data:image\/\w+;base64,/, ''));
    var fname = ist.date + '_' + ist.hms.replace(/:/g, '') + '_' + emp.emp_id + '_' + emp.name.replace(/[^\w]+/g, '') + '_' + action + '.jpg';
    photoBlob = Utilities.newBlob(bytes, 'image/jpeg', fname);
    selfieId = selfieFolderFor_(ist.date).createFile(photoBlob).getId();
  }

  var base = {
    ts_ms: now, date: ist.date, time: ist.hms, emp_id: emp.emp_id, name: emp.name, action: action,
    device_id: dev.device_id, device_name: dev.name, lat: lat == null ? '' : lat.toFixed(6),
    lng: lng == null ? '' : lng.toFixed(6), accuracy_m: acc == null ? '' : acc,
    distance_m: distance == null ? '' : distance, selfie_id: selfieId
  };

  function reject(code, message, faceDist) {
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    var count = 0;
    try {
      var att = Object.assign({}, base, { attempt_id: newId_('ATT'), reason: code, face_distance: faceDist == null ? '' : faceDist.toFixed(4) });
      appendChained_(SHEET.ATT, att);
      if (code === 'FACE_MISMATCH') count = recentFaceFails_(emp.emp_id, now);
    } finally { lock.releaseLock(); }
    notifyOwners_('⛔ Punch NOT accepted: ' + emp.name + ' (' + ACTIONS[action].label + ')\n' +
      fmt12_(now) + ' · ' + fmtDateLong_(ist.date) + '\nReason: ' + message +
      (distance != null ? '\n📍 ' + distance + ' m from store' : '') + '\n📱 ' + dev.name, photoBlob);
    return { ok: false, code: code, message: message, face_fail_count: count };
  }

  // 1. Store hours
  var win = punchWindow_(now, s);
  if (!win.is_open) return reject('OUTSIDE_HOURS', win.reason);

  // 2. GPS
  if (s.store_lat && s.store_lng) {
    if (lat == null || lng == null) return reject('GPS_REQUIRED', 'Location is off. Turn on location for this browser and try again.');
    var maxAcc = Number(s.max_gps_accuracy_m) || 200;
    if (acc != null && acc > maxAcc) return reject('GPS_WEAK', 'GPS signal is weak (±' + acc + ' m). Move near the door or a window and try again.');
    var radius = Number(s.store_radius_m) || 100;
    if (distance > radius + Math.min(acc || 0, 50)) return reject('AWAY_FROM_STORE', 'This phone is ' + distance + ' m from the store. Punching only works at the store.');
  }

  // 3. Photo (always) and face match (only when the owner turns face check on)
  if (!req.photo) return reject('NO_PHOTO', 'No photo was taken.');
  var faceOn = isYes_(s.face_check);
  var method = 'PHOTO', status = 'OK', dist = null;
  if (faceOn) {
    if (!emp.face_enrolled_on) return reject('NOT_ENROLLED', emp.name + "'s face is not enrolled yet. The owner must enrol it first.");
    var faceRow = readObjects_(SHEET.FACES).filter(function (f) { return f.emp_id === emp.emp_id; })[0];
    var samples = faceRow ? JSON.parse(faceRow.descriptors || '[]') : [];
    dist = faceDistance_(req.descriptor, samples);
    if (dist == null) return reject('NO_FACE', 'No face found in the photo. Try again in better light.');
    var threshold = Number(s.face_threshold) || 0.5;
    method = 'FACE';
    if (dist > threshold) {
      if (req.override) {
        var fails = recentFaceFails_(emp.emp_id, now);
        var needed = Number(s.face_retries) || 3;
        if (fails < needed) return reject('FACE_MISMATCH', 'Face did not match ' + emp.name + '.', dist);
        method = 'OVERRIDE';
        status = 'PENDING';
      } else {
        return reject('FACE_MISMATCH', 'Face did not match ' + emp.name + '.', dist);
      }
    }
  }

  // 4. Order + double-tap gap, then write. Under lock so two punches can't race.
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var rec;
  try {
    var mine = dayPunches_(ist.date, { recentOnly: true }).filter(function (p) { return p.emp_id === emp.emp_id; });
    var st = stateFromPunches_(mine);
    if (st.allowed.indexOf(action) < 0) {
      lock.releaseLock();
      return reject('WRONG_ORDER', wrongOrderMessage_(emp.name, st));
    }
    var gap = Number(s.min_gap_minutes) || 2;
    if (st.last && now - st.last.ts < gap * 60000) {
      lock.releaseLock();
      return reject('TOO_SOON', emp.name + ' was punched ' + Math.round((now - st.last.ts) / 1000) + ' seconds ago. Wait ' + gap + ' minutes between punches.');
    }
    rec = Object.assign({}, base, {
      log_id: newId_('P'), status: status, method: method, face_distance: dist == null ? '' : dist.toFixed(4),
      phone_time: req.phone_time ? String(req.phone_time) : '',
      note: !s.store_lat ? 'Store location not set — GPS not checked' : ''
    });
    appendChained_(SHEET.LOG, rec);
  } finally {
    try { lock.releaseLock(); } catch (e) { /* already released */ }
  }

  var a = ACTIONS[action];
  var caption = a.emoji + ' ' + emp.name + ' ' + a.past + '\n' + fmt12_(now) + ' · ' + fmtDateLong_(ist.date) +
    (dist != null ? '\n🙂 Face ' + (status === 'OK' ? 'matched' : 'NOT matched') + ' (' + dist.toFixed(2) + ')' : '') +
    (distance != null ? '\n📍 ' + distance + ' m from store' : '') + '\n📱 ' + dev.name;
  if (status === 'PENDING') {
    caption = '⚠️ NEEDS YOUR APPROVAL\n' + caption + '\nFace failed ' + (Number(s.face_retries) || 3) +
      ' times, so it was sent for approval. It will not count until you approve.' +
      (adminLink_('approvals') ? '\nReview: ' + adminLink_('approvals') : '');
  }
  notifyOwners_(caption, photoBlob);
  if (isYes_(emp.telegram_receipts) && emp.telegram_chat_id) {
    notifyChat_(emp.telegram_chat_id, 'Hi ' + emp.name + ', you ' + a.past + ' at ' + fmt12_(now) + ' (' + fmtDateLong_(ist.date) + ') ' +
      (status === 'OK' ? '✅' : '⏳ waiting for owner approval'));
  }

  return { ok: true, status: status, name: emp.name, action: action, time: fmt12_(now), message: emp.name + ' ' + a.past + ' at ' + fmt12_(now) };
}

function wrongOrderMessage_(name, st) {
  var t = st.last ? fmt12_(st.last.ts) : '';
  switch (st.state) {
    case 'OFF': return name + ' has not punched IN yet today.';
    case 'IN': return name + ' is already IN (since ' + t + ').';
    case 'BREAK': return name + ' is on a break (since ' + t + '). Use "Back from break" first.';
    case 'DONE': return name + ' already punched OUT today at ' + t + '. Only the owner can change this.';
  }
  return 'That punch is not allowed right now.';
}

function recentFaceFails_(empId, now) {
  return readLastObjects_(SHEET.ATT, 200).filter(function (a) {
    return a.emp_id === empId && a.reason === 'FACE_MISMATCH' && now - Number(a.ts_ms) < 30 * 60000;
  }).length;
}

/* ---------- Drive folders ---------- */

function selfieFolderFor_(date) {
  var root = DriveApp.getFolderById(prop_('SELFIE_FOLDER_ID'));
  var month = date.slice(0, 7);
  var it = root.getFoldersByName(month);
  return it.hasNext() ? it.next() : root.createFolder(month);
}
