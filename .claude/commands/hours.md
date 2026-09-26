---
description: Rostered against worked hours by person for a week, with the cost of each, and anyone over the weekly ceiling.
---

1. Run `node scripts/roster.mjs hours --json` (this week) or `--week=next`.
2. Present rostered vs worked per person. Name anyone over the ceiling (the CLI notes it) and anyone whose worked hours keep running past their rostered ones: that is either under-rostering or unmanaged overtime, and both cost money.
3. Rates cost the roster; payroll pays people. Say so if the operator asks about pay.
