import { NextResponse } from "next/server";
import { getOwnedSession } from "@/lib/engine/ownership";
import { toSessionView } from "@/lib/engine/serialize";
import { grantExecutionConsent } from "@/lib/engine/session";
import { errorResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lets the visitor allow a shared session to run. Ownership-gated like every
 * other `[id]` route, so only whoever opened the link can consent for it.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getOwnedSession(id);
  if (!session) return errorResponse(404, "Session not found");

  grantExecutionConsent(session);
  return NextResponse.json({ session: toSessionView(session) });
}
