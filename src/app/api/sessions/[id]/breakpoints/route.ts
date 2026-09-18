import { NextResponse } from "next/server";
import { getSession } from "@/lib/engine/store";
import { toSessionView } from "@/lib/engine/serialize";
import { setBreakpoint } from "@/lib/engine/session";
import { errorResponse, readJsonBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface BreakpointBody {
  jobId?: string;
  stepKey?: string;
  enabled?: boolean;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) return errorResponse(404, "Session not found");

  const body = await readJsonBody<BreakpointBody>(req);
  if (!body?.jobId || !body?.stepKey || typeof body.enabled !== "boolean") {
    return errorResponse(400, "'jobId', 'stepKey', and boolean 'enabled' are required");
  }
  if (!session.workflow.jobs[body.jobId]) {
    return errorResponse(404, `Unknown job '${body.jobId}'`);
  }

  setBreakpoint(session, body.jobId, body.stepKey, body.enabled);
  return NextResponse.json({ session: toSessionView(session) });
}
