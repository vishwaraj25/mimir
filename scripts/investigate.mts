/**
 * Run one investigation from the terminal and print a compact summary.
 *
 *   npm run investigate -- "Why did completion drop?"
 *   MIMIR_DEMO_SCENARIO=flat npm run investigate -- "Why did completion drop?"
 *
 * Uses the model key in .env.local and whatever source is configured (the
 * synthetic demo if none). This is how the agent is checked against a real
 * model; the offline tests (npm test) only check the loop's rules.
 */
import { readFileSync, existsSync } from "node:fs";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const question = process.argv.slice(2).join(" ").trim();
if (!question) {
  console.error('usage: npm run investigate -- "your question"');
  process.exit(1);
}

const { runInvestigation } = await import("../lib/agent/runner.ts");
const { defaultSource } = await import("../lib/connectors/registry.ts");
const { store } = await import("../lib/store.ts");

const started = Date.now();
console.log(`Q: ${question}   [source=${defaultSource().id}, scenario=${process.env.MIMIR_DEMO_SCENARIO ?? "default"}]`);
try {
  const r = await runInvestigation({ sourceId: defaultSource().id, question });
  const { steps } = await store().getInvestigation(r.investigationId);
  const calls = steps.filter((s) => s.kind === "tool_call");
  console.log("tools   :", calls.map((s) => s.tool_name).join(" > "));
  console.log("headline:", r.headline);
  console.log("confid. :", r.confidence);
  console.log("summary :", r.summary);
  console.log("hypoth. :", r.hypothesis || "(none)");
  console.log("insights:", r.insights.map((i: any) => `[${i.severity}] ${i.headline}`).join(" | ") || "(none)");
  console.log("experim.:", r.experiment ? r.experiment.title : "null");
} catch (e) {
  console.log("FAILED  :", (e as Error).message.slice(0, 300));
  process.exitCode = 1;
}
console.log(`time    : ${((Date.now() - started) / 1000).toFixed(0)}s`);
