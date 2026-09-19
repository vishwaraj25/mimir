import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Mimir — AI Product Analyst",
  description:
    "An agentic analyst that connects to event-level telemetry, investigates on its own, and explains what it found.",
};

const NAV = [
  { group: "Monitor", links: [["/", "Overview"], ["/insights", "Insights"]] },
  { group: "Investigate", links: [["/ask", "Ask Analyst"], ["/investigations", "Investigations"]] },
  { group: "Act", links: [["/experiments", "Experiments"]] },
  { group: "Source", links: [["/data", "Data & Events"]] },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <nav className="sidebar">
            <div className="logo">MIMIR<span>.</span></div>
            <div className="logo-sub">ai product analyst</div>
            {NAV.map((section) => (
              <div key={section.group}>
                <div className="nav-label">{section.group}</div>
                {section.links.map(([href, label]) => (
                  <a key={href} href={href} className="nav-link">{label}</a>
                ))}
              </div>
            ))}
          </nav>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
