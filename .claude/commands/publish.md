---
description: Turn a drafted week into the real roster. Gates checked shift by shift; anything unlawful stays draft with the reason named.
---

1. Run `node scripts/roster.mjs publish --week=next --json` (or the week asked for).
2. Report what went out and what was held: a held shift names its gate (right to work, leave, overlap, rest window). Each held shift gets its one fix.
3. If any published shifts are still open, say how many and offer `/draft-open-shift-callout`.
4. Offer `/draft-roster-message`: each person's week, written to `drafts/`, for a person to send.
