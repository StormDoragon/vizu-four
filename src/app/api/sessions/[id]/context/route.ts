import { NextResponse } from "next/server";
import { getSession } from "@/lib/engine/store";
import { buildEvalContext, resolveEffectiveEnv } from "@/lib/engine/contexts";
import { maskObjectStrings } from "@/lib/engine/masking";
import { errorResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) return errorResponse(404, "Session not found");

  const laneId = new URL(req.url).searchParams.get("laneId");
  const lane = laneId ? session.lanes[laneId] : undefined;
  if (!lane) return errorResponse(404, "Unknown or missing 'laneId'");

  const effectiveEnv = resolveEffectiveEnv(session, lane, lane.pointer, undefined);
  const evalCtx = buildEvalContext(session, lane, { uptoStepIndex: lane.pointer, effectiveEnv });

  // Belt-and-suspenders: mask any secret value that leaked into another
  // context (e.g. via `env: TOKEN: ${{ secrets.TOKEN }}`), then replace the
  // secrets context itself with a same-shaped, always-masked placeholder so
  // the inspector can show which secret *names* exist without ever sending
  // a real value to the client.
  const masked = maskObjectStrings(evalCtx.contexts, session.config.secrets);
  const secretsDisplay = Object.fromEntries(
    Object.keys(session.config.secrets).map((k) => [k, "***"])
  );

  return NextResponse.json({
    context: { ...masked, secrets: secretsDisplay },
    pointer: lane.pointer,
  });
}
