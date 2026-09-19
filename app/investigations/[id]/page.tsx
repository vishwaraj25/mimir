import { mimirDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * The reasoning trail.
 *
 * This page is the reason Mimir stores steps at all. A finding you cannot
 * audit is a finding you have to take on faith, and an analyst you cannot
 * question is worse than a spreadsheet. Every tool call, its arguments, and
 * the raw result it returned are shown in order.
 */
export default async function InvestigationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let inv: any = null;
  let steps: any[] = [];
  let error: string | null = null;

  try {
    const db = mimirDb();
    const [a, b] = await Promise.all([
      db.query(`SELECT * FROM investigations WHERE id = $1`, [id]),
      db.query(
        `SELECT * FROM investigation_steps WHERE investigation_id = $1 ORDER BY step_index ASC`,
        [id],
      ),
    ]);
    inv = a.rows[0] ?? null;
    steps = b.rows;
  } catch (err) {
    error = (err as Error).message;
  }

  if (error) {
    return (
      <div className="panel">
        <div className="mono" style={{ color: "var(--bad)" }}>{error}</div>
      </div>
    );
  }
  if (!inv) {
    return (
      <div className="page-head">
        <h1>Not found</h1>
        <p>No investigation with that id.</p>
      </div>
    );
  }

  const toolCalls = steps.filter((s) => s.kind === "tool_call").length;

  return (
    <>
      <div className="page-head">
        <a href="/investigations" style={{ color: "var(--muted)", fontSize: 13 }}>← Investigations</a>
        <h1 style={{ marginTop: 8 }}>{inv.question}</h1>
        <p>
          {toolCalls} tool calls ·{" "}
          <span className={`badge ${inv.status === "complete" ? "good" : inv.status === "failed" ? "bad" : "warn"}`}>
            {inv.status}
          </span>{" "}
          {inv.confidence && <span className="badge accent">{inv.confidence}</span>}
        </p>
      </div>

      {inv.headline && (
        <div className="panel">
          <h2>Verdict</h2>
          <div style={{ fontSize: 16, fontWeight: 650, marginBottom: 8 }}>{inv.headline}</div>
          <p style={{ color: "var(--muted)" }}>{inv.summary}</p>
          {inv.hypothesis && (
            <>
              <h2 style={{ marginTop: 16 }}>Hypothesis</h2>
              <p style={{ color: "var(--muted)" }}>{inv.hypothesis}</p>
            </>
          )}
        </div>
      )}

      {inv.error && (
        <div className="panel">
          <h2>Failed</h2>
          <div className="mono" style={{ color: "var(--bad)" }}>{inv.error}</div>
        </div>
      )}

      <div className="panel">
        <h2>Reasoning trail</h2>
        {steps.map((s) => (
          <div className={`step ${s.kind}`} key={s.id}>
            <div className="kind">
              {s.kind.replace("_", " ")}
              {s.tool_name ? ` · ${s.tool_name}` : ""}
            </div>
            {s.content && <div style={{ color: "var(--muted)", marginTop: 4 }}>{s.content}</div>}
            {s.tool_input && (
              <pre>{JSON.stringify(s.tool_input, null, 2)}</pre>
            )}
            {s.result && s.kind === "tool_result" && (
              <pre>{truncate(JSON.stringify(s.result, null, 2), 2200)}</pre>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}\n… ${s.length - n} more characters`;
}
