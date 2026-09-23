import { NextResponse } from "next/server";
import { getOwnedSession } from "@/lib/engine/ownership";
import { toSessionView } from "@/lib/engine/serialize";
import { findWorkflowJob, findWorkflowStep, setBreakpoint } from "@/lib/engine/session";
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
  const session = await getOwnedSession(id);
  if (!session) return errorResponse(404, "Session not found");

  const body = await readJsonBody<BreakpointBody>(req);
  if (!body?.jobId || !body?.stepKey || typeof body.enabled !== "boolean") {
    return errorResponse(400, "'jobId', 'stepKey', and boolean 'enabled' are required");
  }
  if (!findWorkflowJob(session, body.jobId)) {
    return errorResponse(404, `Unknown job '${body.jobId}'`);
  }
  // The step has to exist too, the same way the mock-outputs route checks it.
  // Without this, `enabled: true` took any string at all: a typo silently
  // "succeeded" while never matching a step, and `session.breakpoints` - a
  // Set with no bound of its own - grew by one caller-chosen entry per
  // request for the session's lifetime.
  if (!findWorkflowStep(session, body.jobId, body.stepKey)) {
    return errorResponse(404, `Unknown step '${body.stepKey}' in job '${body.jobId}'`);
  }

  setBreakpoint(session, body.jobId, body.stepKey, body.enabled);
  return NextResponse.json({ session: toSessionView(session) });
}
