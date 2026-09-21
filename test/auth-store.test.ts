import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { checkAccess } from "../lib/auth";
import { store } from "../lib/store";

const req = (headers: Record<string, string> = {}, url = "http://localhost/api/x") =>
  new Request(url, { headers });

const saved = { ...process.env };
beforeEach(() => {
  delete process.env.MIMIR_ACCESS_KEY;
  delete process.env.CRON_SECRET;
  (process.env as any).NODE_ENV = "test";
});
afterEach(() => { process.env = { ...saved }; });

test("locally, with no key configured, access is open", () => {
  assert.equal(checkAccess(req()).ok, true);
});

test("in production, with no key configured, access is closed", () => {
  (process.env as any).NODE_ENV = "production";
  const r = checkAccess(req());
  assert.equal(r.ok, false);
  assert.equal(r.error, "mimir_access_key_not_set");
});

test("the right key in the header is accepted; wrong or missing is not", () => {
  process.env.MIMIR_ACCESS_KEY = "s3cret";
  assert.equal(checkAccess(req({ "x-mimir-key": "s3cret" })).ok, true);
  assert.equal(checkAccess(req({ "x-mimir-key": "s3cre" })).ok, false);
  assert.equal(checkAccess(req({ "x-mimir-key": "s3cretX" })).ok, false);
  assert.equal(checkAccess(req()).error, "unauthorized");
});

test("the key in the URL is NOT accepted", () => {
  process.env.MIMIR_ACCESS_KEY = "s3cret";
  assert.equal(checkAccess(req({}, "http://localhost/api/x?key=s3cret")).ok, false);
});

test("Vercel's cron secret works with or without an access key set", () => {
  process.env.CRON_SECRET = "cron";
  const signed = req({ authorization: "Bearer cron" });
  assert.equal(checkAccess(signed).ok, true);
  process.env.MIMIR_ACCESS_KEY = "s3cret";
  assert.equal(checkAccess(signed).ok, true, "must not depend on the browser key being unset");
  assert.equal(checkAccess(req({ authorization: "Bearer nope" })).ok, false);
});

// ---- in-memory store --------------------------------------------------------

test("an investigation's steps come back in order, and finishing records the verdict", async () => {
  const db = store();
  const id = await db.createInvestigation({ sourceId: "demo", question: "q", trigger: "ask", modelLabel: "m" });
  for (const [i, kind] of ["tool_call", "tool_result", "conclusion"].entries()) {
    await db.addStep({ investigation_id: id, step_index: 2 - i, kind, tool_name: null, tool_input: null, content: null, result: null, duration_ms: null });
  }
  await db.finishInvestigation(id, { status: "complete", headline: "H", confidence: "low" });
  const { investigation, steps } = await db.getInvestigation(id);
  assert.deepEqual(steps.map((s) => s.step_index), [0, 1, 2], "sorted by step_index, not insertion order");
  assert.equal(investigation?.status, "complete");
  assert.equal(investigation?.headline, "H");
  assert.ok(investigation?.finished_at);
});

test("a second brief for the same day replaces the first", async () => {
  const db = store();
  const b = { source_id: "s", brief_date: "2026-09-21", metrics: {} };
  await db.saveBrief({ ...b, headline: "first", body: "" });
  await db.saveBrief({ ...b, headline: "second", body: "" });
  assert.equal((await db.latestBrief("s"))?.headline, "second");
});

test("a missing investigation is null, not an error", async () => {
  assert.equal((await store().getInvestigation(999_999)).investigation, null);
});
