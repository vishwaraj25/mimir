import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { compressHistory } from "../lib/agent/runner";
import { completeWithRetry } from "../lib/llm";
import { GeminiProvider } from "../lib/llm/gemini";
import { OpenAICompatibleProvider } from "../lib/llm/openai-compatible";
import { RateLimitError } from "../lib/llm/types";
import type { LLMMessage, LLMProvider, LLMResponse } from "../lib/llm/types";

// ---- history compression ----------------------------------------------------

const user = (text: string): LLMMessage => ({ role: "user", text });
const asst = (name: string): LLMMessage => ({
  role: "assistant", text: "", toolCalls: [{ id: name, name, input: {} }],
});
const res = (name: string, size: number): LLMMessage => ({
  role: "tool_results", results: [{ id: name, name, content: "x".repeat(size) }],
});

/** Five exchanges of 1,000 chars each, oldest first. */
function history(): LLMMessage[] {
  const m: LLMMessage[] = [user("Investigate: why did completion drop?")];
  for (let i = 1; i <= 5; i++) m.push(asst(`t${i}`), res(`t${i}`, 1000));
  return m;
}

test("the question is never dropped", () => {
  const out = compressHistory(history(), 200);
  assert.equal(out[0].role, "user");
  assert.match((out[0] as any).text, /why did completion drop/);
});

test("the most recent results stay verbatim, older ones are abbreviated", () => {
  const out = compressHistory(history(), 1_000_000);
  const sizes = out.filter((m) => m.role === "tool_results").map((m: any) => m.results[0].content.length);
  assert.equal(sizes.length, 5);
  assert.ok(sizes[0] < 400 && sizes[1] < 400, "two oldest are trimmed");
  assert.deepEqual(sizes.slice(2), [1000, 1000, 1000], "three newest are intact");
});

test("an abbreviated result does not invite the agent to call it again", () => {
  const stub = compressHistory(history(), 1_000_000).find((m) => m.role === "tool_results") as any;
  assert.match(stub.results[0].content, /do not request it again/);
  assert.doesNotMatch(stub.results[0].content, /call .* again/i);
});

test("a tight budget drops the oldest exchanges first", () => {
  const out = compressHistory(history(), 2_500);
  const names = out.filter((m) => m.role === "assistant").map((m: any) => m.toolCalls[0].name);
  assert.ok(names.includes("t5") && !names.includes("t1"));
});

test("history never starts with a result whose tool call was dropped", () => {
  for (const budget of [100, 900, 1500, 2100, 3000, 4500]) {
    const [, first] = compressHistory(history(), budget);
    assert.notEqual(first?.role, "tool_results", `dangling result at budget ${budget}`);
  }
});

// ---- retry and quota handling ----------------------------------------------

const ok: LLMResponse = { text: "fine", toolCalls: [] };
const opts = { system: "s", messages: [] as LLMMessage[] };
function flaky(errors: unknown[]): LLMProvider & { calls: number } {
  const p: any = {
    id: "x", model: "x", label: "Test model", free: true, calls: 0,
    complete: async () => {
      const e = errors[p.calls++];
      if (e) throw e;
      return ok;
    },
  };
  return p;
}

test("a per-minute limit is waited out and then succeeds", async () => {
  const p = flaky([new RateLimitError("429", 5), new RateLimitError("429", 5)]);
  assert.deepEqual(await completeWithRetry(p, opts), ok);
  assert.equal(p.calls, 3);
});

test("a daily quota fails at once instead of sleeping through it", async () => {
  const p = flaky([new RateLimitError("429", 11 * 60_000)]);
  const started = Date.now();
  await assert.rejects(completeWithRetry(p, opts), /daily quota is used up.*11 min/);
  assert.ok(Date.now() - started < 200, "must not wait");
  assert.equal(p.calls, 1);
});

test("an error that is not a rate limit is not retried", async () => {
  const p = flaky([new Error("groq 400: bad request")]);
  await assert.rejects(completeWithRetry(p, opts), /bad request/);
  assert.equal(p.calls, 1);
});

test("it gives up after repeated rate limits rather than looping forever", async () => {
  const p = flaky(Array.from({ length: 20 }, () => new RateLimitError("429", 1)));
  await assert.rejects(completeWithRetry(p, opts), RateLimitError);
  assert.equal(p.calls, 7, "the first try plus six retries");
});

// ---- provider quirks, against a faked network -------------------------------

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function fakeFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  const seen: { url: string; body: any }[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    seen.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
  }) as typeof fetch;
  return seen;
}

test("gemini: a thoughtSignature comes back on the functionCall part it belongs to", async () => {
  const seen = fakeFetch(200, { candidates: [{ content: { parts: [{ text: "ok" }] } }] });
  const gemini = new GeminiProvider("k", "m");
  await gemini.complete({
    system: "s",
    messages: [
      { role: "user", text: "q" },
      { role: "assistant", text: "", toolCalls: [{ id: "a", name: "funnel", input: { steps: [] }, raw: { thoughtSignature: "SIG123" } }] },
      { role: "tool_results", results: [{ id: "a", name: "funnel", content: "[]" }] },
    ],
  });
  const part = seen[0].body.contents[1].parts[0];
  assert.equal(part.thoughtSignature, "SIG123");
  assert.equal(part.functionCall.name, "funnel");
});

test("gemini: a signature in the response is captured for the next turn", async () => {
  fakeFetch(200, { candidates: [{ content: { parts: [{ functionCall: { name: "funnel", args: {} }, thoughtSignature: "SIG9" }] }, finishReason: "STOP" }] });
  const r = await new GeminiProvider("k", "m").complete({ system: "s", messages: [{ role: "user", text: "q" }] });
  assert.deepEqual(r.toolCalls[0].raw, { thoughtSignature: "SIG9" });
  assert.equal(r.finishReason, "STOP");
});

test("gemini: a 429 carries the exact retry delay Google states", async () => {
  fakeFetch(429, { error: { details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "40s" }] } });
  await assert.rejects(
    new GeminiProvider("k", "m").complete({ system: "s", messages: [{ role: "user", text: "q" }] }),
    (e: any) => e instanceof RateLimitError && e.retryAfterMs === 40_000,
  );
});

test("openai-compatible: a 429 carries Retry-After, in ms", async () => {
  fakeFetch(429, "{}", { "retry-after": "33" });
  const p = new OpenAICompatibleProvider({ id: "groq", baseUrl: "http://x", model: "m", label: "l", free: true });
  await assert.rejects(
    p.complete({ system: "s", messages: [{ role: "user", text: "q" }] }),
    (e: any) => e instanceof RateLimitError && e.retryAfterMs === 33_000,
  );
});

test("openai-compatible: malformed tool arguments become an error the agent can see, not a crash", async () => {
  fakeFetch(200, { choices: [{ message: { tool_calls: [{ id: "1", function: { name: "funnel", arguments: "{not json" } }] }, finish_reason: "tool_calls" }] });
  const p = new OpenAICompatibleProvider({ id: "groq", baseUrl: "http://x", model: "m", label: "l", free: true });
  const r = await p.complete({ system: "s", messages: [{ role: "user", text: "q" }] });
  assert.equal(r.toolCalls[0].name, "funnel");
  assert.ok("__parse_error" in r.toolCalls[0].input);
});

test("openai-compatible: gpt-oss models are told to reason briefly", async () => {
  const seen = fakeFetch(200, { choices: [{ message: { content: "hi" } }] });
  const mk = (model: string) => new OpenAICompatibleProvider({ id: "groq", baseUrl: "http://x", model, label: "l", free: true });
  await mk("openai/gpt-oss-120b").complete({ system: "s", messages: [{ role: "user", text: "q" }] });
  await mk("llama-3").complete({ system: "s", messages: [{ role: "user", text: "q" }] });
  assert.equal(seen[0].body.reasoning_effort, "low");
  assert.equal(seen[1].body.reasoning_effort, undefined);
});
