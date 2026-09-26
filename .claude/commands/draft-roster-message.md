---
description: Write each person's week - their shifts, sites and times - as a message ready to send, one file per person in drafts/. Never sends anything.
---

1. Run `node scripts/roster.mjs roster --week=next --json` and group the published shifts by person.
2. For each person, write `drafts/roster-<name>-<week>.md`: a two-line message in the operator's voice with their days, times and sites, and who to tell if something does not work. Plain words, no jargon, no exclamation marks.
3. One extra file, `drafts/roster-summary-<week>.md`, lists every message written and the open shifts still needing cover.
4. Report the file list. A person sends these; this system never does.
