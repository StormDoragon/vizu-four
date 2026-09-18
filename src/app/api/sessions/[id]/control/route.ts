import { NextResponse } from "next/server";
import { getSession } from "@/lib/engine/store";
import { toSessionView } from "@/lib/engine/serialize";
import { controlContinue, controlRunAll, controlRunToEnd, controlStep } from "@/lib/engine/session";
import { EngineError } from "@/lib/engine/errors";
import { errorResponse, readJsonBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Action = "step" | "continue" | "runToEnd" | "runAll";

interface ControlBody {
  action?: Action;
  laneId?: string;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) return errorResponse(404, "Session not found");

  const body = await readJsonBody<ControlBody>(req);
  if (!body?.action) return errorResponse(400, "'action' is required");

  try {
    switch (body.action) {
      case "step":
        if (!body.laneId) return errorResponse(400, "'laneId' is required for action 'step'");
        await controlStep(session, body.laneId);
        break;
      case "continue":
        if (!body.laneId) return errorResponse(400, "'laneId' is required for action 'continue'");
        await controlContinue(session, body.laneId);
        break;
      case "runToEnd":
        if (!body.laneId) return errorResponse(400, "'laneId' is required for action 'runToEnd'");
        await controlRunToEnd(session, body.laneId);
        break;
      case "runAll":
        await controlRunAll(session);
        break;
      default:
        return errorResponse(400, `Unknown action '${body.action}'`);
    }
  } catch (err) {
    if (err instanceof EngineError) return errorResponse(409, err.message);
    throw err;
  }

  return NextResponse.json({ session: toSessionView(session) });
}
