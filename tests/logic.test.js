// Run: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const L = require('../backend/Logic.js');

const D = '2026-11-23'; // a Monday
const t = (hm) => L.istToMs_(D, hm);
const raw = (id, hm, action, status = 'OK') => ({ log_id: id, date: D, ts_ms: String(t(hm)), emp_id: 'E01', action, status });

test('IST conversion', () => {
  const ms = t('10:04');
  assert.strictEqual(L.istParts_(ms).hm, '10:04');
  assert.strictEqual(L.istParts_(ms).weekday, 'Mon');
  assert.strictEqual(L.fmt12_(ms), '10:04 AM');
  assert.strictEqual(L.fmt12_(t('21:30')), '9:30 PM');
  assert.strictEqual(L.fmt12_(t('00:05')), '12:05 AM');
});

test('state machine allows one shift and breaks', () => {
  assert.deepStrictEqual(L.stateFromPunches_([]).allowed, ['IN']);
  const inOnly = L.effectivePunches_([raw('a', '10:00', 'IN')], [], D);
  assert.deepStrictEqual(L.stateFromPunches_(inOnly).allowed, ['BREAK_OUT', 'OUT']);
  const onBreak = L.effectivePunches_([raw('a', '10:00', 'IN'), raw('b', '14:00', 'BREAK_OUT')], [], D);
  assert.strictEqual(L.stateFromPunches_(onBreak).state, 'BREAK');
  const done = L.effectivePunches_([raw('a', '10:00', 'IN'), raw('b', '20:00', 'OUT')], [], D);
  assert.deepStrictEqual(L.stateFromPunches_(done).allowed, []);
});

test('day summary: worked time minus break, late flag', () => {
  const p = L.effectivePunches_([
    raw('a', '10:20', 'IN'), raw('b', '14:00', 'BREAK_OUT'), raw('c', '14:45', 'BREAK_IN'), raw('d', '21:00', 'OUT')
  ], [], D);
  const s = L.summarizeDay_(p, { shiftStart: '10:00', graceMin: 10, dayOver: true });
  assert.strictEqual(s.break_min, 45);
  assert.strictEqual(s.worked_min, 10 * 60 + 40 - 45);
  assert.ok(s.flags.includes('LATE'));
  assert.strictEqual(s.status, 'DONE');
});

test('missing OUT flagged only after day is over', () => {
  const p = L.effectivePunches_([raw('a', '09:55', 'IN')], [], D);
  assert.ok(!L.summarizeDay_(p, { dayOver: false }).flags.includes('MISSING_OUT'));
  assert.ok(L.summarizeDay_(p, { dayOver: true }).flags.includes('MISSING_OUT'));
});

test('corrections layer on top of raw log', () => {
  const rawRows = [raw('a', '10:00', 'IN'), raw('b', '12:00', 'OUT', 'PENDING')];
  const corr = [
    { corr_id: 'c1', date: D, ts_ms: '1', type: 'REJECT', ref_log_id: 'b', emp_id: 'E01' },
    { corr_id: 'c2', date: D, ts_ms: '2', type: 'ADD_PUNCH', new_value: '21:05', action: 'OUT', emp_id: 'E01', reason: 'forgot' },
    { corr_id: 'c3', date: D, ts_ms: '3', type: 'CHANGE_TIME', ref_log_id: 'a', new_value: '10:10', emp_id: 'E01' }
  ];
  const p = L.effectivePunches_(rawRows, corr, D);
  assert.strictEqual(p.length, 2);
  assert.strictEqual(L.istParts_(p[0].ts).hm, '10:10');
  assert.strictEqual(p[1].status, 'ADDED');
  const s = L.summarizeDay_(p, { dayOver: true });
  assert.ok(s.flags.includes('CORRECTED'));
  assert.strictEqual(s.worked_min, 655);
});

test('pending punches flagged until approved', () => {
  const rawRows = [raw('a', '10:00', 'IN', 'PENDING')];
  assert.ok(L.summarizeDay_(L.effectivePunches_(rawRows, [], D), {}).flags.includes('NEEDS_APPROVAL'));
  const approved = L.effectivePunches_(rawRows, [{ corr_id: 'c', date: D, ts_ms: '1', type: 'APPROVE', ref_log_id: 'a' }], D);
  assert.strictEqual(approved[0].status, 'APPROVED');
  assert.ok(!L.summarizeDay_(approved, {}).flags.includes('NEEDS_APPROVAL'));
});

test('punch window: hours and closed Tuesday', () => {
  const s = { open_time: '09:30', close_time: '21:30', closed_weekdays: 'Tue' };
  assert.strictEqual(L.punchWindow_(t('09:29'), s).is_open, false);
  assert.strictEqual(L.punchWindow_(t('09:30'), s).is_open, true);
  assert.strictEqual(L.punchWindow_(t('21:30'), s).is_open, false);
  const tue = L.istToMs_('2026-11-24', '12:00');
  assert.strictEqual(L.punchWindow_(tue, s).is_open, false);
});

test('GPS distance', () => {
  const d = L.haversineM_(28.4595, 77.0266, 28.4595, 77.0276); // ~98 m east in Gurugram
  assert.ok(d > 90 && d < 105, String(d));
});

test('face distance picks best sample', () => {
  const a = Array(128).fill(0), b = Array(128).fill(0.1), q = Array(128).fill(0.09);
  assert.ok(Math.abs(L.faceDistance_(q, [a, b]) - Math.sqrt(128 * 0.0001)) < 1e-9);
  assert.strictEqual(L.faceDistance_([1, 2], [a]), null);
});

test('web/js/logic.js is an exact copy of backend/Logic.js (run: cp backend/Logic.js web/js/logic.js)', () => {
  const fs = require('fs');
  const path = require('path');
  const a = fs.readFileSync(path.join(__dirname, '..', 'backend', 'Logic.js'), 'utf8');
  const b = fs.readFileSync(path.join(__dirname, '..', 'web', 'js', 'logic.js'), 'utf8');
  assert.strictEqual(a, b);
});
