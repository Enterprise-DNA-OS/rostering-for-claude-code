---
description: The timesheets for a week, or everything awaiting approval, with worked hours, breaks, and variance against the roster.
---

1. Run `node scripts/roster.mjs timesheets --json` (this week), `--pending` (awaiting approval), or `--week=` for another week.
2. Present them with the state loud: NOT CLOCKED OUT and BREAK SHORT first, then AWAITING sheets by age, then the clean ones in one line.
3. Flag any variance beyond 30 minutes either way: worked well past the rostered finish is unplanned cost, well under is a service that ran short-handed.
4. Point at the next step: `/approve` for the queue, `/clock` for the open sheet.
