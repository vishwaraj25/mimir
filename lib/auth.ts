/**
 * Access control.
 *
 * Mimir reads another product's behavioural data and spends model quota when
 * it thinks, so nothing here is public -- pages included. One shared key: a
 * single-operator tool, not a multi-tenant product.
 *
 * Two ways in:
 *   - a browser signs in once at /login and gets a session cookie
 *   - a script or Vercel's cron sends the key (or CRON_SECRET) as a header
 *
 * The cookie holds an HMAC of the key, never the key itself, so a leaked
 * cookie doesn't reveal the password, and changing MIMIR_ACCESS_KEY signs
 * everyone out. It is httpOnly (scripts can't read it) and SameSite=Strict
 * (another site can't make a signed-in browser act on its behalf).
 *
 * Only Web Crypto is used, so the same code runs in proxy.ts and in routes.
 */

export const SESSION_COOKIE = "mimir_session";
export const SESSION_MAX_AGE_S = 60 * 60 * 24 * 30;

const enc = new TextEncoder();

/** Constant time, so response timing can't be used to guess a secret. */
export function sameSecret(given: string | null | undefined, expected: string): boolean {
  if (typeof given !== "string") return false;
  const a = enc.encode(given);
  const b = enc.encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/** The cookie value for a given access key. */
export async function sessionToken(key: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode("mimir-session-v1"));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export type Access = { ok: true; via: "open" | "cron" | "header" | "cookie" } | { ok: false; error: string };

/**
 * The one access decision, used by proxy.ts for every request and again by
 * each route and page next to the data. The proxy is only the first check;
 * Next.js documents it as optimistic, so it never stands alone.
 */
export async function checkAccess(request: Request): Promise<Access> {
  // Vercel signs its own cron calls. Honoured whether or not a key is set.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && sameSecret(request.headers.get("authorization"), `Bearer ${cronSecret}`)) {
    return { ok: true, via: "cron" };
  }

  const expected = process.env.MIMIR_ACCESS_KEY;

  // Unset: open on a dev machine, closed in production. A deployment that
  // forgot to set a key must not serve another product's data to anyone.
  if (!expected) {
    return process.env.NODE_ENV === "production"
      ? { ok: false, error: "mimir_access_key_not_set" }
      : { ok: true, via: "open" };
  }

  if (sameSecret(request.headers.get("x-mimir-key"), expected)) return { ok: true, via: "header" };

  const cookie = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  if (cookie && sameSecret(cookie, await sessionToken(expected))) return { ok: true, via: "cookie" };

  return { ok: false, error: "unauthorized" };
}

/**
 * A cookie-authenticated request that changes something must come from this
 * site. SameSite=Strict already blocks the cookie cross-site; this is the
 * second lock, in case a browser or proxy gets that wrong.
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // same-origin fetches from old browsers, and non-browser clients
  return origin === new URL(request.url).origin;
}

/**
 * Where to send someone after signing in. Only a path on this site: never
 * "//evil.example" (which browsers treat as another host), "/\\evil.example",
 * or a full URL -- otherwise the login page becomes a way to bounce a user
 * to a phishing page that looks like it came from Mimir.
 */
export function safeRedirectPath(next: unknown): string {
  if (typeof next !== "string" || !next.startsWith("/")) return "/";
  if (next.startsWith("//") || next.startsWith("/\\")) return "/";
  if (/[\u0000-\u001f]/.test(next)) return "/";
  return next;
}

export function unauthorized(error: string) {
  return Response.json({ error }, { status: error === "unauthorized" ? 401 : 503 });
}
