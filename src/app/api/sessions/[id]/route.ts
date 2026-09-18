import { NextResponse } from "next/server";
import { deleteSessionAndWorkspace, getSession } from "@/lib/engine/store";
import { toSessionView } from "@/lib/engine/serialize";
import { errorResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) return errorResponse(404, "Session not found");
  return NextResponse.json({ session: toSessionView(session) });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await deleteSessionAndWorkspace(id);
  return NextResponse.json({ ok: true });
}
