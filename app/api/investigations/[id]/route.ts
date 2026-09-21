import { checkAccess, unauthorized } from "@/lib/auth";
import { store } from "@/lib/store";

/** Trail for one investigation. Polled by the Overview page while it runs. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await checkAccess(request);
  if (!auth.ok) return unauthorized(auth.error);

  const { id } = await params;
  if (!/^\d{1,12}$/.test(id)) return Response.json({ error: "not_found" }, { status: 404 });

  const data = await store().getInvestigation(Number(id));
  if (!data.investigation) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json(data);
}
