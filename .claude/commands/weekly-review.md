---
description: The Monday review, written from four commands - what needs a decision, the week ahead, the hours and cost, and the paper.
---

1. Run four commands, `--json` each: `node scripts/roster.mjs attention`, `roster --week=next`, `hours --week=next`, `compliance`. Add `timesheets --pending` if the queue is not empty.
2. Write the review in four short sections, prose plus small tables, nothing invented:
   - **Today's decisions.** The attention list, worst first, one action each. A right-to-work breach or an uncovered licensed day is the first line of the whole review.
   - **The week ahead.** The roster by day: open shifts, who carries the load, anything still draft.
   - **The money.** Rostered cost by site and area, anyone over the hours ceiling, worked-vs-rostered variance from last week.
   - **The paper.** Anything expiring inside 30 days: visas, duty certificates, and what to start renewing now.
3. End with at most five actions for the week, each doable with a single command or conversation.
4. If the operator wants it on paper, `npm run view` renders the week and hours pages in the business's brand.
