import { defaultSource, listSources } from "@/lib/connectors/registry";

export const dynamic = "force-dynamic";

/**
 * Data & Events.
 *
 * This is the same view of the schema the agent gets before it reasons --
 * shown to you so you can see exactly what it can and cannot know. If a
 * property isn't listed here, no investigation can use it, and the honest
 * answer to a question that depends on it is "that isn't tracked yet".
 */
export default async function DataPage() {
  let source, schema, health;
  try {
    source = defaultSource();
    [schema, health] = await Promise.all([
      source.describeSchema(),
      source.healthCheck(),
    ]);
  } catch (err) {
    return (
      <>
        <div className="page-head">
          <h1>Data &amp; Events</h1>
          <p>No source connected.</p>
        </div>
        <div className="panel">
          <div className="mono" style={{ color: "var(--bad)" }}>{(err as Error).message}</div>
        </div>
      </>
    );
  }

  const quality = findQualityIssues(schema);

  return (
    <>
      <div className="page-head">
        <h1>Data &amp; Events</h1>
        <p>
          The schema as the agent sees it. {schema.events.length} event types,{" "}
          {schema.totalEvents.toLocaleString()} events, {schema.totalUsers.toLocaleString()} users.
        </p>
      </div>

      <div className="panel">
        <h2>Connected sources</h2>
        <table>
          <thead><tr><th>Source</th><th>Id</th><th>Status</th><th>Window</th></tr></thead>
          <tbody>
            {listSources().map((s) => (
              <tr key={s.id}>
                <td>{s.displayName}</td>
                <td className="mono">{s.id}</td>
                <td>
                  <span className={`badge ${health.ok ? "good" : "bad"}`}>
                    {health.ok ? "connected" : "error"}
                  </span>
                </td>
                <td className="mono" style={{ color: "var(--muted-2)" }}>
                  {schema.firstEventAt ? new Date(schema.firstEventAt).toISOString().slice(0, 10) : "—"}
                  {" → "}
                  {schema.lastEventAt ? new Date(schema.lastEventAt).toISOString().slice(0, 10) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {quality.length > 0 && (
        <div className="panel">
          <h2>Data quality</h2>
          {quality.map((q, i) => (
            <div key={i} style={{ padding: "6px 0", color: "var(--muted)" }}>
              <span className="badge warn" style={{ marginRight: 8 }}>check</span>
              {q}
            </div>
          ))}
        </div>
      )}

      {schema.events.map((ev) => (
        <div className="panel" key={ev.name}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <div className="mono" style={{ fontSize: 14, color: "var(--accent)" }}>{ev.name}</div>
            <div className="mono" style={{ color: "var(--muted-2)" }}>{ev.count.toLocaleString()} events</div>
          </div>
          {ev.properties.length === 0 ? (
            <div className="empty">No properties — fires on its own.</div>
          ) : (
            <table>
              <thead><tr><th>Property</th><th>Type</th><th className="num">Distinct</th><th>Values seen</th></tr></thead>
              <tbody>
                {ev.properties.map((p) => (
                  <tr key={p.key}>
                    <td className="mono">{p.key}</td>
                    <td><span className="badge">{p.type}</span></td>
                    <td className="num">{p.distinctCount}</td>
                    <td className="mono" style={{ color: "var(--muted)" }}>
                      {p.sampleValues.slice(0, 6).join(", ")}
                      {p.distinctCount > 6 ? " …" : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </>
  );
}

/** Cheap structural checks — the things that quietly ruin an analysis. */
function findQualityIssues(schema: {
  events: { name: string; count: number; properties: { key: string; distinctCount: number }[] }[];
  totalUsers: number;
}): string[] {
  const issues: string[] = [];

  if (schema.totalUsers < 30) {
    issues.push(
      `Only ${schema.totalUsers} users tracked so far. Most comparisons will be statistically meaningless until this is 30+, and the agent is instructed to say so rather than report noise as a finding.`,
    );
  }
  for (const ev of schema.events) {
    if (ev.count < 5) {
      issues.push(`"${ev.name}" has fired only ${ev.count} times — too rare to analyse.`);
    }
    for (const p of ev.properties) {
      if (p.distinctCount === 1) {
        issues.push(
          `"${ev.name}.${p.key}" only ever has one value — it can't segment anything, so it may be worth dropping or enriching.`,
        );
      }
    }
  }
  return issues.slice(0, 8);
}
