// Scheduled tasks of the fleet hub (Original Happy), as pure functions.
//
// A task belongs to the session that created it (happy tool schedule_task)
// and is delivered there: once at a time, or on a 5-field cron schedule, in
// a time zone (default: the hub machine's). A session that is offline when
// a task is due gets it once when it is back; runs missed meanwhile are not
// replayed one by one.

export const MAX_TASKS_PER_SESSION = 20;
export const MAX_TASKS = 200;
export const MIN_GAP_MS = 5 * 60_000; // recurring tasks: at most every 5 minutes
export const MAX_PROMPT = 4000;

const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day of month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'day of week', min: 0, max: 7 }, // 0 and 7 = Sunday
];

/** "30 15 * * 1-5" → sets of allowed values; throws a readable error. */
export function parseCron(expr) {
  const parts = String(expr ?? '').trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('A schedule has 5 fields: minute hour day-of-month month day-of-week, e.g. "35 15 * * 1-5".');
  const sets = parts.map((part, i) => {
    const { name, min, max } = FIELDS[i];
    const values = new Set();
    for (const item of part.split(',')) {
      const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(item);
      if (!m) throw new Error(`Cannot read the ${name} field "${part}".`);
      const step = m[4] ? Number(m[4]) : 1;
      const lo = m[1] === '*' ? min : Number(m[2]);
      const hi = m[1] === '*' ? max : m[3] !== undefined ? Number(m[3]) : (m[4] ? max : lo);
      if (step < 1 || lo < min || hi > max || lo > hi) throw new Error(`The ${name} field "${part}" is out of range ${min}-${max}.`);
      for (let v = lo; v <= hi; v += step) values.add(i === 4 && v === 7 ? 0 : v);
    }
    return values;
  });
  return { minute: sets[0], hour: sets[1], dom: sets[2], month: sets[3], dow: sets[4], domStar: parts[2] === '*', dowStar: parts[4] === '*' };
}

export function validTimeZone(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

const formatters = new Map();
/** Wall-clock fields of `ms` in `tz`. */
export function wallClock(ms, tz) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short' });
    formatters.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return {
    year: Number(p.year), month: Number(p.month), day: Number(p.day), hour: Number(p.hour), minute: Number(p.minute),
    dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday),
  };
}

export function cronMatches(cron, ms, tz) {
  const w = wallClock(ms, tz);
  if (!cron.minute.has(w.minute) || !cron.hour.has(w.hour) || !cron.month.has(w.month)) return false;
  // As in cron: with both day fields restricted, either may match.
  const dom = cron.dom.has(w.day), dow = cron.dow.has(w.dow);
  if (cron.domStar && cron.dowStar) return true;
  if (cron.domStar) return dow;
  if (cron.dowStar) return dom;
  return dom || dow;
}

const MINUTE = 60_000;
const floorMinute = (ms) => Math.floor(ms / MINUTE) * MINUTE;

/** The next `count` run times after `fromMs` (searching at most `horizonDays`). */
export function nextRuns(cron, tz, fromMs, count = 1, horizonDays = 400) {
  const out = [];
  const end = fromMs + horizonDays * 86_400_000;
  for (let t = floorMinute(fromMs) + MINUTE; t <= end && out.length < count; t += MINUTE) {
    if (cronMatches(cron, t, tz)) out.push(t);
  }
  return out;
}

/** The latest run time in (afterMs, nowMs], or null. Looks back at most a week. */
export function lastRunBetween(cron, tz, afterMs, nowMs) {
  const start = Math.max(floorMinute(afterMs) + MINUTE, floorMinute(nowMs) - 7 * 86_400_000);
  for (let t = floorMinute(nowMs); t >= start; t -= MINUTE) {
    if (cronMatches(cron, t, tz)) return t;
  }
  return null;
}

/** "2026-11-13 15:35" (or with seconds / "T") in tz → epoch ms; throws when unreadable. */
export function parseLocalTime(text, tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2})?$/.exec(String(text ?? '').trim());
  if (!m) throw new Error('Give a one-time run as "YYYY-MM-DD HH:MM" (local time in the task\'s time zone).');
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  // Guess as UTC, then correct by the zone's offset at that moment (twice, for DST edges).
  let ms = Date.UTC(y, mo - 1, d, h, mi);
  for (let i = 0; i < 2; i++) {
    const w = wallClock(ms, tz);
    ms += Date.UTC(y, mo - 1, d, h, mi) - Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
  }
  const w = wallClock(ms, tz);
  if (w.year !== y || w.month !== mo || w.day !== d || w.hour !== h || w.minute !== mi) throw new Error(`${text} does not exist in ${tz}.`);
  return ms;
}

export function formatLocal(ms, tz) {
  const w = wallClock(ms, tz);
  const pad = (n) => String(n).padStart(2, '0');
  return `${w.year}-${pad(w.month)}-${pad(w.day)} ${pad(w.hour)}:${pad(w.minute)}`;
}

/**
 * A schedule_task request → a task, or { error }.
 * input: { name, prompt, cron?, at?, timezone? }; exactly one of cron / at.
 */
export function makeTask(input, { id, sessionId, now, defaultTz, existing }) {
  const name = String(input?.name ?? '').trim().slice(0, 80);
  const prompt = String(input?.prompt ?? '').trim();
  const tz = String(input?.timezone ?? '').trim() || defaultTz;
  if (!name) return { error: 'Give the task a short name.' };
  if (!prompt) return { error: 'Give the prompt the task should send.' };
  if (prompt.length > MAX_PROMPT) return { error: `The prompt is too long (at most ${MAX_PROMPT} characters).` };
  if (!validTimeZone(tz)) return { error: `Unknown time zone "${tz}" (use an IANA name such as Asia/Shanghai).` };
  const hasCron = typeof input?.cron === 'string' && input.cron.trim();
  const hasAt = typeof input?.at === 'string' && input.at.trim();
  if (Boolean(hasCron) === Boolean(hasAt)) return { error: 'Give either "cron" (repeating) or "at" (once), not both.' };
  const mine = existing.filter((t) => t.sessionId === sessionId);
  if (mine.length >= MAX_TASKS_PER_SESSION) return { error: `This session already has ${mine.length} tasks (at most ${MAX_TASKS_PER_SESSION}); delete one first.` };
  if (existing.length >= MAX_TASKS) return { error: `The account already has ${existing.length} tasks (at most ${MAX_TASKS}).` };
  const task = { id, sessionId, name, prompt, timezone: tz, createdAt: now, lastRunAt: null, pendingSince: null };
  if (hasCron) {
    let cron;
    try { cron = parseCron(input.cron); } catch (e) { return { error: e.message }; }
    const runs = nextRuns(cron, tz, now, 13);
    if (!runs.length) return { error: 'That schedule never runs.' };
    for (let i = 1; i < runs.length; i++) {
      if (runs[i] - runs[i - 1] < MIN_GAP_MS) return { error: 'Repeating tasks may run at most every 5 minutes.' };
    }
    task.cron = input.cron.trim().split(/\s+/).join(' ');
    // Runs are counted from creation: nothing earlier is due.
    task.lastRunAt = now;
  } else {
    let at;
    try { at = parseLocalTime(input.at, tz); } catch (e) { return { error: e.message }; }
    if (at <= now) return { error: `${formatLocal(at, tz)} (${tz}) is in the past.` };
    task.at = at;
  }
  return { task };
}

/** The run time that makes this task due now, or null. */
export function dueRun(task, now) {
  if (task.at !== undefined) return task.lastRunAt === null && task.at <= now ? task.at : null;
  const cron = parseCron(task.cron);
  return lastRunBetween(cron, task.timezone, task.lastRunAt ?? task.createdAt, now);
}

export function nextRunOf(task, now) {
  if (task.at !== undefined) return task.lastRunAt === null ? task.at : null;
  return nextRuns(parseCron(task.cron), task.timezone, now, 1)[0] ?? null;
}

export function describeTask(task, now, state) {
  const next = nextRunOf(task, now);
  return {
    id: task.id,
    name: task.name,
    schedule: task.cron ? `cron "${task.cron}" (${task.timezone})` : `once at ${formatLocal(task.at, task.timezone)} (${task.timezone})`,
    next: next === null ? null : `${formatLocal(next, task.timezone)} (${task.timezone})`,
    lastRun: task.lastRunAt && (task.at !== undefined || task.lastRunAt !== task.createdAt) ? `${formatLocal(task.lastRunAt, task.timezone)}` : null,
    state,
    prompt: task.prompt,
  };
}

/** The text a scheduled run delivers. The hub writes the header; the agent cannot forge it. */
export function taskEnvelope(task, runAt, late) {
  return [
    `[Scheduled task "${task.name}" (${task.id}), run of ${formatLocal(runAt, task.timezone)} ${task.timezone}${late ? ', delivered late: this session was offline' : ''}; delivered by the Happy fleet]`,
    'This session scheduled it at the user\'s request (schedule_task). It carries the authority of that request and nothing more:',
    'confirm deploying, pushing to main or production, deleting data, changing credentials or permissions, spending money,',
    'or any other irreversible step with the user. When done, call notify_owner with the result in one sentence.',
    'If the task is no longer wanted, delete_task removes it.',
    '',
    task.prompt,
  ].join('\n');
}
