/**
 * Pure logic: no Google services used here, so it can be unit-tested in Node.
 * India has no daylight saving, so IST is always UTC+05:30.
 */
var IST_OFFSET_MS = 330 * 60000;
var WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

var ACTIONS = {
  IN: { label: 'Punch IN', past: 'punched IN', emoji: '🟢' },
  BREAK_OUT: { label: 'Start break', past: 'went on break', emoji: '☕' },
  BREAK_IN: { label: 'Back from break', past: 'came back from break', emoji: '🔙' },
  OUT: { label: 'Punch OUT', past: 'punched OUT', emoji: '🔴' }
};

/** Allowed next actions for each state. One shift per day. */
var TRANSITIONS = {
  OFF: ['IN'],
  IN: ['BREAK_OUT', 'OUT'],
  BREAK: ['BREAK_IN', 'OUT'],
  DONE: []
};

function istParts_(ms) {
  var d = new Date(Number(ms) + IST_OFFSET_MS);
  var iso = d.toISOString();
  return {
    date: iso.slice(0, 10),
    hm: iso.slice(11, 16),
    hms: iso.slice(11, 19),
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
    weekday: WEEKDAYS[d.getUTCDay()]
  };
}

/** "2026-11-23" + "10:04" (IST) -> epoch ms */
function istToMs_(date, hm) {
  return Date.parse(date + 'T' + hm + ':00+05:30');
}

function hmToMin_(hm) {
  var m = /^(\d{1,2}):(\d{2})$/.exec(String(hm || '').trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function fmt12_(ms) {
  var p = istParts_(ms);
  var h = Math.floor(p.minutes / 60), mi = p.minutes % 60;
  var ampm = h >= 12 ? 'PM' : 'AM';
  var h12 = h % 12 === 0 ? 12 : h % 12;
  return h12 + ':' + (mi < 10 ? '0' : '') + mi + ' ' + ampm;
}

function fmtHm12_(hm) {
  var mins = hmToMin_(hm);
  if (mins == null) return hm;
  var h = Math.floor(mins / 60), mi = mins % 60;
  return (h % 12 === 0 ? 12 : h % 12) + ':' + (mi < 10 ? '0' : '') + mi + ' ' + (h >= 12 ? 'PM' : 'AM');
}

function fmtDuration_(mins) {
  mins = Math.max(0, Math.round(mins));
  var h = Math.floor(mins / 60), m = mins % 60;
  return h ? h + 'h ' + m + 'm' : m + 'm';
}

function fmtDateLong_(date) {
  var d = new Date(date + 'T00:00:00Z');
  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return WEEKDAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + months[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
}

/** Distance in metres between two GPS points. */
function haversineM_(lat1, lng1, lat2, lng2) {
  var R = 6371000, toRad = Math.PI / 180;
  var dLat = (lat2 - lat1) * toRad, dLng = (lng2 - lng1) * toRad;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Smallest Euclidean distance between a 128-d face descriptor and enrolled samples. Lower = more similar. */
function faceDistance_(descriptor, samples) {
  if (!descriptor || descriptor.length !== 128 || !samples || !samples.length) return null;
  var best = Infinity;
  for (var s = 0; s < samples.length; s++) {
    var sample = samples[s];
    if (!sample || sample.length !== 128) continue;
    var sum = 0;
    for (var i = 0; i < 128; i++) {
      var diff = Number(descriptor[i]) - Number(sample[i]);
      sum += diff * diff;
    }
    best = Math.min(best, Math.sqrt(sum));
  }
  return best === Infinity ? null : best;
}

/**
 * Builds the effective list of punches for one date, applying owner corrections.
 * The raw log is never changed; corrections are layered on top.
 */
function effectivePunches_(rawRows, corrRows, date) {
  var byId = {};
  var list = [];
  rawRows.forEach(function (r) {
    if (r.date !== date) return;
    if (r.status !== 'OK' && r.status !== 'PENDING') return;
    var p = {
      id: r.log_id, emp_id: r.emp_id, ts: Number(r.ts_ms), action: r.action,
      status: r.status, method: r.method, face_distance: r.face_distance,
      distance_m: r.distance_m, selfie_id: r.selfie_id, source: 'PUNCH', edited: false
    };
    byId[p.id] = p;
    list.push(p);
  });
  corrRows
    .filter(function (c) { return c.date === date; })
    .sort(function (a, b) { return Number(a.ts_ms) - Number(b.ts_ms); })
    .forEach(function (c) {
      var target = byId[c.ref_log_id];
      switch (c.type) {
        case 'APPROVE':
          if (target) target.status = 'APPROVED';
          break;
        case 'REJECT':
        case 'VOID':
          if (target) target.removed = true;
          break;
        case 'CHANGE_TIME':
          if (target && c.new_value) { target.ts = istToMs_(date, c.new_value); target.edited = true; }
          break;
        case 'ADD_PUNCH':
          var added = {
            id: c.corr_id, emp_id: c.emp_id, ts: istToMs_(date, c.new_value), action: c.action,
            status: 'ADDED', method: 'OWNER', source: 'CORRECTION', edited: true, reason: c.reason
          };
          byId[added.id] = added;
          list.push(added);
          break;
      }
    });
  return list
    .filter(function (p) { return !p.removed; })
    .sort(function (a, b) { return a.ts - b.ts; });
}

function stateFromPunches_(punches) {
  var state = 'OFF', last = null;
  punches.forEach(function (p) {
    last = p;
    if (p.action === 'IN' || p.action === 'BREAK_IN') state = 'IN';
    else if (p.action === 'BREAK_OUT') state = 'BREAK';
    else if (p.action === 'OUT') state = 'DONE';
  });
  return { state: state, last: last, allowed: TRANSITIONS[state].slice() };
}

/**
 * Summary of one employee's day.
 * opts: { shiftStart:'HH:mm', graceMin:number, dayOver:boolean }
 */
function summarizeDay_(punches, opts) {
  opts = opts || {};
  var firstIn = null, lastOut = null, breakMin = 0, breakStart = null, flags = [];
  punches.forEach(function (p) {
    if (p.action === 'IN' && firstIn == null) firstIn = p.ts;
    if (p.action === 'BREAK_OUT') breakStart = p.ts;
    if (p.action === 'BREAK_IN' && breakStart != null) { breakMin += (p.ts - breakStart) / 60000; breakStart = null; }
    if (p.action === 'OUT') {
      lastOut = p.ts;
      if (breakStart != null) { flags.push('LEFT_DURING_BREAK'); breakStart = null; }
    }
    if (p.status === 'PENDING') flags.push('NEEDS_APPROVAL');
    if (p.edited) flags.push('CORRECTED');
  });
  var worked = 0;
  if (firstIn != null && lastOut != null) worked = Math.max(0, (lastOut - firstIn) / 60000 - breakMin);
  var status;
  if (firstIn == null) status = 'ABSENT';
  else if (lastOut == null) status = breakStart != null ? 'ON_BREAK' : 'IN';
  else status = 'DONE';
  if (firstIn != null && lastOut == null && opts.dayOver) flags.push('MISSING_OUT');
  if (firstIn != null && opts.shiftStart) {
    var startMin = hmToMin_(opts.shiftStart);
    var inMin = istParts_(firstIn).minutes;
    var late = inMin - startMin - (Number(opts.graceMin) || 0);
    if (startMin != null && late > 0) flags.push('LATE');
  }
  var uniq = [];
  flags.forEach(function (f) { if (uniq.indexOf(f) < 0) uniq.push(f); });
  return {
    status: status,
    first_in: firstIn, last_out: lastOut,
    first_in_text: firstIn ? fmt12_(firstIn) : '',
    last_out_text: lastOut ? fmt12_(lastOut) : '',
    break_min: Math.round(breakMin),
    worked_min: Math.round(worked),
    worked_text: worked ? fmtDuration_(worked) : '',
    flags: uniq
  };
}

/** Is punching allowed right now? settings: open_time, close_time, closed_weekdays ("Tue,Sun") */
function punchWindow_(ms, settings) {
  var p = istParts_(ms);
  var closedDays = String(settings.closed_weekdays || '').split(',')
    .map(function (s) { return s.trim(); }).filter(Boolean);
  var openMin = hmToMin_(settings.open_time), closeMin = hmToMin_(settings.close_time);
  var res = {
    date: p.date, weekday: p.weekday,
    open_time: settings.open_time, close_time: settings.close_time,
    is_open: true, reason: ''
  };
  if (closedDays.indexOf(p.weekday) >= 0) {
    res.is_open = false;
    res.reason = 'The store is closed on ' + p.weekday + 'days. Punching is off today.';
  } else if (openMin != null && p.minutes < openMin) {
    res.is_open = false;
    res.reason = 'Punching opens at ' + fmtHm12_(settings.open_time) + '.';
  } else if (closeMin != null && p.minutes >= closeMin) {
    res.is_open = false;
    res.reason = 'Punching closed at ' + fmtHm12_(settings.close_time) + '. It opens again tomorrow.';
  }
  return res;
}

/* Node export for tests (ignored in Apps Script). */
if (typeof module !== 'undefined') {
  module.exports = {
    istParts_: istParts_, istToMs_: istToMs_, hmToMin_: hmToMin_, fmt12_: fmt12_, fmtDuration_: fmtDuration_,
    haversineM_: haversineM_, faceDistance_: faceDistance_, effectivePunches_: effectivePunches_,
    stateFromPunches_: stateFromPunches_, summarizeDay_: summarizeDay_, punchWindow_: punchWindow_,
    fmtDateLong_: fmtDateLong_, fmtHm12_: fmtHm12_
  };
}
