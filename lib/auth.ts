import { timingSafeEqual } from "node:crypto";

/**
 * Access control.
 *
 * Mimir reads another product's behavioural data and spends model quota when
 * it thinks, so nothing here is public. One shared key, checked on every
 * route -- a single-operator tool, not a multi-tenant product, and a login
 * system would be ceremony around a problem that does not exist yet.
 *
 * The key travels in a header only. It used to be accepted as ?key=... too,
 * which is convenient and wrong: a query string ends up in server logs,
 * browser history and Referer headers.
 */

/** Compares in constant time, so response timing cannot be used to guess it. */
function sameSecret(given: string | null, expected: string): boolean {
  if (given === null) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function checkAccess(request: Request): { ok: boolean; error?: string } {
  // Vercel signs its own cron invocations with CRON_SECRET. Checked first and
  // independently: it must work whether or not a browser access key is set.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && sameSecret(request.headers.get("authorization"), `Bearer ${cronSecret}`)) {
    return { ok: true };
  }

  const expected = process.env.MIMIR_ACCESS_KEY;

  // Unset means open on localhost and closed in production. `npm run dev`
  // should not require inventing a password, but a deployed instance that
  // forgot to set one must not serve another product's behavioural data.
  if (!expected) {
    return process.env.NODE_ENV === "production"
      ? { ok: false, error: "mimir_access_key_not_set" }
      : { ok: true };
  }

  return sameSecret(request.headers.get("x-mimir-key"), expected)
    ? { ok: true }
    : { ok: false, error: "unauthorized" };
}

export function unauthorized(error: string) {
  return Response.json({ error }, { status: error === "unauthorized" ? 401 : 503 });
}
