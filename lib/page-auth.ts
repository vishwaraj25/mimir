import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { checkAccess } from "./auth";

/**
 * The check next to the data, for server-rendered pages.
 *
 * proxy.ts already gates every request, but Next.js documents the proxy as
 * an optimistic check only, so each page that reads data repeats it here.
 * If one of the two is ever misconfigured, the other still holds.
 */
export async function requirePageAccess(): Promise<void> {
  const access = await checkAccess(new Request("http://mimir.local/", { headers: await headers() }));
  if (access.ok) return;
  if (access.error === "mimir_access_key_not_set") {
    throw new Error("Mimir is not configured: set MIMIR_ACCESS_KEY on the server.");
  }
  redirect("/login");
}

/** Same decision, without redirecting: for the layout, to decide what chrome to show. */
export async function hasPageAccess(): Promise<boolean> {
  return (await checkAccess(new Request("http://mimir.local/", { headers: await headers() }))).ok;
}
