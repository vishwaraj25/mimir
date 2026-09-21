import { test } from "node:test";
import assert from "node:assert/strict";
import { executeTool } from "../lib/agent/tools";
import { DemoEventSource } from "../lib/connectors/demo-source";

const src = new DemoEventSource();

test("the demo regression exists: completion falls by about 30 points", async () => {
  const c: any = await executeTool(src, "compare_periods", { steps: ["run_start", "boss_defeated"], window_days: 7 });
  const [before, after] = c.prior_period.conversion_pct[1] !== undefined
    ? [c.prior_period.conversion_pct[1], c.recent_period.conversion_pct[1]] : [0, 0];
  assert.ok(before - after > 25, `expected a drop of 25+ points, got ${before} to ${after}`);
});

test("the demo is deterministic, so every clone sees the same product", async () => {
  const a: any = await new DemoEventSource().describeSchema();
  const b: any = await new DemoEventSource().describeSchema();
  assert.equal(a.totalEvents, b.totalEvents);
});

test("the boss is actually reachable: a success event exists at all", async () => {
  // Regression test for a generator bug where the loop stepped by 2000 but
  // the finish line sat on a non-multiple, so the boss could never be beaten.
  const schema: any = await src.describeSchema();
  assert.ok(schema.events.find((e: any) => e.name === "boss_defeated")?.count > 0);
});
