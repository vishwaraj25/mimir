import Anthropic from "@anthropic-ai/sdk";
import { getSource } from "../connectors/registry";
import { mimirDb } from "../db";
import { INVESTIGATION_SYSTEM_PROMPT } from "./prompts";
import { executeTool, TOOL_DEFINITIONS } from "./tools";

/**
 * The agentic loop.
 *
 * Claude picks a tool, we run it against the connected source, hand back the
 * result, and repeat until it stops asking for tools and returns its verdict.
 * Every step is persisted as it happens, so an investigation that fails
 * halfway still shows how far it got -- and so the UI can show the reasoning
 * trail rather than just a conclusion the user has to take on faith.
 */

const MODEL = "claude-sonnet-5";
const MAX_STEPS = 24; // generous: a real investigation is 8-15 calls
const MAX_TOKENS = 4096;

export interface InvestigationResult {
  investigationId: number;
  headline: string;
  summary: string;
  hypothesis: string;
  confidence: string;
  insights: any[];
  experiment: any | null;
}

function client(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  return new Anthropic({ apiKey });
}

async function recordStep(
  investigationId: number,
  stepIndex: number,
  kind: string,
  fields: {
    toolName?: string;
    toolInput?: unknown;
    content?: string;
    result?: unknown;
  } = {},
) {
  await mimirDb().query(
    `INSERT INTO investigation_steps
       (investigation_id, step_index, kind, tool_name, tool_input, content, result)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      investigationId,
      stepIndex,
      kind,
      fields.toolName ?? null,
      fields.toolInput ? JSON.stringify(fields.toolInput) : null,
      fields.content ?? null,
      fields.result ? JSON.stringify(fields.result) : null,
    ],
  );
}

/** Pull the JSON verdict out of the final message. */
function parseVerdict(text: string): any | null {
  const fenced = text.match(/```json\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  try {
    return JSON.parse(raw.trim());
  } catch {
    return null;
  }
}

export async function runInvestigation(opts: {
  sourceId: string;
  question: string;
  trigger?: "ask" | "monitor";
}): Promise<InvestigationResult> {
  const source = getSource(opts.sourceId);
  const db = mimirDb();

  const created = await db.query(
    `INSERT INTO investigations (source_id, question, trigger, status)
     VALUES ($1, $2, $3, 'running') RETURNING id`,
    [opts.sourceId, opts.question, opts.trigger ?? "ask"],
  );
  const investigationId: number = created.rows[0].id;

  const anthropic = client();
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Telemetry source: ${source.displayName} (id: ${source.id})

Investigate: ${opts.question}`,
    },
  ];

  let stepIndex = 0;

  try {
    for (let turn = 0; turn < MAX_STEPS; turn++) {
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: INVESTIGATION_SYSTEM_PROMPT,
        tools: TOOL_DEFINITIONS,
        messages,
      });

      // Persist any narration the model produced alongside its tool calls.
      for (const block of response.content) {
        if (block.type === "text" && block.text.trim()) {
          await recordStep(investigationId, stepIndex++, "thought", {
            content: block.text,
          });
        }
      }

      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );

      // No tools requested -> this is the verdict.
      if (toolUses.length === 0) {
        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n");

        const verdict = parseVerdict(text) ?? {
          headline: "Investigation finished without a structured verdict.",
          summary: text.slice(0, 1000),
          hypothesis: "",
          confidence: "low",
          insights: [],
          experiment: null,
        };

        await recordStep(investigationId, stepIndex++, "conclusion", {
          content: verdict.summary ?? text,
          result: verdict,
        });

        await db.query(
          `UPDATE investigations
             SET status='complete', headline=$2, summary=$3,
                 hypothesis=$4, confidence=$5, finished_at=now()
           WHERE id=$1`,
          [
            investigationId,
            verdict.headline ?? null,
            verdict.summary ?? null,
            verdict.hypothesis ?? null,
            verdict.confidence ?? null,
          ],
        );

        for (const ins of verdict.insights ?? []) {
          await db.query(
            `INSERT INTO insights
               (source_id, investigation_id, headline, detail, kind, severity,
                metric_before, metric_after, sample_size)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
              opts.sourceId,
              investigationId,
              ins.headline ?? "(untitled)",
              ins.detail ?? "",
              ins.kind ?? "anomaly",
              ins.severity ?? "info",
              ins.metric_before ?? null,
              ins.metric_after ?? null,
              ins.sample_size ?? null,
            ],
          );
        }

        if (verdict.experiment) {
          const e = verdict.experiment;
          await db.query(
            `INSERT INTO experiments
               (source_id, title, hypothesis, change_described,
                primary_metric, guardrail_metrics, status)
             VALUES ($1,$2,$3,$4,$5,$6,'proposed')`,
            [
              opts.sourceId,
              e.title ?? "(untitled)",
              e.hypothesis ?? "",
              e.change_described ?? "",
              e.primary_metric ?? "",
              JSON.stringify(e.guardrail_metrics ?? []),
            ],
          );
        }

        return { investigationId, ...verdict };
      }

      // Run each requested tool and feed the results back.
      messages.push({ role: "assistant", content: response.content });
      const results: Anthropic.ToolResultBlockParam[] = [];

      for (const use of toolUses) {
        await recordStep(investigationId, stepIndex++, "tool_call", {
          toolName: use.name,
          toolInput: use.input,
        });

        let payload: unknown;
        let isError = false;
        try {
          payload = await executeTool(source, use.name, use.input as any);
        } catch (err) {
          payload = { error: (err as Error).message };
          isError = true;
        }

        await recordStep(investigationId, stepIndex++, "tool_result", {
          toolName: use.name,
          result: payload,
        });

        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: JSON.stringify(payload).slice(0, 60_000),
          is_error: isError,
        });
      }

      messages.push({ role: "user", content: results });
    }

    throw new Error(`investigation exceeded ${MAX_STEPS} steps without a verdict`);
  } catch (err) {
    await db.query(
      `UPDATE investigations SET status='failed', error=$2, finished_at=now() WHERE id=$1`,
      [investigationId, (err as Error).message],
    );
    throw err;
  }
}
