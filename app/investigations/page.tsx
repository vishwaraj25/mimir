import { mimirDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function InvestigationsPage() {
  let rows: any[] = [];
  let error: string | null = null;
  try {
    const r = await mimirDb().query(
      `SELECT id, question, status, trigger, headline, confidence, started_at
       FROM investigations ORDER BY started_at DESC LIMIT 50`,
    );
    rows = r.rows;
  } catch (err) {
    error = (err as Error).message;
  }

  return (
    <>
      <div className="page-head">
        <h1>Investigations</h1>
        <p>Every question the agent has worked through, and how it concluded. Ones marked
           &ldquo;monitor&rdquo; it started by itself after spotting something in the daily check.</p>
      </div>

      {error && <div className="panel"><div className="mono" style={{ color: "var(--bad)" }}>{error}</div></div>}

      <div className="panel">
        {rows.length === 0 && !error ? (
          <div className="empty">Nothing yet. Ask a question on the Ask Analyst page.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Question</th><th>Finding</th><th>Started</th><th>Trigger</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><a href={`/investigations/${r.id}`} style={{ color: "var(--accent)" }}>{r.question}</a></td>
                  <td style={{ color: "var(--muted)" }}>{r.headline ?? "—"}</td>
                  <td className="mono" style={{ color: "var(--muted-2)" }}>
                    {new Date(r.started_at).toISOString().slice(5, 16).replace("T", " ")}
                  </td>
                  <td><span className="badge">{r.trigger}</span></td>
                  <td>
                    <span className={`badge ${r.status === "complete" ? "good" : r.status === "failed" ? "bad" : "warn"}`}>
                      {r.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
