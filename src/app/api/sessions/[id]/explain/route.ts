import { NextResponse } from "next/server";
import { getSession } from "@/lib/engine/store";
import { explainFailure, type ExplainInput } from "@/lib/ai/explain";
import { errorResponse, readJsonBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ExplainBody {
  laneId?: string;
  stepIndex?: number;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) return errorResponse(404, "Session not found");

  const body = await readJsonBody<ExplainBody>(req);
  if (!body?.laneId || typeof body.stepIndex !== "number") {
    return errorResponse(400, "'laneId' and numeric 'stepIndex' are required");
  }

  const lane = session.lanes[body.laneId];
  if (!lane) return errorResponse(404, `Unknown lane '${body.laneId}'`);
  const job = session.workflow.jobs[lane.jobId];
  const step = job?.steps[body.stepIndex];
  const record = lane.steps[body.stepIndex];
  if (!step || !record) return errorResponse(404, "Unknown step index for this lane");

  const input: ExplainInput = {
    stepName: record.name,
    run: step.run,
    uses: step.uses,
    shell: step.shell,
    exitCode: record.exitCode ?? null,
    stdout: record.stdout,
    stderr: record.stderr,
    engineError: record.engineError,
    ifWarning: record.ifWarning,
    ifError: record.ifError,
    timedOut: record.engineError === "Step timed out",
  };

  const explanation = await explainFailure(input);
  return NextResponse.json({ explanation });
}
