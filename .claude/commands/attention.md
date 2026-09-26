---
description: Everything that wants a decision this morning, worst first. A person on the published roster past their right-to-work expiry outranks everything, then a licensed site trading without a certified duty manager, forgotten clock-outs, leave clashes, rest breaches, short breaks, open shifts, a late roster, stale timesheets and expiring paper.
---

1. Run `node scripts/roster.mjs attention --json`.
2. Present it worst first, grouped by reason, in the business's words. Lead with anything rank 1 or 2 (a right-to-work breach, an uncovered licensed day): those are today's first conversations, say so plainly.
3. For each group, say the one action that clears it: `staff visa NAME --expires=`, put a certificate holder on the day, `clock out NAME --at=`, `shift unassign REF`, move one of the clashing shifts, `/approve`, `leave approve REF`.
4. If the list is empty, say so in one line and stop.
