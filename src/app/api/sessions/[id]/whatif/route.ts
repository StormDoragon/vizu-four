import { NextResponse } from "next/server";
import { getOwnedSession } from "@/lib/engine/ownership";
import { toSessionView } from "@/lib/engine/serialize";
import { applyWhatIf, type WhatIfPatch } from "@/lib/engine/session";
import { errorResponse, readJsonBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getOwnedSession(id);
  if (!session) return errorResponse(404, "Session not found");

  const body = await readJsonBody<WhatIfPatch>(req);
  if (!body) return errorResponse(400, "Invalid JSON body");

  applyWhatIf(session, body);
  return NextResponse.json({ session: toSessionView(session) });
}
