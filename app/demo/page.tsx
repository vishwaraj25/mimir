import Link from "next/link";
import { computeOverview } from "@/lib/analysis/metrics";
import { detectAnomalies } from "@/lib/analysis/anomalies";
import { getSource } from "@/lib/connectors/registry";
import { MetricCard, StatCard, pctDelta } from "../page";

export const dynamic = "force-dynamic";

/**
 * A public walkthrough, reachable with no access key.
 *
 * Everything else in the app is deliberately gated (see proxy.ts) because it
 * reads a connected product's real behavioural data and spends model quota.
 * A recruiter or reviewer following a bare link should still be able to see
 * what Mimir does, so this page exists as its own thing: always the
 * synthetic source (never the real Night Run connection, however this
 * deployment is configured), and no "Ask Mimir" action, so no anonymous
 * visitor can spend the connected model's daily quota.
 */
export default async function DemoPage() {
  const source = getSource("demo");
  const [overview, anomalies] = await Promise.all([computeOverview(source), detectAnomalies(source)]);

  const topCount = Math.max(1, ...overview.topEvents.map((e) => e.count));
  const flagged = anomalies.filter((a) => a.meaningful);
  const spark14 = overview.activeByDay.slice(-14);
  const sparkPeak = Math.max(1, ...spark14.map((d) => d.users));
  const dauDelta = pctDelta(overview.dauPrevDay, overview.dau);
  const wauDelta = pctDelta(overview.wauPrevWeek, overview.wau);

  return (
    <div style={{ maxWidth: 960, margin: "0 auto" }}>
      <header className="head">
        <div>
          <h1>Overview</h1>
          <p>
            {source.displayName} (public demo) · {overview.totalEvents.toLocaleString()} events ·{" "}
            {overview.totalUsers.toLocaleString()} users
          </p>
        </div>
        <Link href="/login" className="btn">Sign in for the live version</Link>
      </header>

      <div className="body">
        <div className="banner">
          <span style={{ color: "var(--data)" }}>◆</span>
          <div>
            <b>Read-only public demo, on synthetic data</b>
            This is Mimir's built-in synthetic product, with a planted regression to find. The
            real deployment connects a live game's Postgres telemetry and can run a live agent
            investigation, both behind sign-in, so a public link can't spend that quota or read
            real user data.
          </div>
        </div>

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

        <div className="card">
          <div className="card-head"><h2>What the agent found here</h2></div>
          <div className="card-body" style={{ color: "var(--text-2)" }}>
            Completion on this synthetic product drops from ~65% to ~35% in the last week,
            caused by a difficulty spike at one position in the run. Signed-in, asking
            <i> &quot;why did completion drop?&quot;</i> against this same data has the agent locate that exact
            spike itself, three runs out of three, rather than guessing. See{" "}
            <a href="https://github.com/vishwaraj25/mimir" target="_blank" rel="noreferrer">
              the source
            </a>{" "}
            for the reasoning trail and how it&apos;s kept honest.
          </div>
        </div>
      </div>
    </div>
  );
}
