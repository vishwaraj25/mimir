import { store } from "@/lib/store";
import { requirePageAccess } from "@/lib/page-auth";

export const dynamic = "force-dynamic";

export default async function ExperimentsPage() {
  await requirePageAccess();
  const rows = await store().listExperiments(50);

  return (
    <>
      <header className="head">
        <div>
          <h1>Experiments</h1>
          <p>Changes proposed at the end of an investigation, each with the metric that decides it
             and the guardrails that say when to stop.</p>
        </div>
      </header>

      <div className="body">
        {rows.length === 0 ? (
          <div className="card"><div className="empty">Nothing proposed yet.</div></div>
        ) : rows.map((r) => (
          <div className="card" key={r.id}>
            <div className="card-head">
              <h2>{r.title}</h2>
              <span className={`tag ${r.status === "shipped" ? "ok" : r.status === "rejected" ? "err" : "agent"}`}>
                {r.status}
              </span>
            </div>
            <div className="card-body flush">
              <table>
                <tbody>
                  <tr><td style={{ width: 150, color: "var(--text-3)" }}>Hypothesis</td><td>{r.hypothesis}</td></tr>
                  <tr><td style={{ color: "var(--text-3)" }}>Change</td><td>{r.change_described}</td></tr>
                  <tr><td style={{ color: "var(--text-3)" }}>Primary metric</td><td className="mono" style={{ color: "var(--data)" }}>{r.primary_metric}</td></tr>
                  <tr><td style={{ color: "var(--text-3)" }}>Guardrails</td><td className="mono">
                    {Array.isArray(r.guardrail_metrics) && r.guardrail_metrics.length ? r.guardrail_metrics.join(", ") : "—"}
                  </td></tr>
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
