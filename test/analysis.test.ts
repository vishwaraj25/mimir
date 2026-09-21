import { test } from "node:test";
import assert from "node:assert/strict";
import { executeTool, niceStep } from "../lib/agent/tools";
import { detectAnomalies } from "../lib/analysis/anomalies";
import { daysAgo } from "../lib/analysis/metrics";
import { DemoEventSource } from "../lib/connectors/demo-source";
import type { EventSource } from "../lib/connectors/types";

const demo = new DemoEventSource();
const sig = (bs: number, bt: number, as_: number, at: number) =>
  executeTool(demo, "check_significance", {
    before_successes: bs, before_total: bt, after_successes: as_, after_total: at,
  }) as Promise<any>;

// ---- the significance check -------------------------------------------------

test("a real drop is reported as significant", async () => {
  // The demo regression: 70/108 down to 38/109.
  const r = await sig(70, 108, 38, 109);
  assert.equal(r.significant_at_95, true);
  assert.equal(r.z_score, -4.41);
  assert.equal(r.before_rate_pct, 64.8);
  assert.equal(r.after_rate_pct, 34.9);
  assert.equal(r.absolute_change_pct_points, -30);
});

test("normal variation is not called a shift", async () => {
  const r = await sig(70, 108, 72, 110);
  assert.equal(r.significant_at_95, false);
  assert.match(r.verdict, /within normal variation/);
});

test("a big swing on a tiny sample is refused, not believed", async () => {
  // 1 of 10 up to 9 of 10: z is about 3.6, which WOULD be significant on a
  // large sample. On ten users it is not evidence of anything, and the guard
  // is the only thing standing between this and a confident false finding.
  const r = await sig(1, 10, 9, 10);
  assert.ok(Math.abs(r.z_score) > 1.96, "the case has to be one the z-test alone would accept");
  assert.equal(r.sample_too_small, true);
  assert.equal(r.significant_at_95, false, "must not be significant however large the z-score");
  assert.match(r.verdict, /too small/);
});

test("the small-sample guard needs 30 in EACH window", async () => {
  assert.equal((await sig(10, 29, 5, 200)).sample_too_small, true);
  assert.equal((await sig(10, 200, 5, 29)).sample_too_small, true);
  assert.equal((await sig(10, 30, 5, 30)).sample_too_small, false);
});

test("degenerate inputs give a number, never NaN", async () => {
  const cases: [number, number, number, number][] = [[0, 0, 0, 0], [0, 50, 0, 50], [50, 50, 50, 50]];
  for (const args of cases) {
    const r = await sig(...args);
    assert.ok(Number.isFinite(r.z_score), `z was ${r.z_score} for ${args}`);
    assert.equal(r.significant_at_95, false);
  }
});

// ---- anomaly detection ------------------------------------------------------

/** A source whose only behaviour is: this many events last window, this many this one. */
function counts(byEvent: Record<string, [prior: number, recent: number]>): EventSource {
  const recentEnd = daysAgo(0).getTime();
  return {
    describeSchema: async () => ({
      events: Object.keys(byEvent).map((name) => ({ name, count: 0, properties: [] })),
      totalEvents: 0, totalUsers: 0, firstEventAt: null, lastEventAt: null,
    }),
    eventCountsByDay: async (name: string, range: { to: Date }) => {
      const [prior, recent] = byEvent[name];
      return [{ day: new Date(), segment: null, count: range.to.getTime() === recentEnd ? recent : prior }];
    },
  } as unknown as EventSource;
}

test("a large move on real volume is flagged as meaningful", async () => {
  const out = await detectAnomalies(counts({ boss_defeated: [80, 38] }));
  assert.equal(out.length, 1);
  assert.equal(out[0].meaningful, true);
  assert.equal(out[0].direction, "down");
  assert.equal(out[0].changePct, -52.5);
});

test("a dramatic move on tiny volume is kept but marked as noise", async () => {
  const [a] = await detectAnomalies(counts({ rare: [2, 9] }));
  assert.equal(a.meaningful, false);
  assert.match(a.note, /likely noise/);
});

test("moves under 25% are not reported at all", async () => {
  assert.deepEqual(await detectAnomalies(counts({ steady: [100, 110] })), []);
});

test("an event that appears from nothing counts as +100%", async () => {
  const [a] = await detectAnomalies(counts({ launched: [0, 50] }));
  assert.equal(a.changePct, 100);
  assert.equal(a.meaningful, false, "no prior volume, so it cannot clear the floor");
});

test("meaningful anomalies sort ahead of louder-but-noisy ones", async () => {
  const out = await detectAnomalies(counts({ noisy: [1, 20], real: [100, 150] }));
  assert.deepEqual(out.map((a) => a.eventName), ["real", "noisy"]);
});

// ---- locate_change on the demo data ----------------------------------------

test("locate_change puts the planted spike first, and drops properties that only scaled", async () => {
  const r: any = await executeTool(demo, "locate_change", { event_name: "player_died" });
  const top = r.strongest_first[0];
  assert.equal(top.property, "x");
  assert.equal(top.top_changes[0].value, "22000");
  assert.equal(top.top_changes[0].prior, 4);
  assert.equal(top.top_changes[0].recent, 49);
  assert.ok(top.top_changes[0].excess > 35);
  // `reason` rose in proportion with total deaths, so it is not the source.
  assert.ok(!r.strongest_first.some((f: any) => f.property === "reason"));
});

test("locate_change reports nothing where nothing moved", async () => {
  const r: any = await executeTool(demo, "locate_change", { event_name: "item_collected" });
  assert.deepEqual(r.strongest_first, []);
  assert.match(r.note, /does not localise/);
});

test("locate_change names the known events when given an unknown one", async () => {
  const r: any = await executeTool(demo, "locate_change", { event_name: "no_such_event" });
  assert.match(r.error, /no event named/);
  assert.ok(r.known_events.includes("player_died"));
});

test("aggregate compare_to_prior sorts by biggest change", async () => {
  const r: any = await executeTool(demo, "aggregate", {
    event_name: "player_died", group_by: "x", bucket_size: 2000,
    metric: "event_count", days_back: 7, compare_to_prior: true,
  });
  assert.equal(r.biggest_changes[0].group_value, "22000");
  assert.equal(r.biggest_changes[0].change, 45);
});

// ---- bucket sizing ----------------------------------------------------------

test("niceStep picks a round width giving roughly 14 buckets", () => {
  assert.equal(niceStep(0, 28000), 2000);
  assert.equal(niceStep(0, 100), 10);
  assert.equal(niceStep(0, 1), 0.1);
  assert.ok(Number.isFinite(niceStep(5, 5)), "a zero range must not divide by zero");
});
