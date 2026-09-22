import { getSource } from "../connectors/registry";
import { completeWithRetry, getProvider } from "../llm";
import type { LLMMessage, LLMProvider, LLMToolResult } from "../llm";
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

/**
 * Everything below is sized against a real free-tier ceiling rather than
 * chosen by feel. Groq's free tier allows 8,000 tokens per MINUTE, counting
 * input and output together, and every request re-sends the system prompt,
 * all nine tool definitions, and the conversation so far. Measured: with
 * only per-result trimming, an investigation reached 18 tool calls and then
 * died on a 413 at 8,163 tokens.
 *
 * So the budget is explicit:
 *   system prompt + tool definitions   ~2,700 tokens (fixed, every request)
 *   reserved for the reply             1,200 tokens (MAX_TOKENS)
 *   conversation history               ~1,500 tokens (HISTORY_BUDGET_CHARS)
 *                                      ------
 *                                      ~5,400 tokens per request
 *
 * which fits inside 8,000 with room for a second request in the same
 * minute. A verdict is a few hundred tokens of JSON, so 1,200 is generous.
 */
const MAX_TOKENS = 1_200;
/** Reply budget on a forced-verdict turn, which carries no tool definitions. */
const VERDICT_MAX_TOKENS = 2_500;

/** Hard cap on one tool result before it even enters the history. */
const MAX_RESULT_CHARS = 2_500;
/**
 * How many of the most recent tool-result turns stay verbatim.
 *
 * Was 1, which was too aggressive and caused a loop: everything older got
 * stubbed, so the agent kept re-asking questions it had already answered.
 * Observed in a real trace -- describe_schema three times, the identical
 * compare_periods three times -- and it never reached a verdict because it
 * kept re-gathering instead of concluding.
 */
const VERBATIM_RESULT_TURNS = 3;
/** What an older, superseded tool result gets compressed down to. */
const COMPRESSED_RESULT_CHARS = 220;
/** Total characters of conversation history allowed into one request. */
const HISTORY_BUDGET_CHARS = 6_000;
/** Turns remaining at which the agent is told to start wrapping up. */
const WRAP_UP_WARNING_TURNS = 5;

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

/**
 * Keeps the prompt from growing without bound as an investigation runs.
 *
 * Every turn used to re-send every previous tool result in full, so by turn
 * seven the model was re-reading the entire history just to ask one more
 * question. Measured against a free tier: the per-turn rate-limit wait rose
 * steadily (23s, 27s, 29s, 31s, 36s...) purely from that growth, on two
 * different models -- it is the loop's shape, not the model, that was the
 * problem.
 *
 * Recent results stay verbatim because that is what the current step is
 * reasoning about. Older ones collapse to a stub: the model has already
 * drawn its conclusions from them, and they are still in the stored trail
 * for the human reader.
 */
function truncateResult(serialised: string): string {
  if (serialised.length <= MAX_RESULT_CHARS) return serialised;
  return (
    `${serialised.slice(0, MAX_RESULT_CHARS)}\n\n[result truncated from ` +
    `${serialised.length} chars — narrow the query (fewer days, a specific ` +
    `event, or a coarser bucket_size) if you need to see all of it.]`
  );
}

export function compressHistory(
  messages: LLMMessage[],
  budgetChars = HISTORY_BUDGET_CHARS,
): LLMMessage[] {
  const resultTurns: number[] = [];
  messages.forEach((m, i) => {
    if (m.role === "tool_results") resultTurns.push(i);
  });
  const keepVerbatimFrom = resultTurns.slice(-VERBATIM_RESULT_TURNS)[0] ?? Infinity;

  const trimmed: LLMMessage[] = messages.map((m, i) => {
    if (m.role !== "tool_results" || i >= keepVerbatimFrom) return m;
    return {
      role: "tool_results",
      results: m.results.map((r) =>
        r.content.length <= COMPRESSED_RESULT_CHARS
          ? r
          : {
              ...r,
              // Deliberately does NOT invite a re-call. An earlier version
              // ended with "call it again if you need the full data", and
              // the agent obediently did -- the same query three times over,
              // never concluding.
              content:
                `${r.content.slice(0, COMPRESSED_RESULT_CHARS)}\n\n[earlier ${r.name} result, ` +
                `abbreviated. You already have what it told you -- do not request it again.]`,
            },
      ),
    };
  });

  // Per-message trimming alone still grows without bound across enough
  // turns, so a hard budget drops the oldest exchanges outright. The first
  // message is always kept: it carries the question being investigated,
  // and dropping it would leave the agent working on nothing.
  const [opening, ...rest] = trimmed;
  const kept: LLMMessage[] = [];
  let used = 0;
  for (let i = rest.length - 1; i >= 0; i--) {
    const size = sizeOf(rest[i]);
    if (used + size > budgetChars && kept.length > 0) break;
    kept.unshift(rest[i]);
    used += size;
  }

  // A tool_results message whose matching assistant tool_call got dropped
  // is a dangling result: some providers reject that outright.
  while (kept.length > 0 && kept[0].role === "tool_results") kept.shift();

  return opening ? [opening, ...kept] : kept;
}

function sizeOf(m: LLMMessage): number {
  if (m.role === "user") return m.text.length;
  if (m.role === "assistant") {
    return m.text.length + JSON.stringify(m.toolCalls).length;
  }
  return m.results.reduce((n, r) => n + r.content.length, 0);
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

/**
 * Creates the investigation row and returns its id, without running
 * anything yet.
 *
 * Split out from the loop so a caller can hand the id to the browser
 * immediately and let it poll the reasoning trail while the agent works.
 * Previously the client only learned the id from the response of the
 * request that ran the whole investigation -- which meant the "watch it
 * work" trace had nothing to poll until there was nothing left to watch.
 */
export async function startInvestigation(opts: {
  sourceId: string;
  question: string;
  trigger?: "ask" | "monitor";
  /** Defaults to the configured provider's label. */
  modelLabel?: string;
}): Promise<number> {
  getSource(opts.sourceId); // fail fast on an unknown source
  return store().createInvestigation({
    sourceId: opts.sourceId,
    question: opts.question,
    trigger: opts.trigger ?? "ask",
    modelLabel: opts.modelLabel ?? getProvider().label,
  });
}

/** Convenience for callers that don't need the id early (the brief). */
export async function runInvestigation(opts: {
  sourceId: string;
  question: string;
  trigger?: "ask" | "monitor";
}): Promise<InvestigationResult> {
  const id = await startInvestigation(opts);
  return runInvestigationLoop(id, opts);
}

export async function runInvestigationLoop(
  investigationId: number,
  opts: {
    sourceId: string;
    question: string;
    /** Injected by tests, so the loop's rules can be checked with no model. */
    provider?: LLMProvider;
  },
): Promise<InvestigationResult> {
  const source = getSource(opts.sourceId);
  const provider = opts.provider ?? getProvider();
  const db = store();

  const messages: LLMMessage[] = [
    {
      role: "user",
      text: `Telemetry source: ${source.displayName} (id: ${source.id})\n\nInvestigate: ${opts.question}`,
    },
  ];

  /** Set when a reply came back without a usable verdict and was re-asked. */
  let verdictRequested = false;
  /**
   * Whether any tool actually measured something. describe_schema only lists
   * what exists; it has no counts. Observed: asked which weapon is picked up
   * least, the agent called describe_schema alone and answered with invented
   * figures ("jetpack, 2%") -- the real least was double_mg, and the jetpack
   * was second MOST.
   */
  let measured = false;
  let measureNudged = false;

  /** Whether the agent ever TRIED to establish where the change came from. */
  let localiseAttempted = false;
  /** Whether a tool result actually pointed at a place. */
  let causeFound = false;
  let localiseNudged = false;

  /** Signature -> abbreviated result, so an identical re-ask can be refused. */
  const seenCalls = new Map<string, string>();

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
      const turnsLeft = MAX_TURNS - turn;

      // Left to itself the agent keeps investigating and never decides it
      // has enough -- measured: 20 tool calls, all successful, and still no
      // verdict. So the budget is made explicit near the end, and on the
      // final turn the tools are withheld entirely: with nothing to call,
      // the only thing it can return is the verdict.
      const forceVerdict = turnsLeft === 1 || verdictRequested;
      if (turnsLeft === WRAP_UP_WARNING_TURNS) {
        messages.push({
          role: "user",
          text:
            `You have ${turnsLeft - 1} tool calls left before you must give your ` +
            `verdict. Stop gathering and start concluding: if the evidence so far ` +
            `does not support a confident answer, say so and report what is still ` +
            `missing rather than continuing to look.`,
        });
      }

      // A 413 is "this single request is too big", which no amount of
      // waiting fixes -- unlike a 429. Halve the history budget and try the
      // same turn again rather than losing the whole investigation, which
      // is exactly how a run died at 8,163 tokens against an 8,000 ceiling.
      let response;
      let budget = HISTORY_BUDGET_CHARS;
      for (;;) {
        try {
          response = await completeWithRetry(provider, {
            system: forceVerdict
              ? `${INVESTIGATION_SYSTEM_PROMPT}\n\nYou are out of tool calls. Reply NOW with only the JSON verdict described above, based on what you already found.`
              : INVESTIGATION_SYSTEM_PROMPT,
            messages: compressHistory(messages, budget),
            tools: forceVerdict ? undefined : TOOL_DEFINITIONS,
            // A forced-verdict turn sends no tool definitions (~1,400 tokens
            // saved), so that room goes to the reply instead: the verdict JSON
            // plus a reasoning model's hidden thinking has to fit here.
            maxTokens: forceVerdict ? VERDICT_MAX_TOKENS : MAX_TOKENS,
          });
          break;
        } catch (err) {
          const tooLarge = / 413\b/.test((err as Error).message);
          if (!tooLarge || budget <= 800) throw err;
          budget = Math.floor(budget / 2);
          console.warn(`request too large, retrying with ${budget} chars of history`);
        }
      }

      if (response.text.trim() && response.toolCalls.length > 0) {
        await step("thought", {
          content: response.text,
          duration_ms: Date.now() - started,
        });
      }

      // No verdict before a measurement. Checked before anything else, since
      // a verdict with nothing measured behind it has no numbers to trust.
      if (
        response.toolCalls.length === 0 &&
        parseVerdict(response.text) &&
        !measured &&
        !measureNudged &&
        turnsLeft > 2
      ) {
        measureNudged = true;
        verdictRequested = false; // tools must be available again
        console.warn("verdict offered before anything was measured; sending it back once");
        messages.push({ role: "assistant", text: response.text, toolCalls: [] });
        messages.push({
          role: "user",
          text:
            "You have not measured anything yet: describe_schema only lists which events " +
            "and properties exist, it has no counts. Every number in your verdict has to " +
            "come from a tool result. Measure first (segment_event, funnel, aggregate, " +
            "compare_periods), then answer from what those return.",
        });
        continue;
      }

      // A verdict on a change nobody located is a guess with a number in it.
      // Observed twice: it measured the drop correctly, never asked where
      // the loss happened, and concluded "the boss" with high confidence.
      // The prompt says to localise; the model skipped it, so this makes it
      // structural: send the verdict back once, with tools restored.
      if (
        response.toolCalls.length === 0 &&
        parseVerdict(response.text)?.question_type === "change" &&
        !localiseAttempted &&
        !localiseNudged &&
        turnsLeft > 2
      ) {
        localiseNudged = true;
        verdictRequested = false; // tools must be available again
        console.warn("verdict offered without locating the change; sending it back once");
        messages.push({ role: "assistant", text: response.text, toolCalls: [] });
        messages.push({
          role: "user",
          text:
            "Before concluding: you have not established WHERE the change came from. " +
            "Call locate_change on the event that marks the loss (for example the " +
            "event recorded when a user fails, exits or errors) and let its result " +
            "shape your verdict. If it shows nothing localised, say that instead.",
        });
        continue;
      }

      // No tools requested means the model thinks it is done. But a reply
      // with no tool calls is not automatically a verdict: observed, a run
      // that had gathered the right evidence in 4 calls came back with an
      // empty body and was recorded as "Finished without a structured
      // verdict" -- the investigation was fine, only the write-up was lost.
      // If the reply isn't a parseable verdict and there is budget left,
      // hand it back and ask for the JSON explicitly, once per turn left.
      if (
        response.toolCalls.length === 0 &&
        !parseVerdict(response.text) &&
        turnsLeft > 1
      ) {
        console.warn(
          `no parseable verdict (finish_reason=${response.finishReason ?? "?"}, ` +
            `${response.text.length} chars); asking again`,
        );
        if (response.text.trim()) {
          messages.push({ role: "assistant", text: response.text, toolCalls: [] });
        }
        messages.push({
          role: "user",
          text:
            "That reply did not contain the verdict. Using only what you have " +
            "already found, reply now with ONLY the JSON verdict object described " +
            "in your instructions -- no prose around it, no further tool calls.",
        });
        verdictRequested = true;
        continue;
      }

      if (response.toolCalls.length === 0) {
        const verdict = parseVerdict(response.text) ?? {
          headline: "Finished without a structured verdict.",
          summary: response.text.slice(0, 1200),
          hypothesis: "",
          confidence: "low",
          insights: [],
          experiment: null,
        };

        // What a verdict is allowed to claim is decided here, not left to the
        // model. Observed: with nothing located, it still offered invented
        // causes ("enemy attacks softened or shield cooldown increased") and
        // an experiment built on them, at high confidence.
        if (!measured) {
          const original = `${verdict.headline ?? ""} ${verdict.summary ?? ""}`.trim();
          verdict.headline = "Unverified: no measurement was made before answering.";
          verdict.summary =
            `No tool that measures the data was called, so none of the figures the ` +
            `model gave can be trusted. Its unverified answer was: ${original}`;
          verdict.confidence = "insufficient_data";
          verdict.hypothesis = "";
          verdict.experiment = null;
          verdict.insights = [];
        } else if (verdict.question_type === "change" && !causeFound) {
          if (verdict.hypothesis) {
            verdict.summary =
              `${verdict.summary ?? ""} Untested idea (nothing in the data located a cause): ${verdict.hypothesis}`.trim();
            verdict.hypothesis = "";
          }
          verdict.experiment = null;
          if (verdict.confidence === "high") verdict.confidence = "medium";
        }

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

        // Refuse an exact repeat rather than answering it again. Observed
        // without this: the same compare_periods call three times and the
        // same describe_schema three times in one investigation, burning
        // the turn budget on questions already answered and never reaching
        // a verdict. Saying "you already asked, here is what it said" moves
        // it forward; silently re-answering just feeds the loop.
        const signature = `${call.name}:${JSON.stringify(call.input ?? {})}`;
        const previous = seenCalls.get(signature);
        if (previous !== undefined) {
          payload = {
            repeated_call: true,
            note:
              `You already ran ${call.name} with these exact arguments earlier in ` +
              `this investigation. Re-running it cannot tell you anything new. Use ` +
              `the result below, change the arguments, pick a different tool, or ` +
              `conclude.`,
            earlier_result: previous,
          };
        } else {
          try {
            payload = await executeTool(source, call.name, call.input as any);
          } catch (err) {
            payload = { error: (err as Error).message };
            isError = true;
          }
          if (!isError) {
            if (call.name !== "describe_schema") measured = true;
            if (
              call.name === "locate_change" ||
              (call.name === "aggregate" && (call.input as any)?.compare_to_prior)
            ) {
              localiseAttempted = true;
              const found = (payload as any)?.strongest_first?.length > 0 ||
                (payload as any)?.biggest_changes?.length > 0;
              if (found) causeFound = true;
            }
            seenCalls.set(signature, truncateResult(JSON.stringify(payload)).slice(0, 1_200));
          }
        }

        await step("tool_result", {
          tool_name: call.name,
          result: payload,
          duration_ms: Date.now() - toolStarted,
        });

        results.push({
          id: call.id,
          name: call.name,
          // The full payload is stored for the human-readable trail above;
          // only what the model needs to reason with goes into the prompt.
          content: truncateResult(JSON.stringify(payload)),
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
