import { listSources, isDemoOnly } from "@/lib/connectors/registry";
import { describeProvider } from "@/lib/llm";
import { store } from "@/lib/store";
import { AccessKeyField } from "./access-key-field";

export const dynamic = "force-dynamic";

/**
 * Settings & connections.
 *
 * Everything backend-shaped that used to sit on the Overview page lives
 * here instead: which telemetry source is connected, which model would
 * run, where findings are stored, and the access key for this browser.
 * The main dashboard is player behaviour only.
 */
export default async function SettingsPage() {
  const sources = listSources();
  const provider = describeProvider();
  const persistent = store().persistent;
  const demo = isDemoOnly();

  const healths = await Promise.all(sources.map((s) => s.healthCheck()));

  return (
    <>
      <header className="head">
        <div>
          <h1>Settings</h1>
          <p>Connections, model, and storage. Nothing about player behaviour lives on this page.</p>
        </div>
      </header>

      <div className="body">
        <div className="card">
          <div className="card-head">
            <h2>Telemetry source</h2>
            {demo && <span className="tag warn">no real source connected</span>}
          </div>
          <div className="card-body flush">
            <table>
              <thead><tr><th>Source</th><th>Id</th><th>Status</th><th>Detail</th></tr></thead>
              <tbody>
                {sources.map((s, i) => (
                  <tr key={s.id}>
                    <td>{s.displayName}</td>
                    <td className="mono">{s.id}</td>
                    <td><span className={`tag ${healths[i].ok ? "ok" : "err"}`}>{healths[i].ok ? "connected" : "error"}</span></td>
                    <td style={{ color: "var(--text-2)" }}>{healths[i].detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {demo && (
            <div className="card-body" style={{ borderTop: "1px solid var(--line)" }}>
              <div className="kv">
                <div className="k">To connect a real source</div>
                <div className="v mono" style={{ color: "var(--text-2)" }}>
                  Set <code>SOURCE_NIGHT_RUN_URL</code> (a read-only Postgres role) in your
                  environment and redeploy. See README for the full variable list.
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Agent model</h2>
            <span className={`tag ${provider.free ? "ok" : "warn"}`}>{provider.free ? "free" : "paid"}</span>
          </div>
          <div className="card-body">
            <div className="kv">
              <div className="k">Active model</div>
              <div className="v mono">{provider.configured ? provider.label : "none configured"}</div>
            </div>
            <div className="kv">
              <div className="k">Cost</div>
              <div className="v" style={{ color: "var(--text-2)" }}>
                {provider.configured
                  ? provider.free
                    ? "Free tier. Metrics and significance checks are computed in code, not by the model, to stay well inside free limits."
                    : "This provider bills per token. See README for free alternatives (Gemini, Groq, local Ollama)."
                  : "Set GEMINI_API_KEY (free) to enable investigations. See README."}
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h2>Storage</h2></div>
          <div className="card-body">
            <div className="kv">
              <div className="k">Findings store</div>
              <div className="v mono">{persistent ? "postgres (persistent)" : "in-memory (resets on restart)"}</div>
            </div>
            {!persistent && (
              <div className="kv">
                <div className="k">To persist</div>
                <div className="v" style={{ color: "var(--text-2)" }}>
                  Set <code className="mono">MIMIR_DATABASE_URL</code> and run{" "}
                  <code className="mono">db/schema.sql</code> against it once.
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h2>Your access key</h2></div>
          <div className="card-body">
            <p style={{ color: "var(--text-2)", marginTop: 0, marginBottom: 10, fontSize: 12.5 }}>
              Kept only in this browser&apos;s local storage, sent as a header on Ask and
              Investigation requests. Required in production if <code className="mono">MIMIR_ACCESS_KEY</code>{" "}
              is set on the server; unnecessary for local development.
            </p>
            <AccessKeyField />
          </div>
        </div>
      </div>
    </>
  );
}
