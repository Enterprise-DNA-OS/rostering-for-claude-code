---
description: Work the approval queue. Approval is the payroll gate: it confirms hours, never invents them.
---

1. Run `node scripts/roster.mjs timesheets --pending --json` and read every sheet before approving anything.
2. A sheet still open refuses: fix it first (`clock out NAME --at=`). A BREAK SHORT sheet gets a decision, not a silent pass: record the break that was taken (`timesheet break REF --minutes=`) or approve the true record and fix the practice.
3. Approve one by one (`approve REF`) when sheets need judgment, or `approve --all` when the queue is clean. Say every variance note the CLI raises.
4. Close with what payroll gets: `export` writes `timesheets.csv`, and approved rows carry the hours.
