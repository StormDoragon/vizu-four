import { NextResponse } from "next/server";
import { deleteSessionAndWorkspace } from "@/lib/engine/store";
import { getOwnedSession } from "@/lib/engine/ownership";
import { toSessionView } from "@/lib/engine/serialize";
import { errorResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getOwnedSession(id);
  if (!session) return errorResponse(404, "Session not found");
  return NextResponse.json({ session: toSessionView(session) });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getOwnedSession(id);
  if (session) await deleteSessionAndWorkspace(id);
  // Deliberately the same answer whether the session was deleted, never
  // existed, or belongs to someone else: this stays idempotent for the
  // caller without confirming that an id exists.
  return NextResponse.json({ ok: true });
}
