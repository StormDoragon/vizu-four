import { NextResponse } from "next/server";
import { getSession } from "@/lib/engine/store";
import { toSessionView } from "@/lib/engine/serialize";
import { setMockOutputs } from "@/lib/engine/session";
import { errorResponse, readJsonBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface MockOutputsBody {
  jobId?: string;
  stepKey?: string;
  /** Pass null (or omit/empty) to clear the mock for this step. */
  outputs?: Record<string, string> | null;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) return errorResponse(404, "Session not found");

  const body = await readJsonBody<MockOutputsBody>(req);
  if (!body?.jobId || !body?.stepKey) {
    return errorResponse(400, "'jobId' and 'stepKey' are required");
  }
  const job = session.workflow.jobs[body.jobId];
  if (!job) return errorResponse(404, `Unknown job '${body.jobId}'`);
  const step = job.steps.find((s) => s.key === body.stepKey);
  if (!step) return errorResponse(404, `Unknown step '${body.stepKey}' in job '${body.jobId}'`);
  if (!step.uses) {
    return errorResponse(400, "Mock outputs only apply to 'uses:' steps");
  }

  setMockOutputs(session, body.jobId, body.stepKey, body.outputs ?? null);
  return NextResponse.json({ session: toSessionView(session) });
}
