# Mimir

An agentic product analyst. It connects to event-level telemetry, investigates
user behaviour on its own, and explains what it found — including when the
honest answer is "not enough data to say".

It is not a dashboard with a chatbot bolted on. The dashboard shows numbers;
the agent goes and finds out why they moved.

## What it does

Ask it something like *"boss completion dropped recently, find out why"* and it
runs a real investigation:

1. Reads the event schema, so it works with the events that exist rather than
   guessing names
2. Confirms the change is real before explaining it
3. Locates which funnel stage or segment actually moved
4. Segments that metric by every property the data carries
5. Compares users who succeeded against users who did not
6. Checks whether the sample is large enough to conclude anything
7. Forms a hypothesis, and says what would falsify it
8. Proposes an experiment with a primary metric and guardrails

Every step is stored. The Investigations page shows the full trail — each tool
call, its arguments, and the raw result — so a finding can be audited rather
than taken on faith.

It also runs itself every morning: a scheduled job computes the metrics,
flags anything that moved meaningfully, writes a short brief, and if something
real changed it starts the investigation automatically, so the "why" is
already waiting when you open it.

## Source-agnostic by design

Night Run (a browser game) is the first connected source, but nothing in the
agent or the analysis layer knows that. Everything speaks one interface:

```
lib/connectors/types.ts        the EventSource contract
lib/connectors/postgres-*.ts   a connector for any Postgres event table
lib/connectors/registry.ts     which sources this deployment can see
```

A connector is configured by a `TableMapping` saying which columns mean what,
so pointing it at a differently-named database is config, not code. Adding a
different kind of source (a warehouse, a vendor API, a CSV drop) means writing
one class that satisfies `EventSource` — `lib/agent` and `lib/analysis` don't
change.

## Architecture

```
app/                    Next.js App Router
  page.tsx              Overview — metrics, what changed, today's brief
  ask/                  Ask Analyst — run an investigation
  investigations/       List, and the full reasoning trail for each
  insights/             What the agent currently believes
  experiments/          Proposed changes, metrics, guardrails
  data/                 The schema exactly as the agent sees it
  api/investigate       Runs the agent loop
  api/cron/morning-brief  Scheduled daily run

lib/
  agent/runner.ts       The agentic loop (tool call -> execute -> feed back)
  agent/tools.ts        What the agent can do, defined over EventSource
  agent/prompts.ts      Operating instructions, including the honesty rules
  agent/brief.ts        Morning brief + auto-triggered investigation
  analysis/metrics.ts   Deterministic metrics (computed in code, not by the model)
  analysis/anomalies.ts Conservative change detection with a volume floor
  connectors/           The source abstraction
  db.ts                 Mimir's own database
```

### Two deliberate splits

**Deterministic maths stays in code.** Metrics and significance tests are
computed in `lib/analysis` and in the `check_significance` tool, never by the
model. The agent spends its reasoning on *why* a number moved, not on
arithmetic it could get subtly wrong.

**Mimir never writes to a source.** Connected telemetry is read-only by
contract. Mimir's own findings live in its own database, so a source can be
revoked or swapped without losing anything.

### The agent cannot write SQL

Tools are structured requests (`segment_event`, `funnel`, `compare_cohorts`,
`aggregate`), not query strings. Column names come from the table mapping and
are identifier-quoted; every value the agent chooses is a bound parameter. A
malformed or hostile tool call can produce a bad aggregate, never an arbitrary
statement. It should also hold a read-only database role.

## Setup

```bash
npm install
cp .env.example .env.local   # fill in the four variables
npm run dev
```

| Variable | What |
|---|---|
| `MIMIR_DATABASE_URL` | Mimir's own Postgres. Run `db/schema.sql` against it once. |
| `SOURCE_NIGHT_RUN_URL` | Read-only Postgres role on the telemetry source |
| `ANTHROPIC_API_KEY` | For the agent |
| `MIMIR_ACCESS_KEY` | Password for the dashboard and API |

Deploy on Vercel. `vercel.json` registers the 06:00 daily cron for the brief.

## Cost

An investigation is roughly 8–15 model calls with tool results attached.
The morning brief is one call over pre-computed numbers, plus one
investigation only when something genuinely moved — so a quiet day costs
almost nothing.

## Status

Working: the connector abstraction, the agent loop, investigations with full
trails, insights, proposed experiments, the schema explorer, the morning brief.

Not built yet: user-defined funnels and cohorts as first-class saved objects,
and experiment result tracking (the schema is there, the measurement loop is
not). Both were deliberately deferred — at the current data volume they would
be empty shells.
