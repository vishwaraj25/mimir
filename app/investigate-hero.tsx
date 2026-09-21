"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MimirHead } from "./components/mimir-head";
import { Trace, type TraceStep } from "./investigations/trace";

/**
 * The unified intelligence bar.
 *
 * Folded into the Overview page rather than living on its own empty tab --
 * there is no reason "the thing you ask Mimir" should be a separate
 * destination from "the product Mimir is analysing". The Mimir head's eyes
 * light up for exactly as long as a real investigation is running: not a
 * decorative loop, the literal `busy` state below.
 */

const EXAMPLES = [
  "Why did completion drop?",
  "Where do players give up?",
  "Is the shield mechanic used?",
];

export function InvestigateHero() {
  const [question, setQuestion] = useState("");
  const [accessKey, setAccessKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<TraceStep[]>([]);
  const [liveId, setLiveId] = useState<number | null>(null);
  const router = useRouter();

  useEffect(() => {
    try {
      setAccessKey(localStorage.getItem("mimir_key") ?? "");
    } catch {}
  }, []);

  /**
   * Poll the trail while the agent works.
   *
   * `liveId` is state rather than a ref precisely so this effect re-runs the
   * moment the id arrives -- a ref would update silently and the polling
   * would never start, which is exactly the bug this replaced.
   */
  useEffect(() => {
    if (liveId == null) return;
    let stop = false;

    const tick = async () => {
      try {
        const r = await fetch(`/api/investigations/${liveId}`, {
          headers: { "x-mimir-key": accessKey },
        });
        if (!r.ok) return;
        const data = await r.json();
        if (stop) return;
        setSteps(data.steps ?? []);

        const inv = data.investigation;
        if (inv?.status === "complete" || inv?.status === "failed") {
          stop = true;
          setBusy(false);
          if (inv.status === "failed") {
            setError(inv.error ?? "The investigation failed.");
          } else {
            // The conclusion step carries the full structured verdict,
            // including any proposed experiment; the row carries the prose.
            const conclusion = (data.steps ?? []).find(
              (s: TraceStep) => s.kind === "conclusion",
            );
            const verdict = (conclusion?.result ?? {}) as any;
            setResult({
              investigationId: liveId,
              headline: inv.headline,
              summary: inv.summary,
              hypothesis: inv.hypothesis,
              confidence: inv.confidence,
              modelLabel: inv.model_label,
              experiment: verdict.experiment ?? null,
            });
          }
          router.refresh();
        }
      } catch {
        // A single failed poll is not worth surfacing; the next one retries.
      }
    };

    void tick();
    const t = setInterval(tick, 1200);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [liveId, accessKey, router]);

  async function run(q?: string) {
    const text = (q ?? question).trim();
    if (!text) return;
    setQuestion(text);
    setBusy(true);
    setError(null);
    setResult(null);
    setSteps([]);
    setLiveId(null);

    try {
      const started = await fetch("/api/investigate", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-mimir-key": accessKey },
        body: JSON.stringify({ question: text }),
      });
      const data = await started.json();
      if (!started.ok) throw new Error(readableError(data.error));
      // Returns immediately with just the id; the effect above takes over.
      setLiveId(data.investigationId);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <div className="hero">
        <div className="hero-avatar">
          <MimirHead active={busy} size={30} />
        </div>
        <div className="hero-body">
          <div className="hero-title">
            {busy ? "Investigating…" : "Ask Mimir about player behaviour"}
          </div>
          <div className="hero-input-row">
            <input
              className="hero-input"
              placeholder="e.g. Why did boss completion drop this week?"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && run()}
              disabled={busy}
            />
            <button className="btn" onClick={() => run()} disabled={busy || !question.trim()}>
              {busy ? "Working…" : "Investigate"}
            </button>
          </div>
          {!busy && !result && (
            <div className="hero-examples">
              {EXAMPLES.map((ex) => (
                <button key={ex} className="chip" onClick={() => run(ex)}>
                  {ex}
                </button>
              ))}
            </div>
          )}
          {error && <div style={{ marginTop: 10 }}><span className="tag err">{error}</span></div>}
        </div>
      </div>

      {(busy || result) && (
        <div className="card">
          <div className="card-head">
            <h2>{result ? "Verdict" : "Working"}</h2>
            <div style={{ display: "flex", gap: 6 }}>
              {result && (
                <span className={`tag ${result.confidence === "insufficient_data" ? "warn" : "ok"}`}>
                  {result.confidence}
                </span>
              )}
              <span className="tag mono">{steps.filter((s: TraceStep) => s.kind === "tool_call").length} tool calls</span>
            </div>
          </div>
          <div className="card-body">
            {result && (
              <>
                <div style={{ fontSize: 14.5, fontWeight: 650, marginBottom: 6 }}>{result.headline}</div>
                <div className="prose">{result.summary}</div>
                {result.hypothesis && (
                  <>
                    <div style={{ fontSize: 10, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-3)", marginTop: 14, marginBottom: 3, fontWeight: 650 }}>
                      Hypothesis
                    </div>
                    <div className="prose">{result.hypothesis}</div>
                  </>
                )}
                {result.investigationId != null && (
                  <a className="btn sec" style={{ display: "inline-block", marginTop: 12 }} href={`/investigations/${result.investigationId}`}>
                    Open full investigation
                  </a>
                )}
              </>
            )}
          </div>
          <Trace steps={steps} />
          {steps.length === 0 && busy && <div className="empty live">Starting…</div>}
        </div>
      )}

      {result?.experiment && (
        <div className="card">
          <div className="card-head"><h2>Proposed experiment</h2></div>
          <div className="card-body flush">
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
    </>
  );
}

function readableError(code: string): string {
  if (code === "mimir_access_key_not_set") return "Server has no MIMIR_ACCESS_KEY set.";
  if (code === "unauthorized") return "Wrong access key — set it on the Settings page.";
  if (code === "investigation_failed") return "The investigation failed. Check the model key on Settings.";
  return code ?? "Something went wrong.";
}
