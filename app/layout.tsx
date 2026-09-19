import "./globals.css";
import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { describeProvider } from "@/lib/llm";
import { defaultSource, isDemoOnly } from "@/lib/connectors/registry";
import { store } from "@/lib/store";
import { NavLink } from "./nav-link";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Mimir",
  description:
    "An agentic product analyst: connects to event telemetry, investigates on its own, shows its working.",
};

const NAV = [
  ["Monitor", [["/", "Overview"], ["/insights", "Insights"]]],
  ["Investigate", [["/ask", "Ask"], ["/investigations", "Investigations"]]],
  ["Act", [["/experiments", "Experiments"]]],
  ["Source", [["/data", "Data & events"]]],
] as const;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const provider = describeProvider();
  const demo = isDemoOnly();
  const source = defaultSource();
  const persistent = store().persistent;

  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body style={{ fontFamily: "var(--font-sans), system-ui, sans-serif" }}>
        <div className="app">
          <nav className="rail">
            <div className="rail-brand">
              <b>Mimir</b>
              <i>analyst</i>
            </div>

            {NAV.map(([group, links]) => (
              <div key={group}>
                <div className="rail-group">{group}</div>
                {links.map(([href, label]) => (
                  <NavLink key={href} href={href} label={label} />
                ))}
              </div>
            ))}

            <div className="rail-foot">
              <div className="k">Source</div>
              <div className="v">
                {source.displayName}
                {demo && (
                  <span className="tag warn" style={{ marginLeft: 6 }}>
                    synthetic
                  </span>
                )}
              </div>
              <div className="k">Model</div>
              <div className="v">
                {provider.label}
                {provider.configured && (
                  <span className={`tag ${provider.free ? "ok" : "warn"}`} style={{ marginLeft: 6 }}>
                    {provider.free ? "free" : "paid"}
                  </span>
                )}
              </div>
              <div className="k">Store</div>
              <div className="v">{persistent ? "postgres" : "in-memory (resets)"}</div>
            </div>
          </nav>

          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
