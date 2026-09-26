# Moving off Deputy

The promise: export from Deputy (or Tanda, When I Work, Sling, or any rostering system whose reports print to CSV), run one command, and the operating record comes with you in a morning. Here is exactly what carries, what starts fresh, and why.

## What to export

Deputy's list screens and reports export to CSV. You need up to three files:

1. **People.** The team member export: name (or first and last), email, mobile. (`People` > export, or the Team Members report.)
2. **Timesheets.** The timesheet export for the period you want on record: employee, date, start, end, meal break, location. (`Timesheets` > export, or Reports > Timesheet report.)
3. **Shifts** (optional). The roster export for the weeks ahead: employee (blank rows import as open shifts), date, start time, end time, area, location.

Column names vary between Deputy screens and report layouts; the importer matches the common variants case-insensitively (`Employee`, `Employee Name`, `Start`, `Start Time`, `Clock In`, `Mealbreak`, `Meal Break (Mins)` all work). Dates in DD/MM/YYYY are read as New Zealand dates. A meal break exported in hours (0.5) or minutes (30) reads correctly either way.

## Run it

```bash
node scripts/roster.mjs import deputy --staff=people.csv --timesheets=timesheets.csv --shifts=shifts.csv --dry-run
node scripts/roster.mjs import deputy --staff=people.csv --timesheets=timesheets.csv --shifts=shifts.csv
```

Dry run first, always. The importer is idempotent: it matches people on name (and keeps Deputy's id in `external_ref` when the export carries one), and derives a stable key for every shift and timesheet, so running it twice updates instead of duplicating, and a weekly re-run during a transition period is safe.

## What maps

| Deputy | Here |
|---|---|
| Team member (name, email, mobile) | `staff`, Deputy id kept in `external_ref` |
| Timesheet (date, start, end, meal break, location) | `timesheets`, landed as `submitted` for your approval |
| Rostered shift (employee, date, times, location) | `shifts`, landed as `published`; a blank employee is an open shift |
| Location | `locations`, created on first mention; mark the licensed ones yourself (`site add` shows the flag) |

## What deliberately does not carry over

- **The paper.** Every imported person arrives with **no right-to-work expiry and no duty manager certificate on record**, on purpose. The old system saying a visa was sighted is not the visa. Walk the team once (`staff visa NAME --expires=`, `staff cert NAME --number= --expires=`) and the first `compliance` run after import is your opening audit, on the record.
- **Pay rates and pay history.** Rates here cost rosters; payroll pays people. Set costing rates with `staff rate NAME --rate=`. Pay history stays in the payroll system it belongs to.
- **Leave balances.** Balances are payroll's arithmetic. What lives here is the leave book the roster must respect: enter approved future leave (`leave request` then `leave approve`) and it gates the roster from day one.
- **Availability.** Deputy's availability export is thin and stale in most accounts. Ask the team once and record it fresh: `availability set NAME DAY --start= --end=`. It is ten minutes and the roster builder reads it forever.
- **Old messages, news feed, tasks.** The conversation history stays in the system it happened in. Anything that still matters becomes a file note (`/log`).

## The import is the first audit

Every skip is named and every skip is a question about the old data: a timesheet row with no date, a shift for a person the people export never mentioned. Do not silence them; answer them. Then run the honesty sweep:

```bash
node scripts/roster.mjs compliance --json   # the paper gaps, named person by person
node scripts/roster.mjs attention --json    # what wants a decision today
node scripts/roster.mjs hours --week=next   # the week ahead, costed
```

A clean roster on day one is the point of moving.
