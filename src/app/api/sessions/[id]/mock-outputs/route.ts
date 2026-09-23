import { NextResponse } from "next/server";
import { getOwnedSession } from "@/lib/engine/ownership";
import { toSessionView } from "@/lib/engine/serialize";
import { findWorkflowJob, findWorkflowStep, setMockOutputs } from "@/lib/engine/session";
import type { StepMock } from "@/lib/engine/types";
import { errorResponse, readJsonBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface MockOutputsBody {
  jobId?: string;
  stepKey?: string;
  /** Pass null (or omit) to clear the mock for this step. */
  mock?: Partial<StepMock> | null;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getOwnedSession(id);
  if (!session) return errorResponse(404, "Session not found");

  const body = await readJsonBody<MockOutputsBody>(req);
  if (!body?.jobId || !body?.stepKey) {
    return errorResponse(400, "'jobId' and 'stepKey' are required");
  }
  if (!findWorkflowJob(session, body.jobId)) {
    return errorResponse(404, `Unknown job '${body.jobId}'`);
  }
  const step = findWorkflowStep(session, body.jobId, body.stepKey);
  if (!step) return errorResponse(404, `Unknown step '${body.stepKey}' in job '${body.jobId}'`);
  if (!step.uses && step.run === undefined) {
    return errorResponse(400, "Step has neither 'run' nor 'uses', so there is nothing to mock");
  }

  const mock = body.mock ? normalizeMock(body.mock) : null;
  if (mock instanceof Error) return errorResponse(400, mock.message);

  setMockOutputs(session, body.jobId, body.stepKey, mock);
  return NextResponse.json({ session: toSessionView(session) });
}

/**
 * The body crosses a trust boundary, so coerce it into a StepMock rather than
 * trusting its shape. An exit code that isn't a whole number in range would
 * otherwise end up rendered back to the user as a step's exit status.
 */
function normalizeMock(raw: Partial<StepMock>): StepMock | Error {
  const outputs: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw.outputs ?? {})) {
    if (typeof value !== "string") {
      return new Error(`Mock output '${key}' must be a string`);
    }
    outputs[key] = value;
  }
  if (raw.exitCode !== undefined && raw.exitCode !== null) {
    if (!Number.isInteger(raw.exitCode) || raw.exitCode < 0 || raw.exitCode > 255) {
      return new Error("'exitCode' must be an integer between 0 and 255");
    }
  }
  if (raw.stderr !== undefined && raw.stderr !== null && typeof raw.stderr !== "string") {
    return new Error("'stderr' must be a string");
  }
  return {
    outputs,
    exitCode: raw.exitCode ?? undefined,
    stderr: raw.stderr || undefined,
  };
}
