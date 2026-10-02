import type { ReleaseInput } from "./types";

export class ReleaseError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function parseRepository(value: unknown): string {
  if (typeof value !== "string" || value.length > 250) throw new ReleaseError(400, "Enter a public GitHub repository as owner/repo or an HTTPS GitHub URL.");
  const match = /^(?:https:\/\/github\.com\/)?([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38}))\/([a-zA-Z0-9_.-]{1,100})\/?$/.exec(value.trim());
  if (!match) throw new ReleaseError(400, "Enter a public GitHub repository as owner/repo or an HTTPS GitHub URL.");
  const repo = match[2].replace(/\.git$/, "");
  if (!repo || repo === "." || repo === "..") throw new ReleaseError(400, "Invalid repository name.");
  return `${match[1]}/${repo}`;
}

export function parseRef(value: unknown): string {
  if (typeof value !== "string" || value.length > 200) throw new ReleaseError(400, "Refs must be names or commit SHAs of at most 200 characters.");
  const ref = value.trim();
  if (!/^[a-zA-Z0-9_][a-zA-Z0-9_./-]*$/.test(ref) || ref.includes("..") || ref.includes("//") || ref.endsWith(".") || ref.endsWith("/") || ref.split("/").some(p => p.startsWith(".") || p.endsWith(".lock"))) {
    throw new ReleaseError(400, "Use a tag, branch name, or commit SHA; revision expressions and cross-repository refs are unsupported.");
  }
  return ref;
}

export function parseReleaseInput(body: unknown): ReleaseInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ReleaseError(400, "A JSON release request is required.");
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some(k => !["repository", "base", "head", "useAi"].includes(k)) || (input.useAi !== undefined && typeof input.useAi !== "boolean")) throw new ReleaseError(400, "Unexpected release request fields.");
  return { repository: parseRepository(input.repository), base: parseRef(input.base), head: parseRef(input.head), useAi: input.useAi === true };
}
