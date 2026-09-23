import { NextResponse } from "next/server";
import { ensureOwnerId, getOwnedSession } from "@/lib/engine/ownership";
import { checkExplainLimit, clientAddressFrom } from "@/lib/engine/rateLimit";
import { explainFailure, type ExplainInput } from "@/lib/ai/explain";
import { findLane } from "@/lib/engine/session";
import { errorResponse, readJsonBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ExplainBody {
  laneId?: string;
  stepIndex?: number;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getOwnedSession(id);
  if (!session) return errorResponse(404, "Session not found");

  // With an API key configured this is the only request that spends money.
  // The spend cap itself lives in `lib/ai/budget` and applies instance-wide;
  // this stops one visitor consuming all of it before anyone else can.
  const limit = checkExplainLimit(await ensureOwnerId(), clientAddressFrom(req.headers));
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many explanations requested recently. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  const body = await readJsonBody<ExplainBody>(req);
  if (!body?.laneId || typeof body.stepIndex !== "number") {
    return errorResponse(400, "'laneId' and numeric 'stepIndex' are required");
  }

  const lane = findLane(session, body.laneId);
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
