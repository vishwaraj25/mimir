"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RunBriefButton() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/cron/morning-brief");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "failed");
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      {err && <span className="tag err">{err}</span>}
      <button className="btn sec" onClick={run} disabled={busy}>
        {busy ? "Running…" : "Run brief now"}
      </button>
    </div>
  );
}
