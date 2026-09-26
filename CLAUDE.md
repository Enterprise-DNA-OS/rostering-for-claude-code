# Rostering for Claude Code: operating instructions

This file is the brain. Claude Code reads it at the start of every session. It says who this is for, how work gets done, and the one right way to do each recurring job.

## Who this is for

- **Business:** [YOUR BUSINESS]
- **Operator:** [YOUR NAME], [your role]
- **What matters most:** [the one or two outcomes you care about]

Fill this in once. A worker with context knows. A worker without it guesses.

## How to work

1. **Take a brief, not a script.** The operator describes the outcome. You run the right command and present the answer.
2. **Read before you write.** Before drafting anything about a record, read its full history first.
3. **Plain language.** Short sentences. No filler. Numbers in tables.
4. **Silent success, loud problems.** No play-by-play. Say what broke and what you did about it.
5. **Stop at the line.** Anything that sends, deletes, or faces a customer waits for a yes in this session.

## Routing table: one right way for each recurring job

| When the operator asks for... | Use this |
|---|---|
| "what needs my attention", "what's wrong this morning" | `/attention` |
| "show me the roster", "who's on this week / next week" | `/roster` |
| "roster next week", "build the roster" | `/build-roster` |
| "publish the roster", "send the roster out" | `/publish` |
| "what shifts are unfilled", "who can cover Saturday" | `/open-shifts` |
| "clock X in / out", "X forgot to clock out" | `/clock` |
| "show me the timesheets", "who worked what" | `/timesheets` |
| "approve the timesheets", "clear the queue" | `/approve` |
| "X wants leave", "what leave is waiting" | `/leave` |
| "X can only work weekends now", "who's available Tuesday" | `/availability` |
| "who's over their hours", "rostered vs worked" | `/hours` |
| "what does the week cost", "labour by site" | `/labour` |
| "show me the team", "pull up X" | `/team`, `/person` |
| "are we compliant", "check the rules" | `/compliance` |
| "Monday review", "how are we set for the week" | `/weekly-review` |
| "note that X agreed to swap", "log the conversation" | `/log` |
| "message everyone their shifts", "ask who can cover" | `/draft-roster-message`, `/draft-open-shift-callout` |
| "bring our Deputy data across" | `/import` |
| "add a field", "change a rule", "rename an area" | `/customise` |
| "a page that shows..." | `/new-view` |

If an ask fits nothing here, run the CLI directly (`npm run <cli> -- --help`) and then propose a new command for it.

## Hard rules

- Never send email or messages from here. Draft to `drafts/`, a person sends.
- Never delete records without an explicit yes in this session. Prefer marking closed or archived.
- Never invent a record. If a name is ambiguous, list the candidates and ask.
- The database is the source of truth. If the answer is not in it, say so.

## Where things live

- `scripts/` the CLI. `scripts/lib/db.mjs` picks `DATABASE_URL` (Postgres, Supabase) or the embedded database in `.data/`.
- `supabase/migrations/` the schema, plain SQL. `npm run migrate` applies it.
- `.claude/commands/` the slash commands. Add one every time the same ask comes twice.
- `docs/` the thesis and the guide for moving off Deputy.

Built by Enterprise DNA. Installed and run for you as part of Omni: https://enterprisedna.co/omni/instead-of/deputy
