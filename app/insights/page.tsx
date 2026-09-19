import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function InsightsPage() {
  const rows = await store().listInsights(60);

  return (
    <>
      <header className="head">
        <div>
          <h1>Insights</h1>
          <p>What the agent currently believes, each linked to the investigation that produced it.
             Nothing here is unsourced.</p>
        </div>
      </header>

      <div className="body">
        {rows.length === 0 ? (
          <div className="panel"><div className="empty">No insights yet. They accumulate as investigations run.</div></div>
        ) : rows.map((r) => (
          <div className="panel" key={r.id}>
            <div className="panel-head">
              <h2>{r.kind.replace("_", " ")}</h2>
              <div style={{ display: "flex", gap: 6 }}>
                {r.sample_size != null && <span className="tag mono">n={r.sample_size}</span>}
                <span className={`tag ${r.severity === "critical" ? "err" : r.severity === "warning" ? "warn" : ""}`}>
                  {r.severity}
                </span>
              </div>
            </div>
            <div className="panel-body">
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 5 }}>{r.headline}</div>
              <div className="prose">{r.detail}</div>
              <div style={{ display: "flex", gap: 14, marginTop: 12, alignItems: "center" }}>
                {r.metric_before != null && r.metric_after != null && (
                  <span className="mono num" style={{ fontSize: 12, color: "var(--data)" }}>
                    {r.metric_before} → {r.metric_after}
                  </span>
                )}
                {r.investigation_id && (
                  <a href={`/investigations/${r.investigation_id}`} style={{ color: "var(--agent)", fontSize: 11.5 }}>
                    how this was found →
                  </a>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
