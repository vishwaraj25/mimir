"use client";

import { useState } from "react";

/**
 * Ask Analyst.
 *
 * Deliberately not a chat window. You ask one question, the agent runs a
 * real investigation, and you get a verdict plus a link to the full trail of
 * how it got there. A chat transcript invites the model to opine; an
 * investigation makes it go and check.
 */

const EXAMPLES = [
  "Boss completion dropped recently. Find out why.",
  "Where in the level do players give up, and what happens just before?",
  "Do players who pick up the laser get further than players who don't?",
  "Is the shield mechanic actually being used, or is it dead weight?",
  "Which weapon is picked up least, and is that a discovery problem or a preference?",
];

export default function AskPage() {
  const [question, setQuestion] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!question.trim()) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/investigate", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-mimir-key": key },
        body: JSON.stringify({ question }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "failed");
      setResult(data);
      try { localStorage.setItem("mimir_key", key); } catch {}
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>Ask Analyst</h1>
        <p>
          Ask a question about user behaviour. The agent reads the event schema, runs its own
          queries, checks whether the sample is big enough to mean anything, and reports back with
          the trail of how it got there.
        </p>
      </div>

      <div className="panel">
        <textarea
          className="input"
          rows={3}
          placeholder="e.g. Boss completion dropped last week. Find out why."
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
          <input
            className="input"
            style={{ width: 200 }}
            type="password"
            placeholder="Access key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <button className="btn" onClick={run} disabled={busy || !question.trim()}>
            {busy ? "Investigating…" : "Investigate"}
          </button>
          {busy && (
            <span style={{ color: "var(--muted)", fontSize: 13 }}>
              Running tool calls against your telemetry. This takes 30–90 seconds.
            </span>
          )}
        </div>
      </div>

      {!result && !busy && (
        <div className="panel">
          <h2>Try one of these</h2>
          {EXAMPLES.map((ex) => (
            <div
              key={ex}
              onClick={() => setQuestion(ex)}
              style={{ padding: "8px 0", borderBottom: "1px solid var(--border)", cursor: "pointer", color: "var(--muted)" }}
            >
              {ex}
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="panel">
          <div className="mono" style={{ color: "var(--bad)" }}>{error}</div>
        </div>
      )}

      {result && (
        <>
          <div className="panel">
            <h2>
              Verdict{" "}
              <span className={`badge ${result.confidence === "insufficient_data" ? "warn" : "accent"}`}>
                {result.confidence}
              </span>
            </h2>
            <div style={{ fontSize: 16, fontWeight: 650, marginBottom: 8 }}>{result.headline}</div>
            <p style={{ color: "var(--muted)" }}>{result.summary}</p>
            {result.hypothesis && (
              <>
                <h2 style={{ marginTop: 18 }}>Hypothesis</h2>
                <p style={{ color: "var(--muted)" }}>{result.hypothesis}</p>
              </>
            )}
            <a className="btn ghost" style={{ display: "inline-block", marginTop: 10 }}
               href={`/investigations/${result.investigationId}`}>
              See the full reasoning trail →
            </a>
          </div>

          {result.experiment && (
            <div className="panel">
              <h2>Suggested experiment</h2>
              <div style={{ fontWeight: 650, marginBottom: 6 }}>{result.experiment.title}</div>
              <p style={{ color: "var(--muted)", marginBottom: 12 }}>{result.experiment.hypothesis}</p>
              <table>
                <tbody>
                  <tr><th>Change</th><td>{result.experiment.change_described}</td></tr>
                  <tr><th>Primary metric</th><td className="mono">{result.experiment.primary_metric}</td></tr>
                  <tr>
                    <th>Guardrails</th>
                    <td className="mono">
                      {(result.experiment.guardrail_metrics ?? []).join(", ") || "none specified"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
