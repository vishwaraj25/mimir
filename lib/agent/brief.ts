import { detectAnomalies } from "../analysis/anomalies";
import { computeOverview } from "../analysis/metrics";
import { getSource } from "../connectors/registry";
import { getProvider } from "../llm";
import { store } from "../store";
import { BRIEF_SYSTEM_PROMPT } from "./prompts";
import { runInvestigation } from "./runner";

/**
 * The morning brief.
 *
 * Metrics and anomaly detection run first, in code. The model only writes
 * prose over numbers it was handed -- it never computes them. That keeps the
 * figure you read every morning from drifting because of a model's
 * arithmetic, and keeps a daily run to a single cheap call.
 *
 * A full investigation is started only when something cleared the volume
 * floor, so a quiet day costs one request and nothing else.
 */
export async function generateMorningBrief(sourceId: string) {
  const source = getSource(sourceId);
  const db = store();

  const [overview, anomalies] = await Promise.all([
    computeOverview(source),
    detectAnomalies(source),
  ]);

  const meaningful = anomalies.filter((a) => a.meaningful);

  const facts = {
    source: source.displayName,
    active_users_yesterday: overview.dau,
    active_users_last_7d: overview.wau,
    new_users_last_7d: overview.newUsers7d,
    returning_users_last_7d: overview.returningUsers7d,
    total_users_all_time: overview.totalUsers,
    total_events_all_time: overview.totalEvents,
    top_events: overview.topEvents,
    active_by_day_last_28d: overview.activeByDay,
    anomalies_detected: anomalies,
    note_on_scale:
      overview.totalUsers < 50
        ? "This product has very few users. Week-over-week swings are usually noise; say so plainly rather than reporting them as news."
        : null,
  };

  const provider = getProvider();
  const response = await provider.complete({
    system: BRIEF_SYSTEM_PROMPT,
    messages: [{ role: "user", text: JSON.stringify(facts, null, 2) }],
    maxTokens: 1024,
  });

  let parsed: { headline: string; body: string };
  const fenced = response.text.match(/```(?:json)?\s*([\s\S]*?)```/);
  try {
    parsed = JSON.parse((fenced ? fenced[1] : response.text).trim());
  } catch {
    parsed = {
      headline: "Brief generated",
      body: response.text.slice(0, 800),
    };
  }

  await db.saveBrief({
    source_id: sourceId,
    brief_date: new Date().toISOString().slice(0, 10),
    headline: parsed.headline,
    body: parsed.body,
    metrics: facts,
  });

  // The autonomous half: by the time the brief is read, the investigation
  // into what it flagged has already run.
  let triggeredInvestigation: number | null = null;
  if (meaningful.length > 0) {
    const top = meaningful[0];
    try {
      const result = await runInvestigation({
        sourceId,
        trigger: "monitor",
        question: `${top.eventName} moved ${top.direction} ${Math.abs(top.changePct)}% week over week (${top.before} then ${top.after}). Establish whether this is a real change, find which stage or segment it came from, and explain why.`,
      });
      triggeredInvestigation = result.investigationId;
    } catch {
      // A failed investigation must not take the brief down with it.
    }
  }

  return { ...parsed, metrics: facts, triggeredInvestigation };
}
