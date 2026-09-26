---
description: Draft next week's roster from the standing availability, last week's pattern, and the leave book. Drafts only; nothing is published without a separate yes.
---

1. Read what exists: `node scripts/roster.mjs roster --week=next --json` (already drafted or published), `availability --json`, `leave --all --json` (approved leave next week), and last week's shape (`roster --week=YYYY-MM-DD --json` for the week just gone).
2. Propose a draft: for each site and day, the shifts that repeat weekly, each with a person whose availability window covers it and who is not on leave. Respect the rest window and the weekly hours ceiling; leave a shift open (`--role=`) rather than force a bad fit.
3. Create the shifts with `shift add SITE --date= --start= --end= --area= --staff= [--role=]`. The gates will refuse anything unlawful; a warning about availability is a conversation, not an error.
4. Check the whole week: `hours --week=next --json` (nobody over the ceiling), `labour --week=next --json` (the cost against last week), `compliance --json` (duty cover on licensed days).
5. Present the draft week and its cost, name the open shifts, and stop. Publishing is its own decision: `/publish`.
