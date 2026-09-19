import { computeOverview } from "@/lib/analysis/metrics";
import { detectAnomalies } from "@/lib/analysis/anomalies";
import { defaultSource, isDemoOnly } from "@/lib/connectors/registry";
import { store } from "@/lib/store";
import { RunBriefButton } from "./run-brief-button";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const source = defaultSource();
  const [overview, anomalies, brief] = await Promise.all([
    computeOverview(source),
    detectAnomalies(source),
    store().latestBrief(source.id),
  ]);

  const peak = Math.max(1, ...overview.activeByDay.map((d) => d.users));
  const topCount = Math.max(1, ...overview.topEvents.map((e) => e.count));
  const flagged = anomalies.filter((a) => a.meaningful);

  return (
    <>
      <header className="head">
        <div>
          <h1>Overview</h1>
          <p>
            {source.displayName} · {overview.totalEvents.toLocaleString()} events ·{" "}
            {overview.totalUsers.toLocaleString()} users ·{" "}
            {overview.firstEventAt
              ? `since ${new Date(overview.firstEventAt).toISOString().slice(0, 10)}`
              : "no data"}
          </p>
        </div>
        <RunBriefButton />
      </header>

      <div className="body">
        {isDemoOnly() && (
          <div className="banner">
            <span style={{ color: "var(--agent)" }}>◆</span>
            <div>
              <b>Running on synthetic data</b>
              No telemetry source is connected, so Mimir generated a product with a
              realistic problem buried in it. Everything below is live — the agent
              investigates this exactly as it would a real source. Set{" "}
              <code className="mono">SOURCE_NIGHT_RUN_URL</code> to point at real data.
            </div>
          </div>
        )}

        {brief && (
          <div className="panel">
            <div className="panel-head">
              <h2>Morning brief</h2>
              <span className="tag mono">{brief.brief_date}</span>
            </div>
            <div className="panel-body">
              <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 5 }}>
                {brief.headline}
              </div>
              <div style={{ color: "var(--text-2)" }}>{brief.body}</div>
            </div>
          </div>
        )}

        <div className="strip">
          <Metric k="Active (24h)" v={overview.dau} />
          <Metric k="Active (7d)" v={overview.wau} />
          <Metric k="New (7d)" v={overview.newUsers7d} />
          <Metric
            k="Returning (7d)"
            v={overview.returningUsers7d}
            d={overview.returnRatePct !== null ? `${overview.returnRatePct}% of weekly` : undefined}
          />
          <Metric k="Events tracked" v={overview.topEvents.length} d="distinct types" />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }} className="split">
          <div className="panel">
            <div className="panel-head">
              <h2>Active users · 28d</h2>
              <span className="tag mono">peak {peak}</span>
            </div>
            <div className="panel-body">
              <div className="sparkline">
                {overview.activeByDay.map((d) => (
                  <i key={d.day} style={{ height: `${(d.users / peak) * 100}%` }} title={`${d.day}: ${d.users}`} />
                ))}
              </div>
              <div
                className="mono"
                style={{ display: "flex", justifyContent: "space-between", color: "var(--text-3)", fontSize: 10.5, marginTop: 6 }}
              >
                <span>{overview.activeByDay[0]?.day ?? ""}</span>
                <span>{overview.activeByDay.at(-1)?.day ?? ""}</span>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h2>Event volume</h2>
            </div>
            <div className="panel-body">
              <div className="rows">
                {overview.topEvents.slice(0, 7).map((e) => (
                  <div className="row-bar" key={e.name}>
                    <span className="lab mono">{e.name}</span>
                    <span className="track">
                      <i className="fill" style={{ width: `${(e.count / topCount) * 100}%` }} />
                    </span>
                    <span className="val num">{e.count.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>Week over week</h2>
            <span className="tag">
              {flagged.length} of {anomalies.length} clear the volume floor
            </span>
          </div>
          <div className="panel-body flush">
            {anomalies.length === 0 ? (
              <div className="empty">Nothing moved more than 25%. Quiet week.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Event</th>
                    <th className="r">Prior 7d</th>
                    <th className="r">Last 7d</th>
                    <th className="r">Δ</th>
                    <th>Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {anomalies.slice(0, 9).map((a) => (
                    <tr key={a.eventName}>
                      <td className="mono">{a.eventName}</td>
                      <td className="r num">{a.before}</td>
                      <td className="r num">{a.after}</td>
                      <td className="r num" style={{ color: a.direction === "up" ? "var(--ok)" : "var(--err)" }}>
                        {a.changePct > 0 ? "+" : ""}
                        {a.changePct}%
                      </td>
                      <td>
                        <span className={`tag ${a.meaningful ? "warn" : ""}`}>
                          {a.meaningful ? "investigate" : "below volume floor"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function Metric({ k, v, d }: { k: string; v: number; d?: string }) {
  return (
    <div className="metric">
      <div className="k">{k}</div>
      <div className="v num">{v.toLocaleString()}</div>
      {d && <div className="d">{d}</div>}
    </div>
  );
}
