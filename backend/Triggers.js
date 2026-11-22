/**
 * Runs every 5 minutes (installed by setup()).
 *  - At opening time: "Attendance is open" message
 *  - At closing time: day summary with missing punch-outs and a "Fix it" link
 *  - Completes pending Telegram links
 */
function tick() {
  try { fixBrandName_(); } catch (e) { console.warn(e); }
  var props = PropertiesService.getScriptProperties();
  var now = Date.now();
  var ist = istParts_(now);
  var s = settings_();
  var win = punchWindow_(now, s);
  var openMin = hmToMin_(s.open_time), closeMin = hmToMin_(s.close_time);
  var closedToday = String(s.closed_weekdays || '').split(',').map(function (x) { return x.trim(); }).indexOf(ist.weekday) >= 0;

  if (!closedToday && openMin != null && ist.minutes >= openMin && (closeMin == null || ist.minutes < closeMin) &&
      props.getProperty('OPEN_SENT') !== ist.date) {
    props.setProperty('OPEN_SENT', ist.date);
    notifyOwners_('☀️ ' + s.store_name + ' attendance is open today (' + fmtDateLong_(ist.date) + ')\nPunching works from ' +
      fmtHm12_(s.open_time) + ' to ' + fmtHm12_(s.close_time) + '.');
  }

  if (!closedToday && closeMin != null && ist.minutes >= closeMin && props.getProperty('CLOSE_SENT') !== ist.date) {
    props.setProperty('CLOSE_SENT', ist.date);
    var text = daySummaryText_(ist.date);
    notifyOwners_(text);
    recomputeDaily_(ist.date);
  }

  try {
    var lock = LockService.getScriptLock();
    if (lock.tryLock(5000)) { try { tgPollLinks_(); } finally { lock.releaseLock(); } }
  } catch (e) { console.warn(e); }
  return win;
}

function daySummaryText_(date) {
  var s = settings_();
  var emps = employees_().filter(function (e) { return isYes_(e.active); });
  var punches = dayPunches_(date);
  var lines = [], problems = 0;
  emps.forEach(function (e) {
    var sum = summarizeDay_(punches.filter(function (p) { return p.emp_id === e.emp_id; }),
      { shiftStart: e.shift_start || s.default_shift_start, graceMin: s.late_grace_min, dayOver: true });
    if (sum.status === 'ABSENT') { lines.push('❌ ' + e.name + ': absent (no punch)'); return; }
    var line = (sum.flags.length ? '⚠️ ' : '✅ ') + e.name + ': ' + sum.first_in_text + ' – ' + (sum.last_out_text || '??');
    if (sum.last_out) line += ' · ' + sum.worked_text + (sum.break_min ? ' (break ' + fmtDuration_(sum.break_min) + ')' : '');
    var f = sum.flags.map(function (x) {
      return { MISSING_OUT: 'no punch OUT', LATE: 'late', NEEDS_APPROVAL: 'needs approval', CORRECTED: 'corrected', LEFT_DURING_BREAK: 'left during break' }[x] || x;
    });
    if (f.length) { line += '\n     ↳ ' + f.join(', '); if (sum.flags.indexOf('MISSING_OUT') >= 0 || sum.flags.indexOf('NEEDS_APPROVAL') >= 0) problems++; }
    lines.push(line);
  });
  var link = adminLink_('day=' + date);
  return '🌙 Day summary · ' + fmtDateLong_(date) + '\n\n' + (lines.join('\n') || 'No staff added yet.') +
    (problems ? '\n\n' + problems + ' item(s) need your attention.' + (link ? '\nFix it: ' + link : '') : (link ? '\n\nOpen: ' + link : ''));
}

/** Rewrites the derived "Daily" tab for one date (this tab is a convenience view, not evidence). */
function recomputeDaily_(date) {
  var s = settings_();
  var sh = sheet_(SHEET.DAILY);
  var existing = readObjects_(SHEET.DAILY);
  for (var i = existing.length - 1; i >= 0; i--) if (existing[i].date === date) sh.deleteRow(existing[i]._row);
  bust_(SHEET.DAILY);
  var punches = dayPunches_(date);
  employees_().forEach(function (e) {
    var mine = punches.filter(function (p) { return p.emp_id === e.emp_id; });
    if (!isYes_(e.active) && !mine.length) return;
    var sum = summarizeDay_(mine, { shiftStart: e.shift_start || s.default_shift_start, graceMin: s.late_grace_min, dayOver: true });
    appendObject_(SHEET.DAILY, {
      date: date, emp_id: e.emp_id, name: e.name, status: sum.status, first_in: sum.first_in_text, last_out: sum.last_out_text,
      break_min: sum.break_min, worked_min: sum.worked_min, worked: sum.worked_text, flags: sum.flags.join(' ')
    });
  });
}
