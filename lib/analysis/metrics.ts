import type { EventSource, TimeRange } from "../connectors/types";

/**
 * Deterministic metrics, computed in code rather than by the agent.
 *
 * The split matters: anything that can be computed exactly should be, so the
 * agent spends its reasoning on WHY a number moved rather than on arithmetic
 * it might get subtly wrong. The overview cards and the morning brief both
 * read from here.
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
  dauPrevDay: number;
  wau: number;
  wauPrevWeek: number;
  totalUsers: number;
  totalEvents: number;
  newUsers7d: number;
  returningUsers7d: number;
  returnRatePct: number | null;
  /** Daily active-user counts, oldest first -- the one series every card can trust. */
  activeByDay: { day: string; users: number }[];
  topEvents: { name: string; count: number }[];
  firstEventAt: Date | null;
  lastEventAt: Date | null;
}

export async function computeOverview(
  source: EventSource,
): Promise<OverviewMetrics> {
  const week = lastNDays(7);
  const prevWeek: TimeRange = { from: daysAgo(14), to: daysAgo(7) };

  const [schema, byDay28, dau, dauPrevDay, wau, wauPrevWeek, newUsers7d] =
    await Promise.all([
      source.describeSchema(),
      source.activeUsersByDay(lastNDays(28)),
      source.distinctUsers(lastNDays(1)),
      source.distinctUsers({ from: daysAgo(2), to: daysAgo(1) }),
      source.distinctUsers(week),
      source.distinctUsers(prevWeek),
      source.newUsers(week),
    ]);

  const returningUsers7d = Math.max(0, wau - newUsers7d);

  return {
    dau,
    dauPrevDay,
    wau,
    wauPrevWeek,
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
