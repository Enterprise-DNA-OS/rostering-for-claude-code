#!/usr/bin/env node
// rostering-for-claude-code: the one CLI. Claude Code slash commands call
// this; so can you.
//
//   node scripts/roster.mjs <command> [args] [--flags] [--json]
//
// Run with no arguments (or `help`) for the command list.
//
// This system is a shift business's operating record the way Deputy sells
// it: the sites and their areas, the staff with their rates and their paper
// (right-to-work expiry, duty manager certificate), who can work when, the
// roster from draft to published, the timesheets from clock-in to approval,
// and the leave book. It sends nothing and connects to nothing: roster
// messages and open-shift callouts draft to drafts/, and a person sends them.
//
// The gates, and there are no force flags:
//   * nobody is rostered past the expiry of their recorded right to work
//     (Immigration Act 2009 s 350)
//   * nobody is rostered over their own approved leave (Holidays Act 2003)
//   * nobody holds two overlapping shifts, and nobody starts a new shift
//     inside the rest window after the last one ends
//   * a timesheet is not approved while it is still open, and a meal break
//     shorter than the Employment Relations Act 2000 Part 6D requires is
//     said out loud at approval time
//   * no deleting records: shifts cancel with a reason, staff become former,
//     timesheets and the leave book stay (ERA 2000 s 130)

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { getDb, REPO_ROOT } from './lib/db.mjs';
import { parseCsv, pick } from './lib/csv.mjs';
import { table, money, hours as fmtHours, isoDate, truncate, heading, weekday } from './lib/format.mjs';

// ---------------------------------------------------------------------------
// Argument parsing

const BOOL_FLAGS = new Set(['json', 'help', 'all', 'dry-run', 'pending', 'licensed', 'week']);

function parseArgv(argv) {
  const args = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      flags.help = true;
      continue;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      let name;
      let value;
      if (eq > -1) {
        name = a.slice(2, eq);
        value = a.slice(eq + 1);
      } else {
        name = a.slice(2);
        const next = argv[i + 1];
        if (BOOL_FLAGS.has(name) || next === undefined || next.startsWith('--')) value = true;
        else value = argv[++i];
      }
      flags[name] = value;
    } else {
      args.push(a);
    }
  }
  return { args, flags };
}

class CliError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

const num = (v) => Number(v ?? 0);
const str = (v) => (v === true || v === undefined || v === null ? '' : String(v));

// ---------------------------------------------------------------------------
// Dates, times, weeks

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseDate(v, what = 'date') {
  if (!v || v === true) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const lower = s.toLowerCase();
  if (lower === 'today') return today();
  if (lower === 'yesterday') return addDays(today(), -1);
  if (lower === 'tomorrow') return addDays(today(), 1);
  // New Zealand exports write DD/MM/YYYY: the first number is the day unless
  // the second is too big to be a month.
  const slash = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const [day, month] = b > 12 ? [b, a] : [a, b];
    let year = Number(slash[3]);
    if (year < 100) year += 2000;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  throw new CliError(`Cannot read ${what} "${s}". Use YYYY-MM-DD (or today / tomorrow / DD/MM/YYYY).`);
}

function parseTime(v, what = 'time') {
  if (!v || v === true) return null;
  const s = String(v).trim().toLowerCase();
  const m = s.match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/);
  if (!m) throw new CliError(`Cannot read ${what} "${s}". Use HH:MM, 24-hour (or 9:00am).`);
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) throw new CliError(`Cannot read ${what} "${s}". Use HH:MM, 24-hour.`);
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

// Monday of the week containing `v`; 'next' = next Monday; default = this week.
function weekStart(v) {
  if (v === 'next') {
    const monday = weekStart(undefined);
    return addDays(monday, 7);
  }
  const base = v && v !== true ? parseDate(v, '--week') : today();
  const d = new Date(`${base}T00:00:00`);
  const shift = (d.getDay() + 6) % 7; // Monday = 0
  return addDays(base, -shift);
}

function shiftTimestamps(onDate, startsAt, endsAt) {
  const s = new Date(`${onDate}T${startsAt}:00`);
  const e = new Date(`${onDate}T${endsAt}:00`);
  if (e <= s) e.setDate(e.getDate() + 1);
  return { s, e };
}

function hhmm(v) {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return String(v).slice(11, 16);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Resolvers: partial ids, case-insensitive names, list-and-exit-1 when ambiguous

async function resolveStaff(db, query, { includeFormer = false } = {}) {
  if (!query) throw new CliError('Which person? Give a name (partial is fine).');
  const q = String(query).trim();
  const rows = await db.query(
    `select * from v_staff where name ilike $1 ${includeFormer ? '' : `and status = 'active'`} order by name`,
    [`%${q}%`],
  );
  const exact = rows.filter((r) => r.name.toLowerCase() === q.toLowerCase());
  if (exact.length === 1) return exact[0];
  if (rows.length === 1) return rows[0];
  if (rows.length === 0) throw new CliError(`No staff member matches "${q}".`);
  throw new CliError(`"${q}" matches ${rows.length} people:\n${rows.map((r) => `  ${r.name} (${r.role})`).join('\n')}\nSay more of the name.`);
}

async function resolveSite(db, query) {
  if (!query) throw new CliError('Which site? Give a name (partial is fine).');
  const q = String(query).trim();
  const rows = await db.query(`select * from locations where name ilike $1 order by name`, [`%${q}%`]);
  if (rows.length === 1) return rows[0];
  if (rows.length === 0) throw new CliError(`No site matches "${q}".`);
  const exact = rows.find((r) => r.name.toLowerCase() === q.toLowerCase());
  if (exact) return exact;
  throw new CliError(`"${q}" matches ${rows.length} sites:\n${rows.map((r) => `  ${r.name}`).join('\n')}\nSay more of the name.`);
}

async function resolveArea(db, locationId, query) {
  if (!query) return null;
  const q = String(query).trim();
  const rows = await db.query(`select * from areas where location_id = $1 and name ilike $2 order by name`, [locationId, `%${q}%`]);
  if (rows.length === 1) return rows[0];
  const all = await db.query(`select name from areas where location_id = $1 order by name`, [locationId]);
  if (rows.length === 0) {
    throw new CliError(`No area matches "${q}" at that site. Areas there: ${all.map((r) => r.name).join(', ') || '(none yet: area add SITE NAME)'}.`);
  }
  throw new CliError(`"${q}" matches ${rows.length} areas: ${rows.map((r) => r.name).join(', ')}. Say more of the name.`);
}

async function resolveByRef(db, view, ref, what, prefix) {
  if (!ref) throw new CliError(`Which ${what}? Give its reference (${prefix}-...).`);
  let q = String(ref).trim().toUpperCase();
  if (/^\d+$/.test(q)) q = `${prefix}-${q}`;
  const rows = await db.query(`select * from ${view} where upper(ref) = $1`, [q]);
  if (rows.length === 1) return rows[0];
  throw new CliError(`No ${what} matches "${ref}".`);
}

async function mintRef(db, tableName, prefix, start) {
  const [row] = await db.query(
    `select coalesce(max(substring(ref from ${prefix.length + 2})::int), $1) + 1 as n
     from ${tableName} where ref like '${prefix}-%' and substring(ref from ${prefix.length + 2}) ~ '^[0-9]+$'`,
    [start - 1],
  );
  return `${prefix}-${row.n}`;
}

// ---------------------------------------------------------------------------
// The gates. One place, used by shift add, shift assign and publish.
// Returns violations (refuse, no force flag) and warnings (say it, proceed).

async function assignmentGates(db, staff, { onDate, startsAt, endsAt, excludeShiftId = null }) {
  const violations = [];
  const warnings = [];
  const { s, e } = shiftTimestamps(onDate, startsAt, endsAt);

  if (staff.status !== 'active') {
    violations.push(`${staff.name} is former staff. Reinstate them first if they are back (staff add keeps the history).`);
  }
  if (staff.visa_expires_on && onDate > isoDate(staff.visa_expires_on)) {
    violations.push(
      `${staff.name}'s recorded right to work expires ${isoDate(staff.visa_expires_on)} and this shift is ${onDate}. ` +
      `Employing a person not entitled to work is an offence (Immigration Act 2009 s 350). ` +
      `Record the new visa first: staff visa "${staff.name}" --expires=YYYY-MM-DD.`,
    );
  }
  const leaveRows = await db.query(
    `select ref, type, starts_on, ends_on from leave
     where staff_id = $1 and status = 'approved' and $2::date between starts_on and ends_on`,
    [staff.staff_id, onDate],
  );
  for (const lv of leaveRows) {
    violations.push(`${staff.name} is on approved ${lv.type} leave ${isoDate(lv.starts_on)} to ${isoDate(lv.ends_on)} (${lv.ref}). The roster respects the leave book (Holidays Act 2003).`);
  }

  const nearby = await db.query(
    `select ref, on_date, starts_at, ends_at from shifts
     where staff_id = $1 and status <> 'cancelled' and id is distinct from $2
       and on_date between ($3::date - 1) and ($3::date + 1)`,
    [staff.staff_id, excludeShiftId, onDate],
  );
  const [settings] = await db.query('select * from v_settings');
  const restMs = Number(settings.rest_between_shifts_hours) * 3600 * 1000;
  for (const sh of nearby) {
    const other = shiftTimestamps(isoDate(sh.on_date), String(sh.starts_at).slice(0, 5), String(sh.ends_at).slice(0, 5));
    if (s < other.e && e > other.s) {
      violations.push(`${staff.name} already holds ${sh.ref} (${isoDate(sh.on_date)} ${String(sh.starts_at).slice(0, 5)}-${String(sh.ends_at).slice(0, 5)}), which overlaps this shift.`);
      continue;
    }
    const gap = s >= other.e ? s - other.e : other.s - e;
    if (gap < restMs) {
      violations.push(
        `${staff.name} would get ${(gap / 3600000).toFixed(1)}h between ${sh.ref} and this shift; the rest window is ${settings.rest_between_shifts_hours}h ` +
        `(settings: rest_between_shifts_hours). A close-then-open is how people get hurt. Move one of the shifts.`,
      );
    }
  }

  const dow = new Date(`${onDate}T00:00:00`).getDay();
  const avail = await db.query(`select * from availability where staff_id = $1`, [staff.staff_id]);
  if (avail.length) {
    const windows = avail.filter((a) => Number(a.weekday) === dow);
    const inside = windows.some((w) => String(w.starts_at).slice(0, 5) <= startsAt && String(w.ends_at).slice(0, 5) >= endsAt);
    if (!inside) {
      warnings.push(
        `${staff.name}'s standing availability ${windows.length ? `on ${weekday(onDate)} is ${windows.map((w) => `${String(w.starts_at).slice(0, 5)}-${String(w.ends_at).slice(0, 5)}`).join(', ')}` : `does not include ${weekday(onDate)}`}. Ask before publishing.`,
      );
    }
  }
  return { violations, warnings };
}

function enforce(violations) {
  if (violations.length) {
    throw new CliError(violations.map((v) => `refused: ${v}`).join('\n'));
  }
}

// ---------------------------------------------------------------------------
// Output

function out(flags, rows, humanFn) {
  if (flags.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  humanFn();
}

const SHIFT_COLS = [
  { key: 'ref', label: 'ref' },
  { key: 'on_date', label: 'date', format: (v) => `${weekday(v)} ${isoDate(v)}` },
  { key: 'starts_at', label: 'start', format: (v) => String(v).slice(0, 5) },
  { key: 'ends_at', label: 'end', format: (v) => String(v).slice(0, 5) },
  { key: 'site', label: 'site', width: 22 },
  { key: 'area', label: 'area', width: 16 },
  { key: 'staff', label: 'who', format: (v, r) => v || (r.role_needed ? `(open: ${r.role_needed})` : '(open)') },
  { key: 'paid_minutes', label: 'paid', align: 'right', format: (v) => fmtHours(v) },
  { key: 'cost_cents', label: 'cost', align: 'right', format: (v) => (v == null ? '' : money(v)) },
  { key: 'state', label: 'state' },
];

const TS_COLS = [
  { key: 'ref', label: 'ref' },
  { key: 'on_date', label: 'date', format: (v) => `${weekday(v)} ${isoDate(v)}` },
  { key: 'staff', label: 'who' },
  { key: 'site', label: 'site', width: 22 },
  { key: 'clock_in_at', label: 'in', format: hhmm },
  { key: 'clock_out_at', label: 'out', format: hhmm },
  { key: 'break_minutes', label: 'break', align: 'right', format: (v) => `${v}m` },
  { key: 'worked_minutes', label: 'worked', align: 'right', format: (v) => (v == null ? '' : fmtHours(v)) },
  { key: 'variance_minutes', label: 'vs roster', align: 'right', format: (v) => (v == null ? '' : `${v > 0 ? '+' : ''}${v}m`) },
  { key: 'state', label: 'state' },
];

// ---------------------------------------------------------------------------
// Commands: the roster

async function cmdRoster(db, flags) {
  const start = weekStart(flags.week);
  const end = addDays(start, 7);
  const params = [start, end];
  let where = `on_date >= $1 and on_date < $2`;
  if (!flags.all) where += ` and status <> 'cancelled'`;
  if (flags.site) {
    const site = await resolveSite(db, flags.site);
    params.push(site.id);
    where += ` and location_id = $${params.length}`;
  }
  const rows = await db.query(`select * from v_shifts where ${where} order by on_date, site, starts_at, area nulls first`, params);
  out(flags, rows, () => {
    console.log(heading(`Roster, week of ${weekday(start)} ${start}`));
    if (!rows.length) {
      console.log('  (no shifts this week: shift add SITE --date= --start= --end=)');
      return;
    }
    const byDay = new Map();
    for (const r of rows) {
      const k = isoDate(r.on_date);
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(r);
    }
    for (const dayRows of byDay.values()) {
      const day = isoDate(dayRows[0].on_date);
      console.log(`\n${weekday(day)} ${day}`);
      console.log(table(dayRows, SHIFT_COLS.filter((c) => c.key !== 'on_date')));
    }
    const openCount = rows.filter((r) => r.state === 'OPEN').length;
    const cost = rows.filter((r) => r.status !== 'cancelled').reduce((a, r) => a + num(r.cost_cents), 0);
    console.log(`\n  ${rows.length} shift(s), ${openCount} open, rostered cost ${money(cost)}`);
  });
}

async function cmdShiftAdd(db, args, flags) {
  const site = await resolveSite(db, args[0] || flags.site);
  const onDate = parseDate(flags.date, '--date');
  const startsAt = parseTime(flags.start, '--start');
  const endsAt = parseTime(flags.end, '--end');
  if (!onDate || !startsAt || !endsAt) throw new CliError('shift add SITE --date= --start= --end= [--staff= --area= --break=30 --role= --note=]');
  const area = await resolveArea(db, site.id, flags.area);
  const breakMinutes = flags.break === undefined ? 30 : num(flags.break);
  let staff = null;
  if (flags.staff) {
    staff = await resolveStaff(db, flags.staff);
    const { violations, warnings } = await assignmentGates(db, staff, { onDate, startsAt, endsAt });
    enforce(violations);
    for (const w of warnings) console.error(`note: ${w}`);
  }
  const ref = await mintRef(db, 'shifts', 'SH', 1001);
  await db.query(
    `insert into shifts (ref, location_id, area_id, staff_id, on_date, starts_at, ends_at, break_minutes, role_needed, status, note)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft', $10)`,
    [ref, site.id, area?.id ?? null, staff?.staff_id ?? null, onDate, startsAt, endsAt, breakMinutes, str(flags.role) || null, str(flags.note) || null],
  );
  const [row] = await db.query(`select * from v_shifts where ref = $1`, [ref]);
  out(flags, row, () => {
    console.log(`${ref}: ${weekday(onDate)} ${onDate} ${startsAt}-${endsAt} at ${site.name}${area ? ` / ${area.name}` : ''}, ${staff ? staff.name : `open${flags.role ? ` (${flags.role})` : ''}`}, draft.`);
    console.log(`Publish the week when it is ready: publish --week=${weekStart(onDate)}`);
  });
}

async function cmdShiftAssign(db, args, flags) {
  const shift = await resolveByRef(db, 'v_shifts', args[0], 'shift', 'SH');
  const staff = await resolveStaff(db, args.slice(1).join(' ') || flags.staff);
  if (shift.status === 'cancelled') throw new CliError(`${shift.ref} is cancelled.`);
  const { violations, warnings } = await assignmentGates(db, staff, {
    onDate: isoDate(shift.on_date),
    startsAt: String(shift.starts_at).slice(0, 5),
    endsAt: String(shift.ends_at).slice(0, 5),
    excludeShiftId: shift.shift_id,
  });
  enforce(violations);
  for (const w of warnings) console.error(`note: ${w}`);
  await db.query(`update shifts set staff_id = $1 where id = $2`, [staff.staff_id, shift.shift_id]);
  out(flags, { ref: shift.ref, staff: staff.name }, () => {
    console.log(`${shift.ref}: ${weekday(shift.on_date)} ${isoDate(shift.on_date)} ${String(shift.starts_at).slice(0, 5)}-${String(shift.ends_at).slice(0, 5)} at ${shift.site} is now ${staff.name}'s.`);
  });
}

async function cmdShiftUnassign(db, args, flags) {
  const shift = await resolveByRef(db, 'v_shifts', args[0], 'shift', 'SH');
  await db.query(`update shifts set staff_id = null where id = $1`, [shift.shift_id]);
  out(flags, { ref: shift.ref }, () => console.log(`${shift.ref} is now an open shift. Offer it: /draft-open-shift-callout.`));
}

async function cmdShiftCancel(db, args, flags) {
  const shift = await resolveByRef(db, 'v_shifts', args[0], 'shift', 'SH');
  const reason = str(flags.reason);
  if (!reason) throw new CliError('A cancelled shift keeps its reason: shift cancel REF --reason="why".');
  await db.query(`update shifts set status = 'cancelled', cancel_reason = $1 where id = $2`, [reason, shift.shift_id]);
  out(flags, { ref: shift.ref, reason }, () => {
    console.log(`${shift.ref} cancelled: ${reason}`);
    if (shift.staff && isoDate(shift.on_date) <= addDays(today(), 2)) {
      console.log(`note: that shift was ${(new Date(`${isoDate(shift.on_date)}T00:00:00`) - new Date(`${today()}T00:00:00`)) / 86400000} day(s) away. Short-notice cancellation may owe compensation under the employment agreement (ERA 2000 s 67C). Tell ${shift.staff} now.`);
    }
  });
}

async function cmdPublish(db, flags) {
  const start = weekStart(flags.week);
  const end = addDays(start, 7);
  const drafts = await db.query(
    `select * from v_shifts where status = 'draft' and on_date >= $1 and on_date < $2 order by on_date, starts_at`,
    [start, end],
  );
  if (!drafts.length) throw new CliError(`No draft shifts in the week of ${start}. (roster --week=${start} shows the week.)`);
  const published = [];
  const held = [];
  for (const d of drafts) {
    if (d.staff_id) {
      const [staff] = await db.query(`select * from v_staff where staff_id = $1`, [d.staff_id]);
      const { violations } = await assignmentGates(db, staff, {
        onDate: isoDate(d.on_date),
        startsAt: String(d.starts_at).slice(0, 5),
        endsAt: String(d.ends_at).slice(0, 5),
        excludeShiftId: d.shift_id,
      });
      if (violations.length) {
        held.push({ ref: d.ref, why: violations[0] });
        continue;
      }
    }
    await db.query(`update shifts set status = 'published' where id = $1`, [d.shift_id]);
    published.push(d.ref);
  }
  const stillOpen = await db.query(`select count(*)::int as n from v_open_shifts where on_date >= $1 and on_date < $2`, [start, end]);
  out(flags, { week: start, published, held }, () => {
    console.log(`Published ${published.length} shift(s) for the week of ${start}.`);
    for (const h of held) console.log(`held as draft: ${h.ref}: ${h.why}`);
    if (num(stillOpen[0].n)) console.log(`note: ${stillOpen[0].n} published shift(s) that week still have nobody assigned. Offer them: /draft-open-shift-callout.`);
    console.log(`Tell the team: /draft-roster-message writes each person's week to drafts/.`);
  });
}

async function cmdOpen(db, flags) {
  const rows = await db.query(`select * from v_open_shifts order by on_date, starts_at`);
  out(flags, rows, () => {
    console.log(heading('Open shifts looking for a person'));
    console.log(table(rows, SHIFT_COLS.filter((c) => !['staff', 'cost_cents', 'state'].includes(c.key)).concat([{ key: 'role_needed', label: 'needs' }])));
    if (rows.length) console.log(`\n  Offer them: /draft-open-shift-callout. Fill one: shift assign REF NAME.`);
  });
}

// ---------------------------------------------------------------------------
// Commands: the people

async function cmdTeam(db, flags) {
  const rows = await db.query(
    `select * from v_staff where ($1 or status = 'active') order by status, name`,
    [Boolean(flags.all)],
  );
  out(flags, rows, () => {
    console.log(heading('The team'));
    console.log(
      table(rows, [
        { key: 'name', label: 'name' },
        { key: 'role', label: 'role' },
        { key: 'employment', label: 'employment' },
        { key: 'hourly_rate_cents', label: 'rate', align: 'right', format: (v) => (v == null ? '' : `${money(v)}/h`) },
        { key: 'work_rights', label: 'work rights', format: (v, r) => (v && v !== 'current' ? `${v} ${isoDate(r.visa_expires_on)}` : v) },
        { key: 'duty_cert', label: 'duty cert', format: (v, r) => (v && v !== 'current' ? `${v} ${isoDate(r.duty_manager_cert_expires_on)}` : v) },
        { key: 'shifts_next_7', label: 'next 7d', align: 'right' },
        { key: 'awaiting_approval', label: 'ts waiting', align: 'right' },
        { key: 'status', label: 'status' },
      ]),
    );
  });
}

async function cmdPerson(db, args, flags) {
  const staff = await resolveStaff(db, args.join(' '), { includeFormer: true });
  const availabilityRows = await db.query(`select weekday, starts_at, ends_at, note from availability where staff_id = $1 order by weekday`, [staff.staff_id]);
  const upcoming = await db.query(`select * from v_shifts where staff_id = $1 and on_date >= current_date and status <> 'cancelled' order by on_date, starts_at limit 14`, [staff.staff_id]);
  const sheets = await db.query(`select * from v_timesheets where staff_id = $1 order by on_date desc limit 10`, [staff.staff_id]);
  const leaveRows = await db.query(`select * from v_leave where staff_id = $1 order by starts_on desc limit 8`, [staff.staff_id]);
  const notes = await db.query(`select noted_on, note from file_notes where staff_id = $1 order by noted_on desc limit 8`, [staff.staff_id]);
  const card = { staff, availability: availabilityRows, upcoming_shifts: upcoming, timesheets: sheets, leave: leaveRows, notes };
  out(flags, card, () => {
    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    console.log(heading(`${staff.name} (${staff.role}, ${staff.employment}${staff.status === 'former' ? ', FORMER' : ''})`));
    const paper = [];
    if (staff.hourly_rate_cents != null) paper.push(`rate ${money(staff.hourly_rate_cents)}/h`);
    paper.push(staff.visa_expires_on ? `right to work: ${staff.work_rights} (${isoDate(staff.visa_expires_on)})` : 'right to work: no expiry on record');
    if (staff.duty_manager_cert_no) paper.push(`duty manager cert ${staff.duty_manager_cert_no}: ${staff.duty_cert} (${isoDate(staff.duty_manager_cert_expires_on)})`);
    console.log(`  ${paper.join(' | ')}`);
    if (staff.phone || staff.email) console.log(`  ${[staff.phone, staff.email].filter(Boolean).join(' | ')}`);
    console.log('\nStanding availability');
    console.log(availabilityRows.length
      ? table(availabilityRows, [
          { key: 'weekday', label: 'day', format: (v) => DAYS[v] },
          { key: 'starts_at', label: 'from', format: (v) => String(v).slice(0, 5) },
          { key: 'ends_at', label: 'to', format: (v) => String(v).slice(0, 5) },
          { key: 'note', label: 'note', width: 40 },
        ])
      : '  (none recorded: any time is assumed. availability set NAME DAY --start= --end=)');
    console.log('\nUpcoming shifts');
    console.log(table(upcoming, SHIFT_COLS.filter((c) => !['staff'].includes(c.key))));
    console.log('\nRecent timesheets');
    console.log(table(sheets, TS_COLS.filter((c) => c.key !== 'staff')));
    if (leaveRows.length) {
      console.log('\nLeave');
      console.log(table(leaveRows, [
        { key: 'ref', label: 'ref' },
        { key: 'type', label: 'type' },
        { key: 'starts_on', label: 'from', format: isoDate },
        { key: 'ends_on', label: 'to', format: isoDate },
        { key: 'days', label: 'days', align: 'right' },
        { key: 'state', label: 'state' },
      ]));
    }
    if (notes.length) {
      console.log('\nFile notes');
      for (const n of notes) console.log(`  ${isoDate(n.noted_on)}  ${truncate(n.note, 100)}`);
    }
  });
}

async function cmdStaffAdd(db, args, flags) {
  const name = args.join(' ');
  if (!name) throw new CliError('staff add NAME --role= [--rate= --employment= --phone= --email= --visa-expires= --cert= --cert-expires=]');
  const existing = await db.query(`select id, status from staff where lower(name) = lower($1)`, [name]);
  if (existing.length && existing[0].status === 'active') throw new CliError(`${name} is already on the team.`);
  if (existing.length) {
    await db.query(`update staff set status = 'active' where id = $1`, [existing[0].id]);
    out(flags, { name, reinstated: true }, () => console.log(`${name} reinstated, history intact.`));
    return;
  }
  const rate = flags.rate !== undefined ? Math.round(Number(flags.rate) * (Number(flags.rate) < 500 ? 100 : 1)) : null;
  await db.query(
    `insert into staff (name, role, employment, hourly_rate_cents, phone, email, visa_expires_on, duty_manager_cert_no, duty_manager_cert_expires_on)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      name,
      str(flags.role) || 'front_of_house',
      str(flags.employment) || 'casual',
      rate,
      str(flags.phone) || null,
      str(flags.email) || null,
      flags['visa-expires'] ? parseDate(flags['visa-expires'], '--visa-expires') : null,
      str(flags.cert) || null,
      flags['cert-expires'] ? parseDate(flags['cert-expires'], '--cert-expires') : null,
    ],
  );
  out(flags, { name }, () => console.log(`${name} added. Availability next: availability set "${name}" DAY --start= --end=.`));
}

async function cmdStaffSet(db, sub, args, flags) {
  const staff = await resolveStaff(db, args.join(' '), { includeFormer: true });
  if (sub === 'rate') {
    const rate = Number(flags.rate);
    if (!rate) throw new CliError('staff rate NAME --rate=32.50 (dollars per hour) or --rate=3250 (cents).');
    const cents = Math.round(rate * (rate < 500 ? 100 : 1));
    await db.query(`update staff set hourly_rate_cents = $1 where id = $2`, [cents, staff.staff_id]);
    out(flags, { name: staff.name, hourly_rate_cents: cents }, () => console.log(`${staff.name}: ${money(cents)}/h for roster costing.`));
  } else if (sub === 'visa') {
    const expires = flags.expires === 'none' ? null : parseDate(flags.expires, '--expires');
    await db.query(`update staff set visa_expires_on = $1 where id = $2`, [expires, staff.staff_id]);
    out(flags, { name: staff.name, visa_expires_on: expires }, () =>
      console.log(expires ? `${staff.name}: right to work recorded to ${expires}. The rostering gate reads this date.` : `${staff.name}: no work-rights expiry on record (citizen or resident).`));
  } else if (sub === 'cert') {
    const expires = parseDate(flags.expires, '--expires');
    await db.query(`update staff set duty_manager_cert_no = $1, duty_manager_cert_expires_on = $2 where id = $3`, [str(flags.number) || staff.duty_manager_cert_no, expires, staff.staff_id]);
    out(flags, { name: staff.name, expires }, () => console.log(`${staff.name}: duty manager certificate recorded to ${expires}. The duty cover check reads this.`));
  } else if (sub === 'former') {
    await db.query(`update staff set status = 'former' where id = $1`, [staff.staff_id]);
    const future = await db.query(`select ref from shifts where staff_id = $1 and status = 'published' and on_date >= current_date`, [staff.staff_id]);
    out(flags, { name: staff.name, open_shifts_created: future.length }, () => {
      console.log(`${staff.name} is now former staff; the record stays.`);
      if (future.length) console.log(`note: they still hold ${future.length} published shift(s): ${future.map((r) => r.ref).join(', ')}. Reassign or open them.`);
    });
  } else {
    throw new CliError(`Unknown staff command "${sub}" (add|rate|visa|cert|former).`);
  }
}

const DAY_NAMES = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };

async function cmdAvailability(db, args, flags, sub) {
  if (sub === 'set') {
    const dayArg = args[args.length - 1];
    const weekdayNum = DAY_NAMES[String(dayArg).toLowerCase()] ?? (Number.isInteger(Number(dayArg)) ? Number(dayArg) : null);
    if (weekdayNum === null || weekdayNum < 0 || weekdayNum > 6) throw new CliError('availability set NAME DAY --start= --end= (DAY = mon..sun or 0..6, 0 = Sunday).');
    const staff = await resolveStaff(db, args.slice(0, -1).join(' '));
    const startsAt = parseTime(flags.start, '--start');
    const endsAt = parseTime(flags.end, '--end');
    if (!startsAt || !endsAt) throw new CliError('availability set NAME DAY --start=HH:MM --end=HH:MM');
    await db.query(`insert into availability (staff_id, weekday, starts_at, ends_at, note) values ($1, $2, $3, $4, $5)`, [staff.staff_id, weekdayNum, startsAt, endsAt, str(flags.note) || null]);
    out(flags, { name: staff.name, weekday: weekdayNum, startsAt, endsAt }, () =>
      console.log(`${staff.name}: available ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][weekdayNum]} ${startsAt}-${endsAt}.`));
    return;
  }
  if (sub === 'clear') {
    const dayArg = args.length > 1 && (DAY_NAMES[String(args[args.length - 1]).toLowerCase()] !== undefined || /^\d$/.test(args[args.length - 1])) ? args[args.length - 1] : null;
    const staff = await resolveStaff(db, (dayArg ? args.slice(0, -1) : args).join(' '));
    const weekdayNum = dayArg === null ? null : (DAY_NAMES[String(dayArg).toLowerCase()] ?? Number(dayArg));
    await db.query(`delete from availability where staff_id = $1 ${weekdayNum === null ? '' : 'and weekday = $2'}`, weekdayNum === null ? [staff.staff_id] : [staff.staff_id, weekdayNum]);
    out(flags, { name: staff.name }, () => console.log(`${staff.name}: availability cleared${weekdayNum === null ? '' : ` for ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][weekdayNum]}`} (standing windows only; shifts are untouched).`));
    return;
  }
  const params = [];
  let where = '';
  if (args.length) {
    const staff = await resolveStaff(db, args.join(' '), { includeFormer: true });
    params.push(staff.staff_id);
    where = 'where a.staff_id = $1';
  }
  const rows = await db.query(
    `select s.name, a.weekday, a.starts_at, a.ends_at, a.note from availability a join staff s on s.id = a.staff_id ${where} order by s.name, a.weekday`,
    params,
  );
  out(flags, rows, () => {
    console.log(heading('Standing availability'));
    console.log(table(rows, [
      { key: 'name', label: 'name' },
      { key: 'weekday', label: 'day', format: (v) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][v] },
      { key: 'starts_at', label: 'from', format: (v) => String(v).slice(0, 5) },
      { key: 'ends_at', label: 'to', format: (v) => String(v).slice(0, 5) },
      { key: 'note', label: 'note', width: 40 },
    ]));
    console.log('\n  Staff with no rows are assumed available any time. The roster builder reads this first.');
  });
}

async function cmdSiteAdd(db, args, flags) {
  const name = args.join(' ');
  if (!name) throw new CliError('site add NAME [--address=] [--licensed]');
  await db.query(`insert into locations (name, address, licensed) values ($1, $2, $3)`, [name, str(flags.address) || null, Boolean(flags.licensed)]);
  out(flags, { name }, () => console.log(`${name} added${flags.licensed ? ' (licensed: the duty manager check now watches it)' : ''}. Areas next: area add "${name}" Kitchen.`));
}

async function cmdAreaAdd(db, args, flags) {
  const site = await resolveSite(db, args[0]);
  const name = args.slice(1).join(' ');
  if (!name) throw new CliError('area add SITE NAME');
  await db.query(`insert into areas (location_id, name) values ($1, $2)`, [site.id, name]);
  out(flags, { site: site.name, area: name }, () => console.log(`${site.name} / ${name} added.`));
}

// ---------------------------------------------------------------------------
// Commands: time

async function cmdClock(db, sub, args, flags) {
  const staff = await resolveStaff(db, args.join(' '));
  const nowIso = () => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const atRaw = str(flags.at);
  const at = atRaw
    ? (atRaw.includes('-') ? `${parseDate(atRaw.split(' ')[0], '--at')} ${parseTime(atRaw.split(' ')[1] || '00:00', '--at')}` : `${today()} ${parseTime(atRaw, '--at')}`)
    : nowIso();
  const open = await db.query(`select * from timesheets where staff_id = $1 and status = 'open'`, [staff.staff_id]);

  if (sub === 'in') {
    if (open.length) throw new CliError(`${staff.name} already has an open timesheet (${open[0].ref}, clocked in ${hhmm(open[0].clock_in_at)}). Clock out first.`);
    const onDate = at.slice(0, 10);
    let site = flags.site ? await resolveSite(db, flags.site) : null;
    const [todayShift] = await db.query(
      `select * from v_shifts where staff_id = $1 and on_date = $2 and status = 'published' order by starts_at limit 1`,
      [staff.staff_id, onDate],
    );
    if (!site && todayShift) site = { id: todayShift.location_id, name: todayShift.site };
    const ref = await mintRef(db, 'timesheets', 'TS', 2001);
    await db.query(
      `insert into timesheets (ref, staff_id, shift_id, location_id, on_date, clock_in_at, status) values ($1, $2, $3, $4, $5, $6, 'open')`,
      [ref, staff.staff_id, todayShift?.shift_id ?? null, site?.id ?? null, onDate, at],
    );
    out(flags, { ref, staff: staff.name, clock_in_at: at }, () => {
      console.log(`${ref}: ${staff.name} clocked in ${at}${site ? ` at ${site.name}` : ''}${todayShift ? ` (rostered ${String(todayShift.starts_at).slice(0, 5)}-${String(todayShift.ends_at).slice(0, 5)})` : ' (no rostered shift today: unrostered work is still real work)'}.`);
    });
    return;
  }

  if (sub === 'out') {
    if (!open.length) throw new CliError(`${staff.name} has no open timesheet. clock in first, or record the whole thing: timesheet add.`);
    const ts = open[0];
    const inAt = new Date(ts.clock_in_at);
    const outAt = new Date(`${at.replace(' ', 'T')}:00`);
    if (outAt <= inAt) throw new CliError(`Clock-out ${at} is not after clock-in ${hhmm(ts.clock_in_at)} ${isoDate(ts.clock_in_at)}. Use --at="YYYY-MM-DD HH:MM" for an overnight finish.`);
    let breakMin = flags.break !== undefined ? num(flags.break) : null;
    if (breakMin === null && ts.shift_id) {
      const [sh] = await db.query(`select break_minutes from shifts where id = $1`, [ts.shift_id]);
      breakMin = sh ? num(sh.break_minutes) : 0;
    }
    breakMin = breakMin ?? 0;
    await db.query(`update timesheets set clock_out_at = $1, break_minutes = $2, status = 'submitted' where id = $3`, [at, breakMin, ts.id]);
    const [row] = await db.query(`select * from v_timesheets where timesheet_id = $1`, [ts.id]);
    out(flags, row, () => {
      console.log(`${ts.ref}: ${staff.name} clocked out ${at}. Worked ${fmtHours(row.worked_minutes)} with ${breakMin}m break, submitted for approval.`);
      if (row.break_short) {
        console.log(`note: that span requires ${row.required_break_minutes}m of meal break (Employment Relations Act 2000 Part 6D) and ${breakMin}m is recorded. If a break was taken, fix the record: timesheet break ${ts.ref} --minutes=. If not, fix the practice.`);
      }
    });
    return;
  }
  throw new CliError('clock in NAME [--site=] [--at=HH:MM] | clock out NAME [--at=] [--break=]');
}

async function cmdTimesheetAdd(db, args, flags) {
  const staff = await resolveStaff(db, args.join(' '));
  const onDate = parseDate(flags.date, '--date');
  const inTime = parseTime(flags.in, '--in');
  const outTime = parseTime(flags.out, '--out');
  if (!onDate || !inTime || !outTime) throw new CliError('timesheet add NAME --date= --in=HH:MM --out=HH:MM [--break=30 --site= --note=]');
  const { s, e } = shiftTimestamps(onDate, inTime, outTime);
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const site = flags.site ? await resolveSite(db, flags.site) : null;
  const [shift] = await db.query(`select id from shifts where staff_id = $1 and on_date = $2 and status = 'published' limit 1`, [staff.staff_id, onDate]);
  const ref = await mintRef(db, 'timesheets', 'TS', 2001);
  await db.query(
    `insert into timesheets (ref, staff_id, shift_id, location_id, on_date, clock_in_at, clock_out_at, break_minutes, status, note)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 'submitted', $9)`,
    [ref, staff.staff_id, shift?.id ?? null, site?.id ?? null, onDate, fmt(s), fmt(e), flags.break !== undefined ? num(flags.break) : 30, str(flags.note) || null],
  );
  const [row] = await db.query(`select * from v_timesheets where ref = $1`, [ref]);
  out(flags, row, () => console.log(`${ref}: ${staff.name} ${onDate} ${inTime}-${outTime}, ${fmtHours(row.worked_minutes)} worked, submitted.`));
}

async function cmdTimesheetBreak(db, args, flags) {
  const ts = await resolveByRef(db, 'v_timesheets', args[0], 'timesheet', 'TS');
  if (ts.status === 'approved') throw new CliError(`${ts.ref} is already approved; the record stands. Add a file note if something was wrong.`);
  const minutes = num(flags.minutes);
  await db.query(`update timesheets set break_minutes = $1 where id = $2`, [minutes, ts.timesheet_id]);
  out(flags, { ref: ts.ref, break_minutes: minutes }, () => console.log(`${ts.ref}: break recorded as ${minutes}m.`));
}

async function cmdTimesheets(db, flags) {
  const params = [];
  const where = [];
  if (flags.pending) where.push(`status = 'submitted'`);
  else if (!flags.all) {
    const start = weekStart(flags.week);
    params.push(start, addDays(start, 7));
    where.push(`on_date >= $1 and on_date < $2`);
  }
  const rows = await db.query(`select * from v_timesheets ${where.length ? `where ${where.join(' and ')}` : ''} order by on_date, staff`, params);
  out(flags, rows, () => {
    console.log(heading(flags.pending ? 'Timesheets awaiting approval' : `Timesheets${flags.all ? '' : `, week of ${weekStart(flags.week)}`}`));
    console.log(table(rows, TS_COLS));
    const shorts = rows.filter((r) => r.state === 'BREAK SHORT').length;
    if (shorts) console.log(`\n  ${shorts} sheet(s) show less meal break than the span requires: read them before approving.`);
  });
}

async function cmdApprove(db, args, flags) {
  let sheets;
  if (flags.all) {
    sheets = await db.query(`select * from v_timesheets where status = 'submitted' order by on_date`);
    if (!sheets.length) throw new CliError('Nothing is awaiting approval.');
  } else {
    sheets = [await resolveByRef(db, 'v_timesheets', args[0], 'timesheet', 'TS')];
  }
  const done = [];
  for (const ts of sheets) {
    if (ts.status === 'open') throw new CliError(`${ts.ref} is still open: ${ts.staff} has not clocked out. Approval confirms hours; it never invents them. clock out ${ts.staff} --at= first.`);
    if (ts.status === 'approved') {
      console.error(`note: ${ts.ref} was already approved.`);
      continue;
    }
    await db.query(`update timesheets set status = 'approved', approved_on = current_date where id = $1`, [ts.timesheet_id]);
    done.push(ts.ref);
    if (ts.break_short) {
      console.error(`note: ${ts.ref} (${ts.staff}) shows ${ts.break_minutes}m break against ${ts.required_break_minutes}m required for the span (ERA 2000 Part 6D). Approved as the true record; fix the break practice, not the record.`);
    }
    if (ts.variance_minutes != null && Math.abs(num(ts.variance_minutes)) >= 30) {
      console.error(`note: ${ts.ref} (${ts.staff}) worked ${num(ts.variance_minutes) > 0 ? '+' : ''}${ts.variance_minutes}m against the rostered shift.`);
    }
  }
  out(flags, { approved: done }, () => console.log(`Approved ${done.length} timesheet(s): ${done.join(', ')}. Export for payroll: export.`));
}

// ---------------------------------------------------------------------------
// Commands: leave

async function cmdLeave(db, sub, args, flags) {
  if (sub === 'request') {
    const staff = await resolveStaff(db, args.join(' '));
    const type = str(flags.type) || 'annual';
    const from = parseDate(flags.from, '--from');
    const to = parseDate(flags.to || flags.from, '--to');
    if (!from) throw new CliError('leave request NAME --type=annual --from=DATE [--to=DATE] [--note=]');
    const overlap = await db.query(
      `select ref from leave where staff_id = $1 and status = 'approved' and starts_on <= $3::date and ends_on >= $2::date`,
      [staff.staff_id, from, to],
    );
    if (overlap.length) throw new CliError(`refused: ${staff.name} already has approved leave overlapping those dates (${overlap.map((r) => r.ref).join(', ')}).`);
    const ref = await mintRef(db, 'leave', 'LV', 101);
    await db.query(
      `insert into leave (ref, staff_id, type, starts_on, ends_on, note) values ($1, $2, $3, $4, $5, $6)`,
      [ref, staff.staff_id, type, from, to, str(flags.note) || null],
    );
    out(flags, { ref, staff: staff.name, type, from, to }, () => console.log(`${ref}: ${staff.name}, ${type} leave ${from} to ${to}, requested. Decide it: leave approve ${ref}.`));
    return;
  }
  if (sub === 'approve' || sub === 'decline') {
    const lv = await resolveByRef(db, 'v_leave', args[0], 'leave request', 'LV');
    if (lv.status !== 'requested') throw new CliError(`${lv.ref} is already ${lv.status}.`);
    if (sub === 'decline' && !str(flags.reason)) throw new CliError('A declined request keeps its reason: leave decline REF --reason="why".');
    await db.query(
      `update leave set status = $1, decided_on = current_date, note = coalesce($2, note) where id = $3`,
      [sub === 'approve' ? 'approved' : 'declined', sub === 'decline' ? `Declined: ${flags.reason}` : null, lv.leave_id],
    );
    const clashes = sub === 'approve'
      ? await db.query(
          `select ref, on_date, starts_at, ends_at from shifts where staff_id = $1 and status = 'published' and on_date between $2 and $3 order by on_date`,
          [lv.staff_id, isoDate(lv.starts_on), isoDate(lv.ends_on)],
        )
      : [];
    out(flags, { ref: lv.ref, status: sub === 'approve' ? 'approved' : 'declined', clashes }, () => {
      console.log(`${lv.ref}: ${lv.staff}'s ${lv.type} leave ${isoDate(lv.starts_on)} to ${isoDate(lv.ends_on)} ${sub === 'approve' ? 'approved' : 'declined'}.`);
      for (const c of clashes) console.log(`note: ${c.ref} (${weekday(c.on_date)} ${isoDate(c.on_date)} ${String(c.starts_at).slice(0, 5)}-${String(c.ends_at).slice(0, 5)}) is published over this leave. Reassign or open it: shift unassign ${c.ref}.`);
    });
    return;
  }
  // list
  const where = flags.pending ? `where status = 'requested'` : flags.all ? '' : `where ends_on >= current_date - 30`;
  const rows = await db.query(`select * from v_leave ${where} order by starts_on`);
  out(flags, rows, () => {
    console.log(heading(flags.pending ? 'Leave awaiting a decision' : 'The leave book'));
    console.log(table(rows, [
      { key: 'ref', label: 'ref' },
      { key: 'staff', label: 'who' },
      { key: 'type', label: 'type' },
      { key: 'starts_on', label: 'from', format: isoDate },
      { key: 'ends_on', label: 'to', format: isoDate },
      { key: 'days', label: 'days', align: 'right' },
      { key: 'rostered_clashes', label: 'clashes', align: 'right', format: (v) => (num(v) ? String(v) : '') },
      { key: 'state', label: 'state' },
    ]));
  });
}

// ---------------------------------------------------------------------------
// Commands: the hours and the money

async function cmdHours(db, flags) {
  const start = weekStart(flags.week);
  const end = addDays(start, 7);
  const rows = await db.query(
    `select s.name, s.role, s.hourly_rate_cents,
            coalesce(r.mins, 0)::int as rostered_minutes,
            coalesce(r.cost, 0)::bigint as rostered_cost_cents,
            coalesce(r.n, 0)::int as shifts,
            coalesce(w.mins, 0)::int as worked_minutes,
            coalesce(w.cost, 0)::bigint as worked_cost_cents
     from staff s
     left join (select staff_id, sum(paid_minutes) as mins, sum(cost_cents) as cost, count(*) as n
                from v_shifts where status in ('published', 'draft') and staff_id is not null and on_date >= $1 and on_date < $2
                group by staff_id) r on r.staff_id = s.id
     left join (select staff_id, sum(worked_minutes) as mins, sum(cost_cents) as cost
                from v_timesheets where clock_out_at is not null and on_date >= $1 and on_date < $2
                group by staff_id) w on w.staff_id = s.id
     where r.mins is not null or w.mins is not null
     order by rostered_minutes desc, name`,
    [start, end],
  );
  const [settings] = await db.query('select * from v_settings');
  out(flags, rows, () => {
    console.log(heading(`Hours, week of ${start}`));
    console.log(table(rows, [
      { key: 'name', label: 'name' },
      { key: 'role', label: 'role' },
      { key: 'shifts', label: 'shifts', align: 'right' },
      { key: 'rostered_minutes', label: 'rostered', align: 'right', format: (v) => fmtHours(v) },
      { key: 'worked_minutes', label: 'worked', align: 'right', format: (v) => (num(v) ? fmtHours(v) : '') },
      { key: 'rostered_cost_cents', label: 'roster cost', align: 'right', format: (v) => money(v) },
      { key: 'worked_cost_cents', label: 'worked cost', align: 'right', format: (v) => (num(v) ? money(v) : '') },
    ]));
    const over = rows.filter((r) => num(r.rostered_minutes) / 60 > Number(settings.max_week_hours));
    for (const o of over) console.log(`\n  note: ${o.name} is rostered ${fmtHours(o.rostered_minutes)}, over the ${settings.max_week_hours}h ceiling.`);
    const totals = rows.reduce((a, r) => ({ r: a.r + num(r.rostered_cost_cents), w: a.w + num(r.worked_cost_cents) }), { r: 0, w: 0 });
    console.log(`\n  Rostered cost ${money(totals.r)}${totals.w ? `, worked cost so far ${money(totals.w)}` : ''}. (Costing only; payroll pays people.)`);
  });
}

async function cmdLabour(db, flags) {
  const start = weekStart(flags.week);
  const end = addDays(start, 7);
  const rows = await db.query(
    `select site, coalesce(area, '(no area)') as area,
            count(*)::int as shifts,
            count(*) filter (where staff_id is null)::int as open_shifts,
            sum(paid_minutes)::int as minutes,
            sum(cost_cents)::bigint as cost_cents
     from v_shifts
     where status in ('published', 'draft') and on_date >= $1 and on_date < $2
     group by site, area
     order by site, cost_cents desc nulls last`,
    [start, end],
  );
  out(flags, rows, () => {
    console.log(heading(`Labour, week of ${start}`));
    console.log(table(rows, [
      { key: 'site', label: 'site', width: 24 },
      { key: 'area', label: 'area' },
      { key: 'shifts', label: 'shifts', align: 'right' },
      { key: 'open_shifts', label: 'open', align: 'right', format: (v) => (num(v) ? String(v) : '') },
      { key: 'minutes', label: 'hours', align: 'right', format: (v) => fmtHours(v) },
      { key: 'cost_cents', label: 'cost', align: 'right', format: (v) => (v == null ? '(no rate)' : money(v)) },
    ]));
    const total = rows.reduce((a, r) => a + num(r.cost_cents), 0);
    console.log(`\n  The week costs ${money(total)} as rostered. An open shift costs nothing yet and fails a service instead.`);
  });
}

// ---------------------------------------------------------------------------
// Commands: the rules

async function cmdAttention(db, flags) {
  const rows = await db.query(`select * from v_attention order by rank, days desc nulls last`);
  out(flags, rows, () => {
    console.log(heading('Needs a decision, worst first'));
    if (!rows.length) {
      console.log('  Nothing. The roster is published, the paper is current, the sheets are approved.');
      return;
    }
    for (const r of rows) {
      console.log(`\n  [${r.rank}] ${r.reason}  ${[r.label, r.who, r.place].filter(Boolean).join('  ')}`);
      console.log(`      ${r.detail}`);
    }
  });
}

const COMPLIANCE_RULES = [
  {
    key: 'entitlement',
    title: 'Right to work: nobody rostered past their recorded entitlement (Immigration Act 2009 s 350)',
    sql: `select st.name as who, to_char(st.visa_expires_on, 'YYYY-MM-DD') as expires, count(sh.id)::int as published_shifts_past_expiry
          from staff st left join shifts sh on sh.staff_id = st.id and sh.status = 'published' and sh.on_date > st.visa_expires_on and sh.on_date >= current_date
          where st.status = 'active' and st.visa_expires_on is not null and st.visa_expires_on < current_date
          group by st.name, st.visa_expires_on`,
    gate: 'shift add, shift assign and publish refuse a shift dated past the recorded expiry. No force flag.',
  },
  {
    key: 'duty-manager',
    title: 'A certified duty manager on every trading day at a licensed site (Sale and Supply of Alcohol Act 2012 ss 212-214)',
    sql: `select site, to_char(on_date, 'Dy YYYY-MM-DD') as day, shifts::int as shifts_published from v_duty_days where not covered order by on_date`,
    gate: 'Check only: the fix is a person, not a flag. Put a certificate holder on the day.',
  },
  {
    key: 'breaks',
    title: 'Meal breaks match the span worked (Employment Relations Act 2000 Part 6D)',
    sql: `select ref, staff as who, to_char(on_date, 'YYYY-MM-DD') as day, break_minutes::int as recorded, required_break_minutes::int as required
          from v_timesheets where break_short and status in ('submitted', 'approved') and on_date >= current_date - 30 order by on_date`,
    gate: 'clock out and approve say it out loud; the record is never silently rounded.',
  },
  {
    key: 'rest',
    title: 'The rest window between shifts holds (HSWA 2015 fatigue duty; Hospitality Award cl 15 in AU)',
    sql: `select staff as who, first_ref || ' then ' || then_ref as shifts, to_char(then_date, 'Dy YYYY-MM-DD') as day, gap_hours from v_rest_clashes order by then_date`,
    gate: 'shift add, shift assign and publish refuse a new shift inside the window. No force flag.',
  },
  {
    key: 'notice',
    title: 'The roster is published before the notice window (ERA 2000 ss 67C-67G; Hospitality Award cl 15 in AU)',
    sql: `select ref, to_char(on_date, 'Dy YYYY-MM-DD') as day, site, coalesce(staff, '(open)') as who from v_shifts where state = 'DRAFT LATE' order by on_date`,
    gate: 'Check only: finish the week and run publish.',
  },
  {
    key: 'hours',
    title: 'Nobody rostered over the weekly ceiling (settings: max_week_hours; ERA 2000 s 11B)',
    sql: `select name as who, to_char(min(on_date), 'YYYY-MM-DD') as week_of, round(sum(paid_minutes) / 60.0, 1) as rostered_hours
          from v_hours where on_date >= current_date - 7 group by name, date_trunc('week', on_date)
          having sum(paid_minutes) / 60.0 > (select max_week_hours from v_settings)`,
    gate: 'hours and attention flag it; the fix is spreading the load.',
  },
  {
    key: 'leave',
    title: 'Approved leave is never rostered over (Holidays Act 2003)',
    sql: `select ref, staff as who, type, to_char(starts_on, 'YYYY-MM-DD') || ' to ' || to_char(ends_on, 'YYYY-MM-DD') as leave, rostered_clashes::int as published_shifts
          from v_leave where state = 'ROSTERED OVER'`,
    gate: 'shift add and shift assign refuse a shift on approved leave. Clashes here came in by import or by approving leave over an existing roster: unassign or cancel the shift.',
  },
  {
    key: 'records',
    title: 'The wages, time and leave records are kept (ERA 2000 s 130: six years; Holidays Act 2003 s 81)',
    sql: `select ref, staff as who, to_char(on_date, 'YYYY-MM-DD') as day, 'open since ' || to_char(clock_in_at, 'YYYY-MM-DD HH24:MI') as problem
          from v_timesheets where state = 'NOT CLOCKED OUT'`,
    gate: 'Held by design: this CLI has no delete path. Shifts cancel with a reason, staff become former, timesheets stay. The one live risk is a record still open: close it while somebody remembers.',
  },
];

async function cmdCompliance(db, args, flags) {
  const only = args[0] ? String(args[0]).toLowerCase() : null;
  const rules = only ? COMPLIANCE_RULES.filter((r) => r.key === only) : COMPLIANCE_RULES;
  if (!rules.length) throw new CliError(`Unknown rule "${only}". Rules: ${COMPLIANCE_RULES.map((r) => r.key).join(', ')}.`);
  const results = [];
  for (const rule of rules) {
    const issues = await db.query(rule.sql);
    results.push({ rule: rule.key, title: rule.title, gate: rule.gate, issues });
  }
  out(flags, results, () => {
    console.log(heading('The rule book, run against the records'));
    for (const r of results) {
      const mark = r.issues.length ? `${r.issues.length} issue(s)` : 'PASS';
      console.log(`\n${r.rule}: ${mark}`);
      console.log(`  ${r.title}`);
      if (r.issues.length) console.log(table(r.issues, Object.keys(r.issues[0]).map((k) => ({ key: k, label: k, width: 44 }))));
      console.log(`  gate: ${r.gate}`);
    }
    console.log(`\nSources and reasoning: docs/compliance.md. This is the operator's rule book, not legal advice.`);
  });
}

async function cmdSettings(db, args, flags) {
  if (args[0] === 'set') {
    const [, key, ...rest] = args;
    const value = rest.join(' ');
    if (!key || !value) throw new CliError('settings set KEY VALUE');
    await db.query(
      `insert into settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value`,
      [key, value],
    );
    console.log(`${key} = ${value}`);
    return;
  }
  const rows = await db.query(`select key, value, note from settings order by key`);
  out(flags, rows, () => {
    console.log(heading('Settings: the numbers the rules read'));
    console.log(table(rows, [
      { key: 'key', label: 'key' },
      { key: 'value', label: 'value', align: 'right' },
      { key: 'note', label: 'what it does', width: 80 },
    ]));
  });
}

// ---------------------------------------------------------------------------
// Commands: notes

async function cmdNote(db, sub, args, flags) {
  if (sub === 'add') {
    const staff = await resolveStaff(db, args[0], { includeFormer: true });
    const text = args.slice(1).join(' ');
    if (!text) throw new CliError('note add NAME "what happened"');
    await db.query(`insert into file_notes (staff_id, noted_on, note) values ($1, current_date, $2)`, [staff.staff_id, text]);
    console.log(`Noted on ${staff.name}'s file.`);
    return;
  }
  const staff = await resolveStaff(db, args.join(' '), { includeFormer: true });
  const rows = await db.query(`select noted_on, note from file_notes where staff_id = $1 order by noted_on desc`, [staff.staff_id]);
  out(flags, rows, () => {
    console.log(heading(`File notes: ${staff.name}`));
    for (const n of rows) console.log(`  ${isoDate(n.noted_on)}  ${n.note}`);
    if (!rows.length) console.log('  (none)');
  });
}

// ---------------------------------------------------------------------------
// Commands: moving in and out

async function cmdImport(db, args, flags) {
  if ((args[0] || '').toLowerCase() !== 'deputy') throw new CliError('import deputy --staff=FILE [--timesheets=FILE] [--shifts=FILE] [--dry-run]');
  const dry = Boolean(flags['dry-run']);
  const report = { created: [], updated: [], skipped: [] };

  const readFile = (p) => {
    const full = path.resolve(String(p));
    if (!existsSync(full)) throw new CliError(`File not found: ${full}`);
    return parseCsv(readFileSync(full, 'utf8'));
  };

  const staffByName = async (name) => {
    const rows = await db.query(`select * from staff where lower(name) = lower($1)`, [name]);
    return rows[0] ?? null;
  };

  if (flags.staff) {
    for (const row of readFile(flags.staff)) {
      const name = (pick(row, 'Name', 'Employee', 'Employee Name', 'Display Name') || `${pick(row, 'First Name', 'FirstName')} ${pick(row, 'Last Name', 'LastName')}`).trim();
      if (!name) {
        report.skipped.push({ what: 'staff row', why: 'no name in the row', row: JSON.stringify(row).slice(0, 120) });
        continue;
      }
      const extRef = pick(row, 'Id', 'Employee Id', 'EmployeeId') ? `deputy:staff:${pick(row, 'Id', 'Employee Id', 'EmployeeId')}` : null;
      const email = pick(row, 'Email', 'Email Address') || null;
      const phone = pick(row, 'Mobile Number', 'Mobile Phone', 'Mobile', 'Phone', 'Contact Phone') || null;
      const existing = (extRef ? (await db.query(`select * from staff where external_ref = $1`, [extRef]))[0] : null) ?? (await staffByName(name));
      if (existing) {
        if (!dry) await db.query(`update staff set email = coalesce($1, email), phone = coalesce($2, phone), external_ref = coalesce($3, external_ref) where id = $4`, [email, phone, extRef, existing.id]);
        report.updated.push({ what: 'staff', name });
      } else {
        if (!dry) await db.query(`insert into staff (name, email, phone, external_ref) values ($1, $2, $3, $4)`, [name, email, phone, extRef]);
        report.created.push({ what: 'staff', name });
      }
    }
  }

  const ensureLocation = async (name) => {
    if (!name) return null;
    const rows = await db.query(`select * from locations where lower(name) = lower($1)`, [name]);
    if (rows.length) return rows[0];
    if (dry) return { id: null, name };
    const [loc] = await db.query(`insert into locations (name) values ($1) returning *`, [name]);
    return loc;
  };

  const rowsFor = async (file, kind) => {
    for (const row of readFile(file)) {
      const who = pick(row, 'Employee', 'Employee Name', 'Name', 'Team Member');
      const date = pick(row, 'Date', 'Shift Date', 'Start Date');
      const start = pick(row, 'Start', 'Start Time', 'Clock In', 'Start Time (24hr)');
      const end = pick(row, 'End', 'End Time', 'Clock Out', 'Finish', 'End Time (24hr)');
      const breakMin = pick(row, 'Mealbreak', 'Meal Break', 'Mealbreak (Mins)', 'Break', 'Break Length', 'Total Mealbreak');
      const locName = pick(row, 'Location', 'Location Name', 'Site');
      if (!date || !start || !end) {
        report.skipped.push({ what: kind, why: 'missing date, start or end', row: JSON.stringify(row).slice(0, 120) });
        continue;
      }
      let onDate;
      let startT;
      let endT;
      try {
        onDate = parseDate(date, 'Date');
        startT = parseTime(start.replace(/\s?(am|pm)$/i, (m) => m), 'Start');
        endT = parseTime(end, 'End');
      } catch (e) {
        report.skipped.push({ what: kind, why: e.message, row: JSON.stringify(row).slice(0, 120) });
        continue;
      }
      const brk = breakMin ? Math.round(parseFloat(breakMin) * (parseFloat(breakMin) < 3 ? 60 : 1)) : 0; // Deputy exports hours or minutes
      let staffRow = null;
      if (who) {
        staffRow = await staffByName(who);
        if (!staffRow && kind === 'timesheet') {
          report.skipped.push({ what: kind, why: `no staff member named "${who}" (import staff first)`, row: `${who} ${onDate}` });
          continue;
        }
        if (!staffRow && kind === 'shift') {
          report.skipped.push({ what: kind, why: `no staff member named "${who}" (import staff first, or leave Employee blank for an open shift)`, row: `${who} ${onDate}` });
          continue;
        }
      }
      const loc = await ensureLocation(locName);
      const extRef = `deputy:${kind}:${(who || 'open').toLowerCase()}:${onDate}:${startT}`;
      const existing = await db.query(`select id from ${kind === 'shift' ? 'shifts' : 'timesheets'} where external_ref = $1`, [extRef]);
      if (existing.length) {
        report.updated.push({ what: kind, name: `${who || '(open)'} ${onDate}` });
        continue;
      }
      if (kind === 'shift') {
        if (!dry) {
          const ref = await mintRef(db, 'shifts', 'SH', 1001);
          await db.query(
            `insert into shifts (ref, location_id, staff_id, on_date, starts_at, ends_at, break_minutes, status, external_ref)
             values ($1, $2, $3, $4, $5, $6, $7, 'published', $8) on conflict (external_ref) do nothing`,
            [ref, loc?.id ?? (await ensureLocation('Imported'))?.id, staffRow?.id ?? null, onDate, startT, endT, brk, extRef],
          );
        }
        report.created.push({ what: 'shift', name: `${who || '(open)'} ${onDate} ${startT}-${endT}` });
      } else {
        const { s, e } = shiftTimestamps(onDate, startT, endT);
        const pad = (n) => String(n).padStart(2, '0');
        const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        if (!dry) {
          const ref = await mintRef(db, 'timesheets', 'TS', 2001);
          await db.query(
            `insert into timesheets (ref, staff_id, location_id, on_date, clock_in_at, clock_out_at, break_minutes, status, external_ref)
             values ($1, $2, $3, $4, $5, $6, $7, 'submitted', $8) on conflict (external_ref) do nothing`,
            [ref, staffRow.id, loc?.id ?? null, onDate, fmt(s), fmt(e), brk, extRef],
          );
        }
        report.created.push({ what: 'timesheet', name: `${who} ${onDate} ${startT}-${endT}` });
      }
    }
  };

  if (flags.shifts) await rowsFor(flags.shifts, 'shift');
  if (flags.timesheets) await rowsFor(flags.timesheets, 'timesheet');
  if (!flags.staff && !flags.shifts && !flags.timesheets) throw new CliError('Nothing to import. import deputy --staff=FILE [--timesheets=FILE] [--shifts=FILE] [--dry-run]');

  out(flags, { dry_run: dry, created: report.created, updated: report.updated, skipped: report.skipped }, () => {
    console.log(heading(`Import from Deputy${dry ? ' (dry run: nothing written)' : ''}`));
    console.log(`  created: ${report.created.length}   updated: ${report.updated.length}   skipped: ${report.skipped.length}`);
    for (const s of report.skipped) console.log(`  skipped ${s.what}: ${s.why}  [${s.row}]`);
    console.log(`\nEvery import arrives with no right-to-work expiry and no duty manager certificate on record, deliberately.`);
    console.log(`The old system saying the paper was sighted is not the paper. Walk the team: staff visa NAME --expires=, staff cert NAME --number= --expires=.`);
    console.log(`Then the honesty sweep: compliance (the gaps, named), attention, hours --week=next.`);
  });
}

async function cmdExport(db, flags) {
  const dir = path.resolve(str(flags.out) || path.join(REPO_ROOT, 'export'));
  mkdirSync(dir, { recursive: true });
  const csv = (rows) => {
    if (!rows.length) return '';
    const cols = Object.keys(rows[0]);
    const esc = (v) => {
      const s = v === null || v === undefined ? '' : v instanceof Date ? isoDate(v) : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
  };
  const files = {
    'staff.csv': await db.query(`select name, role, employment, hourly_rate_cents, phone, email, visa_expires_on, duty_manager_cert_no, duty_manager_cert_expires_on, status from staff order by name`),
    'shifts.csv': await db.query(`select ref, on_date, site, area, staff, starts_at, ends_at, break_minutes, paid_minutes, cost_cents, status, state from v_shifts order by on_date`),
    'timesheets.csv': await db.query(`select ref, on_date, staff, site, clock_in_at, clock_out_at, break_minutes, worked_minutes, cost_cents, status, state from v_timesheets order by on_date`),
    'leave.csv': await db.query(`select ref, staff, type, starts_on, ends_on, days, status, requested_on, decided_on from v_leave order by starts_on`),
  };
  const written = [];
  for (const [name, rows] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), csv(rows) + '\n');
    written.push({ file: name, rows: rows.length });
  }
  out(flags, { dir, written }, () => {
    console.log(`Exported to ${dir}:`);
    for (const w of written) console.log(`  ${w.file}  ${w.rows} row(s)`);
    console.log(`\ntimesheets.csv is the payroll handoff: approved rows carry the hours. Your data, plain CSV, no export fee.`);
  });
}

async function cmdStats(db, flags) {
  const [row] = await db.query(`
    select
      (select count(*) from staff where status = 'active') as active_staff,
      (select count(*) from locations where status = 'active') as sites,
      (select count(*) from shifts where status = 'published' and on_date >= current_date and on_date < current_date + 14) as published_next_14,
      (select count(*) from v_open_shifts) as open_shifts,
      (select count(*) from v_shifts where state = 'DRAFT LATE') as draft_late,
      (select count(*) from v_timesheets where status = 'submitted') as awaiting_approval,
      (select count(*) from v_timesheets where state = 'NOT CLOCKED OUT') as not_clocked_out,
      (select count(*) from leave where status = 'requested') as leave_pending,
      (select coalesce(sum(paid_minutes), 0) from v_shifts where status = 'published' and on_date >= (date_trunc('week', current_date))::date + 7 and on_date < (date_trunc('week', current_date))::date + 14) as next_week_minutes,
      (select coalesce(sum(cost_cents), 0) from v_shifts where status = 'published' and on_date >= (date_trunc('week', current_date))::date + 7 and on_date < (date_trunc('week', current_date))::date + 14) as next_week_cost_cents,
      (select count(*) from v_attention) as attention_items
  `);
  const data = Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Number(v)]));
  out(flags, data, () => {
    console.log(heading('The whole business, in numbers'));
    console.log(`  team           ${data.active_staff} active staff across ${data.sites} site(s)`);
    console.log(`  roster         ${data.published_next_14} published shift(s) in the next 14 days, ${data.open_shifts} open, ${data.draft_late} draft inside the notice window`);
    console.log(`  next week      ${fmtHours(data.next_week_minutes)} rostered, ${money(data.next_week_cost_cents)} as costed`);
    console.log(`  timesheets     ${data.awaiting_approval} awaiting approval, ${data.not_clocked_out} never clocked out`);
    console.log(`  leave          ${data.leave_pending} request(s) waiting`);
    console.log(`  attention      ${data.attention_items} item(s): run attention`);
  });
}

// ---------------------------------------------------------------------------
// Help

function help() {
  console.log(`rostering-for-claude-code: the roster as a database and a CLI.

  the roster
    roster [--week=next|DATE] [--site=NAME] [--all]      the week, day by day, costed
    shift add SITE --date= --start= --end= [--staff= --area= --break=30 --role= --note=]
    shift assign REF NAME        shift unassign REF       shift cancel REF --reason=
    publish [--week=next|DATE]                            drafts become the real roster, gates checked
    open                                                  every published shift still looking for a person

  the people
    team [--all]                 person NAME              the whole card: paper, shifts, sheets, leave
    staff add NAME --role= [--rate= --employment= --visa-expires= --cert= --cert-expires=]
    staff rate NAME --rate=      staff visa NAME --expires=      staff cert NAME --number= --expires=
    staff former NAME
    availability [NAME]          availability set NAME DAY --start= --end=      availability clear NAME [DAY]
    site add NAME [--address= --licensed]                 area add SITE NAME

  time
    clock in NAME [--site= --at=HH:MM]                    clock out NAME [--at= --break=]
    timesheet add NAME --date= --in= --out= [--break= --site=]
    timesheet break REF --minutes=
    timesheets [--pending] [--week=] [--all]              approve REF | approve --all

  leave
    leave [--pending] [--all]    leave request NAME --type= --from= [--to=]
    leave approve REF            leave decline REF --reason=

  the hours
    hours [--week=next|DATE]     rostered vs worked vs cost, by person
    labour [--week=]             the week's cost by site and area

  the rules
    compliance [RULE]            the rule book, run against the records
    attention                    everything that wants a decision, worst first
    settings [set KEY VALUE]     the numbers the rules read

  notes
    note add NAME TEXT           notes NAME

  moving in and out
    import deputy --staff=FILE [--timesheets=FILE] [--shifts=FILE] [--dry-run]
    export [--out=DIR]           stats

Any read command takes --json. Money in NZD, rates for costing only: payroll pays people. There are no force flags.`);
}

// ---------------------------------------------------------------------------
// Main

const { args: argv, flags } = parseArgv(process.argv.slice(2));
const [cmd, ...rest] = argv;

const db = await getDb();
try {
  switch ((cmd || 'help').toLowerCase()) {
    case 'help': help(); break;
    case 'roster': await cmdRoster(db, flags); break;
    case 'shift': {
      const sub = (rest[0] || '').toLowerCase();
      if (sub === 'add') await cmdShiftAdd(db, rest.slice(1), flags);
      else if (sub === 'assign') await cmdShiftAssign(db, rest.slice(1), flags);
      else if (sub === 'unassign') await cmdShiftUnassign(db, rest.slice(1), flags);
      else if (sub === 'cancel') await cmdShiftCancel(db, rest.slice(1), flags);
      else throw new CliError('shift add|assign|unassign|cancel');
      break;
    }
    case 'publish': await cmdPublish(db, flags); break;
    case 'open': await cmdOpen(db, flags); break;
    case 'team': await cmdTeam(db, flags); break;
    case 'person': await cmdPerson(db, rest, flags); break;
    case 'staff': {
      const sub = (rest[0] || '').toLowerCase();
      if (sub === 'add') await cmdStaffAdd(db, rest.slice(1), flags);
      else await cmdStaffSet(db, sub, rest.slice(1), flags);
      break;
    }
    case 'availability': {
      const sub = (rest[0] || '').toLowerCase();
      if (sub === 'set' || sub === 'clear') await cmdAvailability(db, rest.slice(1), flags, sub);
      else await cmdAvailability(db, rest, flags, 'list');
      break;
    }
    case 'site': {
      if ((rest[0] || '').toLowerCase() !== 'add') throw new CliError('site add NAME [--address= --licensed]');
      await cmdSiteAdd(db, rest.slice(1), flags);
      break;
    }
    case 'area': {
      if ((rest[0] || '').toLowerCase() !== 'add') throw new CliError('area add SITE NAME');
      await cmdAreaAdd(db, rest.slice(1), flags);
      break;
    }
    case 'clock': await cmdClock(db, (rest[0] || '').toLowerCase(), rest.slice(1), flags); break;
    case 'timesheet': {
      const sub = (rest[0] || '').toLowerCase();
      if (sub === 'add') await cmdTimesheetAdd(db, rest.slice(1), flags);
      else if (sub === 'break') await cmdTimesheetBreak(db, rest.slice(1), flags);
      else throw new CliError('timesheet add|break (lists: timesheets)');
      break;
    }
    case 'timesheets': await cmdTimesheets(db, flags); break;
    case 'approve': await cmdApprove(db, rest, flags); break;
    case 'leave': {
      const sub = (rest[0] || '').toLowerCase();
      if (['request', 'approve', 'decline'].includes(sub)) await cmdLeave(db, sub, rest.slice(1), flags);
      else await cmdLeave(db, 'list', rest, flags);
      break;
    }
    case 'hours': await cmdHours(db, flags); break;
    case 'labour': case 'labor': await cmdLabour(db, flags); break;
    case 'attention': await cmdAttention(db, flags); break;
    case 'compliance': await cmdCompliance(db, rest, flags); break;
    case 'settings': await cmdSettings(db, rest, flags); break;
    case 'note': await cmdNote(db, (rest[0] || '').toLowerCase(), rest.slice(1), flags); break;
    case 'notes': await cmdNote(db, 'list', rest, flags); break;
    case 'import': await cmdImport(db, rest, flags); break;
    case 'export': await cmdExport(db, flags); break;
    case 'stats': await cmdStats(db, flags); break;
    default:
      throw new CliError(`Unknown command "${cmd}". Run with no arguments for the list.`);
  }
} catch (e) {
  if (e instanceof CliError) {
    console.error(e.message);
    process.exitCode = e.code;
  } else {
    throw e;
  }
} finally {
  await db.close();
}
