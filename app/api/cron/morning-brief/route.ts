import { checkAccess, unauthorized } from "@/lib/auth";
import { generateMorningBrief } from "@/lib/agent/brief";
import { listSources } from "@/lib/connectors/registry";

export const maxDuration = 300;

/** Runs on a schedule (see vercel.json) and on demand from the UI. */
export async function GET(request: Request) {
  const auth = checkAccess(request);
  if (!auth.ok) return unauthorized(auth.error!);

  const results = [];
  for (const source of listSources()) {
    try {
      results.push({ source: source.id, ...(await generateMorningBrief(source.id)) });
    } catch (err) {
      results.push({ source: source.id, error: (err as Error).message });
    }
  }
  return Response.json({ generated: results.length, results });
}
