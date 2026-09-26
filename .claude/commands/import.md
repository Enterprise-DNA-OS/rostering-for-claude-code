---
description: Bring the business across from Deputy (or any rostering system whose exports land in CSV) - people, then timesheets, then shifts, dry-run first. The import is the first audit.
---

1. Read `docs/replace-deputy.md` for what exports, what maps, and what deliberately starts fresh.
2. Dry run first: `node scripts/roster.mjs import deputy --staff=people.csv --timesheets=timesheets.csv --shifts=shifts.csv --dry-run --json`. Read the skips out loud: a row with no date is a question about the old data, not a rounding error.
3. Run it for real, then re-run it: the second pass must create nothing new. That is the idempotency check.
4. Every imported person arrives with no right-to-work expiry and no duty manager certificate on record, deliberately. The old system saying the paper was sighted is not the paper. Walk the team: `staff visa NAME --expires=`, `staff cert NAME --number= --expires=`.
5. Then the honesty sweep: `compliance --json` (the gaps, named), `attention --json`, `hours --week=next --json`. Present created, updated, skipped-and-why, and the three commands to run next.
