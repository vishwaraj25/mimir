"use client";

import { useState } from "react";

/**
 * The trace viewer.
 *
 * Modelled on APM/LLM trace tooling rather than on a chat transcript: one
 * row per step, collapsed by default, with a latency bar so the expensive
 * steps are visible at a glance and the shape of the investigation reads
 * without opening anything.
 *
 * Rows are the agent's actual work -- which tool it chose, the arguments it
 * chose, and the raw data that came back. Everything the verdict rests on is
 * one click away, which is the difference between an analyst you can
 * question and a black box you have to believe.
 */

export interface TraceStep {
  id: number;
  step_index: number;
  kind: string;
  tool_name: string | null;
  tool_input: unknown;
  content: string | null;
  result: unknown;
  duration_ms: number | null;
}

const GLYPH: Record<string, { mark: string; cls: string }> = {
  thought: { mark: "◇", cls: "" },
  tool_call: { mark: "▸", cls: "agent" },
  tool_result: { mark: "▪", cls: "data" },
  conclusion: { mark: "◆", cls: "ok" },
};

export function Trace({ steps }: { steps: TraceStep[] }) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const maxMs = Math.max(1, ...steps.map((s) => s.duration_ms ?? 0));

  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  if (steps.length === 0) {
    return <div className="empty">No steps recorded.</div>;
  }

  return (
    <div className="trace">
      {steps.map((s) => {
        const g = GLYPH[s.kind] ?? { mark: "·", cls: "" };
        const isOpen = open.has(s.id);
        const summary = summarise(s);

        return (
          <div key={s.id}>
            <div className="trace-row" onClick={() => toggle(s.id)}>
              <span className="idx mono">{String(s.step_index).padStart(2, "0")}</span>
              <span
                className="glyph"
                style={{
                  color:
                    g.cls === "agent"
                      ? "var(--agent)"
                      : g.cls === "data"
                        ? "var(--data)"
                        : g.cls === "ok"
                          ? "var(--ok)"
                          : "var(--text-3)",
                }}
              >
                {g.mark}
              </span>
              <span className="name">
                <b className={s.tool_name ? "mono" : undefined}>
                  {s.tool_name ?? s.kind.replace("_", " ")}
                </b>
                <span>{summary}</span>
              </span>
              <span className="lat">
                <i style={{ width: `${((s.duration_ms ?? 0) / maxMs) * 100}%` }} />
              </span>
              <span className="ms mono">
                {s.duration_ms != null ? `${s.duration_ms}ms` : ""}
              </span>
            </div>

            {isOpen && (
              <div className="trace-detail">
                {s.content && (
                  <>
                    <div className="lbl">
                      {s.kind === "conclusion" ? "Conclusion" : "Reasoning"}
                    </div>
                    <div className="prose">{s.content}</div>
                  </>
                )}
                {s.tool_input != null && (
                  <>
                    <div className="lbl">Arguments</div>
                    <pre className="code mono">{JSON.stringify(s.tool_input, null, 2)}</pre>
                  </>
                )}
                {s.result != null && (
                  <>
                    <div className="lbl">
                      {s.kind === "conclusion" ? "Structured verdict" : "Returned data"}
                    </div>
                    <pre className="code mono">{trim(JSON.stringify(s.result, null, 2))}</pre>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** A one-line gist of the step, so the collapsed trace is still readable. */
function summarise(s: TraceStep): string {
  if (s.kind === "tool_call" && s.tool_input && typeof s.tool_input === "object") {
    const parts = Object.entries(s.tool_input as Record<string, unknown>)
      .filter(([, v]) => v !== undefined && v !== null)
      .slice(0, 3)
      .map(([k, v]) => `${k}=${Array.isArray(v) ? `[${v.length}]` : String(v).slice(0, 22)}`);
    return parts.join("  ");
  }
  if (s.kind === "tool_result") {
    const r = s.result as any;
    if (Array.isArray(r)) return `${r.length} rows`;
    if (r && typeof r === "object") {
      if (r.error) return `error: ${String(r.error).slice(0, 48)}`;
      if (r.verdict) return String(r.verdict).slice(0, 60);
      return `${Object.keys(r).length} fields`;
    }
    return "";
  }
  if (s.content) return s.content.replace(/\s+/g, " ").slice(0, 70) + "…";
  return "";
}

function trim(s: string): string {
  return s.length <= 4000 ? s : `${s.slice(0, 4000)}\n… ${s.length - 4000} more chars`;
}
