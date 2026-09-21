import "./globals.css";
import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { isDemoOnly } from "@/lib/connectors/registry";
import { hasPageAccess } from "@/lib/page-auth";
import { MimirHead } from "./components/mimir-head";
import { NavLink } from "./nav-link";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Mimir",
  description:
    "An agentic product analyst: connects to event telemetry, investigates on its own, shows its working.",
};

// Config, connection status and model choice live on Settings only -- the
// rest of the app is player behaviour, full stop. That split was the whole
// point of moving off the first cut of this UI.
const NAV = [
  ["", [["/", "Home", "◆"]]],
  ["Analytics", [
    ["/insights", "Insights", "◇"],
    ["/investigations", "Investigations", "▸"],
    ["/experiments", "Experiments", "⚙"],
  ]],
  ["Data", [["/data", "Schema", "▦"]]],
] as const;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Signed out means the only reachable page is /login: render it bare, so
  // the navigation (and whether a real source is connected) isn't shown to
  // someone who hasn't signed in.
  if (!(await hasPageAccess())) {
    return (
      <html lang="en" className={`${inter.variable} ${mono.variable}`}>
        <body style={{ fontFamily: "var(--font-sans), system-ui, sans-serif" }}>{children}</body>
      </html>
    );
  }

  const demo = isDemoOnly();

  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body style={{ fontFamily: "var(--font-sans), system-ui, sans-serif" }}>
        <div className="app">
          <nav className="rail">
            <div className="rail-brand">
              <MimirHead size={30} />
              <div>
                <b>Mimir</b>
                <i>analyst</i>
              </div>
            </div>

            {NAV.map(([group, links]) => (
              <div key={group || "root"}>
                {group && <div className="rail-group">{group}</div>}
                {links.map(([href, label, icon]) => (
                  <NavLink key={href} href={href} label={label} icon={icon} />
                ))}
              </div>
            ))}

            <div className="rail-foot">
              {demo && (
                <div className="card" style={{ marginBottom: 8 }}>
                  <span className="tag warn">synthetic data</span>
                </div>
              )}
              <NavLink href="/settings" label="Settings" icon="⚬" />
            </div>
          </nav>

          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
