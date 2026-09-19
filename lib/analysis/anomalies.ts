import type { EventSource } from "../connectors/types";
import { daysAgo } from "./metrics";

/**
 * Cheap, deterministic anomaly detection -- the trigger that decides an
 * investigation is worth running at all.
 *
 * Deliberately conservative. At small data volumes almost any week-over-week
 * comparison looks dramatic, so every candidate must clear an absolute
 * volume floor before it is allowed to be called a change. Flagging noise
 * every morning is how a daily brief becomes something you stop reading.
 */

export interface Anomaly {
  eventName: string;
  before: number;
  after: number;
  changePct: number;
  direction: "up" | "down";
  /** False when volumes are too low to mean anything; kept for context. */
  meaningful: boolean;
  note: string;
}

const MIN_VOLUME = 20; // per window, below which a swing is noise
const MIN_CHANGE_PCT = 25;

export async function detectAnomalies(
  source: EventSource,
  windowDays = 7,
): Promise<Anomaly[]> {
  const schema = await source.describeSchema();
  const recent = { from: daysAgo(windowDays), to: daysAgo(0) };
  const prior = { from: daysAgo(windowDays * 2), to: daysAgo(windowDays) };

  const out: Anomaly[] = [];

  for (const ev of schema.events) {
    const [a, b] = await Promise.all([
      source.eventCountsByDay(ev.name, prior),
      source.eventCountsByDay(ev.name, recent),
    ]);
    const before = a.reduce((s, r) => s + r.count, 0);
    const after = b.reduce((s, r) => s + r.count, 0);
    if (before === 0 && after === 0) continue;

    const changePct =
      before > 0 ? ((after - before) / before) * 100 : after > 0 ? 100 : 0;
    if (Math.abs(changePct) < MIN_CHANGE_PCT) continue;

    const meaningful = before >= MIN_VOLUME && after >= MIN_VOLUME;
    out.push({
      eventName: ev.name,
      before,
      after,
      changePct: Number(changePct.toFixed(1)),
      direction: changePct >= 0 ? "up" : "down",
      meaningful,
      note: meaningful
        ? `${ev.name} moved ${changePct >= 0 ? "up" : "down"} ${Math.abs(changePct).toFixed(0)}% week over week.`
        : `${ev.name} changed ${Math.abs(changePct).toFixed(0)}%, but volumes are small (${before} then ${after}); likely noise.`,
    });
  }

  // Loudest first, but only among the ones that cleared the volume floor.
  out.sort((x, y) => {
    if (x.meaningful !== y.meaningful) return x.meaningful ? -1 : 1;
    return Math.abs(y.changePct) - Math.abs(x.changePct);
  });
  return out;
}
