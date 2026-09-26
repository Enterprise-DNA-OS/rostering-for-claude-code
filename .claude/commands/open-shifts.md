---
description: Every published shift still looking for a person, and who could plausibly take each one.
---

1. Run `node scripts/roster.mjs open --json`.
2. For each open shift, work out who could take it: `availability --json` for the weekday window, `hours --week= --json` to avoid pushing someone over the ceiling, the leave book, and the rest window against their existing shifts.
3. Present each shift with its two or three plausible names and why. Assign on a yes: `shift assign REF NAME` (the gates recheck everything).
4. If nobody fits, say so and offer `/draft-open-shift-callout` to ask the team.
