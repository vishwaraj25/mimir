import { defaultSource, listSources } from "@/lib/connectors/registry";
import { TOOL_DEFINITIONS } from "@/lib/agent/tools";
import { describeProvider } from "@/lib/llm";

export const dynamic = "force-dynamic";

/**
 * Data & events.
 *
 * Deliberately shows exactly what the agent can see and do -- the schema it
 * reads, and the complete set of tools it can call. If a property is not on
 * this page, no investigation can use it, and the honest answer to a
 * question that depends on it is "that is not tracked".
 */
export default async function DataPage() {
  const source = defaultSource();
  const [schema, health] = await Promise.all([
    source.describeSchema(),
    source.healthCheck(),
  ]);
  const provider = describeProvider();
  const quality = findQualityIssues(schema);

  return (
    <>
      <header className="head">
        <div>
          <h1>Data &amp; events</h1>
          <p>
            The schema as the agent sees it, and every tool it can call. {schema.events.length}{" "}
            event types · {schema.totalEvents.toLocaleString()} events ·{" "}
            {schema.totalUsers.toLocaleString()} users.
          </p>
        </div>
      </header>

      <div className="body">
        <div className="card">
          <div className="card-head"><h2>Connection</h2></div>
          <div className="card-body flush">
            <table>
              <thead>
                <tr><th>Source</th><th>Id</th><th>Status</th><th>Window</th><th>Detail</th></tr>
              </thead>
              <tbody>
                {listSources().map((s) => (
                  <tr key={s.id}>
                    <td>{s.displayName}</td>
                    <td className="mono">{s.id}</td>
                    <td><span className={`tag ${health.ok ? "ok" : "err"}`}>{health.ok ? "live" : "error"}</span></td>
                    <td className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>
                      {schema.firstEventAt ? new Date(schema.firstEventAt).toISOString().slice(0, 10) : "—"}
                      {" → "}
                      {schema.lastEventAt ? new Date(schema.lastEventAt).toISOString().slice(0, 10) : "—"}
                    </td>
                    <td style={{ color: "var(--text-3)", fontSize: 11.5 }}>{s.id === source.id ? health.detail : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Agent capability</h2>
            <span className={`tag ${provider.free ? "ok" : "warn"}`}>{provider.label}</span>
          </div>
          <div className="card-body flush">
            <table>
              <thead><tr><th>Tool</th><th>What it does</th></tr></thead>
              <tbody>
                {TOOL_DEFINITIONS.map((t) => (
                  <tr key={t.name}>
                    <td className="mono" style={{ color: "var(--agent)", whiteSpace: "nowrap" }}>{t.name}</td>
                    <td style={{ color: "var(--text-2)" }}>{t.description.split(".")[0]}.</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {quality.length > 0 && (
          <div className="card">
            <div className="card-head">
              <h2>Data quality</h2>
              <span className="tag warn">{quality.length} checks</span>
            </div>
            <div className="card-body flush">
              <table>
                <tbody>
                  {quality.map((q, i) => (
                    <tr key={i}><td style={{ color: "var(--text-2)" }}>{q}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {schema.events.map((ev) => (
          <div className="card" key={ev.name}>
            <div className="card-head">
              <h2 className="mono" style={{ textTransform: "none", letterSpacing: 0, color: "var(--data)" }}>
                {ev.name}
              </h2>
              <span className="tag mono num">{ev.count.toLocaleString()}</span>
            </div>
            <div className="card-body flush">
              {ev.properties.length === 0 ? (
                <div className="empty">No properties.</div>
              ) : (
                <table>
                  <thead>
                    <tr><th>Property</th><th>Type</th><th className="r">Distinct</th><th>Values</th></tr>
                  </thead>
                  <tbody>
                    {ev.properties.map((p) => (
                      <tr key={p.key}>
                        <td className="mono">{p.key}</td>
                        <td><span className="tag">{p.type}</span></td>
                        <td className="r num">{p.distinctCount}</td>
                        <td className="mono" style={{ color: "var(--text-3)", fontSize: 11 }}>
                          {p.sampleValues.slice(0, 6).join("  ")}
                          {p.distinctCount > 6 ? "  …" : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function findQualityIssues(schema: {
  events: { name: string; count: number; properties: { key: string; distinctCount: number }[] }[];
  totalUsers: number;
}): string[] {
  const issues: string[] = [];
  if (schema.totalUsers < 30) {
    issues.push(
      `Only ${schema.totalUsers} users tracked. Most comparisons stay statistically meaningless until 30+; the agent is instructed to report that rather than dress noise up as a finding.`,
    );
  }
  for (const ev of schema.events) {
    if (ev.count < 5) issues.push(`"${ev.name}" fired ${ev.count} times — too rare to analyse.`);
    for (const p of ev.properties) {
      if (p.distinctCount === 1) {
        issues.push(`"${ev.name}.${p.key}" has one value only — it cannot segment anything.`);
      }
    }
  }
  return issues.slice(0, 8);
}
