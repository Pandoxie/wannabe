import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cronMatches, describeTask, dueRun, formatLocal, lastRunBetween, makeTask, nextRuns, parseCron, parseLocalTime, taskEnvelope,
} from '../tasks.mjs';

const TZ = 'Asia/Shanghai';
const at = (s) => parseLocalTime(s, TZ);
const ctx = (now, existing = []) => ({ id: 't1', sessionId: 's1', now, defaultTz: TZ, existing });

test('cron: fields, ranges, steps, lists; Sunday is 0 or 7; day-of-month OR day-of-week', () => {
  const c = parseCron('35 15 * * 1-5');
  assert.equal(cronMatches(c, at('2026-11-13 15:35'), TZ), true);  // Friday
  assert.equal(cronMatches(c, at('2026-11-14 15:35'), TZ), false); // Saturday
  assert.equal(cronMatches(c, at('2026-11-13 15:36'), TZ), false);
  assert.equal(cronMatches(parseCron('0 9 * * 7'), at('2026-11-15 09:00'), TZ), true); // Sunday
  assert.equal(cronMatches(parseCron('*/15 * * * *'), at('2026-11-13 10:45'), TZ), true);
  const both = parseCron('0 8 1 * 1');
  assert.equal(cronMatches(both, at('2026-12-01 08:00'), TZ), true);  // the 1st (a Tuesday)
  assert.equal(cronMatches(both, at('2026-11-16 08:00'), TZ), true);  // a Monday
  assert.throws(() => parseCron('35 15 * *'), /5 fields/);
  assert.throws(() => parseCron('60 * * * *'), /minute/);
  assert.throws(() => parseCron('x * * * *'), /Cannot read/);
});

test('time zones: local times convert both ways, also across DST', () => {
  assert.equal(formatLocal(at('2026-11-13 15:35'), TZ), '2026-11-13 15:35');
  assert.equal(at('2026-11-13 15:35'), Date.UTC(2026, 10, 13, 7, 35));
  const ny = parseLocalTime('2026-07-01 09:30', 'America/New_York');
  assert.equal(ny, Date.UTC(2026, 6, 1, 13, 30));
  assert.throws(() => parseLocalTime('2026-03-08 02:30', 'America/New_York'), /does not exist/);
  assert.throws(() => parseLocalTime('tomorrow', TZ), /YYYY-MM-DD/);
});

test('next and last runs', () => {
  const c = parseCron('35 15 * * 1-5');
  assert.deepEqual(nextRuns(c, TZ, at('2026-11-13 16:00'), 2).map((t) => formatLocal(t, TZ)), ['2026-11-16 15:35', '2026-11-17 15:35']);
  assert.equal(formatLocal(lastRunBetween(c, TZ, at('2026-11-12 16:00'), at('2026-11-16 20:00')), TZ), '2026-11-16 15:35');
  assert.equal(lastRunBetween(c, TZ, at('2026-11-16 15:35'), at('2026-11-16 20:00')), null);
});

test('creating tasks: one of cron / at, limits, nothing due before creation', () => {
  const now = at('2026-11-13 10:00');
  const r = makeTask({ name: '股票复盘', prompt: '做今日复盘', cron: '35  15 * * 1-5' }, ctx(now));
  assert.equal(r.task.cron, '35 15 * * 1-5');
  assert.equal(dueRun(r.task, at('2026-11-13 15:34')), null);
  assert.equal(formatLocal(dueRun(r.task, at('2026-11-13 15:40')), TZ), '2026-11-13 15:35');
  const once = makeTask({ name: 'call', prompt: 'remind', at: '2026-11-13 18:00' }, ctx(now)).task;
  assert.equal(dueRun(once, at('2026-11-13 17:59')), null);
  assert.equal(dueRun(once, at('2026-11-13 18:00')), at('2026-11-13 18:00'));
  assert.equal(dueRun({ ...once, lastRunAt: at('2026-11-13 18:00') }, at('2026-11-14 18:00')), null);
  assert.match(makeTask({ name: 'x', prompt: 'y', cron: '* * * * *' }, ctx(now)).error, /every 5 minutes/);
  assert.match(makeTask({ name: 'x', prompt: 'y', at: '2026-11-12 18:00' }, ctx(now)).error, /past/);
  assert.match(makeTask({ name: 'x', prompt: 'y', cron: '0 9 * * *', at: '2026-11-14 09:00' }, ctx(now)).error, /either/);
  assert.match(makeTask({ name: 'x', prompt: 'y', cron: '0 9 * * *', timezone: 'Mars/Base' }, ctx(now)).error, /time zone/);
  assert.match(makeTask({ name: '', prompt: 'y', cron: '0 9 * * *' }, ctx(now)).error, /name/);
  const full = Array.from({ length: 20 }, (_, i) => ({ id: `t${i}`, sessionId: 's1' }));
  assert.match(makeTask({ name: 'x', prompt: 'y', cron: '0 9 * * *' }, ctx(now, full)).error, /already has 20/);
});

test('describing and delivering', () => {
  const now = at('2026-11-13 10:00');
  const t = makeTask({ name: '股票复盘', prompt: '做今日复盘', cron: '35 15 * * 1-5' }, ctx(now)).task;
  assert.deepEqual(describeTask(t, now, 'active'), {
    id: 't1', name: '股票复盘', schedule: 'cron "35 15 * * 1-5" (Asia/Shanghai)', next: '2026-11-13 15:35 (Asia/Shanghai)',
    lastRun: null, state: 'active', prompt: '做今日复盘',
  });
  const text = taskEnvelope(t, at('2026-11-13 15:35'), true);
  assert.match(text, /^\[Scheduled task "股票复盘" \(t1\), run of 2026-11-13 15:35 Asia\/Shanghai, delivered late/);
  assert.match(text, /notify_owner/);
  assert.ok(text.endsWith('\n做今日复盘'));
});
