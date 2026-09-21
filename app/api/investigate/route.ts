import { checkAccess, unauthorized } from "@/lib/auth";
import { runInvestigationLoop, startInvestigation } from "@/lib/agent/runner";
import { defaultSource } from "@/lib/connectors/registry";

export const maxDuration = 300;

/**
 * Start an investigation and return its id straight away.
 *
 * Deliberately NOT synchronous. An investigation is 8-15 model calls and,
 * on a rate-limited free tier, minutes of wall clock -- far too long to
 * hold a browser request open, and it made the live reasoning trail
 * impossible: the client only learned the id once there was nothing left
 * to watch. Now the row exists before the work starts, the browser polls
 * /api/investigations/[id] for steps as they land, and the loop runs on
 * past this response.
 *
 * On a serverless host the function may be frozen once the response is
 * sent; if this is deployed somewhere that does that, the loop wants a
 * platform keep-alive (Vercel's waitUntil) or a queue. Running as a normal
 * Node server, it simply keeps going.
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

  // Fall back to whichever source is actually registered on this
  // deployment -- "night-run" only exists once SOURCE_NIGHT_RUN_URL is set.
  const sourceId = body.sourceId ?? defaultSource().id;

  let investigationId: number;
  try {
    investigationId = await startInvestigation({ sourceId, question });
  } catch (err) {
    console.error("could not start investigation:", (err as Error).message);
    return Response.json({ error: "investigation_failed" }, { status: 500 });
  }

  // Failures land on the investigation row itself (status 'failed' plus the
  // message), which is what the client is already polling -- so nothing is
  // swallowed by not awaiting here.
  void runInvestigationLoop(investigationId, { sourceId, question }).catch(
    (err) => console.error("investigation failed:", (err as Error).message),
  );

  return Response.json({ investigationId, status: "running" });
}
