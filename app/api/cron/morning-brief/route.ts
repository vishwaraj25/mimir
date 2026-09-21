import { checkAccess, unauthorized } from "@/lib/auth";
import { generateMorningBrief } from "@/lib/agent/brief";
import { isDemoOnly, listSources } from "@/lib/connectors/registry";

export const maxDuration = 300;

/** Runs on a schedule (see vercel.json) and on demand from the UI. */
export async function GET(request: Request) {
  const auth = await checkAccess(request);
  if (!auth.ok) return unauthorized(auth.error);

  // The synthetic source is always registered as a fallback. Once a real
  // source is connected it must not get a brief too: it would spend model
  // quota every morning -- and trigger an investigation into its planted
  // regression -- on data nobody is looking at.
  const sources = isDemoOnly() ? listSources() : listSources().filter((s) => s.id !== "demo");

  const results = [];
  for (const source of sources) {
    try {
      results.push({ source: source.id, ...(await generateMorningBrief(source.id)) });
    } catch (err) {
      results.push({ source: source.id, error: (err as Error).message });
    }
  }
  return Response.json({ generated: results.length, results });
}
