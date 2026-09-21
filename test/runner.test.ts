import { test } from "node:test";
import assert from "node:assert/strict";
import type { LLMMessage, LLMProvider, LLMResponse } from "../lib/llm/types";
import { runInvestigationLoop, startInvestigation } from "../lib/agent/runner";

/**
 * A model that says exactly what it is told to, in order.
 *
 * Checking the loop's RULES against a real model is slow, costs quota and is
 * not repeatable -- the model may or may not misbehave on a given day. These
 * rules are the harness's, not the model's, so they are tested with a script
 * and run in milliseconds.
 */
class ScriptedProvider implements LLMProvider {
  readonly id = "scripted";
  readonly model = "scripted";
  readonly label = "scripted";
  readonly free = true;
  calls: { messages: LLMMessage[]; hadTools: boolean }[] = [];
  private i = 0;
  constructor(private script: LLMResponse[]) {}
  async complete(opts: { messages: LLMMessage[]; tools?: unknown[] }): Promise<LLMResponse> {
    this.calls.push({ messages: opts.messages, hadTools: !!opts.tools?.length });
    const next = this.script[Math.min(this.i++, this.script.length - 1)];
    return next;
  }
}

const tool = (name: string, input: Record<string, unknown> = {}): LLMResponse => ({
  text: "",
  toolCalls: [{ id: `${name}-${Math.random()}`, name, input }],
});

const verdict = (over: Record<string, unknown>): LLMResponse => ({
  text:
    "```json\n" +
    JSON.stringify({
      question_type: "change",
      headline: "h",
      summary: "s",
      hypothesis: "It is the boss.",
      confidence: "high",
      insights: [],
      experiment: { title: "Spawn more bosses", hypothesis: "x", change_described: "y", primary_metric: "m", guardrail_metrics: [] },
      ...over,
    }) +
    "\n```",
  toolCalls: [],
});

async function run(script: LLMResponse[], question = "Why did completion drop?") {
  const provider = new ScriptedProvider(script);
  const id = await startInvestigation({ sourceId: "demo", question, modelLabel: "scripted" });
  const result = await runInvestigationLoop(id, { sourceId: "demo", question, provider });
  return { provider, result };
}

test("a change verdict that never tried to locate the change is sent back once", async () => {
  const { provider, result } = await run([
    verdict({}), // offered straight away
    tool("locate_change", { event_name: "player_died" }),
    verdict({}),
  ]);
  assert.equal(provider.calls.length, 3, "the first verdict should have been refused");
  const nudge = provider.calls[1].messages.at(-1);
  assert.ok(nudge && nudge.role === "user" && /locate_change/.test(nudge.text));
  assert.ok(provider.calls[1].hadTools, "tools must be available again after the nudge");
  // It located the spike on the demo data, so the cause stands.
  assert.equal(result.confidence, "high");
  assert.ok(result.hypothesis);
  assert.ok(result.experiment);
});

test("with nothing located, a change verdict cannot keep an invented cause or experiment", async () => {
  // Never calls a locating tool, however often it is asked.
  const { result } = await run([verdict({}), verdict({}), verdict({}), verdict({})]);
  assert.equal(result.hypothesis, "", "an untested idea must not be reported as a hypothesis");
  assert.equal(result.experiment, null, "no experiment on an untested cause");
  assert.equal(result.confidence, "medium", "high confidence describes the cause, which is unproven");
  assert.match(result.summary, /Untested idea/);
  assert.match(result.summary, /It is the boss\./, "the idea is kept, but labelled");
});

test("locate_change that finds nothing also strips the cause", async () => {
  // item_collected does not move between the two weeks on the demo data.
  const { provider, result } = await run([
    tool("locate_change", { event_name: "item_collected" }),
    verdict({}),
  ]);
  assert.equal(provider.calls.length, 2, "an attempt was made, so no nudge");
  assert.equal(result.hypothesis, "");
  assert.equal(result.experiment, null);
  assert.notEqual(result.confidence, "high");
});

test("a state question is never pushed to look for a change", async () => {
  const { provider, result } = await run(
    [verdict({ question_type: "state", hypothesis: "", experiment: null, confidence: "high" })],
    "Which weapon is picked up least?",
  );
  assert.equal(provider.calls.length, 1, "no gate on a question with nothing to localise");
  assert.equal(result.confidence, "high");
});

test("an exact repeat of a tool call is refused, not re-run", async () => {
  const { provider } = await run([
    tool("describe_schema"),
    tool("describe_schema"),
    verdict({ question_type: "state" }),
  ]);
  const secondResult = provider.calls[2].messages.find(
    (m, i, all) => m.role === "tool_results" && i === all.length - 1,
  );
  assert.ok(secondResult && secondResult.role === "tool_results");
  assert.match(secondResult.results[0].content, /repeated_call/);
});

test("an empty reply is asked again instead of recorded as the verdict", async () => {
  const { provider, result } = await run([
    { text: "", toolCalls: [] },
    verdict({ question_type: "state", hypothesis: "", experiment: null }),
  ]);
  assert.equal(provider.calls.length, 2);
  assert.ok(!provider.calls[1].hadTools, "the re-ask is a no-tools turn, so it can only answer");
  assert.equal(result.headline, "h");
});
