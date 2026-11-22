/**
 * Google Sheet storage. Every cell is stored as plain text so the hash chain
 * stays exactly reproducible (Sheets never reformats a number or date).
 */
var SHEET = {
  EMP: 'Employees',
  LOG: 'RawLog',
  ATT: 'Attempts',
  CORR: 'Corrections',
  DAILY: 'Daily',
  DEV: 'Devices',
  FACES: 'Faces',
  AUDIT: 'AdminLog',
  SET: 'Settings'
};

var SCHEMA = {
  Employees: ['emp_id', 'name', 'role', 'phone', 'monthly_salary', 'shift_start', 'shift_end', 'active',
    'face_enrolled_on', 'consent_on', 'telegram_receipts', 'telegram_chat_id', 'created_on', 'notes'],
  RawLog: ['log_id', 'ts_ms', 'date', 'time', 'emp_id', 'name', 'action', 'status', 'method',
    'face_distance', 'device_id', 'device_name', 'lat', 'lng', 'accuracy_m', 'distance_m',
    'phone_time', 'selfie_id', 'note', 'prev_hash', 'row_hash'],
  Attempts: ['attempt_id', 'ts_ms', 'date', 'time', 'emp_id', 'name', 'action', 'reason', 'face_distance',
    'device_id', 'device_name', 'lat', 'lng', 'accuracy_m', 'distance_m', 'selfie_id', 'prev_hash', 'row_hash'],
  Corrections: ['corr_id', 'ts_ms', 'time', 'date', 'emp_id', 'name', 'type', 'ref_log_id', 'action',
    'old_value', 'new_value', 'reason', 'by_email', 'prev_hash', 'row_hash'],
  Daily: ['date', 'emp_id', 'name', 'status', 'first_in', 'last_out', 'break_min', 'worked_min', 'worked', 'flags'],
  Devices: ['device_id', 'name', 'token_hash', 'active', 'created_on', 'created_by', 'revoked_on'],
  Faces: ['emp_id', 'descriptors', 'photo_id', 'enrolled_on', 'enrolled_by'],
  AdminLog: ['ts_ms', 'time', 'email', 'what', 'details', 'prev_hash', 'row_hash'],
  Settings: ['key', 'value', 'description']
};

/** Sheets that only ever grow, and are hash-chained. */
var CHAINED = ['RawLog', 'Attempts', 'Corrections', 'AdminLog'];

var _ssCache = null;
function ss_() {
  if (_ssCache) return _ssCache;
  var id = prop_('SPREADSHEET_ID');
  if (!id) throw apiError_('NOT_SET_UP', 'Backend not set up yet. Run setup() in the Apps Script editor.');
  _ssCache = SpreadsheetApp.openById(id);
  return _ssCache;
}

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw apiError_('NOT_SET_UP', 'Missing sheet "' + name + '". Run setup() again.');
  return sh;
}

function rowToObj_(headers, row, rowIndex) {
  var o = { _row: rowIndex };
  for (var i = 0; i < headers.length; i++) o[headers[i]] = row[i] == null ? '' : String(row[i]);
  return o;
}

function readObjects_(name) {
  var sh = sheet_(name);
  var last = sh.getLastRow();
  var headers = SCHEMA[name];
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, headers.length).getValues();
  return values.map(function (r, i) { return rowToObj_(headers, r, i + 2); });
}

/** Last n rows only (recent punches are always at the bottom). */
function readLastObjects_(name, n) {
  var sh = sheet_(name);
  var last = sh.getLastRow();
  var headers = SCHEMA[name];
  if (last < 2) return [];
  var start = Math.max(2, last - n + 1);
  var values = sh.getRange(start, 1, last - start + 1, headers.length).getValues();
  return values.map(function (r, i) { return rowToObj_(headers, r, start + i); });
}

function objToRow_(name, obj) {
  return SCHEMA[name].map(function (h) { return obj[h] == null ? '' : String(obj[h]); });
}

function writeRow_(sh, rowIndex, row) {
  if (rowIndex > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), Math.max(50, rowIndex - sh.getMaxRows()));
  sh.getRange(rowIndex, 1, 1, row.length).setNumberFormat('@').setValues([row]);
}

function appendObject_(name, obj) {
  var sh = sheet_(name);
  writeRow_(sh, sh.getLastRow() + 1, objToRow_(name, obj));
}

function updateObject_(name, rowIndex, obj) {
  writeRow_(sheet_(name), rowIndex, objToRow_(name, obj));
}

function canonical_(name, obj) {
  return SCHEMA[name]
    .filter(function (h) { return h !== 'row_hash'; })
    .map(function (h) { return obj[h] == null ? '' : String(obj[h]); })
    .join('|');
}

/** Append to a hash-chained sheet. Must be called while holding the script lock. */
function appendChained_(name, obj) {
  var sh = sheet_(name);
  var headers = SCHEMA[name];
  var last = sh.getLastRow();
  obj.prev_hash = last > 1 ? String(sh.getRange(last, headers.indexOf('row_hash') + 1).getValue()) : 'GENESIS';
  obj.row_hash = sha256Hex_(canonical_(name, obj));
  writeRow_(sh, last + 1, objToRow_(name, obj));
  return obj;
}

/** Re-checks a chained sheet. Any edited, inserted or deleted row breaks the chain. */
function verifyChain_(name) {
  var rows = readObjects_(name);
  var prev = 'GENESIS';
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (r.prev_hash !== prev) return { sheet: name, ok: false, rows: rows.length, broken_row: r._row, problem: 'A row before this was changed or deleted' };
    if (sha256Hex_(canonical_(name, r)) !== r.row_hash) return { sheet: name, ok: false, rows: rows.length, broken_row: r._row, problem: 'This row was edited' };
    prev = r.row_hash;
  }
  return { sheet: name, ok: true, rows: rows.length };
}

/* ---------- Settings (owner-visible key/value tab) ---------- */

var SETTING_DEFAULTS = [
  ['store_name', 'Saatvikei', 'Shown on the punch screen and in messages'],
  ['open_time', '09:30', 'Punching opens (24h HH:mm, India time)'],
  ['close_time', '21:30', 'Punching closes and the day summary is sent'],
  ['closed_weekdays', 'Tue', 'Days with no punching, comma separated (Sun,Mon,Tue,Wed,Thu,Fri,Sat)'],
  ['store_lat', '', 'Store latitude. Set it from the owner app: Setup → Store location'],
  ['store_lng', '', 'Store longitude'],
  ['store_radius_m', '100', 'Punches further than this many metres from the store are rejected'],
  ['max_gps_accuracy_m', '200', 'Reject the punch if the phone GPS is less precise than this'],
  ['face_check', 'no', 'Match each punch photo against the enrolled face (yes/no). When no, a photo is still taken.'],
  ['face_threshold', '0.5', 'Face match strictness. Lower is stricter (0.45–0.55 recommended)'],
  ['face_retries', '3', 'Failed face checks before a punch can be sent for owner approval'],
  ['min_gap_minutes', '2', 'Minimum minutes between two punches of the same person'],
  ['late_grace_min', '10', 'Minutes after shift start before someone is marked late'],
  ['default_shift_start', '10:00', 'Used when an employee has no own shift start'],
  ['admin_url', '', 'Link to the owner app (used in Telegram "Fix it" links)']
];

var _settingsCache = null;
function settings_() {
  if (_settingsCache) return _settingsCache;
  var s = {};
  SETTING_DEFAULTS.forEach(function (d) { s[d[0]] = d[1]; });
  readObjects_(SHEET.SET).forEach(function (r) { if (r.key) s[r.key] = r.value; });
  _settingsCache = s;
  return s;
}

function saveSettings_(values) {
  var allowed = SETTING_DEFAULTS.map(function (d) { return d[0]; });
  var rows = readObjects_(SHEET.SET);
  var changed = [];
  Object.keys(values).forEach(function (k) {
    if (allowed.indexOf(k) < 0) return;
    var v = String(values[k] == null ? '' : values[k]).trim();
    var row = rows.filter(function (r) { return r.key === k; })[0];
    if (row) {
      if (row.value === v) return;
      changed.push(k + ': "' + row.value + '" → "' + v + '"');
      row.value = v;
      updateObject_(SHEET.SET, row._row, row);
    } else {
      var desc = SETTING_DEFAULTS.filter(function (d) { return d[0] === k; })[0][2];
      appendObject_(SHEET.SET, { key: k, value: v, description: desc });
      changed.push(k + ': → "' + v + '"');
    }
  });
  _settingsCache = null;
  return changed;
}

/* ---------- Small helpers ---------- */

function prop_(key) { return PropertiesService.getScriptProperties().getProperty(key) || ''; }
function setProp_(key, value) { PropertiesService.getScriptProperties().setProperty(key, String(value)); }

function sha256Hex_(str) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(str), Utilities.Charset.UTF_8);
  return bytes.map(function (b) { var v = (b + 256) % 256; return (v < 16 ? '0' : '') + v.toString(16); }).join('');
}

function newId_(prefix) {
  return prefix + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 12).toUpperCase();
}

function randomToken_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

function apiError_(code, message) {
  var e = new Error(message);
  e.apiCode = code;
  return e;
}

function audit_(email, what, details) {
  var now = Date.now();
  appendChained_(SHEET.AUDIT, {
    ts_ms: now, time: istParts_(now).date + ' ' + istParts_(now).hms, email: email, what: what,
    details: typeof details === 'string' ? details : JSON.stringify(details || {})
  });
}

function employees_() {
  return readObjects_(SHEET.EMP);
}

function employeeById_(empId) {
  return employees_().filter(function (e) { return e.emp_id === empId; })[0] || null;
}

function isYes_(v) { return String(v).toLowerCase() === 'yes' || String(v).toUpperCase() === 'TRUE'; }

/** Effective punches for a date for all employees (raw log + corrections). */
function dayPunches_(date, opts) {
  opts = opts || {};
  var raw = opts.recentOnly ? readLastObjects_(SHEET.LOG, 400) : readObjects_(SHEET.LOG);
  var corr = opts.recentOnly ? readLastObjects_(SHEET.CORR, 400) : readObjects_(SHEET.CORR);
  return effectivePunches_(raw, corr, date);
}
