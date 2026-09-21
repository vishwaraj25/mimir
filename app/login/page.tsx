import { MimirHead } from "../components/mimir-head";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 20 }}>
      <div className="card" style={{ width: "100%", maxWidth: 340, marginBottom: 0 }}>
        <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <MimirHead size={34} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>Mimir</div>
              <div style={{ color: "var(--text-3)", fontSize: 12 }}>Enter the access key to continue</div>
            </div>
          </div>
          <LoginForm next={next ?? "/"} />
        </div>
      </div>
    </div>
  );
}
