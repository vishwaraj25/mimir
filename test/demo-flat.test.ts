import { test } from "node:test";
import assert from "node:assert/strict";

// Its own file on purpose: the scenario is read once, when the demo data is
// generated, and node runs each test file in its own process.
process.env.MIMIR_DEMO_SCENARIO = "flat";

test("the flat scenario really has no regression, so a false premise can be tested", async () => {
  const { executeTool } = await import("../lib/agent/tools");
  const { DemoEventSource } = await import("../lib/connectors/demo-source");
  const src = new DemoEventSource();
  const c: any = await executeTool(src, "compare_periods", { steps: ["run_start", "boss_defeated"], window_days: 7 });
  const [a, b] = [c.prior_period.steps, c.recent_period.steps];
  const s: any = await executeTool(src, "check_significance", {
    before_successes: a[1].users, before_total: a[0].users, after_successes: b[1].users, after_total: b[0].users,
  });
  assert.equal(s.significant_at_95, false);
  assert.ok(Math.abs(s.absolute_change_pct_points) < 5);

  const died: any = await executeTool(src, "locate_change", { event_name: "player_died" });
  assert.ok(!died.strongest_first.some((f: any) => f.property === "x" && f.top_changes[0].value === "22000" && f.strength > 0.2),
    "no spike at 22000 when there is no regression");
});
