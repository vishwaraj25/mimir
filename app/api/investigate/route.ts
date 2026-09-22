import { after } from "next/server";
import { checkAccess, sameOrigin, unauthorized } from "@/lib/auth";
import { runInvestigationLoop, startInvestigation } from "@/lib/agent/runner";
import { defaultSource } from "@/lib/connectors/registry";

export const maxDuration = 60;

let running = false;

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
 * On Vercel the function is frozen the instant the response is sent, so
 * the loop is scheduled with next/server's `after()`, which keeps the
 * function alive for exactly this kind of post-response work. It is still
 * bounded by `maxDuration` (60s on Hobby) -- a real investigation is
 * measured at 44-112s per question, so a long one can still be cut off
 * mid-run on Hobby. Running as a normal Node server, `after()` is a no-op
 * wrapper and the loop simply keeps going with no such limit.
 */
export async function POST(request: Request) {
  const auth = await checkAccess(request);
  if (!auth.ok) return unauthorized(auth.error);
  if (auth.via === "cookie" && !sameOrigin(request)) {
    return Response.json({ error: "cross_origin" }, { status: 403 });
  }

  let body: { question?: string; sourceId?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) return Response.json({ error: "question_required" }, { status: 400 });
  if (question.length > 2000) {
    return Response.json({ error: "question_too_long" }, { status: 400 });
  }

  // Fall back to whichever source is actually registered on this
  // deployment -- "night-run" only exists once SOURCE_NIGHT_RUN_URL is set.
  const sourceId = typeof body.sourceId === "string" ? body.sourceId : defaultSource().id;

  // One investigation at a time. Each is thousands of tokens against a daily
  // free-tier quota measured at about five or six investigations; a double
  // click, or anyone with access looping on this, would burn the day's
  // allowance for nothing. Per server instance, which is enough for one
  // operator. The check and the set sit together with no await between them,
  // so two simultaneous requests cannot both get through.
  if (running) {
    return Response.json({ error: "investigation_already_running" }, { status: 409 });
  }
  running = true;

  let investigationId: number;
  try {
    investigationId = await startInvestigation({ sourceId, question });
  } catch (err) {
    running = false;
    console.error("could not start investigation:", (err as Error).message);
    return Response.json({ error: "investigation_failed" }, { status: 500 });
  }

  // Failures land on the investigation row itself (status 'failed' plus the
  // message), which is what the client is already polling -- so nothing is
  // swallowed by not awaiting here.
  after(() =>
    runInvestigationLoop(investigationId, { sourceId, question })
      .catch((err) => console.error("investigation failed:", (err as Error).message))
      .finally(() => {
        running = false;
      }),
  );

  return Response.json({ investigationId, status: "running" });
}
