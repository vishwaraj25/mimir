import type { EventSource, TimeRange } from "../connectors/types";

/**
 * Deterministic metrics, computed in code rather than by the agent.
 *
 * The split matters: anything that can be computed exactly should be, so the
 * agent spends its reasoning on WHY a number moved rather than on arithmetic
 * it might get subtly wrong. The overview page and the morning brief both
 * read from here; the agent reads these same numbers through its tools.
 */

export function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function lastNDays(n: number): TimeRange {
  return { from: daysAgo(n), to: daysAgo(-1) };
}

export interface OverviewMetrics {
  dau: number;
  wau: number;
  totalUsers: number;
  totalEvents: number;
  newUsers7d: number;
  returningUsers7d: number;
  /** Share of users who came back on a later day than their first. */
  returnRatePct: number | null;
  activeByDay: { day: string; users: number }[];
  topEvents: { name: string; count: number }[];
  firstEventAt: Date | null;
  lastEventAt: Date | null;
}

export async function computeOverview(
  source: EventSource,
): Promise<OverviewMetrics> {
  const week = lastNDays(7);
  const [schema, byDay28, dau, wau, newUsers7d] = await Promise.all([
    source.describeSchema(),
    source.activeUsersByDay(lastNDays(28)),
    source.distinctUsers(lastNDays(1)),
    source.distinctUsers(week),
    source.newUsers(week),
  ]);

  const returningUsers7d = Math.max(0, wau - newUsers7d);

  return {
    dau,
    wau,
    totalUsers: schema.totalUsers,
    totalEvents: schema.totalEvents,
    newUsers7d,
    returningUsers7d,
    returnRatePct: wau > 0 ? Number(((returningUsers7d / wau) * 100).toFixed(1)) : null,
    activeByDay: byDay28.map((d) => ({
      day: new Date(d.day).toISOString().slice(0, 10),
      users: d.users,
    })),
    topEvents: schema.events.slice(0, 12).map((e) => ({
      name: e.name,
      count: e.count,
    })),
    firstEventAt: schema.firstEventAt,
    lastEventAt: schema.lastEventAt,
  };
}

/**
 * Conversion between two events over a window, with the raw counts kept so
 * a significance check can be run on them.
 */
export async function conversionBetween(
  source: EventSource,
  fromEvent: string,
  toEvent: string,
  range: TimeRange,
): Promise<{ from: number; to: number; ratePct: number | null }> {
  const rows = await source.funnel([fromEvent, toEvent], range);
  const a = rows[0]?.users ?? 0;
  const b = rows[1]?.users ?? 0;
  return {
    from: a,
    to: b,
    ratePct: a > 0 ? Number(((b / a) * 100).toFixed(1)) : null,
  };
}
