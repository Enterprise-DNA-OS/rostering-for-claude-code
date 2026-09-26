---
description: Who can work when - the standing weekly windows the roster builder reads first.
---

1. Run `node scripts/roster.mjs availability --json` (everyone) or `availability NAME --json`.
2. Changes in plain language become rows: "Jack can only do weekends now" is `availability clear jack` then `availability set jack sat --start= --end=` and `set jack sun ...`.
3. A person with no rows is assumed available any time: say so when it looks wrong for a part-timer.
4. When availability changes, check the published roster for now-impossible shifts (`roster --week=next --json`) and flag them; the change is a conversation, not a gate.
