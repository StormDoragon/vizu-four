import { NextResponse } from "next/server";
import { ensureOwnerId, getOwnedSession } from "@/lib/engine/ownership";
import { checkEvaluateLimit, clientAddressFrom } from "@/lib/engine/rateLimit";
import { buildEvalContext, resolveEffectiveEnv } from "@/lib/engine/contexts";
import {
  maskObjectStrings,
  maskSecrets,
  secretsToMask,
  type SecretValues,
} from "@/lib/engine/masking";
import type { EvalContext } from "@/lib/expressions/evaluator";
import { evaluateExpressionTraced, type TraceNode } from "@/lib/expressions/trace";
import { findExpressionSpans } from "@/lib/expressions/interpolate";
import { sampleEvalContext } from "@/lib/expressions/sampleContext";
import { errorResponse, readJsonBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface EvaluateBody {
  expression?: unknown;
  sessionId?: unknown;
  laneId?: unknown;
}

/**
 * Ceiling on the expression text itself.
 *
 * The evaluator caps the values a call may produce, which bounds the work an
 * expression can do; this bounds the work it takes to reach the evaluator at
 * all - parsing is recursive descent, so arbitrarily long input is also
 * arbitrarily deep nesting. Far above anything anyone types into the
 * playground by hand or pastes out of a workflow.
 */
const MAX_EXPRESSION_CHARS = 8_000;

/**
 * Ceilings on the response.
 *
 * The evaluator's cap bounds what one call may build, but a trace carries a
 * value *and* a source label per node, so an expression comfortably under
 * that cap still answered with a response orders of magnitude larger than
 * the request - a maximal 7.9KB expression produced ~1MB. Per-string caps
 * alone don't fix that, because the node count grows with the input too, so
 * the budget below is shared across the whole response: strings are capped
 * individually, and the trace stops being walked once the total is spent.
 *
 * The playground shows a tree of sub-expressions; neither a 65,000-character
 * value at one node nor a thousand nodes is something it can display.
 *
 * All of this runs strictly after masking. Truncating first and masking the
 * remainder is the leak this codebase keeps finding: the discarded tail is
 * what the retained head needed to be matched against.
 */
const MAX_DISPLAY_CHARS = 2_000;
const MAX_RESPONSE_CHARS = 120_000;

interface Budget {
  left: number;
}

function truncateStrings<T>(value: T, budget: Budget): T {
  if (typeof value === "string") {
    const capped =
      value.length > MAX_DISPLAY_CHARS
        ? `${value.slice(0, MAX_DISPLAY_CHARS)}… (${value.length} characters)`
        : value;
    budget.left -= capped.length;
    return capped as unknown as T;
  }
  if (Array.isArray(value)) return value.map((v) => truncateStrings(v, budget)) as unknown as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        truncateStrings(v, budget),
      ])
    ) as T;
  }
  return value;
}

/** Depth-first within the shared budget; a subtree that doesn't fit is
 * dropped and the node says so rather than being silently childless. */
function shapeTrace(node: TraceNode, budget: Budget): TraceNode & { truncated?: boolean } {
  const { children, ...rest } = node;
  const shaped = truncateStrings(rest, budget) as TraceNode;
  if (children.length === 0) return { ...shaped, children: [] };
  if (budget.left <= 0) return { ...shaped, children: [], truncated: true };
  return { ...shaped, children: children.map((c) => shapeTrace(c, budget)) };
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
  const expression = body?.expression;
  // Type first: `.trim()` on a number threw, which answered a malformed
  // request with a 500 as though the server had failed.
  if (typeof expression !== "string") {
    return errorResponse(400, "'expression' is required and must be a string");
  }
  if (expression.trim() === "") {
    return errorResponse(400, "'expression' is required");
  }
  if (expression.length > MAX_EXPRESSION_CHARS) {
    return errorResponse(400, `'expression' must be at most ${MAX_EXPRESSION_CHARS} characters`);
  }

  // This endpoint needs no session, so nothing else on it costs a visitor
  // anything - session creation limits never see this traffic. Its own
  // allowance is generous (the playground evaluates as you type) and lives
  // in a separate bucket, so using it cannot block opening a session.
  const ownerId = await ensureOwnerId();
  const limit = checkEvaluateLimit(ownerId, clientAddressFrom(req.headers));
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error:
          limit.scope === "global"
            ? "This demo instance is busy right now. Try again shortly, or run it locally."
            : "Too many expressions evaluated recently. Try again shortly.",
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : undefined;
  const laneId = typeof body?.laneId === "string" ? body.laneId : undefined;

  let secrets: SecretValues = [];
  let sessionCtx: EvalContext | null = null;
  if (sessionId && laneId) {
    // Ownership-gated like every `[id]` route: this endpoint takes a session
    // id in its body and answers with that session's env, vars and masked
    // secrets, so an unowned id has to fall through to the sample context
    // rather than quietly evaluate against someone else's session.
    const session = await getOwnedSession(sessionId);
    const lane = session?.lanes[laneId];
    if (session && lane) {
      // Includes retired values: a secret this session has since replaced or
      // deleted can still be sitting in the context this evaluates against.
      secrets = secretsToMask(session.config.secrets, session.retiredSecretValues);
      const effectiveEnv = resolveEffectiveEnv(session, lane, lane.pointer, undefined);
      sessionCtx = buildEvalContext(session, lane, { uptoStepIndex: lane.pointer, effectiveEnv });
    }
  }
  const evalCtx = sessionCtx ?? sampleEvalContext();

  const { trace, result, error, errorPosition } = evaluateExpressionTraced(
    stripWrapper(expression),
    evalCtx
  );
  // Mask, then shape for display - never the other way round. The result and
  // the error are shaped first so a large trace can never crowd them out.
  const budget: Budget = { left: MAX_RESPONSE_CHARS };
  return NextResponse.json({
    result:
      result !== undefined
        ? truncateStrings(maskObjectStrings(result, secrets), budget)
        : undefined,
    // An error can quote the value that caused it, e.g. fromJSON(secrets.TOKEN)
    // reports the text it could not parse - masked like `result` and `trace`.
    error: error ? truncateStrings(maskSecrets(error, secrets), budget) : error,
    errorPosition,
    // The trace can surface a secret's own value at the node that reads it
    // (e.g. `secrets.TOKEN` itself), same as `result` above - masked the
    // same way rather than trusting every node along the way to be safe.
    trace: trace ? shapeTrace(maskObjectStrings(trace, secrets), budget) : undefined,
  });
}
