import { NextResponse } from "next/server";
import { getOwnedSession } from "@/lib/engine/ownership";
import { buildEvalContext, resolveEffectiveEnv } from "@/lib/engine/contexts";
import { maskObjectStrings } from "@/lib/engine/masking";
import { evaluateExpression, type EvalContext } from "@/lib/expressions/evaluator";
import { findExpressionSpans } from "@/lib/expressions/interpolate";
import { sampleEvalContext } from "@/lib/expressions/sampleContext";
import { errorResponse, readJsonBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface EvaluateBody {
  expression?: string;
  sessionId?: string;
  laneId?: string;
}

/**
 * Pasting an expression straight out of a workflow file (the obvious thing
 * to do here, whatever the placeholder hint says) comes wrapped in
 * `${{ ... }}`, which this playground evaluates as a raw expression - so
 * that wrapper must be stripped first, exactly like a step/job `if:` does
 * when it's a single whole-string expression.
 */
function stripWrapper(expression: string): string {
  const trimmed = expression.trim();
  const spans = findExpressionSpans(trimmed);
  if (spans.length === 1 && spans[0].start === 0 && spans[0].end === trimmed.length) {
    return spans[0].expr.trim();
  }
  return trimmed;
}

export async function POST(req: Request) {
  const body = await readJsonBody<EvaluateBody>(req);
  if (!body?.expression || body.expression.trim() === "") {
    return errorResponse(400, "'expression' is required");
  }

  let secrets: Record<string, string> = {};
  let sessionCtx: EvalContext | null = null;
  if (body.sessionId && body.laneId) {
    // Ownership-gated like every `[id]` route: this endpoint takes a session
    // id in its body and answers with that session's env, vars and masked
    // secrets, so an unowned id has to fall through to the sample context
    // rather than quietly evaluate against someone else's session.
    const session = await getOwnedSession(body.sessionId);
    const lane = session?.lanes[body.laneId];
    if (session && lane) {
      secrets = session.config.secrets;
      const effectiveEnv = resolveEffectiveEnv(session, lane, lane.pointer, undefined);
      sessionCtx = buildEvalContext(session, lane, { uptoStepIndex: lane.pointer, effectiveEnv });
    }
  }
  const evalCtx = sessionCtx ?? sampleEvalContext(process.cwd());

  try {
    const result = evaluateExpression(stripWrapper(body.expression), evalCtx);
    return NextResponse.json({ result: maskObjectStrings(result, secrets) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message });
  }
}
