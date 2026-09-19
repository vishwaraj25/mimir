import Anthropic from "@anthropic-ai/sdk";
import { detectAnomalies } from "../analysis/anomalies";
import { computeOverview } from "../analysis/metrics";
import { getSource } from "../connectors/registry";
import { mimirDb } from "../db";
import { BRIEF_SYSTEM_PROMPT } from "./prompts";
import { runInvestigation } from "./runner";

/**
 * The morning brief.
 *
 * Deterministic metrics and anomaly detection run first, in code. The model
 * only writes the prose summary over numbers it was handed -- it never
 * computes them. That keeps the daily number you read from drifting because
 * of a model's arithmetic, and keeps the brief cheap.
 *
 * If a genuinely meaningful anomaly is found, a full investigation is kicked
 * off automatically so the "why" is already waiting when you open the app.
 */
export async function generateMorningBrief(sourceId: string) {
  const source = getSource(sourceId);
  const db = mimirDb();

  const [overview, anomalies] = await Promise.all([
    computeOverview(source),
    detectAnomalies(source),
  ]);

  const meaningful = anomalies.filter((a) => a.meaningful);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  const anthropic = new Anthropic({ apiKey });

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
        ? "This product has very few users so far. Week-over-week swings are usually noise. Say so plainly rather than reporting them as news."
        : null,
  };

  const response = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1024,
    system: BRIEF_SYSTEM_PROMPT,
    messages: [{ role: "user", content: JSON.stringify(facts, null, 2) }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const fenced = text.match(/```json\s*([\s\S]*?)```/);
  let parsed: { headline: string; body: string };
  try {
    parsed = JSON.parse((fenced ? fenced[1] : text).trim());
  } catch {
    parsed = { headline: "Brief generated", body: text.slice(0, 800) };
  }

  const today = new Date().toISOString().slice(0, 10);
  await db.query(
    `INSERT INTO briefs (source_id, brief_date, headline, body, metrics)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (source_id, brief_date)
     DO UPDATE SET headline = EXCLUDED.headline,
                   body = EXCLUDED.body,
                   metrics = EXCLUDED.metrics,
                   created_at = now()`,
    [sourceId, today, parsed.headline, parsed.body, JSON.stringify(facts)],
  );

  // Only chase a cause when there is a real change to chase. This is the
  // autonomous half: by the time you read the brief, the investigation of
  // the thing it flagged has already run.
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
