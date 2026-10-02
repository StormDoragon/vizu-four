/**
 * Review-flag detection for release metadata. Runs on the RAW message (before truncation), so
 * a marker late in a long body still counts. Matching is finite: every bridge between two terms
 * is a bounded repeat, never an unrestricted `.*`.
 */

const ZERO_WIDTH = /[\u00ad\u200b-\u200d\u2060\ufeff]/g;
const HYPHENS = /[\u2010-\u2015\u2212\ufe58\ufe63\uff0d]/g;
const LINE_SEPARATORS = /[\u2028\u2029\u0085]/g;
const SPACES = /[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\t\f\v]/g;

/**
 * Supported normalization, applied before any pattern runs:
 * - CRLF, bare CR, U+2028/U+2029/U+0085 become LF (a bare-CR footer is still a footer line);
 * - NFKC folds full-width and compatibility forms (e.g. full-width "SSRF" -> "SSRF");
 * - Unicode dashes and the minus sign become "-", so "backwards-incompatible" with a Unicode hyphen matches;
 * - Unicode spaces and tabs become a plain space; soft hyphens and zero-width characters are removed.
 * Anything outside this list (confusables such as a Cyrillic letter standing in for a Latin one) is NOT normalized.
 */
export function normalizeForDetection(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(LINE_SEPARATORS, "\n").normalize("NFKC")
    .replace(ZERO_WIDTH, "").replace(HYPHENS, "-").replace(SPACES, " ");
}

/** Joins ordinary wrapped lines (single newlines) so a phrase split by hard wrapping still matches. Blank lines stay separators. */
function joinWrapped(text: string): string {
  // A line holding only spaces or tabs is a blank line, so it separates paragraphs like an empty one.
  return text.replace(/^[ \t]+$/gm, "").replace(/(?<!\n)\n(?!\n)/g, " ");
}

const VULNERABILITY_TERMS = /\b(?:security|vulnerabilit\w*|CVE-\d{4}-\d+|credential|exploit|injection|XSS|CSRF|DoS|RCE|denial of service|path traversal|auth(?:entication)? bypass)\b|\b(?:SSRF|XXE|clickjacking|open redirect|privilege escalation|directory traversal|remote code execution|arbitrary code execution|sanitiz\w*|timing attacks?|buffer overflow|zip slip|prototype pollution|(?:unsafe|insecure) deserializ\w*|deserializ\w* of untrusted)\b/i;

/**
 * Secret nouns. A bare "token" or "key" is deliberately NOT here: design tokens, parser tokens
 * and object keys are ordinary product vocabulary. Tokens count only with a credential qualifier.
 */
const SECRET = "(?:secrets?|passwords?|passphrases?|credentials?|api[ -]?keys?|(?:access|secret|private|ssh|signing|encryption) keys?|(?:session|auth\\w*|access|refresh|api|bearer|personal access|csrf|jwt|id) tokens?)";
/** One vocabulary for both orders, so "exposure of a secret" and "secret exposure" behave alike. */
const EXPOSURE = "(?:leak\\w*|expos\\w*|disclos\\w*|dump\\w*|print\\w*|logs?|logg\\w*|hard-?cod\\w*)";
const BRIDGE = "[^\\n]{0,40}";
const SECRET_EXPOSURE = new RegExp(`\\b${EXPOSURE}\\b${BRIDGE}\\b${SECRET}\\b|\\b${SECRET}\\b${BRIDGE}\\b${EXPOSURE}\\b`, "i");

const BREAKING_FOOTER = /(?:^|\n)(?:\w+(?:\([^\n)]*\))?!:\s*\S|BREAKING[ -]CHANGES?:\s*\S|BREAKING:\s*\S)/i;
/** A bracketed marker counts only where an author declares it: the start of a line (after an optional type prefix) or the end of a line. A mention in the middle of prose does not. */
const BRACKET = "[(\\[]\\s*breaking(?:[-_ ]changes?)?\\s*[)\\]]";
const BREAKING_BRACKET = new RegExp(`(?:^|\\n)(?:\\w+(?:\\([^\\n)]*\\))?:\\s*)?${BRACKET}|${BRACKET}[ \\t]*(?=\\n|$)`, "i");
const BREAKING_PROSE = /\b(?:backwards?|backward)[- ]incompatible\b/gi;
const BREAKING_SUPPORT = /\b(?:drop(?:s|ped|ping)?|remov(?:e|es|ed|ing)) (?:support|compatibility) (?:for|of|with)\b|\bend of support\b|\bno longer (?:support\w*|compatible with)\b/gi;
/** Words just before "backwards-incompatible" that mean the change avoids or repairs it, not introduces it. */
const AVOIDS = /(?:\b(?:avoid\w*|prevent\w*|without|never|not|no|restor\w*|preserv\w*|maintain\w*|keep\w*|ensur\w*|stop\w*)|\b(?:don|doesn|didn|won|can)'?t)\b[^\n.]{0,30}$/i;

/** True when `text` has a match of `pattern` that is not preceded (within 40 characters) by avoidance or negation. */
function hasUnnegatedMatch(pattern: RegExp, text: string): boolean {
  for (const match of text.matchAll(pattern)) {
    if (!AVOIDS.test(text.slice(Math.max(0, match.index - 40), match.index))) return true;
  }
  return false;
}

function introducesIncompatibility(text: string): boolean {
  return /\bnot (?:backwards?|backward)[- ]compatible\b/i.test(text) || hasUnnegatedMatch(BREAKING_PROSE, text);
}

export function reviewFlags(text: string) {
  const lines = normalizeForDetection(text);
  const prose = joinWrapped(lines);
  return {
    breakingChange: BREAKING_FOOTER.test(lines) || BREAKING_BRACKET.test(lines) || hasUnnegatedMatch(BREAKING_SUPPORT, prose) || introducesIncompatibility(prose),
    securitySensitive: VULNERABILITY_TERMS.test(prose) || SECRET_EXPOSURE.test(prose),
  };
}
