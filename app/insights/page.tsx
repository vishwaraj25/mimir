import { mimirDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function InsightsPage() {
  let rows: any[] = [];
  let error: string | null = null;
  try {
    const r = await mimirDb().query(
      `SELECT i.*, inv.question FROM insights i
       LEFT JOIN investigations inv ON inv.id = i.investigation_id
       WHERE i.active ORDER BY
         CASE i.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
         i.created_at DESC
       LIMIT 60`,
    );
    rows = r.rows;
  } catch (err) { error = (err as Error).message; }

  return (
    <>
      <div className="page-head">
        <h1>Insights</h1>
        <p>What the agent currently believes about this product. Each one links back to the
           investigation that produced it, so nothing here is unsourced.</p>
      </div>
      {error && <div className="panel"><div className="mono" style={{ color: "var(--bad)" }}>{error}</div></div>}
      {rows.length === 0 && !error ? (
        <div className="panel"><div className="empty">No insights yet. They accumulate as investigations run.</div></div>
      ) : rows.map((r) => (
        <div className="panel" key={r.id}>
          <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span className={`badge ${r.severity === "critical" ? "bad" : r.severity === "warning" ? "warn" : ""}`}>
              {r.severity}
            </span>
            <span className="badge">{r.kind}</span>
            {r.sample_size != null && <span className="badge">n={r.sample_size}</span>}
          </div>
          <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 6 }}>{r.headline}</div>
          <p style={{ color: "var(--muted)", margin: 0 }}>{r.detail}</p>
          {r.metric_before != null && r.metric_after != null && (
            <div className="mono" style={{ marginTop: 10, color: "var(--muted-2)" }}>
              {r.metric_before} → {r.metric_after}
            </div>
          )}
          {r.investigation_id && (
            <a href={`/investigations/${r.investigation_id}`} style={{ color: "var(--accent)", fontSize: 13, display: "inline-block", marginTop: 10 }}>
              How this was found →
            </a>
          )}
        </div>
      ))}
    </>
  );
}
