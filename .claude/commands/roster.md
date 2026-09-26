---
description: The week's roster, day by day, costed. This week by default; --week=next for the week ahead; --site= for one site.
---

1. Run `node scripts/roster.mjs roster --json` (add `--week=next` or `--week=YYYY-MM-DD`, and `--site=` if asked).
2. Present it day by day: who, where, what hours, what the day costs. Flag anything whose state is not `published` or `worked`: OPEN needs a person, DRAFT LATE needs publishing, NO WORK RIGHTS needs the visa conversation today.
3. Close with the week's totals: shifts, open count, rostered cost.
4. If the operator wants it on the wall, `npm run docs` renders each site's printed weekly roster.
