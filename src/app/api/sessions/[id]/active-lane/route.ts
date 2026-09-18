import { NextResponse } from "next/server";
import { getSession } from "@/lib/engine/store";
import { toSessionView } from "@/lib/engine/serialize";
import { setActiveLane } from "@/lib/engine/session";
import { EngineError } from "@/lib/engine/errors";
import { errorResponse, readJsonBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) return errorResponse(404, "Session not found");

  const body = await readJsonBody<{ laneId?: string }>(req);
  if (!body?.laneId) return errorResponse(400, "'laneId' is required");

  try {
    setActiveLane(session, body.laneId);
  } catch (err) {
    if (err instanceof EngineError) return errorResponse(404, err.message);
    throw err;
  }
  return NextResponse.json({ session: toSessionView(session) });
}
