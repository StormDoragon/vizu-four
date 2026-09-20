import { NextResponse } from "next/server";
import { getOwnedSession } from "@/lib/engine/ownership";
import { buildEvalContext, resolveEffectiveEnv } from "@/lib/engine/contexts";
import { maskObjectStrings } from "@/lib/engine/masking";
import { errorResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getOwnedSession(id);
  if (!session) return errorResponse(404, "Session not found");

  const url = new URL(req.url);
  const laneId = url.searchParams.get("laneId");
  const lane = laneId ? session.lanes[laneId] : undefined;
  if (!lane) return errorResponse(404, "Unknown or missing 'laneId'");

  // Defaults to the lane's own pointer (its current position) but a caller
  // can ask for the context as of any already-executed step - e.g. the step
  // the user actually clicked on, rather than always the pointer's step.
  // Clamped so a request can't peek at a step that hasn't run yet.
  const stepIndexParam = url.searchParams.get("stepIndex");
  const requestedIndex = stepIndexParam === null ? NaN : Number(stepIndexParam);
  const uptoStepIndex = Number.isFinite(requestedIndex)
    ? Math.max(0, Math.min(requestedIndex, lane.pointer))
    : lane.pointer;

  // A step that has already run carries the environment it was actually
  // given. Recomputing instead would answer with the present: a later
  // `$GITHUB_ENV` write, or a What-If override applied since, rewrote what
  // every earlier step appeared to have seen. The step at the pointer has
  // not run yet, so there it is still a live question - and the answer
  // should include pending overrides, since that is what running it now
  // would use.
  const recorded = uptoStepIndex < lane.pointer ? lane.steps[uptoStepIndex]?.envBefore : undefined;
  const effectiveEnv = recorded ?? resolveEffectiveEnv(session, lane, uptoStepIndex, undefined);
  const evalCtx = buildEvalContext(session, lane, { uptoStepIndex, effectiveEnv });

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
