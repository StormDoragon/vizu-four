import { NextResponse } from "next/server";
import { EngineError } from "@/lib/engine/errors";
import { getOwnedSession } from "@/lib/engine/ownership";
import { toSessionView } from "@/lib/engine/serialize";
import { applyWhatIf, type WhatIfPatch } from "@/lib/engine/session";
import { validateWhatIfPatch } from "@/lib/engine/validateRequest";
import { errorResponse, readJsonBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getOwnedSession(id);
  if (!session) return errorResponse(404, "Session not found");

  const body = await readJsonBody<WhatIfPatch>(req);
  if (!body) return errorResponse(400, "Invalid JSON body");
  const invalid = validateWhatIfPatch(body);
  if (invalid) return errorResponse(400, invalid);

  try {
    applyWhatIf(session, body);
  } catch (err) {
    // The only thing `applyWhatIf` refuses is a patch that would push the
    // session's accumulated configuration past its limits - a property of
    // the request, so 400 rather than 409 or 500.
    if (err instanceof EngineError) return errorResponse(400, err.message);
    throw err;
  }
  return NextResponse.json({ session: toSessionView(session) });
}
