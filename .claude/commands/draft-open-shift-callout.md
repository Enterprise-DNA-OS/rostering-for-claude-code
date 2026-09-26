---
description: Write the cover request for open shifts - who is being asked, for what, by when - to drafts/. Never sends anything.
---

1. Run `node scripts/roster.mjs open --json`. For each open shift, work out who can lawfully take it: availability for that weekday, the leave book, the rest window, the hours ceiling.
2. Write `drafts/open-shifts-<week>.md`: one short ask per shift (day, time, site, role) with the two or three names it suits, in the operator's voice.
3. If a shift has no lawful taker, say so in the draft: that is a hiring signal, not a formatting problem.
4. Report the file path. A person sends it; this system never does.
