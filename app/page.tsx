import { computeOverview } from "@/lib/analysis/metrics";
import { detectAnomalies } from "@/lib/analysis/anomalies";
import { defaultSource, isDemoOnly } from "@/lib/connectors/registry";
import { store } from "@/lib/store";
import { InvestigateHero } from "./investigate-hero";
import { RunBriefButton } from "./run-brief-button";
import { requirePageAccess } from "@/lib/page-auth";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  await requirePageAccess();
  const source = defaultSource();
  const [overview, anomalies, brief] = await Promise.all([
    computeOverview(source),
    detectAnomalies(source),
    store().latestBrief(source.id),
  ]);

  const topCount = Math.max(1, ...overview.topEvents.map((e) => e.count));
  const flagged = anomalies.filter((a) => a.meaningful);
  const spark14 = overview.activeByDay.slice(-14);
  const sparkPeak = Math.max(1, ...spark14.map((d) => d.users));

  const dauDelta = pctDelta(overview.dauPrevDay, overview.dau);
  const wauDelta = pctDelta(overview.wauPrevWeek, overview.wau);

  return (
    <>
      <header className="head">
        <div>
          <h1>Overview</h1>
          <p>
            {source.displayName} · {overview.totalEvents.toLocaleString()} events ·{" "}
            {overview.totalUsers.toLocaleString()} users
          </p>
        </div>
        <RunBriefButton />
      </header>

      <div className="body">
        {isDemoOnly() && (
          <div className="banner">
            <span style={{ color: "var(--data)" }}>◆</span>
            <div>
              <b>Running on synthetic data</b>
              No telemetry source is connected, so a product with a realistic problem was
              generated to explore. Connect a real source on Settings.
            </div>
          </div>
        )}

        <InvestigateHero />

        {brief && (
          <div className="card">
            <div className="card-head">
              <h2>Morning brief</h2>
              <span className="tag mono">{brief.brief_date}</span>
            </div>
            <div className="card-body">
              <div style={{ fontSize: 14.5, fontWeight: 650, marginBottom: 6 }}>{brief.headline}</div>
              <div style={{ color: "var(--text-2)" }}>{brief.body}</div>
            </div>
          </div>
        )}

        <div className="grid-metrics">
          <MetricCard k="Active, 24h" v={overview.dau} delta={dauDelta} sparkline={spark14} sparkPeak={sparkPeak} />
          <MetricCard k="Active, 7d" v={overview.wau} delta={wauDelta} sparkline={spark14} sparkPeak={sparkPeak} accent="data" />
          <StatCard k="New, 7d" v={overview.newUsers7d} />
          <StatCard
            k="Returning, 7d"
            v={overview.returningUsers7d}
            note={overview.returnRatePct !== null ? `${overview.returnRatePct}% of weekly actives` : undefined}
          />
          <StatCard k="Event types" v={overview.topEvents.length} note="tracked" />
        </div>

        <div className="grid-2">
          <div className="card">
            <div className="card-head">
              <h2>Week over week</h2>
              <span className="tag warn">{flagged.length} flagged</span>
            </div>
            <div className="card-body flush">
              {anomalies.length === 0 ? (
                <div className="empty">Nothing moved more than 25%. Quiet week.</div>
              ) : (
                <table>
                  <thead>
                    <tr><th>Event</th><th className="r">Δ</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {anomalies.slice(0, 8).map((a) => (
                      <tr key={a.eventName}>
                        <td className="mono">{a.eventName}</td>
                        <td className="r num" style={{ color: a.direction === "up" ? "var(--ok)" : "var(--err)", fontWeight: 650 }}>
                          {a.changePct > 0 ? "+" : ""}{a.changePct}%
                        </td>
                        <td>
                          <span className={`tag ${a.meaningful ? "warn" : ""}`}>
                            {a.meaningful ? "investigate" : "below floor"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h2>Event volume</h2></div>
            <div className="card-body">
              <div className="rows">
                {overview.topEvents.slice(0, 7).map((e) => (
                  <div className="row-bar" key={e.name}>
                    <span className="lab mono">{e.name}</span>
                    <span className="track"><i className="fill" style={{ width: `${(e.count / topCount) * 100}%` }} /></span>
                    <span className="val num">{e.count.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export function pctDelta(before: number, after: number): { pct: number; dir: "up" | "down" | "flat" } {
  if (before === 0) return { pct: after > 0 ? 100 : 0, dir: after > 0 ? "up" : "flat" };
  const pct = Number((((after - before) / before) * 100).toFixed(0));
  return { pct, dir: pct > 0 ? "up" : pct < 0 ? "down" : "flat" };
}

export function MetricCard({
  k, v, delta, sparkline, sparkPeak, accent,
}: {
  k: string; v: number; delta: { pct: number; dir: "up" | "down" | "flat" };
  sparkline: { day: string; users: number }[]; sparkPeak: number; accent?: "data" | "agent";
}) {
  return (
    <div className="mcard">
      <div className="mcard-top">
        <span className="k">{k}</span>
        <span className={`delta ${delta.dir}`}>
          {delta.dir === "up" ? "↑" : delta.dir === "down" ? "↓" : "–"} {Math.abs(delta.pct)}%
        </span>
      </div>
      <div className="v num">{v.toLocaleString()}</div>
      <div className="spark-wrap">
        <div className={`sparkline ${accent ?? ""}`}>
          {sparkline.map((d) => (
            <i key={d.day} style={{ height: `${Math.max(6, (d.users / sparkPeak) * 100)}%` }} title={`${d.day}: ${d.users}`} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function StatCard({ k, v, note }: { k: string; v: number; note?: string }) {
  return (
    <div className="mcard">
      <div className="mcard-top"><span className="k">{k}</span></div>
      <div className="v num">{v.toLocaleString()}</div>
      {note && <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>{note}</div>}
    </div>
  );
}
