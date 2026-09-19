import { mimirDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ExperimentsPage() {
  let rows: any[] = [];
  let error: string | null = null;
  try {
    const r = await mimirDb().query(
      `SELECT * FROM experiments ORDER BY created_at DESC LIMIT 50`,
    );
    rows = r.rows;
  } catch (err) { error = (err as Error).message; }

  return (
    <>
      <div className="page-head">
        <h1>Experiments</h1>
        <p>Changes the agent proposed at the end of an investigation, each with the one metric
           that decides it and the guardrails that say when to stop. You move the status.</p>
      </div>
      {error && <div className="panel"><div className="mono" style={{ color: "var(--bad)" }}>{error}</div></div>}
      {rows.length === 0 && !error ? (
        <div className="panel"><div className="empty">No experiments proposed yet.</div></div>
      ) : rows.map((r) => (
        <div className="panel" key={r.id}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
            <div style={{ fontSize: 15, fontWeight: 650 }}>{r.title}</div>
            <span className={`badge ${r.status === "shipped" ? "good" : r.status === "rejected" ? "bad" : "accent"}`}>
              {r.status}
            </span>
          </div>
          <p style={{ color: "var(--muted)" }}>{r.hypothesis}</p>
          <table>
            <tbody>
              <tr><th>Change</th><td>{r.change_described}</td></tr>
              <tr><th>Primary metric</th><td className="mono">{r.primary_metric}</td></tr>
              <tr><th>Guardrails</th><td className="mono">
                {Array.isArray(r.guardrail_metrics) && r.guardrail_metrics.length
                  ? r.guardrail_metrics.join(", ") : "none specified"}
              </td></tr>
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}
