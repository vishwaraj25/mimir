"use client";

import { useActionState } from "react";
import { signIn } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signIn, {});
  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <input type="hidden" name="next" value={next} />
      <input
        className="field mono"
        type="password"
        name="key"
        placeholder="Access key"
        autoComplete="current-password"
        autoFocus
        required
      />
      <button className="btn" type="submit" disabled={pending}>
        {pending ? "Checking…" : "Sign in"}
      </button>
      {state.error && <span className="tag err">{state.error}</span>}
    </form>
  );
}
