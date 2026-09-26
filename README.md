<h1 align="center">Rostering for Claude Code</h1>

<p align="center">
  <strong>The open-source rostering and timesheet system that is just a database and Claude Code.</strong>
</p>

<p align="center">
  Created by <a href="https://www.enterprisedna.co"><strong>Enterprise DNA</strong></a>. Free and open source. Works with Claude Code, Codex, OpenCode or Cursor.
</p>

<!-- three-doors -->
<table align="center">
  <tr>
    <td align="center"><strong>Do it yourself</strong><br/>Clone it, run it, own it. Free, MIT.<br/><a href="#quick-start">Quick start</a></td>
    <td align="center"><strong>We customise it</strong><br/>Your fields, your rules, your Deputy data brought across.<br/><a href="https://enterprisedna.co/omni/book/?utm_source=github&utm_medium=readme&utm_campaign=deputy">Book a call</a></td>
    <td align="center"><strong>We run it for you</strong><br/>Installed, connected and operated inside Omni. Setup fee, then a retainer.<br/><a href="https://enterprisedna.co/omni/instead-of/deputy?utm_source=github&utm_medium=readme&utm_campaign=deputy">How it works</a></td>
  </tr>
</table>

<p align="center">
  <a href="#what-is-this">What is this</a> &bull;
  <a href="#why-no-front-end">Why no front end</a> &bull;
  <a href="#quick-start">Quick start</a> &bull;
  <a href="#the-commands">Commands</a> &bull;
  <a href="#instead-of-deputy">Instead of Deputy</a> &bull;
  <a href="#want-it-installed-and-run-for-you">Installed for you</a> &bull;
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node-20+-339933?style=flat-square" alt="Node 20+" />
  <img src="https://img.shields.io/badge/PostgreSQL-any-336791?style=flat-square" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/PGlite-embedded-3ecf8e?style=flat-square" alt="PGlite" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="MIT License" />
</p>

---

## What is this

Rostering for Claude Code does the job you pay Deputy for, as a Postgres database and a set of agent commands. There is no web front end. You open the folder in [Claude Code](https://claude.com/claude-code) (or Codex, OpenCode, Cursor: see `AGENTS.md`) and ask for what you want in plain language. It runs the right query, and it can answer questions the Deputy dashboard cannot.

The bill this replaces grows with every hire. Deputy prices per person per month: Lite at A$6.75, Core at A$8.75, Pro at A$13, with Payroll (A$5) and HR (A$3.50) add-ons and a A$30 monthly minimum ([deputy.com/au/pricing](https://www.deputy.com/au/pricing)). One cafe with 20 staff on Core pays about A$2,100 a year; three sites and 60 staff on Pro is about A$9,400; a 150-staff hospitality group clears A$20,000 a year, every year, for rosters and timesheets.

Want the same thing with a web front end, or built on a different stack? That is a customisation, and it is exactly what Enterprise DNA does: [book a call](https://enterprisedna.co/omni/book/?utm_source=github&utm_medium=readme&utm_campaign=deputy).

This one covers the operating record of a shift business: the sites and their areas, the staff with their paper (right-to-work expiry, duty manager certificate), who can work when, the roster from draft to published, the timesheets from clock-in to approval, and the leave book. The New Zealand rules are built in as gates with their sources cited: nobody is rostered past their recorded right to work, nobody is rostered over approved leave or inside the rest window, a licensed site trading without a certified duty manager is named, and a meal break shorter than the Employment Relations Act requires is said out loud. Payroll stays in the payroll system, deliberately; one export hands it the approved hours.

## Why no front end

- The front end was only ever there because the database was hard to talk to. That is no longer true.
- Your data sits in plain Postgres tables you own. Any tool can read them. No export, no lock-in.
- No seats, no tiers, no add-ons. Read [docs/why-no-front-end.md](docs/why-no-front-end.md) for the honest trade-offs too.

## Quick start

Sixty seconds, no database install (an embedded Postgres runs inside Node):

```bash
git clone https://github.com/Enterprise-DNA-OS/rostering-for-claude-code.git
cd rostering-for-claude-code
npm install
npm run demo
```

Then open the folder in Claude Code and type `/attention`. The demo business has a bartender on the published roster twelve days past his recorded right to work, a licensed site trading Saturday with no certified duty manager, a forgotten clock-out, a shift rostered over approved leave, and a chef closing at eleven and opening at seven; the answer shows you exactly how this system thinks.

### Use it with your own Postgres or Supabase

Copy `.env.example` to `.env`, set `DATABASE_URL`, then `npm run migrate`. Same commands, shared data, no per-seat fee.

## The commands

| Command | What it does |
|---|---|
| `/attention` | Everything that wants a decision, worst first. A right-to-work breach outranks everything |
| `/roster` | The week day by day, costed, with open and late-draft shifts loud |
| `/build-roster` | Draft next week from availability, last week's pattern and the leave book |
| `/publish` | Drafts become the real roster, gates checked shift by shift |
| `/open-shifts` | Unfilled shifts, and who could lawfully take each one |
| `/clock` | In, out, and fixing the forgotten clock-out honestly |
| `/timesheets` | The week's sheets: worked hours, breaks, variance against the roster |
| `/approve` | The approval queue. Confirms hours, never invents them |
| `/leave` | Requests waiting, what each approval does to the roster |
| `/availability` | Who can work when, the windows the roster builder reads first |
| `/hours` | Rostered against worked by person, and anyone over the ceiling |
| `/labour` | What the week costs by site and area, before it happens |
| `/team` `/person` | The team with its paper; one person's whole card |
| `/compliance` | The rule book run against the records, sources cited |
| `/weekly-review` | The Monday review written from four commands |
| `/log` | The agreed swap, the lateness chat, onto the record |
| `/draft-roster-message` `/draft-open-shift-callout` | Drafts to `drafts/`; a person sends them |
| `/import` | Bring the business across from Deputy, dry-run first |
| `/customise` | Change a field, a threshold, a rule, in plain language |
| `/new-view` | A new read-only dashboard page, described in plain language |

## Instead of Deputy

Export your people, timesheets and roster from Deputy (or Tanda, When I Work, or any rostering system that prints to CSV), then:

```bash
node scripts/roster.mjs import deputy --staff=people.csv --timesheets=timesheets.csv --shifts=shifts.csv --dry-run
node scripts/roster.mjs import deputy --staff=people.csv --timesheets=timesheets.csv --shifts=shifts.csv
```

The importer matches common column-name variants, is idempotent (re-running updates instead of duplicating), and names every row it skips. Every imported person deliberately arrives with no right-to-work expiry and no duty manager certificate on record: the paper gets verified on the way in, not assumed from the old system. [docs/replace-deputy.md](docs/replace-deputy.md) covers exactly what carries over and what starts fresh, and why.

### Ten questions your rostering dashboard cannot answer

Each of these is one plain-language ask away in Claude Code, because the record is a database you own:

1. Who is rostered next week whose right to work expires before their last shift?
2. Which trading days this month had no certified duty manager rostered at the licensed site?
3. Who closed and then opened inside ten hours in the last month, and how often?
4. Which staff consistently work past their rostered finish, and what has that variance cost?
5. Whose worked hours would have missed a legal meal break last week?
6. What does next week's roster cost by site and area before I publish it, and against last week?
7. Which timesheets have sat unapproved past the payroll cutoff, and whose pay do they hold up?
8. If I approve every pending leave request, which published shifts go uncovered?
9. Which open shifts have exactly one person whose availability, hours and rest window all fit?
10. Whose right to work or duty manager certificate lapses inside 30 days?

## Your first hour: ten things to ask for

1. "Walk me through everything on the attention list and what clears each one."
2. "Clock Emma out at yesterday 2pm; she forgot again."
3. "Approve every clean timesheet and read me the ones with short breaks first."
4. "Who can cover the open Saturday kitchen shift without breaking their rest window?"
5. "Draft next week's roster from availability and last week's shape."
6. "What does next week cost by area, against this week?"
7. "Change the rest window to 11 hours." (a one-line settings change)
8. "Grace's leave is approved: open her Tuesday shift and tell me who fits."
9. "Import our people and timesheets from Deputy, dry run first."
10. "Add a page that shows Saturday duty manager cover for the next eight weeks."

## Architecture

```
rostering-for-claude-code/
  CLAUDE.md                 how the operator wants this run (routing table + house rules)
  AGENTS.md                 the same, for Codex / OpenCode / Cursor / Gemini CLI
  .claude/commands/         the slash commands
  scripts/                  the CLI the commands drive
  scripts/lib/db.mjs        one adapter: DATABASE_URL (pg) or embedded PGlite
  supabase/migrations/      plain SQL schema
  supabase/seed.sql         demo data
  docs/                     the thesis and the migration guide
```

## Built with Claude Code

This repository was built with Claude Code as the primary development tool, from the schema to the commands, and it is meant to be extended the same way. Ask for a new command and it writes one.

## Contributing

Issues and pull requests are welcome. Keep the shape: plain SQL, a small CLI, a slash command per recurring job, no front end.

## Want it installed and run for you?

Enterprise DNA installs Rostering for Claude Code for your business, migrates your Deputy data, connects it to the rest of your tools, and runs it for you as part of **Omni**, our managed Command Center. One setup fee, then a monthly retainer.

- Book a call: [enterprisedna.co/omni/book](https://enterprisedna.co/omni/book/?offer=replace-software&utm_source=github&utm_medium=readme&utm_campaign=deputy)
- Read more: [enterprisedna.co/omni/instead-of/deputy](https://enterprisedna.co/omni/instead-of/deputy?utm_source=github&utm_medium=readme&utm_campaign=deputy)

## License

MIT. Copyright (c) 2026 Enterprise DNA.
