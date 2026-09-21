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
2. Decides whether it was asked about a *change* or the current *state*
3. For a change: confirms it is real, and says so plainly if it is not
4. Finds *where* it came from -- which position, stage or segment moved beyond
   what overall growth explains
5. Checks whether the sample is large enough to conclude anything
6. Forms a hypothesis only if something located a cause, and says what would
   falsify it
7. Proposes an experiment with a primary metric and guardrails

Every step is stored. The Investigations page shows the full trail — each tool
call, its arguments, and the raw result — so a finding can be audited rather
than taken on faith.

It also runs itself every morning: a scheduled job computes the metrics,
flags anything that moved meaningfully, writes a short brief, and if something
real changed it starts the investigation automatically, so the "why" is
already waiting when you open it.

## The interface

Card-based, light, one hero action instead of a separate empty "Ask" tab:
asking Mimir something lives at the top of Overview, right where the metrics
it would explain already are. The Mimir head in the sidebar and in that bar
is not decorative — its eyes light up amber for exactly as long as a real
investigation is running, tied to the actual `busy` state, not a loop.

Configuration (which source is connected, which model would run, where
findings are stored, your access key) lives entirely on **Settings**. The
main dashboard is player behaviour and nothing else.

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
  page.tsx              Overview — metric cards, week-over-week, the brief
  investigate-hero.tsx  The "Ask Mimir" bar on Overview + live trace
  components/mimir-head.tsx  The mark; eyes light up only while an
                             investigation is actually running
  investigations/       List, and the full reasoning trail for each
  insights/             What the agent currently believes
  experiments/          Proposed changes, metrics, guardrails
  data/                 The schema exactly as the agent sees it
  settings/             Connections, model, storage, access key —
                         everything backend-shaped lives only here
  api/investigate       Runs the agent loop
  api/cron/morning-brief  Scheduled daily run

lib/
  llm/                  Provider-neutral tool calling (Gemini, Groq, Ollama, ...)
  agent/runner.ts       The agentic loop (tool call -> execute -> feed back)
  agent/tools.ts        What the agent can do (ten tools), defined over EventSource
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
| `MIMIR_ACCESS_KEY` | Password for the API, sent as an `x-mimir-key` header (never in the URL). Optional locally, **required in production**. |

Deploy on Vercel. `vercel.json` registers the 06:00 daily cron for the brief.

## Cost, and the limits that actually bind

Designed to run for nothing, but "free" has real ceilings. Measured by running
it, not read from a pricing page:

| Provider (free tier) | Binding limit | What that means |
|---|---|---|
| **Groq**, `gpt-oss-120b` | 8,000 tokens/min and **200,000 tokens/day** | About 5-6 full investigations a day. The per-minute limit shaped the loop's design (below) |
| **Gemini**, `gemini-3.6-flash` | 5 requests/min and roughly 20/day | About one investigation a day |
| **Ollama** (local) | None | Unlimited, at the speed of your own machine |

What keeps an investigation inside those numbers:

- Metrics, funnels, anomaly detection and the significance test run in code,
  never in the model, so no tokens are spent on arithmetic
- The morning brief is one call over numbers already computed, and an
  investigation starts by itself only when a change clears a volume floor
- Every request re-sends the system prompt, the tool definitions and the
  history, so the history is trimmed and hard-budgeted (`compressHistory`)
  rather than growing every turn. Before that, waits rose steadily and a run
  died at 8,163 tokens against the 8,000 ceiling
- A per-minute 429 is waited out for exactly as long as the provider says; a
  daily-quota 429 fails immediately with a clear message instead of hanging

## How the agent is kept honest

A free model will happily give a confident answer to anything, so the rules
that matter are enforced by the loop (`lib/agent/runner.ts`), not just asked
for in the prompt. Each of these exists because a real run broke it:

- **Question type.** The agent says whether a question is about a *change* or
  the current *state*. State questions ("is the shield used?") get direct
  measurements and are never sent hunting for a week-over-week change
- **A false premise is an answer.** If completion did not drop, the finding is
  that it did not, with both rates
- **A cause has to be located.** `locate_change` compares two equal windows and
  scores each value against what plain growth would predict, so a property that
  merely scaled with total volume is not blamed. If a change verdict never tried
  to locate anything it is sent back once
- **Nothing is claimed that no tool showed.** With no located cause, the
  hypothesis is demoted to an "untested idea" in the summary, the proposed
  experiment is dropped, and confidence is capped
- **No repeats, and a forced ending.** An identical tool call is refused with
  the earlier result, the agent is warned before running out of turns, and the
  last turn withholds tools so the only thing left to do is answer

## Tests

```bash
npm test
```

48 tests, no network and no model key needed. The loop's rules run against a
scripted fake model, so they are checked in milliseconds and repeatably.
Covered: the significance test and its small-sample guard, anomaly detection,
`locate_change`, history trimming, retry and quota handling, the Gemini
`thoughtSignature` round trip, rate-limit parsing for both provider styles,
auth, the store, and the demo scenarios (including one with no regression, so
a false-premise question can be tested).

The tests were themselves checked: six behaviours were broken on purpose, and
each was caught. That exercise found one test that could not fail (its example
was already non-significant, so it never reached the guard), which is now
fixed. What tests cannot cover is whether a real model *chooses* well; that
needs live runs, and those are limited by the quotas above.

## Status

Working: the connector abstraction, the agent loop, investigations with full
trails, insights, proposed experiments, the schema explorer, the morning brief,
and the tests above.

Verified live, against the demo data: on "why did completion drop?" the agent
finds the planted cause (a death spike at x=22,000, 4 to 49) in 7 tool calls,
twice. Five varied questions were also run; three failed and were fixed as
described above. Those three fixes have been tested offline but **not yet
re-run against a real model**.

Not built: saved funnels and cohorts as stored objects, and experiment result
tracking (the schema is there, the measurement loop is not). Not yet done:
connecting a real source, persistent storage in production, and deployment.
