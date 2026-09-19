import { store } from "@/lib/store";
import { Trace } from "../trace";

export const dynamic = "force-dynamic";

export default async function InvestigationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { investigation: inv, steps } = await store().getInvestigation(Number(id));

  if (!inv) {
    return (
      <header className="head">
        <div>
          <h1>Not found</h1>
          <p>No investigation with that id. In-memory storage resets on restart.</p>
        </div>
      </header>
    );
  }

  const toolCalls = steps.filter((s) => s.kind === "tool_call").length;
  const totalMs = steps.reduce((sum, s) => sum + (s.duration_ms ?? 0), 0);

  return (
    <>
      <header className="head">
        <div>
          <a href="/investigations" style={{ color: "var(--text-3)", fontSize: 11.5 }}>
            ← Investigations
          </a>
          <h1 style={{ marginTop: 6 }}>{inv.question}</h1>
          <p>
            {toolCalls} tool calls · {(totalMs / 1000).toFixed(1)}s total ·{" "}
            {inv.model_label ?? "unknown model"}
          </p>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {inv.confidence && (
            <span className={`tag ${inv.confidence === "insufficient_data" ? "warn" : "ok"}`}>
              {inv.confidence}
            </span>
          )}
          <span className={`tag ${inv.status === "complete" ? "ok" : inv.status === "failed" ? "err" : "warn"}`}>
            {inv.status}
          </span>
        </div>
      </header>

      <div className="body">
        {inv.headline && (
          <div className="card">
            <div className="card-head"><h2>Verdict</h2></div>
            <div className="card-body">
              <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 6 }}>{inv.headline}</div>
              <div className="prose">{inv.summary}</div>
              {inv.hypothesis && (
                <>
                  <div style={{ fontSize: 9.5, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-3)", marginTop: 14, marginBottom: 3 }}>
                    Hypothesis
                  </div>
                  <div className="prose">{inv.hypothesis}</div>
                </>
              )}
            </div>
          </div>
        )}

        {inv.error && (
          <div className="card">
            <div className="card-head"><h2>Failed</h2></div>
            <div className="card-body">
              <span className="tag err">{inv.error}</span>
            </div>
          </div>
        )}

        <div className="card">
          <div className="card-head">
            <h2>Agent trace</h2>
            <span className="tag mono">{steps.length} steps · click any row</span>
          </div>
          <div className="card-body flush">
            <Trace steps={steps} />
          </div>
        </div>
      </div>
    </>
  );
}
