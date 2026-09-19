/**
 * Access control.
 *
 * Mimir reads another product's behavioural data and spends API credits when
 * it thinks, so nothing here is public. One shared key, checked on every
 * route -- the same model as the game's own dashboard, for the same reason:
 * this is a single-operator tool, not a multi-tenant product, and a login
 * system would be ceremony around a problem that does not exist yet.
 *
 * Fails CLOSED: if the key is not configured, nothing is served.
 */
export function checkAccess(request: Request): { ok: boolean; error?: string } {
  const expected = process.env.MIMIR_ACCESS_KEY;

  // Unset means open on localhost and closed in production. Running `npm run
  // dev` should not require inventing a password, but a deployed instance
  // that forgot to set one must not be left serving another product's
  // behavioural data to the internet.
  if (!expected) {
    return process.env.NODE_ENV === "production"
      ? { ok: false, error: "mimir_access_key_not_set" }
      : { ok: true };
  }

  const url = new URL(request.url);
  const fromQuery = url.searchParams.get("key");
  const fromHeader = request.headers.get("x-mimir-key");

  if (fromQuery === expected || fromHeader === expected) return { ok: true };

  // Vercel signs its own cron invocations; accept those for the cron route.
  const cronSecret = request.headers.get("authorization");
  if (cronSecret && process.env.CRON_SECRET) {
    if (cronSecret === `Bearer ${process.env.CRON_SECRET}`) return { ok: true };
  }

  return { ok: false, error: "unauthorized" };
}

export function unauthorized(error: string) {
  return Response.json({ error }, { status: error === "unauthorized" ? 401 : 503 });
}
