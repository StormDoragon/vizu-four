import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { NextResponse } from "next/server";
import { parseWorkflow } from "@/lib/workflow/parser";
import { createSession } from "@/lib/engine/session";
import { saveSession, listSessions } from "@/lib/engine/store";
import { toSessionView } from "@/lib/engine/serialize";
import type { RunConfig } from "@/lib/engine/types";
import { errorResponse, readJsonBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CreateSessionBody {
  workflowYaml?: string;
  sourcePath?: string;
  config?: Partial<RunConfig>;
}

export async function GET() {
  const sessions = listSessions().map((s) => ({
    id: s.id,
    createdAt: s.createdAt,
    name: s.workflow.name,
  }));
  return NextResponse.json({ sessions });
}

export async function POST(req: Request) {
  const body = await readJsonBody<CreateSessionBody>(req);
  if (!body) return errorResponse(400, "Invalid JSON body");
  const { workflowYaml, sourcePath, config } = body;
  if (typeof workflowYaml !== "string" || workflowYaml.trim() === "") {
    return errorResponse(400, "'workflowYaml' is required");
  }

  const { workflow, issues } = parseWorkflow(workflowYaml, sourcePath);
  if (!workflow) {
    return errorResponse(400, "Workflow failed to parse", { issues });
  }

  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "actions-debugger-ws-"));
  const session = createSession({ workflow, workspaceDir, config });
  saveSession(session);

  return NextResponse.json({ session: toSessionView(session), issues });
}
