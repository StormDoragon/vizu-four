export type Confidence = "high" | "medium" | "low";

export interface FailureCause {
  title: string;
  detail: string;
  confidence: Confidence;
  suggestion?: string;
}

export interface FailureExplanation {
  summary: string;
  causes: FailureCause[];
  source: "heuristic" | "claude";
}

export interface ExplainInput {
  stepName: string;
  run?: string;
  uses?: string;
  shell?: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  engineError?: string;
  ifWarning?: string;
  ifError?: string;
  timedOut?: boolean;
}

interface Rule {
  test: (combined: string, input: ExplainInput) => boolean;
  title: string;
  detail: string;
  suggestion?: string;
  confidence: Confidence;
}

const RULES: Rule[] = [
  {
    test: (_c, i) => !!i.timedOut,
    title: "Step timed out",
    detail: "The step exceeded its timeout and was killed before it could finish.",
    suggestion:
      "Raise `timeout-minutes` if the work is just slow, or look for a hang - a prompt waiting on stdin, a network call with no timeout, or a stuck background process.",
    confidence: "high",
  },
  {
    test: (_c, i) => !!i.engineError?.includes("Could not evaluate expression"),
    title: "An expression in this step failed to evaluate",
    detail: "One of the `${{ }}` expressions used by this step threw an error before the step could even run.",
    suggestion: "Check the expression playground against this step's context to find the exact bad reference.",
    confidence: "high",
  },
  {
    test: (_c, i) => !!i.engineError && /ENOENT|spawn.*ENOENT/i.test(i.engineError),
    title: "Interpreter or command not found",
    detail: "The shell/interpreter this step needs isn't available in this local environment.",
    suggestion: "Check the `shell:` field, or install the missing interpreter locally.",
    confidence: "high",
  },
  {
    test: (c) => /command not found/i.test(c) || /: not found\b/i.test(c),
    title: "Command not found",
    detail: "A command the script invoked isn't installed, or isn't on PATH in this environment.",
    suggestion:
      "Install the tool locally (or via a setup-* step upstream) and confirm it's on PATH before this step runs.",
    confidence: "high",
  },
  {
    test: (c, i) => i.exitCode === 126 || /permission denied/i.test(c),
    title: "Permission denied",
    detail: "The process couldn't access a file/command it needed, or the script isn't marked executable.",
    suggestion: "Check file permissions (`chmod +x`) and whether the command needs elevated privileges.",
    confidence: "medium",
  },
  {
    test: (c) => /ENOENT/i.test(c) && /no such file or directory/i.test(c),
    title: "Missing file or directory",
    detail: "The command referenced a path that doesn't exist in the workspace.",
    suggestion: "Check `working-directory`, and confirm any file this step depends on was actually produced earlier.",
    confidence: "medium",
  },
  {
    test: (c) => /cannot find module/i.test(c),
    title: "Missing dependency",
    detail: "A required package isn't installed.",
    suggestion: "Confirm an install step (`npm ci`, `pip install`, etc.) ran before this step, in the right directory.",
    confidence: "medium",
  },
  {
    test: (c) => /npm err!/i.test(c) && /404/.test(c),
    title: "Package not found",
    detail: "npm couldn't find a package/version, often from a typo or a private package without registry auth configured.",
    suggestion: "Double check the package name/version and registry configuration.",
    confidence: "medium",
  },
  {
    test: (c) => /authentication failed|could not read username|permission to .* denied/i.test(c),
    title: "Missing or invalid credentials",
    detail:
      "A command needed a credential (git token, registry auth, cloud CLI login) that isn't configured for this local run.",
    suggestion:
      "This is expected if you haven't set a real secret locally - use What-If to provide a local secret value, or mock the step's output.",
    confidence: "medium",
  },
  {
    // Note: the `FAIL` check is intentionally case-sensitive (unlike the
    // other rules) - test runners (Jest, Go test, etc.) emit it in caps as
    // a fixed token, whereas a case-insensitive match would false-positive
    // on any script that casually mentions the word "fail" in its own
    // output (e.g. an echoed error message), producing a misleading cause.
    test: (c) => /assertionerror|expect\(received\)|tests?:\s*\d+ failed/i.test(c) || /(^|\s)FAIL(\s|$)/.test(c),
    title: "Test assertions failed",
    detail: "The test run itself failed one or more assertions rather than crashing outright.",
    suggestion: "Scroll to the first failing assertion in the output above - later failures are often cascades of the first.",
    confidence: "high",
  },
  {
    test: (_c, i) => i.exitCode === null,
    title: "Process ended without an exit code",
    detail: "The step's process was killed or crashed abnormally rather than exiting normally.",
    confidence: "low",
  },
];

function truncateTail(text: string, max = 4000): string {
  return text.length > max ? `…${text.slice(text.length - max)}` : text;
}

/** Deterministic, offline root-cause analysis - always available, no network or API key required. */
export function explainFailureHeuristic(input: ExplainInput): FailureExplanation {
  const combined = `${input.stdout}\n${input.stderr}\n${input.engineError ?? ""}`;
  const causes: FailureCause[] = [];

  if (input.ifWarning) {
    causes.push({
      title: "This step's `if:` condition is always truthy",
      detail: input.ifWarning,
      confidence: "high",
    });
  }
  if (input.ifError) {
    causes.push({
      title: "This step's `if:` condition failed to evaluate",
      detail: input.ifError,
      confidence: "high",
    });
  }

  for (const rule of RULES) {
    if (rule.test(combined, input)) {
      causes.push({
        title: rule.title,
        detail: rule.detail,
        suggestion: rule.suggestion,
        confidence: rule.confidence,
      });
    }
    if (causes.length >= 5) break;
  }

  if (causes.length === 0) {
    causes.push({
      title: `Command exited with code ${input.exitCode ?? "unknown"}`,
      detail: "No specific pattern was recognized in the output - read the captured stdout/stderr above for the real error.",
      confidence: "low",
    });
  }

  const summary =
    input.exitCode !== null && input.exitCode !== 0
      ? `"${input.stepName}" failed with exit code ${input.exitCode}.`
      : `"${input.stepName}" failed before producing a normal exit code.`;

  return { summary, causes, source: "heuristic" };
}

interface ClaudeExplainResponse {
  summary: string;
  causes: Array<{ title: string; detail: string; confidence?: Confidence; suggestion?: string }>;
}

function buildPrompt(input: ExplainInput): string {
  const parts = [
    `A GitHub Actions workflow step named "${input.stepName}" failed during a local debug run.`,
    input.run ? `run script:\n${truncateTail(input.run, 2000)}` : "",
    input.uses ? `uses: ${input.uses} (shell: ${input.shell ?? "default"})` : "",
    `exit code: ${input.exitCode ?? "none (process killed/crashed)"}`,
    input.timedOut ? "the step timed out" : "",
    input.engineError ? `engine error: ${input.engineError}` : "",
    `stdout (tail, secrets already masked as ***):\n${truncateTail(input.stdout) || "(empty)"}`,
    `stderr (tail, secrets already masked as ***):\n${truncateTail(input.stderr) || "(empty)"}`,
    "",
    "Respond with ONLY minified JSON matching this TypeScript type, no prose outside the JSON:",
    `{"summary": string, "causes": Array<{"title": string, "detail": string, "confidence": "high"|"medium"|"low", "suggestion"?: string}>}`,
    "List at most 4 causes, most likely first. Be specific to the actual output shown, not generic CI advice.",
  ];
  return parts.filter(Boolean).join("\n\n");
}

const DEFAULT_MODEL = "claude-sonnet-5";

/**
 * Tries a live Claude call when `ANTHROPIC_API_KEY` is configured (never
 * required - this is an optional upgrade over the offline heuristics), and
 * falls back to `explainFailureHeuristic` on any error, missing key, or
 * malformed response.
 */
export async function explainFailure(input: ExplainInput): Promise<FailureExplanation> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return explainFailureHeuristic(input);

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content: buildPrompt(input) }],
    });
    const textBlock = message.content.find((b): b is { type: "text"; text: string } => b.type === "text");
    if (!textBlock) return explainFailureHeuristic(input);

    const jsonText = textBlock.text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "");
    const parsed = JSON.parse(jsonText) as ClaudeExplainResponse;
    if (!parsed.summary || !Array.isArray(parsed.causes) || parsed.causes.length === 0) {
      return explainFailureHeuristic(input);
    }
    return {
      summary: parsed.summary,
      causes: parsed.causes.slice(0, 4).map((c) => ({
        title: c.title,
        detail: c.detail,
        confidence: c.confidence ?? "medium",
        suggestion: c.suggestion,
      })),
      source: "claude",
    };
  } catch {
    return explainFailureHeuristic(input);
  }
}
