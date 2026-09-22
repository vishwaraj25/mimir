import { NextResponse, type NextRequest } from "next/server";
import { checkAccess } from "./lib/auth";

/**
 * The first gate: every page and API request passes through here before it
 * reaches any data. Pages and routes check again themselves (see
 * lib/page-auth.ts and each route), because Next.js documents the proxy as an
 * optimistic check, not the only one.
 *
 * Before this existed only /api/* checked the key, while every page read
 * behavioural data and findings server-side with no check at all -- anyone
 * with the URL could read everything.
 *
 * /demo is the one deliberate exception: a public walkthrough that only
 * ever reads the built-in synthetic source and has no "ask Mimir" action,
 * so it exposes no real data and can't spend model quota. See app/demo.
 */
export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/login" || request.nextUrl.pathname === "/demo") {
    return NextResponse.next();
  }

  const access = await checkAccess(request);
  if (access.ok) return NextResponse.next();

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: access.error }, { status: access.error === "unauthorized" ? 401 : 503 });
  }
  if (access.error === "mimir_access_key_not_set") {
    return new NextResponse("Mimir is not configured: set MIMIR_ACCESS_KEY on the server.", { status: 503 });
  }
  const login = new URL("/login", request.url);
  login.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except Next's own internals and the public mascot images.
  // All of /_next/ is excluded, not just static and image: in development the
  // live-reload socket lives at /_next/hmr, and gating it broke the page's
  // first load. Nothing under /_next/ serves data -- pages, their data and
  // server actions all go through the page's own URL, which stays gated.
  matcher: ["/((?!_next/|favicon.ico|mascot/).*)"],
};
