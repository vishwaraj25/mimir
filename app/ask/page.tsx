"use client";

import { useEffect, useState } from "react";
import { Trace, type TraceStep } from "../investigations/trace";

/**
 * Ask.
 *
 * Not a chat window. You ask once, the agent runs a real investigation, and
 * the trace streams in underneath as it works -- the waiting time is the
 * product demo, not dead time behind a spinner. A chat UI would invite the
 * model to opine; this one makes it go and check.
 */

const EXAMPLES = [
  "Completion dropped recently. Find out why.",
  "Where do players give up, and what happens just before?",
  "Do players who pick up the laser get further than players who don't?",
  "Is the shield mechanic actually used, or is it dead weight?",
];

export default function AskPage() {
  const [question, setQuestion] = useState("");
  const [accessKey, setAccessKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveId, setLiveId] = useState<number | null>(null);
  const [steps, setSteps] = useState<TraceStep[]>([]);

  useEffect(() => {
    try {
      const k = localStorage.getItem("mimir_key");
      if (k) setAccessKey(k);
    } catch {}
  }, []);

  // Poll the trail while it runs, so the agent's work is visible live.
  useEffect(() => {
    if (!busy || liveId == null) return;
    const t = setInterval(async () => {
      try {
        const r = await fetch(`/api/investigations/${liveId}`, {
          headers: { "x-mimir-key": accessKey },
        });
        if (r.ok) {
          const d = await r.json();
          setSteps(d.steps ?? []);
        }
      } catch {}
    }, 1200);
    return () => clearInterval(t);
  }, [busy, liveId, accessKey]);

  async function run() {
    if (!question.trim()) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setSteps([]);
    try {
      localStorage.setItem("mimir_key", accessKey);
    } catch {}

    try {
      const started = await fetch("/api/investigate", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-mimir-key": accessKey },
        body: JSON.stringify({ question }),
      });
      const data = await started.json();
      if (!started.ok) throw new Error(data.error ?? "failed");
      setResult(data);
      setLiveId(data.investigationId);

      const trail = await fetch(`/api/investigations/${data.investigationId}`, {
        headers: { "x-mimir-key": accessKey },
      });
      if (trail.ok) setSteps((await trail.json()).steps ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="head">
        <div>
          <h1>Ask</h1>
          <p>
            The agent reads the schema, runs its own queries, checks whether the sample supports
            a conclusion, and reports back with every step it took.
          </p>
        </div>
      </header>

      <div className="body">
        <div className="panel">
          <div className="panel-body">
            <textarea
              className="field"
              rows={2}
              placeholder="e.g. Completion dropped recently. Find out why."
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run();
              }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
              <input
                className="field mono"
                style={{ width: 180 }}
                type="password"
                placeholder="access key"
                value={accessKey}
                onChange={(e) => setAccessKey(e.target.value)}
              />
              <button className="btn" onClick={run} disabled={busy || !question.trim()}>
                {busy ? "Investigating…" : "Investigate"}
              </button>
              <span style={{ color: "var(--text-3)", fontSize: 11.5 }}>⌘↵</span>
              {busy && (
                <span className="tag agent live">agent running · {steps.length} steps</span>
              )}
            </div>
          </div>
        </div>

        {!result && !busy && steps.length === 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
            {EXAMPLES.map((ex) => (
              <button key={ex} className="chip" onClick={() => setQuestion(ex)}>
                {ex}
              </button>
            ))}
          </div>
        )}

        {error && (
          <div className="panel">
            <div className="panel-body">
              <span className="tag err">{error}</span>
            </div>
          </div>
        )}

        {result && (
          <div className="panel">
            <div className="panel-head">
              <h2>Verdict</h2>
              <div style={{ display: "flex", gap: 6 }}>
                <span className={`tag ${result.confidence === "insufficient_data" ? "warn" : "ok"}`}>
                  {result.confidence}
                </span>
                <span className="tag mono">{result.modelLabel}</span>
              </div>
            </div>
            <div className="panel-body">
              <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 6 }}>{result.headline}</div>
              <div className="prose">{result.summary}</div>
              {result.hypothesis && (
                <>
                  <div className="lbl" style={{ marginTop: 14, fontSize: 9.5, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-3)" }}>
                    Hypothesis
                  </div>
                  <div className="prose">{result.hypothesis}</div>
                </>
              )}
              <a className="btn sec" style={{ display: "inline-block", marginTop: 12 }}
                 href={`/investigations/${result.investigationId}`}>
                Open full investigation
              </a>
            </div>
          </div>
        )}

        {result?.experiment && (
          <div className="panel">
            <div className="panel-head"><h2>Proposed experiment</h2></div>
            <div className="panel-body flush">
              <table>
                <tbody>
                  <tr><td style={{ width: 150, color: "var(--text-3)" }}>Title</td><td>{result.experiment.title}</td></tr>
                  <tr><td style={{ color: "var(--text-3)" }}>Hypothesis</td><td>{result.experiment.hypothesis}</td></tr>
                  <tr><td style={{ color: "var(--text-3)" }}>Change</td><td>{result.experiment.change_described}</td></tr>
                  <tr><td style={{ color: "var(--text-3)" }}>Primary metric</td><td className="mono">{result.experiment.primary_metric}</td></tr>
                  <tr><td style={{ color: "var(--text-3)" }}>Guardrails</td><td className="mono">
                    {(result.experiment.guardrail_metrics ?? []).join(", ") || "—"}
                  </td></tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {(steps.length > 0 || busy) && (
          <div className="panel">
            <div className="panel-head">
              <h2>Agent trace</h2>
              <span className="tag mono">{steps.filter((s) => s.kind === "tool_call").length} tool calls</span>
            </div>
            <div className="panel-body flush">
              {steps.length === 0 ? (
                <div className="empty live">Starting…</div>
              ) : (
                <Trace steps={steps} />
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
