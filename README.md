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
lib/connectors/demo-source.ts  a synthetic source, so it runs with no setup
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
  llm/                  Provider-neutral tool calling (Gemini, Groq, Ollama, ...)
  agent/runner.ts       The agentic loop (tool call -> execute -> feed back)
  agent/tools.ts        What the agent can do, defined over EventSource
  agent/prompts.ts      Operating instructions, including the honesty rules
  agent/brief.ts        Morning brief + auto-triggered investigation
  analysis/metrics.ts   Deterministic metrics (computed in code, not by the model)
  analysis/anomalies.ts Conservative change detection with a volume floor
  connectors/           The source abstraction
  store.ts              Mimir's own storage (Postgres, or in-memory)
```

### Model-agnostic

The agent loop is written against an `LLMProvider` interface, not a vendor
SDK, so the same investigation runs on a free Gemini key, a free Groq key, a
local Ollama model or a paid API -- selected by an environment variable. The
UI always shows which model actually ran, and whether it was free.

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

## Running it

```bash
npm install
npm run dev
```

That is the whole setup. With no configuration at all, Mimir falls back to a
synthetic telemetry source and in-memory storage, so every page is populated
and explorable immediately. The synthetic product has a real regression
buried in it — completion falls from ~65% to ~35% in the last week, caused by
a difficulty spike at one position — which the agent has to find by
segmenting. It is not told where to look.

To run the agent you need one model key. The recommended ones are free:

| Provider | Cost | Key |
|---|---|---|
| **Gemini** (default) | Free tier | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| **Groq** | Free tier | [console.groq.com/keys](https://console.groq.com/keys) |
| **Ollama** | Free, local — no telemetry leaves your machine | no key |
| OpenRouter / Anthropic | Paid | optional |

```bash
echo "GEMINI_API_KEY=your-key" > .env.local
```

Then optionally, to persist findings and connect real data:

| Variable | What |
|---|---|
| `MIMIR_DATABASE_URL` | Mimir's own Postgres. Run `db/schema.sql` once. Without it, storage is in-memory and resets on restart. |
| `SOURCE_NIGHT_RUN_URL` | Read-only role on a real telemetry source. Without it, the synthetic source is used. |
| `MIMIR_ACCESS_KEY` | Password for the API. Optional locally, **required in production**. |

Deploy on Vercel. `vercel.json` registers the 06:00 daily cron for the brief.

## Cost

Designed to run for nothing. The default provider is Gemini's free tier, and
the work is structured to stay inside it:

- Metrics, funnels, anomaly detection and the significance test are computed
  in code, never by the model
- The morning brief is a single call over numbers already computed
- An investigation runs automatically only when a change clears a volume
  floor, so a quiet day costs one request

An investigation you start by hand is roughly 8–15 calls. On a free tier that
is still nothing; on a paid provider it would be cents.

## Status

Working: the connector abstraction, the agent loop, investigations with full
trails, insights, proposed experiments, the schema explorer, the morning brief.

Not built yet: user-defined funnels and cohorts as first-class saved objects,
and experiment result tracking (the schema is there, the measurement loop is
not). Both were deliberately deferred — at the current data volume they would
be empty shells.
