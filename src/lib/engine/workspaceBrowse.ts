import fs from "node:fs/promises";
import path from "node:path";
import { isSimulationOnly } from "../deployment";
import { MAX_WORKFLOW_YAML_LENGTH } from "./validateRequest";

/** A user-facing error - the route layer maps this to `status` (400 by
 * default), distinct from an unexpected 500 for anything else that goes
 * wrong reading the disk. */
export class WorkspaceError extends Error {
  constructor(message: string, public status: number = 400) {
    super(message);
    this.name = "WorkspaceError";
  }
}

export interface WorkspaceWorkflowFile {
  /** Relative to the chosen directory, e.g. ".github/workflows/ci.yml". */
  relativePath: string;
  name: string;
  content: string;
}

/**
 * Real working-tree access - browsing the host filesystem by path, and
 * later pointing a session's `run:` steps at it - only makes sense for the
 * local-first, single-user deployment this tool defaults to. A shared
 * simulation-only deployment has no business letting a visitor enumerate
 * paths on the host, even though `run:` itself is already disabled there:
 * directory existence and contents are their own information leak.
 */
export function assertRealWorkspaceAllowed(): void {
  if (isSimulationOnly()) {
    throw new WorkspaceError("Real working-tree access is disabled in this deployment.", 403);
  }
}

/** Resolves and validates a user-supplied directory path. Relative paths
 * resolve against the server process's own cwd, so "." means "the repo the
 * debugger itself is running from" - the common case of debugging your own
 * project's workflows. */
export async function resolveWorkingTree(directory: string): Promise<string> {
  if (typeof directory !== "string" || directory.trim() === "") {
    throw new WorkspaceError("A directory is required");
  }
  // Deliberately dynamic - this is the whole point of the feature, letting
  // the operator point the debugger at an arbitrary directory on disk.
  // Turbopack's build-time file tracing can't know that in advance, so tell
  // it not to try (its own warning names this exact pattern as the fix).
  const resolved = path.resolve(/* turbopackIgnore: true */ process.cwd(), directory);
  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch {
    throw new WorkspaceError(`No such directory: ${resolved}`);
  }
  if (!stat.isDirectory()) {
    throw new WorkspaceError(`Not a directory: ${resolved}`);
  }
  return resolved;
}

/**
 * Lists `.github/workflows/*.yml`/`.yaml` under a chosen directory, with
 * their content, so the UI can offer them as one-click loads. Missing
 * `.github/workflows` is not an error - plenty of directories genuinely
 * aren't (yet) a workflow-bearing repo - it just yields an empty list.
 */
export async function listWorkflowFiles(directory: string): Promise<WorkspaceWorkflowFile[]> {
  const root = await resolveWorkingTree(directory);
  const workflowsDir = path.join(root, ".github", "workflows");

  let entries: string[];
  try {
    entries = await fs.readdir(workflowsDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new WorkspaceError(`Could not read ${workflowsDir}: ${(err as Error).message}`);
  }

  const ymlNames = entries.filter((f) => f.endsWith(".yml") || f.endsWith(".yaml")).sort();
  const files: WorkspaceWorkflowFile[] = [];
  for (const name of ymlNames) {
    const full = path.join(workflowsDir, name);
    const stat = await fs.stat(full);
    // Skip rather than fail the whole listing over one outsized or
    // non-regular file - one bad entry shouldn't hide every other workflow.
    if (!stat.isFile() || stat.size > MAX_WORKFLOW_YAML_LENGTH) continue;
    files.push({
      relativePath: path.join(".github", "workflows", name),
      name,
      content: await fs.readFile(full, "utf8"),
    });
  }
  return files;
}
