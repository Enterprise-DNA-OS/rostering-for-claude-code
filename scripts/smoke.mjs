#!/usr/bin/env node
// End-to-end smoke test on a throwaway embedded database.
// Runs migrate, seed, then every CLI command that matters, and asserts on the JSON.
// Passes on Windows and Linux. No network, no Postgres install.
//
// The seed anchors the roster week ahead to next Monday and the worked week
// to current_date offsets, so every assertion here holds whatever day you run it.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = mkdtempSync(path.join(tmpdir(), 'roster-smoke-'));
const scratch = mkdtempSync(path.join(tmpdir(), 'roster-smoke-files-'));
const env = { ...process.env, DATA_DIR: dataDir };
delete env.DATABASE_URL; // the smoke test always runs embedded

let step = 0;
function run(label, args, { json = true, expectFail = false } = {}) {
  step++;
  const argv = [path.join(root, 'scripts', args[0]), ...args.slice(1), ...(json && !expectFail ? ['--json'] : [])];
  const res = spawnSync(process.execPath, argv, { cwd: root, env, encoding: 'utf8' });
  const ok = expectFail ? res.status !== 0 : res.status === 0;
  if (!ok) {
    console.error(`\nFAIL step ${step} (${label}): exit ${res.status}\n--- stdout\n${res.stdout}\n--- stderr\n${res.stderr}`);
    process.exit(1);
  }
  console.log(`  ok  ${String(step).padStart(2)}  ${label}`);
  if (!json || expectFail) return { stdout: res.stdout, stderr: res.stderr };
  try {
    return JSON.parse(res.stdout);
  } catch {
    console.error(`\nFAIL step ${step} (${label}): output is not JSON\n${res.stdout}\n${res.stderr}`);
    process.exit(1);
  }
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`\nFAIL assertion: ${msg}`);
    process.exit(1);
  }
}

const n = (v) => Number(v ?? 0);
const iso = (d) => {
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const addDays = (base, days) => {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
  return d;
};
const now = new Date();
const yesterday = iso(addDays(now, -1));
// Next Monday, the seed's roster anchor.
const nextMonday = iso(addDays(now, 7 - ((now.getDay() + 6) % 7)));

console.log(`smoke: data dir ${dataDir}`);
try {
  run('migrate', ['migrate.mjs'], { json: false });
  run('migrate again (idempotent)', ['migrate.mjs'], { json: false });
  run('seed', ['seed.mjs'], { json: false });
  run('seed again (idempotent)', ['seed.mjs'], { json: false });

  // ---- the numbers -----------------------------------------------------------

  const stats = run('stats', ['roster.mjs', 'stats']);
  assert(n(stats.active_staff) === 10, `ten active staff (${stats.active_staff})`);
  assert(n(stats.sites) === 2, `two sites (${stats.sites})`);
  assert(n(stats.published_next_14) === 22, `22 published shifts ahead (${stats.published_next_14})`);
  assert(n(stats.open_shifts) === 2, `two open shifts (${stats.open_shifts})`);
  assert(n(stats.draft_late) === 2, `two drafts inside the notice window (${stats.draft_late})`);
  assert(n(stats.awaiting_approval) === 4, `four timesheets awaiting approval (${stats.awaiting_approval})`);
  assert(n(stats.not_clocked_out) === 1, `one sheet never clocked out (${stats.not_clocked_out})`);
  assert(n(stats.leave_pending) === 1, `one leave request waiting (${stats.leave_pending})`);
  assert(n(stats.next_week_minutes) === 10020, `167h rostered next week (${stats.next_week_minutes})`);

  // ---- attention: every deliberate mess in the seed fires ---------------------

  const attention = run('attention', ['roster.mjs', 'attention']);
  const reasons = new Set(attention.map((r) => r.reason));
  for (const expected of ['work_rights', 'duty_uncovered', 'not_clocked_out', 'leave_clash', 'rest_breach',
    'break_short', 'draft_late', 'timesheet_stale', 'leave_pending', 'over_hours', 'visa_expiring', 'cert_expiring']) {
    assert(reasons.has(expected), `attention includes ${expected} (${[...reasons].join(', ')})`);
  }
  assert(attention[0].reason === 'work_rights', 'the right-to-work breach outranks everything');
  assert(attention.filter((r) => r.reason === 'timesheet_stale').length === 2, 'two people hold stale timesheets');

  // ---- the team ----------------------------------------------------------------

  const team = run('team', ['roster.mjs', 'team']);
  assert(team.length === 10, `ten active staff listed (${team.length})`);
  const lucas = team.find((s) => s.name === 'Lucas Meyer');
  assert(lucas.work_rights === 'EXPIRED', 'Lucas: right to work expired');
  assert(team.find((s) => s.name === 'Noah Griffin').duty_cert === 'expiring', 'Noah: duty cert expiring');
  assert(team.find((s) => s.name === 'Mia Fletcher').duty_cert === 'current', 'Mia: duty cert current');

  const allTeam = run('team --all includes the former', ['roster.mjs', 'team', '--all']);
  assert(allTeam.length === 11, `all staff (${allTeam.length})`);

  const noah = run('person card by partial name', ['roster.mjs', 'person', 'noah']);
  assert(noah.staff.name === 'Noah Griffin', 'resolved by partial name');
  assert(noah.upcoming_shifts.length === 6, `Noah holds six shifts next week (${noah.upcoming_shifts.length})`);

  const nobody = run('an unknown person exits 1', ['roster.mjs', 'person', 'nobody at all'], { json: false, expectFail: true });
  assert(/No staff member matches/.test(nobody.stderr), 'and says so plainly');

  // ---- the roster ----------------------------------------------------------------

  const week = run('roster --week=next', ['roster.mjs', 'roster', '--week=next']);
  assert(week.length >= 22, `next week holds the published roster (${week.length})`);
  const overnight = week.find((s) => s.ref === 'SH-1041');
  assert(n(overnight.paid_minutes) === 420, `the past-midnight bar shift computes 7h paid (${overnight.paid_minutes})`);
  assert(week.find((s) => s.ref === 'SH-1040').state === 'NO WORK RIGHTS', 'a shift past the visa expiry is loud');

  const open = run('open shifts', ['roster.mjs', 'open']);
  assert(open.length === 2, `two open shifts (${open.length})`);
  assert(open.every((s) => s.staff === null), 'open shifts have nobody assigned');

  const hoursNext = run('hours --week=next', ['roster.mjs', 'hours', '--week=next']);
  const noahHours = hoursNext.find((r) => r.name === 'Noah Griffin');
  assert(n(noahHours.rostered_minutes) === 3120, `Noah is rostered 52h (${noahHours.rostered_minutes}m)`);

  const labour = run('labour --week=next', ['roster.mjs', 'labour', '--week=next']);
  const bar = labour.find((r) => r.area === 'Bar');
  assert(n(bar.minutes) === 780 && n(bar.cost_cents) === 33800, `the bar costs $338 for 13h (${bar.minutes}m, ${bar.cost_cents}c)`);

  // ---- the gates refuse, and say why ------------------------------------------

  const visaGate = run('gate: a shift past the right-to-work expiry refuses', ['roster.mjs', 'shift', 'assign', 'SH-1050', 'Lucas Meyer'], { expectFail: true });
  assert(/Immigration Act 2009/.test(visaGate.stderr), 'and cites the Act');

  const leaveGate = run('gate: rostering over approved leave refuses', ['roster.mjs', 'shift', 'add', 'Eatery', `--date=${nextMonday}`, '--start=10:00', '--end=14:00', '--staff=Grace Okafor'], { expectFail: true });
  assert(/Holidays Act 2003/.test(leaveGate.stderr), 'and cites the Act');

  const overlapGate = run('gate: an overlapping shift refuses', ['roster.mjs', 'shift', 'add', 'Eatery', `--date=${nextMonday}`, '--start=10:00', '--end=14:00', '--staff=Mia Fletcher'], { expectFail: true });
  assert(/overlaps/.test(overlapGate.stderr), 'and names the clash');

  const restGate = run('gate: a shift inside the rest window refuses', ['roster.mjs', 'shift', 'add', 'Eatery', `--date=${iso(addDays(new Date(`${nextMonday}T00:00:00`), 3))}`, '--start=05:00', '--end=06:30', '--staff=Ben Tuilagi'], { expectFail: true });
  assert(/rest window/.test(restGate.stderr), 'and names the window');

  // ---- time: clock in, clock out, approve -------------------------------------

  run('gate: approving an open sheet refuses', ['roster.mjs', 'approve', 'TS-2007'], { expectFail: true });

  const clockedOut = run('clock out the forgotten sheet', ['roster.mjs', 'clock', 'out', 'emma', `--at=${yesterday} 14:06`, '--break=30']);
  assert(n(clockedOut.worked_minutes) === 394, `Emma worked 6.57h (${clockedOut.worked_minutes}m)`);

  const jackIn = run('clock in', ['roster.mjs', 'clock', 'in', 'jack', '--at=10:00', '--site=Espresso']);
  run('gate: a second open sheet refuses', ['roster.mjs', 'clock', 'in', 'jack', '--at=10:05'], { expectFail: true });
  const jackOut = run('clock out', ['roster.mjs', 'clock', 'out', 'jack', '--at=11:30', '--break=0']);
  assert(n(jackOut.worked_minutes) === 90, `Jack worked 90 minutes (${jackOut.worked_minutes})`);
  run('approve it', ['roster.mjs', 'approve', jackOut.ref]);

  const manual = run('a manual overnight timesheet', ['roster.mjs', 'timesheet', 'add', 'oliver', `--date=${yesterday}`, '--in=18:00', '--out=02:00', '--break=30']);
  assert(n(manual.worked_minutes) === 450, `18:00 to 02:00 less 30m is 7.5h (${manual.worked_minutes}m)`);

  const pending = run('timesheets --pending', ['roster.mjs', 'timesheets', '--pending']);
  assert(pending.length === 6, `six sheets now await approval (${pending.length})`);
  const shortSheet = pending.find((t) => t.ref === 'TS-2006');
  assert(shortSheet.state === 'BREAK SHORT' && n(shortSheet.required_break_minutes) === 30, 'the missing meal break is loud');

  run('timesheet break records the missed break', ['roster.mjs', 'timesheet', 'break', 'TS-2006', '--minutes=30']);
  run('approve --all clears the queue', ['roster.mjs', 'approve', '--all']);
  const pendingAfter = run('nothing left pending', ['roster.mjs', 'timesheets', '--pending']);
  assert(pendingAfter.length === 0, `the queue is empty (${pendingAfter.length})`);

  // ---- leave -------------------------------------------------------------------

  const leaveList = run('the leave book', ['roster.mjs', 'leave', '--all']);
  assert(leaveList.length === 3, `three leave records (${leaveList.length})`);
  assert(leaveList.find((l) => l.ref === 'LV-101').state === 'ROSTERED OVER', `Grace's leave shows the clash`);

  run('gate: leave over approved leave refuses', ['roster.mjs', 'leave', 'request', 'grace', `--from=${nextMonday}`], { expectFail: true });

  const decided = run('approve the waiting request', ['roster.mjs', 'leave', 'approve', 'LV-102']);
  assert(decided.status === 'approved' && decided.clashes.length === 0, 'approved clean');

  const newLeave = run('a new request', ['roster.mjs', 'leave', 'request', 'oliver', '--type=annual', `--from=${iso(addDays(now, 40))}`, `--to=${iso(addDays(now, 41))}`]);
  run('declined with a reason', ['roster.mjs', 'leave', 'decline', newLeave.ref, '--reason=Stocktake weekend, next one is yours']);
  run('gate: deciding twice refuses', ['roster.mjs', 'leave', 'approve', newLeave.ref], { expectFail: true });

  // ---- the roster grows: add, assign, publish ----------------------------------

  run('a new site', ['roster.mjs', 'site', 'add', 'Copper Kettle Cart', '--address=Midland Park, Wellington']);
  run('a new area', ['roster.mjs', 'area', 'add', 'Cart', 'Counter']);

  const newStaff = run('a new hire', ['roster.mjs', 'staff', 'add', 'Ana Rangi', '--role=barista', '--rate=27.50', '--employment=part_time']);
  assert(newStaff.name === 'Ana Rangi', 'added');
  run('her availability', ['roster.mjs', 'availability', 'set', 'Ana Rangi', 'sun', '--start=08:00', '--end=16:00']);
  const avail = run('availability reads back', ['roster.mjs', 'availability', 'Ana Rangi']);
  assert(avail.length === 1 && n(avail[0].weekday) === 0, 'Sunday window recorded');

  const sunday = iso(addDays(new Date(`${nextMonday}T00:00:00`), 6));
  const newShift = run('a draft shift inside her window', ['roster.mjs', 'shift', 'add', 'Cart', `--date=${sunday}`, '--start=09:00', '--end=15:00', '--area=Counter', '--staff=Ana Rangi']);
  assert(newShift.status === 'draft', 'lands as draft');

  const published = run('publish the week', ['roster.mjs', 'publish', '--week=next']);
  assert(published.published.includes(newShift.ref), `the new shift went out (${published.published.join(', ')})`);

  const reassigned = run('fill an open shift', ['roster.mjs', 'shift', 'assign', 'SH-1050', 'Emma Walsh']);
  assert(reassigned.staff === 'Emma Walsh', 'assigned');
  run('open it again', ['roster.mjs', 'shift', 'unassign', 'SH-1050']);
  run('cancel with a reason', ['roster.mjs', 'shift', 'cancel', newShift.ref, '--reason=Cart stays closed Sunday']);
  run('gate: cancel without a reason refuses', ['roster.mjs', 'shift', 'cancel', 'SH-1050'], { expectFail: true });

  // ---- staff paper -------------------------------------------------------------

  run('record the new visa', ['roster.mjs', 'staff', 'visa', 'Lucas Meyer', `--expires=${iso(addDays(now, 400))}`]);
  const fixedAttention = run('the breach clears', ['roster.mjs', 'attention']);
  assert(!fixedAttention.some((r) => r.reason === 'work_rights'), 'work_rights is gone once the paper is real');
  run('record a duty cert', ['roster.mjs', 'staff', 'cert', 'Sofia Marino', '--number=DM-99001', `--expires=${iso(addDays(now, 300))}`]);
  run('note the conversation', ['roster.mjs', 'note', 'add', 'Lucas Meyer', 'Grant letter sighted and filed. Visa recorded to next year.'], { json: false });
  const notes = run('notes read back', ['roster.mjs', 'notes', 'Lucas Meyer']);
  assert(notes.length === 2, `two notes on file (${notes.length})`);

  // ---- the rules ----------------------------------------------------------------

  const compliance = run('compliance', ['roster.mjs', 'compliance']);
  assert(compliance.length === 8, `eight rules (${compliance.length})`);
  const byRule = Object.fromEntries(compliance.map((r) => [r.rule, r.issues.length]));
  assert(byRule['entitlement'] === 0, `entitlement passes once the visa is recorded (${byRule['entitlement']})`);
  assert(byRule['duty-manager'] === 1, `Saturday still trades uncovered (${byRule['duty-manager']})`);
  assert(byRule['rest'] === 1, `the close-then-open is on record (${byRule['rest']})`);
  assert(byRule['leave'] === 1, `Grace's clash is on record (${byRule['leave']})`);
  assert(byRule['hours'] === 1, `Noah's 52h week is on record (${byRule['hours']})`);
  const oneRule = run('one rule by key', ['roster.mjs', 'compliance', 'breaks']);
  assert(oneRule.length === 1 && oneRule[0].rule === 'breaks', 'a single rule runs alone');

  run('settings set', ['roster.mjs', 'settings', 'set', 'rest_between_shifts_hours', '11'], { json: false });
  const settings = run('settings read back', ['roster.mjs', 'settings']);
  assert(settings.find((s) => s.key === 'rest_between_shifts_hours').value === '11', 'the rule reads the new number');
  run('settings back', ['roster.mjs', 'settings', 'set', 'rest_between_shifts_hours', '10'], { json: false });

  // ---- moving in and out ---------------------------------------------------------

  const staffCsv = path.join(scratch, 'people.csv');
  writeFileSync(staffCsv, [
    'First Name,Last Name,Email,Mobile Number',
    'Ari,Bell,ari.bell@example.nz,021 555 0900',
    'Jack,Harmon,jack@copperkettle.example.nz,021 555 0507',
  ].join('\n'));
  const tsCsv = path.join(scratch, 'timesheets.csv');
  writeFileSync(tsCsv, [
    'Employee,Date,Start Time,End Time,Mealbreak (Mins),Location',
    `Ari Bell,${yesterday},09:00,17:30,30,Copper Kettle Espresso`,
    `Ari Bell,,09:00,17:30,30,Copper Kettle Espresso`,
  ].join('\n'));
  const shiftsCsv = path.join(scratch, 'shifts.csv');
  writeFileSync(shiftsCsv, [
    'Employee,Date,Start Time,End Time,Mealbreak (Mins),Location',
    `Ari Bell,${iso(addDays(new Date(`${nextMonday}T00:00:00`), 8))},09:00,17:00,30,Copper Kettle Espresso`,
    `,${iso(addDays(new Date(`${nextMonday}T00:00:00`), 8))},11:00,19:00,30,Copper Kettle Espresso`,
  ].join('\n'));

  // Jack's name matched: the import must not create a duplicate. First name-only
  // rows are Deputy's shape, so the joined name is the match key.
  const dry = run('import: dry run first', ['roster.mjs', 'import', 'deputy', `--staff=${staffCsv}`, `--timesheets=${tsCsv}`, `--shifts=${shiftsCsv}`, '--dry-run']);
  assert(dry.dry_run === true && dry.created.some((c) => c.what === 'staff' && c.name === 'Ari Bell'), 'the dry run names who would land');
  assert(dry.skipped.some((s) => /missing date/.test(s.why)), `and names the row with no date (${JSON.stringify(dry.skipped.map((s) => s.why))})`);

  const statsBefore = run('nothing was written', ['roster.mjs', 'stats']);
  assert(n(statsBefore.active_staff) === 11, `still eleven active after the dry run (${statsBefore.active_staff})`);

  const imported = run('import for real', ['roster.mjs', 'import', 'deputy', `--staff=${staffCsv}`, `--timesheets=${tsCsv}`, `--shifts=${shiftsCsv}`]);
  assert(imported.created.some((c) => c.what === 'staff' && c.name === 'Ari Bell'), 'Ari Bell arrived');
  assert(imported.updated.some((u) => u.what === 'staff' && u.name === 'Jack Harmon'), 'Jack matched, not duplicated');

  const again = run('import again (idempotent)', ['roster.mjs', 'import', 'deputy', `--staff=${staffCsv}`, `--timesheets=${tsCsv}`, `--shifts=${shiftsCsv}`]);
  assert(again.created.filter((c) => c.what !== 'staff').length === 0, `the second pass creates nothing new (${JSON.stringify(again.created)})`);

  const exported = run('export', ['roster.mjs', 'export', `--out=${path.join(scratch, 'out')}`]);
  assert(exported.written.length === 4, `four files (${exported.written.length})`);
  for (const w of exported.written) {
    assert(existsSync(path.join(scratch, 'out', w.file)), `${w.file} exists`);
    assert(readFileSync(path.join(scratch, 'out', w.file), 'utf8').split('\n').length > 2, `${w.file} has rows`);
  }

  console.log(`\nPASS: ${step} steps.`);
} finally {
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
}
