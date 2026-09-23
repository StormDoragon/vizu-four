import { maskSecrets, type SecretValues } from "../engine/masking";
import { acquireAiCall, callTimeoutMs } from "./budget";

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

const utf8 = new TextEncoder();

/**
 * `text` cut to at most `maxBytes` of UTF-8 (marker included), keeping its
 * head or its tail. Bytes rather than characters because bytes are what
 * bound what a call costs: a character can be up to four of them.
 */
function clipUtf8(text: string, maxBytes: number, keep: "head" | "tail"): string {
  const bytes = utf8.encode(text);
  if (bytes.length <= maxBytes) return text;
  const room = maxBytes - 3; // "…" is three bytes
  // Never cut through a multi-byte character (continuation bytes are 10xxxxxx).
  if (keep === "head") {
    let end = room;
    while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
    return `${new TextDecoder().decode(bytes.subarray(0, end))}…`;
  }
  let start = bytes.length - room;
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++;
  return `…${new TextDecoder().decode(bytes.subarray(start))}`;
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

/**
 * Masks every free-text field of an explanation input against the secrets a
 * session holds *now*.
 *
 * Output is masked when it is captured, against the secrets known at that
 * moment - so a value declared secret afterwards (someone spots a token in a
 * log and adds it in What-If) is still sitting unmasked in the recorded
 * output. Everywhere else that only shows it back to the person who has
 * already seen it; this is the one path that sends it somewhere else - to a
 * third-party API - and selecting a failed step fetches an explanation
 * automatically. So it is masked again here, against the current set, on
 * the way out.
 */
export function maskExplainInput(input: ExplainInput, secrets: SecretValues): ExplainInput {
  const mask = (text: string | undefined) =>
    text === undefined ? undefined : maskSecrets(text, secrets);
  return {
    ...input,
    stepName: maskSecrets(input.stepName, secrets),
    run: mask(input.run),
    uses: mask(input.uses),
    stdout: maskSecrets(input.stdout, secrets),
    stderr: maskSecrets(input.stderr, secrets),
    engineError: mask(input.engineError),
    ifWarning: mask(input.ifWarning),
    ifError: mask(input.ifError),
  };
}

const CONFIDENCE_LEVELS: ReadonlySet<string> = new Set(["high", "medium", "low"]);

/**
 * The model's reply as an explanation the UI can render, or null to fall
 * back to the heuristics.
 *
 * The reply is untrusted. It is shaped by the step's own output - whatever
 * the debugged workflow printed, or a shared link's mocked stderr - and
 * prompt injection there can steer it. Every field reaches the UI as a React
 * child, where an object throws, so a crafted log could take down the
 * debugger view for whoever selected the step. Each field is checked here
 * instead: a cause without a string title and detail is dropped, an unknown
 * confidence reads as "medium", and a reply with nothing usable left is
 * treated as no reply.
 */
export function parseClaudeExplanation(text: string): FailureExplanation | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, ""));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { summary, causes } = parsed as Record<string, unknown>;
  if (typeof summary !== "string" || summary.trim() === "" || !Array.isArray(causes)) return null;

  const usable: FailureCause[] = [];
  for (const cause of causes) {
    if (typeof cause !== "object" || cause === null) continue;
    const { title, detail, confidence, suggestion } = cause as Record<string, unknown>;
    if (typeof title !== "string" || typeof detail !== "string") continue;
    usable.push({
      title,
      detail,
      confidence:
        typeof confidence === "string" && CONFIDENCE_LEVELS.has(confidence)
          ? (confidence as Confidence)
          : "medium",
      suggestion: typeof suggestion === "string" ? suggestion : undefined,
    });
    if (usable.length === 4) break;
  }
  return usable.length > 0 ? { summary, causes: usable, source: "claude" } : null;
}

/**
 * Ceiling on one prompt, in UTF-8 bytes. The budget caps how many calls are
 * made, which only bounds spend if each call is bounded too - and every
 * field below comes from the visitor: a step's name, `uses:` and engine
 * error went in whole, so a 1 MB workflow made one capped call cost what a
 * hundred should. Each field is clipped to its own share, and a prompt that
 * somehow still exceeds this is not sent at all (see explainFailure).
 */
export const MAX_PROMPT_BYTES = 16 * 1024;

export function buildPrompt(input: ExplainInput): string {
  const parts = [
    `A GitHub Actions workflow step named "${clipUtf8(input.stepName, 256, "head")}" failed during a local debug run.`,
    input.run ? `run script:\n${clipUtf8(input.run, 2048, "tail")}` : "",
    input.uses
      ? `uses: ${clipUtf8(input.uses, 256, "head")} (shell: ${clipUtf8(input.shell ?? "default", 64, "head")})`
      : "",
    `exit code: ${input.exitCode ?? "none (process killed/crashed)"}`,
    input.timedOut ? "the step timed out" : "",
    input.engineError ? `engine error: ${clipUtf8(input.engineError, 1024, "head")}` : "",
    `stdout (tail, secrets already masked as ***):\n${clipUtf8(input.stdout, 4096, "tail") || "(empty)"}`,
    `stderr (tail, secrets already masked as ***):\n${clipUtf8(input.stderr, 4096, "tail") || "(empty)"}`,
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
 * falls back to `explainFailureHeuristic` on any error, missing key,
 * malformed response, or exhausted budget.
 *
 * The budget is what makes configuring a key safe on a shared instance: this
 * is the only path that spends the operator's money, and it previously spent
 * it once per request with no cap, no concurrency limit and no timeout. With
 * MAX_PROMPT_BYTES and `max_tokens` bounding each call, spend has a hard
 * ceiling: calls per window x (prompt + reply) - see DEPLOY.md for the sums.
 * Running out of budget is deliberately not an error - the endpoint answers
 * with the offline explanation instead, so the feature degrades rather than
 * breaking.
 */
export async function explainFailure(input: ExplainInput): Promise<FailureExplanation> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return explainFailureHeuristic(input);

  const prompt = buildPrompt(input);
  if (utf8.encode(prompt).length > MAX_PROMPT_BYTES) return explainFailureHeuristic(input);

  const lease = acquireAiCall();
  if (typeof lease === "string") return explainFailureHeuristic(input);

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create(
      {
        model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      },
      // `timeout` resets on every retry, so the SDK's own retries (up to 3
      // HTTP attempts for one logical call by default) could take up to 3x
      // this long - a hung/slow provider held a concurrency slot for
      // multiples of the configured budget instead of at most it. `signal`
      // aborts the whole operation, retries included, once the deadline
      // passes, so this is what actually bounds one logical call.
      { signal: AbortSignal.timeout(callTimeoutMs()) }
    );
    const textBlock = message.content.find((b): b is { type: "text"; text: string } => b.type === "text");
    if (!textBlock) return explainFailureHeuristic(input);
    return parseClaudeExplanation(textBlock.text) ?? explainFailureHeuristic(input);
  } catch {
    return explainFailureHeuristic(input);
  } finally {
    lease.release();
  }
}
