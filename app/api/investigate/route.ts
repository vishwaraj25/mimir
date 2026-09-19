import { checkAccess, unauthorized } from "@/lib/auth";
import { runInvestigation } from "@/lib/agent/runner";
import { defaultSource } from "@/lib/connectors/registry";

export const maxDuration = 300;

/**
 * Start an investigation and wait for the verdict.
 *
 * Synchronous on purpose: a full investigation is 8-15 tool calls and
 * finishes inside the function timeout, and the reasoning trail is written
 * to the database step by step as it goes -- so the UI can poll and watch
 * the agent work rather than staring at a spinner with nothing behind it.
 */
export async function POST(request: Request) {
  const auth = checkAccess(request);
  if (!auth.ok) return unauthorized(auth.error!);

  let body: { question?: string; sourceId?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const question = (body.question ?? "").trim();
  if (!question) return Response.json({ error: "question_required" }, { status: 400 });
  if (question.length > 2000) {
    return Response.json({ error: "question_too_long" }, { status: 400 });
  }

  try {
    const result = await runInvestigation({
      // Fall back to whichever source is actually registered on this
      // deployment -- "night-run" only exists once SOURCE_NIGHT_RUN_URL is
      // set, so hardcoding it here broke the demo-only case entirely.
      sourceId: body.sourceId ?? defaultSource().id,
      question,
    });
    return Response.json(result);
  } catch (err) {
    console.error("investigation failed:", (err as Error).message);
    return Response.json({ error: "investigation_failed" }, { status: 500 });
  }
}
