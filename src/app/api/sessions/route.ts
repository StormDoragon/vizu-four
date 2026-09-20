import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { NextResponse } from "next/server";
import { parseWorkflow } from "@/lib/workflow/parser";
import { createSession } from "@/lib/engine/session";
import { EngineError } from "@/lib/engine/errors";
import { countSessionsByOwner, listSessions, saveSession } from "@/lib/engine/store";
import { ensureOwnerId } from "@/lib/engine/ownership";
import {
  MAX_LIVE_SESSIONS_PER_OWNER,
  MAX_LIVE_SESSIONS_TOTAL,
  checkCreateLimit,
  clientAddressFrom,
} from "@/lib/engine/rateLimit";
import { warnIfUnsafeDeployment } from "@/lib/deployment";
import { toSessionView } from "@/lib/engine/serialize";
import type { RunConfig } from "@/lib/engine/types";
import { MAX_WORKFLOW_YAML_LENGTH, validateRunConfigPatch } from "@/lib/engine/validateRequest";
import { assertRealWorkspaceAllowed, resolveWorkingTree, WorkspaceError } from "@/lib/engine/workspaceBrowse";
import { errorResponse, readJsonBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CreateSessionBody {
  workflowYaml?: string;
  sourcePath?: string;
  config?: Partial<RunConfig>;
  /** Opt-in: run this session's `run:` steps against a real directory on
   * disk instead of a disposable scratch workspace. Never inferred - the
   * client must explicitly send this, separate from `sourcePath`, which is
   * purely cosmetic (used in parse-error messages). */
  workingTreeDir?: string;
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
  const { workflowYaml, sourcePath, config, workingTreeDir } = body;
  if (typeof workflowYaml !== "string" || workflowYaml.trim() === "") {
    return errorResponse(400, "'workflowYaml' is required");
  }
  if (workflowYaml.length > MAX_WORKFLOW_YAML_LENGTH) {
    return errorResponse(400, `'workflowYaml' exceeds the ${MAX_WORKFLOW_YAML_LENGTH}-character limit`);
  }
  if (sourcePath !== undefined && typeof sourcePath !== "string") {
    return errorResponse(400, "'sourcePath' must be a string");
  }
  if (workingTreeDir !== undefined && (typeof workingTreeDir !== "string" || workingTreeDir.trim() === "")) {
    return errorResponse(400, "'workingTreeDir' must be a non-empty string");
  }
  const configError = validateRunConfigPatch(config);
  if (configError) return errorResponse(400, configError);

  let realWorkspaceDir: string | undefined;
  if (workingTreeDir !== undefined) {
    try {
      assertRealWorkspaceAllowed();
      realWorkspaceDir = await resolveWorkingTree(workingTreeDir);
    } catch (err) {
      if (err instanceof WorkspaceError) return errorResponse(err.status, err.message);
      throw err;
    }
  }

  const { workflow, issues } = parseWorkflow(workflowYaml, sourcePath);
  if (!workflow) {
    return errorResponse(400, "Workflow failed to parse", { issues });
  }

  const ownerId = await ensureOwnerId();

  // Checked before mkdtemp, so a refused request leaves nothing behind.
  const limit = checkCreateLimit(ownerId, clientAddressFrom(req.headers));
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error:
          limit.scope === "global"
            ? "This demo instance is busy right now. Try again shortly, or run it locally."
            : "Too many sessions created recently. Try again shortly.",
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }
  if (countSessionsByOwner(ownerId) >= MAX_LIVE_SESSIONS_PER_OWNER) {
    return errorResponse(
      429,
      `You already have ${MAX_LIVE_SESSIONS_PER_OWNER} sessions open. Close one (or wait for it to be reclaimed) before starting another.`
    );
  }
  // Bounds the whole instance, not one visitor: sessions hold captured output
  // in memory, and the per-owner cap above is only as good as an owner id the
  // visitor can discard.
  if (listSessions().length >= MAX_LIVE_SESSIONS_TOTAL) {
    return errorResponse(
      429,
      "This demo instance is holding as many sessions as it will at once. Try again shortly, or run it locally."
    );
  }

  const workspaceDir =
    realWorkspaceDir ?? (await fs.mkdtemp(path.join(os.tmpdir(), "actions-debugger-ws-")));
  let session;
  try {
    session = createSession({
      workflow,
      workspaceDir,
      usesRealWorkspace: realWorkspaceDir !== undefined,
      ownerId,
      config,
      parseIssues: issues,
    });
  } catch (err) {
    // Only ever the scratch dir this request just made - never a real
    // working tree the user pointed the debugger at.
    if (realWorkspaceDir === undefined) {
      await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => {});
    }
    if (err instanceof EngineError) return errorResponse(400, err.message);
    throw err;
  }
  saveSession(session);

  return NextResponse.json({ session: toSessionView(session), issues });
}
