import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { SESSION_COOKIE, checkAccess, safeRedirectPath, sameOrigin, sameSecret, sessionToken } from "../lib/auth";
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

test("locally, with no key configured, access is open", async () => {
  assert.equal((await checkAccess(req())).ok, true);
});

test("in production, with no key configured, access is closed", async () => {
  (process.env as any).NODE_ENV = "production";
  const r = await checkAccess(req());
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.error, "mimir_access_key_not_set");
});

test("the right key in the header is accepted; wrong or missing is not", async () => {
  process.env.MIMIR_ACCESS_KEY = "s3cret";
  assert.equal((await checkAccess(req({ "x-mimir-key": "s3cret" }))).ok, true);
  assert.equal((await checkAccess(req({ "x-mimir-key": "s3cre" }))).ok, false);
  assert.equal((await checkAccess(req({ "x-mimir-key": "s3cretX" }))).ok, false);
  const none = await checkAccess(req());
  assert.equal(!none.ok && none.error, "unauthorized");
});

test("the key in the URL is NOT accepted", async () => {
  process.env.MIMIR_ACCESS_KEY = "s3cret";
  assert.equal((await checkAccess(req({}, "http://localhost/api/x?key=s3cret"))).ok, false);
});

test("a valid session cookie is accepted, and it does not contain the key", async () => {
  process.env.MIMIR_ACCESS_KEY = "s3cret";
  const token = await sessionToken("s3cret");
  assert.ok(!token.includes("s3cret"), "the cookie must not reveal the password");
  assert.match(token, /^[0-9a-f]{64}$/);
  const r = await checkAccess(req({ cookie: `other=1; ${SESSION_COOKIE}=${token}` }));
  assert.deepEqual(r, { ok: true, via: "cookie" });
});

test("a forged or stale session cookie is rejected", async () => {
  process.env.MIMIR_ACCESS_KEY = "s3cret";
  const forged = await checkAccess(req({ cookie: `${SESSION_COOKIE}=${"0".repeat(64)}` }));
  assert.equal(forged.ok, false);
  // Changing the key signs every existing session out.
  const old = await sessionToken("old-key");
  assert.equal((await checkAccess(req({ cookie: `${SESSION_COOKIE}=${old}` }))).ok, false);
  // The raw key is not a valid cookie value either.
  assert.equal((await checkAccess(req({ cookie: `${SESSION_COOKIE}=s3cret` }))).ok, false);
});

test("Vercel's cron secret works with or without an access key set", async () => {
  process.env.CRON_SECRET = "cron";
  const signed = req({ authorization: "Bearer cron" });
  assert.equal((await checkAccess(signed)).ok, true);
  process.env.MIMIR_ACCESS_KEY = "s3cret";
  assert.equal((await checkAccess(signed)).ok, true, "must not depend on the browser key being unset");
  assert.equal((await checkAccess(req({ authorization: "Bearer nope" }))).ok, false);
});

test("sameSecret compares exactly, including length", () => {
  assert.equal(sameSecret("abc", "abc"), true);
  assert.equal(sameSecret("abc", "abd"), false);
  assert.equal(sameSecret("ab", "abc"), false);
  assert.equal(sameSecret("abcd", "abc"), false);
  assert.equal(sameSecret(null, "abc"), false);
  assert.equal(sameSecret("", ""), true);
});

test("a cross-site POST is refused; same-site and non-browser clients are allowed", () => {
  const at = (origin?: string) =>
    new Request("https://mimir.example/api/investigate", { method: "POST", headers: origin ? { origin } : {} });
  assert.equal(sameOrigin(at("https://mimir.example")), true);
  assert.equal(sameOrigin(at("https://evil.example")), false);
  assert.equal(sameOrigin(at("https://mimir.example.evil.example")), false);
  assert.equal(sameOrigin(at()), true, "curl and server-to-server calls send no Origin");
});

test("after sign-in, only a path on this site is followed", () => {
  assert.equal(safeRedirectPath("/insights"), "/insights");
  assert.equal(safeRedirectPath("/investigations/4?x=1"), "/investigations/4?x=1");
  for (const bad of ["//evil.example", "/\\evil.example", "https://evil.example", "evil.example", "", null, undefined, 42, "/\nx"]) {
    assert.equal(safeRedirectPath(bad), "/", `accepted ${JSON.stringify(bad)}`);
  }
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
