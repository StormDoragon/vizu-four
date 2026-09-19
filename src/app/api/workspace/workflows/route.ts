import { NextResponse } from "next/server";
import { listWorkflowFiles, assertRealWorkspaceAllowed, WorkspaceError } from "@/lib/engine/workspaceBrowse";
import { errorResponse, readJsonBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ListWorkflowsBody {
  directory?: string;
}

/**
 * Lists `.github/workflows/*.yml` under a directory on the host filesystem,
 * for the "open a workflow from the repo" flow. Gated the same way the
 * `workingTreeDir` session opt-in is - a shared simulation-only deployment
 * has no business letting a visitor enumerate paths on the host, even
 * though `run:` itself is already disabled there.
 */
export async function POST(req: Request) {
  try {
    assertRealWorkspaceAllowed();
  } catch (err) {
    if (err instanceof WorkspaceError) return errorResponse(err.status, err.message);
    throw err;
  }

  const body = await readJsonBody<ListWorkflowsBody>(req);
  if (!body || typeof body.directory !== "string" || body.directory.trim() === "") {
    return errorResponse(400, "'directory' is required");
  }

  try {
    const files = await listWorkflowFiles(body.directory);
    return NextResponse.json({ files });
  } catch (err) {
    if (err instanceof WorkspaceError) return errorResponse(err.status, err.message);
    throw err;
  }
}
