import { NextResponse } from "next/server";
import { getOwnedSession } from "@/lib/engine/ownership";
import { buildEvalContext, resolveEffectiveEnv } from "@/lib/engine/contexts";
import { maskObjectStrings, secretsToMask } from "@/lib/engine/masking";
import { errorResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A finite query parameter, or undefined when absent or unparseable. */
function numericParam(url: URL, name: string): number | undefined {
  const raw = url.searchParams.get(name);
  if (raw === null) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getOwnedSession(id);
  if (!session) return errorResponse(404, "Session not found");

  const url = new URL(req.url);
  const laneId = url.searchParams.get("laneId");
  const lane = laneId ? session.lanes[laneId] : undefined;
  if (!lane) return errorResponse(404, "Unknown or missing 'laneId'");

  // Two different questions land on the same step index, so the caller says
  // which it is asking.
  //
  //   afterStepIndex=N - "what did step N leave behind?" Historical: it is
  //     answered from what that step actually recorded, and never moves when
  //     a later step writes `$GITHUB_ENV` or a What-If override is applied.
  //   stepIndex=K - "what would step K be given?" Live for a step that has
  //     not run, so pending overrides are included; historical for one that
  //     has, from its own recorded snapshot.
  //
  // The inspector asks about the step the user clicked, which is the first
  // question whenever that step has finished. Overloading one index for both
  // made the last completed step - the common case, since stepping selects
  // it - answer with the environment the *next* step would get right now.
  const afterParam = numericParam(url, "afterStepIndex");
  const afterIndex =
    afterParam !== undefined && afterParam >= 0 && afterParam < lane.pointer
      ? Math.floor(afterParam)
      : undefined;

  // Clamped so a request can't peek at a step that hasn't run yet.
  const clamp = (n: number) => Math.max(0, Math.min(Math.floor(n), lane.pointer));
  const requested = numericParam(url, "stepIndex");
  const uptoStepIndex =
    afterIndex !== undefined
      ? clamp(afterIndex + 1)
      : requested !== undefined
        ? clamp(requested)
        : lane.pointer;

  const recorded =
    afterIndex !== undefined
      ? lane.steps[afterIndex]?.envAfter
      : uptoStepIndex < lane.pointer
        ? lane.steps[uptoStepIndex]?.envBefore
        : undefined;
  const effectiveEnv = recorded ?? resolveEffectiveEnv(session, lane, uptoStepIndex, undefined);
  const evalCtx = buildEvalContext(session, lane, { uptoStepIndex, effectiveEnv });

  // Belt-and-suspenders: mask any secret value that leaked into another
  // context (e.g. via `env: TOKEN: ${{ secrets.TOKEN }}`), then replace the
  // secrets context itself with a same-shaped, always-masked placeholder so
  // the inspector can show which secret *names* exist without ever sending
  // a real value to the client.
  const masked = maskObjectStrings(
    evalCtx.contexts,
    secretsToMask(session.config.secrets, session.retiredSecretValues)
  );
  const secretsDisplay = Object.fromEntries(
    Object.keys(session.config.secrets).map((k) => [k, "***"])
  );

  return NextResponse.json({
    context: { ...masked, secrets: secretsDisplay },
    pointer: lane.pointer,
  });
}
