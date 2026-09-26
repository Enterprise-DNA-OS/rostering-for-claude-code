---
description: Clock someone in or out, or fix a forgotten clock-out. The timesheet is the wages and time record, so the time recorded is the time worked.
---

1. In: `node scripts/roster.mjs clock in NAME [--site=] [--at=HH:MM]`. Out: `clock out NAME [--at=] [--break=]`. A finish after midnight takes `--at="YYYY-MM-DD HH:MM"`.
2. A forgotten clock-out from a past day: ask what time they actually finished, then `clock out NAME --at="YYYY-MM-DD HH:MM" --break=`. Never guess silently; the record is the record (ERA 2000 s 130).
3. If the CLI notes a short meal break, say it out loud: either the break was taken and needs recording (`timesheet break REF --minutes=`), or it was not and the practice needs fixing this week.
4. Report the sheet: worked hours, break, variance against the rostered shift.
