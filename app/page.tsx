import { computeOverview } from "@/lib/analysis/metrics";
import { detectAnomalies } from "@/lib/analysis/anomalies";
import { defaultSource } from "@/lib/connectors/registry";
import { mimirDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Overview: the state of the connected product, plus today's brief.
 *
 * Everything on this page is computed deterministically (lib/analysis), not
 * by the agent -- the agent's job starts where the numbers stop explaining
 * themselves.
 */
export default async function OverviewPage() {
  let source;
  try {
    source = defaultSource();
  } catch (err) {
    return <NotConfigured message={(err as Error).message} />;
  }

  let overview, anomalies, brief;
  try {
    [overview, anomalies] = await Promise.all([
      computeOverview(source),
      detectAnomalies(source),
    ]);
    const r = await mimirDb().query(
      `SELECT headline, body, brief_date FROM briefs
       WHERE source_id = $1 ORDER BY brief_date DESC LIMIT 1`,
      [source.id],
    );
    brief = r.rows[0] ?? null;
  } catch (err) {
    return <NotConfigured message={(err as Error).message} />;
  }

  const peak = Math.max(1, ...overview.activeByDay.map((d) => d.users));
  const topEventCount = Math.max(1, ...overview.topEvents.map((e) => e.count));

  return (
    <>
      <div className="page-head">
        <h1>Overview</h1>
        <p>
          {source.displayName} · {overview.totalEvents.toLocaleString()} events from{" "}
          {overview.totalUsers.toLocaleString()} users
        </p>
      </div>

      {brief && (
        <div className="panel" style={{ borderColor: "rgba(124,140,255,.35)" }}>
          <h2>
            This morning&apos;s brief{" "}
            <span className="mono" style={{ textTransform: "none", letterSpacing: 0 }}>
              · {new Date(brief.brief_date).toISOString().slice(0, 10)}
            </span>
          </h2>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{brief.headline}</div>
          <div style={{ color: "var(--muted)" }}>{brief.body}</div>
        </div>
      )}

      <div className="tiles">
        <Tile n={overview.dau} label="Active yesterday" />
        <Tile n={overview.wau} label="Active last 7d" />
        <Tile n={overview.newUsers7d} label="New last 7d" />
        <Tile
          n={overview.returningUsers7d}
          label="Returning last 7d"
          sub={overview.returnRatePct !== null ? `${overview.returnRatePct}% of weekly actives` : undefined}
        />
      </div>

      <div className="panel">
        <h2>Active users, last 28 days</h2>
        {overview.activeByDay.length === 0 ? (
          <div className="empty">No activity in this window.</div>
        ) : (
          <>
            <div className="spark">
              {overview.activeByDay.map((d) => (
                <div key={d.day} style={{ height: `${(d.users / peak) * 100}%` }} title={`${d.day}: ${d.users}`} />
              ))}
            </div>
            <div className="mono" style={{ color: "var(--muted-2)", marginTop: 8, display: "flex", justifyContent: "space-between" }}>
              <span>{overview.activeByDay[0]?.day}</span>
              <span>peak {peak}</span>
              <span>{overview.activeByDay.at(-1)?.day}</span>
            </div>
          </>
        )}
      </div>

      <div className="panel">
        <h2>What changed, week over week</h2>
        {anomalies.length === 0 ? (
          <div className="empty">Nothing moved more than 25% either way. A quiet week.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Event</th>
                <th className="num">Prior 7d</th>
                <th className="num">Last 7d</th>
                <th className="num">Change</th>
                <th>Read</th>
              </tr>
            </thead>
            <tbody>
              {anomalies.slice(0, 10).map((a) => (
                <tr key={a.eventName}>
                  <td className="mono">{a.eventName}</td>
                  <td className="num">{a.before}</td>
                  <td className="num">{a.after}</td>
                  <td className="num" style={{ color: a.direction === "up" ? "var(--good)" : "var(--bad)" }}>
                    {a.changePct > 0 ? "+" : ""}
                    {a.changePct}%
                  </td>
                  <td>
                    <span className={`badge ${a.meaningful ? "warn" : ""}`}>
                      {a.meaningful ? "worth a look" : "too small to matter"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h2>Most frequent events</h2>
        <div className="bars">
          {overview.topEvents.map((e) => (
            <div className="bar-row" key={e.name}>
              <div className="label">{e.name}</div>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${(e.count / topEventCount) * 100}%` }} />
              </div>
              <div className="count">{e.count.toLocaleString()}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function Tile({ n, label, sub }: { n: number; label: string; sub?: string }) {
  return (
    <div className="tile">
      <div className="n">{n.toLocaleString()}</div>
      <div className="l">{label}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

function NotConfigured({ message }: { message: string }) {
  return (
    <>
      <div className="page-head">
        <h1>Not configured yet</h1>
        <p>Mimir needs a telemetry source and its own database before it can do anything.</p>
      </div>
      <div className="panel">
        <div className="mono" style={{ color: "var(--bad)", marginBottom: 14 }}>{message}</div>
        <p style={{ color: "var(--muted)" }}>Set these environment variables, then redeploy:</p>
        <pre style={{ background: "#0d0f14", border: "1px solid var(--border)", borderRadius: 6, padding: 12, fontSize: 12 }}>
{`MIMIR_DATABASE_URL     Mimir's own Postgres (run db/schema.sql on it)
SOURCE_NIGHT_RUN_URL   read-only Postgres role on the game's database
ANTHROPIC_API_KEY      for the agent
MIMIR_ACCESS_KEY       password for this dashboard`}
        </pre>
      </div>
    </>
  );
}
