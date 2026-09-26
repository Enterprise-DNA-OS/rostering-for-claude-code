# The rule book /compliance checks

Eight rules, each with its source, what a breach looks like in the data, and where the CLI already refuses at the gate. `node scripts/roster.mjs compliance` runs them all; add a rule key to run one.

Nothing here is legal advice. It is the rule book the operator has pointed the system at, with sources, and the operator changes it to match their business. When the law moves, update the rule and the check together. The defaults are written for New Zealand; the AU equivalents are noted where the numbers differ, and the numbers themselves live in `settings` so an Australian operator changes them without touching code.

## 1. `entitlement` - nobody rostered past their recorded right to work

An employer must not allow a person who is not entitled to work to do so. **Source: Immigration Act 2009 s 350** (an offence, with penalties per worker). The AU equivalent is the Migration Act 1958 (allowing an unlawful non-citizen to work).

Breach in the data: an active staff member whose `visa_expires_on` is past, or a published shift dated after it. A blank expiry means no expiry on record (citizen or resident). **Gate: `shift add`, `shift assign` and `publish` refuse a shift dated past the recorded expiry. No force flag: the fix is the new visa on record (`staff visa`), not a checkbox.**

## 2. `duty-manager` - a certified manager on every trading day at a licensed site

A licensed premises must have a certified manager on duty whenever alcohol is sold. **Source: Sale and Supply of Alcohol Act 2012 ss 212-214** (appointment and presence of certified managers); the General Manager's Certificate is issued by the District Licensing Committee. AU: each state's liquor licensing (for example an Approved Manager under the relevant state Act).

Breach in the data: a future date at a `licensed` location with published shifts where nobody rostered holds a `duty_manager_cert_expires_on` on or after that date. **Check only: the fix is a person on the day, not a flag.** The attention list also warns 30 days before a certificate expires, because DLC renewals take weeks.

## 3. `breaks` - meal breaks match the span worked

A work period over 4 hours and up to 8 requires a 30-minute meal break; longer periods repeat the pattern (a 13-hour double earns two). The 10-minute rest breaks the Act also requires are paid, so they are not deducted time and are not checked against the unpaid break field. **Source: Employment Relations Act 2000 Part 6D (s 69ZD).** AU: the applicable award, for example Hospitality Industry (General) Award 2020 (breaks after 5 hours).

Breach in the data: a submitted or approved timesheet whose recorded `break_minutes` is under what `required_meal_minutes()` returns for the span. **Gate: `clock out` and `approve` say it out loud, and the record is never silently rounded. Approval still stands, because the record must show what actually happened; the fix is the break practice, not the number.**

## 4. `rest` - the rest window between shifts holds

Closing at eleven and opening at seven is how kitchens burn people. NZ has no fixed statutory gap, but the employer's fatigue duty is real. **Source: Health and Safety at Work Act 2015 (primary duty of care, fatigue as a managed risk); Hospitality Industry (General) Award 2020 cl 15 in AU (a 10-hour break between rostered shifts, 8 on changeover).** The window lives in `settings` (`rest_between_shifts_hours`, default 10).

Breach in the data: two shifts for the same person closer together than the window (`v_rest_clashes`). **Gate: `shift add`, `shift assign` and `publish` refuse a new shift inside the window. No force flag: the fix is moving a shift.**

## 5. `notice` - the roster is published before the notice window

Staff plan their lives around the roster. NZ law reaches this through the employment agreement: availability provisions need genuine reasons and compensation, and cancelling a shift without reasonable notice owes what the agreement says. **Source: Employment Relations Act 2000 ss 67C-67G.** AU: Hospitality Industry (General) Award 2020 cl 15 (the roster is posted at least 7 days ahead). The window lives in `settings` (`roster_notice_days`, default 7).

Breach in the data: draft shifts dated inside the window (`DRAFT LATE` in `v_shifts`). **Check only: finish the week and run `publish`.** `shift cancel` also warns when a published shift is cancelled at short notice.

## 6. `hours` - nobody rostered over the weekly ceiling

An employment agreement must fix the maximum hours, and 40 is the default unless the parties agree otherwise. **Source: Employment Relations Act 2000 s 11B.** The ceiling lives in `settings` (`max_week_hours`, default 50 as an agreed maximum); set it to what your agreements actually say.

Breach in the data: one person's rostered paid hours in a week over the ceiling. **Check: `hours` and `attention` flag it; the fix is spreading the load before the pattern sets.**

## 7. `leave` - approved leave is never rostered over

An employee on approved annual holidays is on holiday. **Source: Holidays Act 2003.** A shift published over approved leave is a rostering mistake with a legal edge, and the person finds out on the day.

Breach in the data: a published shift between an approved leave's dates (`ROSTERED OVER` in `v_leave`). **Gate: `shift add` and `shift assign` refuse a shift on approved leave. A clash on the books arrived by import or by approving leave over an existing roster: `leave approve` names every clash it creates, and the fix is `shift unassign` or a reassignment.**

## 8. `records` - the wages, time and leave records are kept

Employers keep a wages and time record for six years, and a holiday and leave record likewise. **Source: Employment Relations Act 2000 s 130; Holidays Act 2003 s 81.**

Held by design: this CLI has no delete path. Shifts cancel with a reason, staff become former, timesheets and the leave book stay. The one live risk is a timesheet still open from a past day, because a record that never closed shows hours nobody confirmed: the check names them, and `clock out NAME --at=` closes them while somebody remembers.
