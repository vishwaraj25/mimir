import { getSource } from "../connectors/registry";
import { getProvider } from "../llm";
import type { LLMMessage, LLMToolResult } from "../llm";
import { store } from "../store";
import { INVESTIGATION_SYSTEM_PROMPT } from "./prompts";
import { executeTool, TOOL_DEFINITIONS } from "./tools";

/**
 * The agentic loop.
 *
 * The model picks a tool, we run it against the connected source, hand the
 * result back, and repeat until it stops asking and gives a verdict. Every
 * step is written to the store as it happens, so an investigation that dies
 * halfway still shows how far it got, and the UI can replay the reasoning
 * instead of presenting a conclusion to be taken on trust.
 *
 * Nothing here names a vendor: the loop talks to an LLMProvider, so it runs
 * identically on a free Gemini key, a free Groq key or a local Ollama.
 */

const MAX_TURNS = 20;
const MAX_TOKENS = 4096;

export interface InvestigationResult {
  investigationId: number;
  headline: string;
  summary: string;
  hypothesis: string;
  confidence: string;
  insights: any[];
  experiment: any | null;
  modelLabel: string;
}

function parseVerdict(text: string): any | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  try {
    return JSON.parse(candidate.trim());
  } catch {
    // Some models wrap prose around the object; take the outermost braces.
    const first = candidate.indexOf("{");
    const last = candidate.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(candidate.slice(first, last + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export async function runInvestigation(opts: {
  sourceId: string;
  question: string;
  trigger?: "ask" | "monitor";
}): Promise<InvestigationResult> {
  const source = getSource(opts.sourceId);
  const provider = getProvider();
  const db = store();

  const investigationId = await db.createInvestigation({
    sourceId: opts.sourceId,
    question: opts.question,
    trigger: opts.trigger ?? "ask",
    modelLabel: provider.label,
  });

  const messages: LLMMessage[] = [
    {
      role: "user",
      text: `Telemetry source: ${source.displayName} (id: ${source.id})\n\nInvestigate: ${opts.question}`,
    },
  ];

  let stepIndex = 0;
  const step = (
    kind: string,
    fields: Partial<{
      tool_name: string | null;
      tool_input: unknown;
      content: string | null;
      result: unknown;
      duration_ms: number | null;
    }> = {},
  ) =>
    db.addStep({
      investigation_id: investigationId,
      step_index: stepIndex++,
      kind,
      tool_name: fields.tool_name ?? null,
      tool_input: fields.tool_input ?? null,
      content: fields.content ?? null,
      result: fields.result ?? null,
      duration_ms: fields.duration_ms ?? null,
    });

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const started = Date.now();
      const response = await provider.complete({
        system: INVESTIGATION_SYSTEM_PROMPT,
        messages,
        tools: TOOL_DEFINITIONS,
        maxTokens: MAX_TOKENS,
      });

      if (response.text.trim() && response.toolCalls.length > 0) {
        await step("thought", {
          content: response.text,
          duration_ms: Date.now() - started,
        });
      }

      // No tools requested means the model is done: this is the verdict.
      if (response.toolCalls.length === 0) {
        const verdict = parseVerdict(response.text) ?? {
          headline: "Finished without a structured verdict.",
          summary: response.text.slice(0, 1200),
          hypothesis: "",
          confidence: "low",
          insights: [],
          experiment: null,
        };

        await step("conclusion", {
          content: verdict.summary ?? response.text,
          result: verdict,
          duration_ms: Date.now() - started,
        });

        await db.finishInvestigation(investigationId, {
          status: "complete",
          headline: verdict.headline ?? null,
          summary: verdict.summary ?? null,
          hypothesis: verdict.hypothesis ?? null,
          confidence: verdict.confidence ?? null,
        });

        for (const ins of verdict.insights ?? []) {
          await db.addInsight({
            source_id: opts.sourceId,
            investigation_id: investigationId,
            headline: ins.headline ?? "(untitled)",
            detail: ins.detail ?? "",
            kind: ins.kind ?? "anomaly",
            severity: ins.severity ?? "info",
            metric_before: ins.metric_before ?? null,
            metric_after: ins.metric_after ?? null,
            sample_size: ins.sample_size ?? null,
          });
        }

        if (verdict.experiment) {
          const e = verdict.experiment;
          await db.addExperiment({
            source_id: opts.sourceId,
            title: e.title ?? "(untitled)",
            hypothesis: e.hypothesis ?? "",
            change_described: e.change_described ?? "",
            primary_metric: e.primary_metric ?? "",
            guardrail_metrics: e.guardrail_metrics ?? [],
            status: "proposed",
          });
        }

        return {
          investigationId,
          modelLabel: provider.label,
          headline: verdict.headline ?? "",
          summary: verdict.summary ?? "",
          hypothesis: verdict.hypothesis ?? "",
          confidence: verdict.confidence ?? "low",
          insights: verdict.insights ?? [],
          experiment: verdict.experiment ?? null,
        };
      }

      messages.push({
        role: "assistant",
        text: response.text,
        toolCalls: response.toolCalls,
      });

      const results: LLMToolResult[] = [];
      for (const call of response.toolCalls) {
        await step("tool_call", {
          tool_name: call.name,
          tool_input: call.input,
        });

        const toolStarted = Date.now();
        let payload: unknown;
        let isError = false;
        try {
          payload = await executeTool(source, call.name, call.input as any);
        } catch (err) {
          payload = { error: (err as Error).message };
          isError = true;
        }

        await step("tool_result", {
          tool_name: call.name,
          result: payload,
          duration_ms: Date.now() - toolStarted,
        });

        results.push({
          id: call.id,
          name: call.name,
          content: JSON.stringify(payload).slice(0, 40_000),
          isError,
        });
      }

      messages.push({ role: "tool_results", results });
    }

    throw new Error(`no verdict after ${MAX_TURNS} turns`);
  } catch (err) {
    await db.finishInvestigation(investigationId, {
      status: "failed",
      error: (err as Error).message,
    });
    throw err;
  }
}
