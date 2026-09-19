import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { NextResponse } from "next/server";
import { parseWorkflow } from "@/lib/workflow/parser";
import { createSession } from "@/lib/engine/session";
import { countSessionsByOwner, saveSession } from "@/lib/engine/store";
import { ensureOwnerId } from "@/lib/engine/ownership";
import {
  MAX_LIVE_SESSIONS_PER_OWNER,
  checkCreateLimit,
} from "@/lib/engine/rateLimit";
import { warnIfUnsafeDeployment } from "@/lib/deployment";
import { toSessionView } from "@/lib/engine/serialize";
import type { RunConfig } from "@/lib/engine/types";
import { MAX_WORKFLOW_YAML_LENGTH, validateRunConfigPatch } from "@/lib/engine/validateRequest";
import { errorResponse, readJsonBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CreateSessionBody {
  workflowYaml?: string;
  sourcePath?: string;
  config?: Partial<RunConfig>;
}

// There is intentionally no GET here. Every session lives in one process-
// wide in-memory store with no per-visitor ownership check (see the
// "Security note" in README.md) - a bulk listing endpoint would let any
// caller enumerate every other session's id and then drive its /control,
// /context, etc. routes. The UI only ever needs the id it just created.

export async function POST(req: Request) {
  warnIfUnsafeDeployment();
  const body = await readJsonBody<CreateSessionBody>(req);
  if (!body) return errorResponse(400, "Invalid JSON body");
  const { workflowYaml, sourcePath, config } = body;
  if (typeof workflowYaml !== "string" || workflowYaml.trim() === "") {
    return errorResponse(400, "'workflowYaml' is required");
  }
  if (workflowYaml.length > MAX_WORKFLOW_YAML_LENGTH) {
    return errorResponse(400, `'workflowYaml' exceeds the ${MAX_WORKFLOW_YAML_LENGTH}-character limit`);
  }
  if (sourcePath !== undefined && typeof sourcePath !== "string") {
    return errorResponse(400, "'sourcePath' must be a string");
  }
  const configError = validateRunConfigPatch(config);
  if (configError) return errorResponse(400, configError);

  const { workflow, issues } = parseWorkflow(workflowYaml, sourcePath);
  if (!workflow) {
    return errorResponse(400, "Workflow failed to parse", { issues });
  }

  const ownerId = await ensureOwnerId();

  // Checked before mkdtemp, so a refused request leaves nothing behind.
  const limit = checkCreateLimit(ownerId);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many sessions created recently. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }
  if (countSessionsByOwner(ownerId) >= MAX_LIVE_SESSIONS_PER_OWNER) {
    return errorResponse(
      429,
      `You already have ${MAX_LIVE_SESSIONS_PER_OWNER} sessions open. Close one (or wait for it to be reclaimed) before starting another.`
    );
  }

  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "actions-debugger-ws-"));
  const session = createSession({ workflow, workspaceDir, ownerId, config, parseIssues: issues });
  saveSession(session);

  return NextResponse.json({ session: toSessionView(session), issues });
}
