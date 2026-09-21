"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, SESSION_MAX_AGE_S, safeRedirectPath, sameSecret, sessionToken } from "@/lib/auth";

/**
 * Failed attempts per client, so the key can't be guessed at machine speed.
 * In memory, per server instance: not a wall, but it turns a fast guessing
 * loop into a slow one, which is the point for a single-operator tool.
 */
const failures = new Map<string, { count: number; since: number }>();
const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 10;

export async function signIn(_prev: { error?: string }, form: FormData): Promise<{ error?: string }> {
  const expected = process.env.MIMIR_ACCESS_KEY;
  if (!expected) redirect(safeRedirectPath(form.get("next")));

  const client = (await headers()).get("x-forwarded-for")?.split(",")[0].trim() || "local";
  const now = Date.now();
  const f = failures.get(client);
  if (f && now - f.since < WINDOW_MS && f.count >= MAX_FAILURES) {
    return { error: "Too many attempts. Try again in 15 minutes." };
  }

  if (!sameSecret(form.get("key") as string | null, expected)) {
    const next = f && now - f.since < WINDOW_MS ? { count: f.count + 1, since: f.since } : { count: 1, since: now };
    failures.set(client, next);
    await new Promise((r) => setTimeout(r, 400));
    return { error: "That key is not right." };
  }

  failures.delete(client);
  (await cookies()).set(SESSION_COOKIE, await sessionToken(expected), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });
  redirect(safeRedirectPath(form.get("next")));
}

export async function signOut(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
