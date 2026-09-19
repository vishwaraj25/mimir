"use client";

import { useEffect, useState } from "react";

/**
 * The access key never lives on the server side of this page -- it is
 * typed once, kept in the browser's own localStorage, and attached as a
 * header on API calls from Ask/Investigations. Settings shows connection
 * STATUS (is a source reachable, which model would run), never a raw
 * secret value; the actual credentials are environment variables this page
 * cannot read or display.
 */
export function AccessKeyField() {
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    try {
      setKey(localStorage.getItem("mimir_key") ?? "");
    } catch {}
  }, []);

  function save() {
    try {
      localStorage.setItem("mimir_key", key);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch {}
  }

  return (
    <div style={{ display: "flex", gap: 8 }}>
      <input
        className="field mono"
        type="password"
        placeholder="access key"
        value={key}
        onChange={(e) => setKey(e.target.value)}
      />
      <button className="btn sec" onClick={save}>
        {saved ? "Saved" : "Save"}
      </button>
    </div>
  );
}
