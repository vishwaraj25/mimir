import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function InvestigationsPage() {
  const rows = await store().listInvestigations(50);

  return (
    <>
      <header className="head">
        <div>
          <h1>Investigations</h1>
          <p>
            Every question worked through, and how it concluded. Ones tagged{" "}
            <span className="tag">monitor</span> the agent started by itself after the daily check
            flagged something.
          </p>
        </div>
      </header>

      <div className="body">
        <div className="card">
          <div className="card-body flush">
            {rows.length === 0 ? (
              <div className="empty">Nothing yet — ask a question on the Ask page.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Question</th><th>Finding</th><th>Confidence</th>
                    <th>Trigger</th><th>Started</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td><a href={`/investigations/${r.id}`} style={{ color: "var(--agent)" }}>{r.question}</a></td>
                      <td style={{ color: "var(--text-2)" }}>{r.headline ?? "—"}</td>
                      <td>{r.confidence ? <span className={`tag ${r.confidence === "insufficient_data" ? "warn" : ""}`}>{r.confidence}</span> : "—"}</td>
                      <td><span className="tag">{r.trigger}</span></td>
                      <td className="mono" style={{ color: "var(--text-3)", fontSize: 11 }}>
                        {new Date(r.started_at).toISOString().slice(5, 16).replace("T", " ")}
                      </td>
                      <td>
                        <span className={`tag ${r.status === "complete" ? "ok" : r.status === "failed" ? "err" : "warn"}`}>
                          {r.status}
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
