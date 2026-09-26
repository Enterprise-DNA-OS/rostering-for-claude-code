---
description: The leave book - requests waiting, approvals, and what each approval does to the roster.
---

1. Run `node scripts/roster.mjs leave --pending --json` (waiting) or `leave --all --json` (the book).
2. Before recommending a decision on a request, check the roster for those dates (`roster --week= --json`) and say what cover is needed if it is approved.
3. Decide on a yes: `leave approve REF` or `leave decline REF --reason=`. A decline always carries its reason; the person reads it.
4. If approval creates clashes, the CLI names the published shifts sitting on the leave: reassign or open each one now (`shift unassign REF`), not on the day.
