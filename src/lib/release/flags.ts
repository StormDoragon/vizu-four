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

/** A line holding only spaces or tabs is a blank line, so it separates paragraphs like an empty one. */
const blankLines = (text: string) => text.replace(/^[ \t]+$/gm, "");

/** Joins ordinary wrapped lines (single newlines) so a phrase split by hard wrapping still matches. Blank lines stay separators. */
function joinWrapped(text: string): string {
  return text.replace(/(?<!\n)\n(?!\n)/g, " ");
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
/**
 * Between the words of a phrase: spaces, or ONE line wrap with optional spaces on either side of it
 * (normalization already turned tabs and Unicode spaces into plain spaces). A blank line is a paragraph
 * break and never matches; whitespace-only lines were reduced to blank lines before matching.
 */
const WS = "(?: +| *\\n *(?!\\n))";
const BREAKING_PROSE = new RegExp(`\\b(?:backwards?|backward)(?:-|${WS})incompatible\\b`, "gi");
const NOT_COMPATIBLE = new RegExp(`\\bnot${WS}(?:backwards?|backward)(?:-|${WS})compatible\\b`, "i");
const BREAKING_SUPPORT = new RegExp(`\\b(?:drop(?:s|ped|ping)?|remov(?:e|es|ed|ing))${WS}(?:support|compatibility)${WS}(?:for|of|with)\\b|\\bend${WS}of${WS}support\\b|\\bno${WS}longer${WS}(?:support\\w*|compatible${WS}with)\\b`, "gi");

/** Words that mean a change avoids, repairs or refuses something rather than introducing it. */
const NEGATORS = "(?:avoid\\w*|prevent\\w*|without|never|not|no|restor\\w*|preserv\\w*|maintain\\w*|keep\\w*|ensur\\w*|stop\\w*|(?:don|doesn|didn|won|can)'?t)";
/** A negator followed by at most 30 characters of the SAME clause. `.`, `;` and a line break all end the clause. */
const AVOIDS = new RegExp(`\\b${NEGATORS}\\b[^\\n.;]{0,30}$`, "i");
/** A line that ends on a bare negator ("fix: do not"): its clause continues on the next line. */
// Punctuation is mandatory INSIDE the optional group, so the two space runs can never split the same spaces
// more than one way (an optional comma between two `[ \\t]*` runs backtracks quadratically).
const TRAILING_NEGATOR = new RegExp(`\\b${NEGATORS}\\b[ \\t]*(?:[,:][ \\t]*)?$`, "i");

/** Start offset of every line, computed once per scan: linear in the text, never per match. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1)) starts.push(at + 1);
  return starts;
}

/**
 * Is the match on line `line` (starting at `index`) negated? Negation never crosses a clause end (`;`
 * or `.`) and never crosses a line break unless the previous line ENDS on a negator, so a new
 * declaration on its own line ("fix: prevent crashes" / "Drop support for Node 16") does not borrow the
 * previous line's negation. The 30-character window is unchanged.
 */
function negated(text: string, index: number, starts: number[], line: number): boolean {
  const lineStart = starts[line];
  const sameLine = text.slice(Math.max(lineStart, index - 40), index);
  if (sameLine.trim()) return AVOIDS.test(sameLine);
  if (line === 0) return false;
  return TRAILING_NEGATOR.test(text.slice(starts[line - 1], lineStart - 1));
}

/** True when `text` has a match of `pattern` that is not negated (see `negated`). Linear: matches arrive in order, so the line pointer only moves forward. */
function hasUnnegatedMatch(pattern: RegExp, text: string): boolean {
  let starts: number[] | undefined;
  let line = 0;
  for (const match of text.matchAll(pattern)) {
    starts ??= lineStarts(text);
    while (line + 1 < starts.length && starts[line + 1] <= match.index) line++;
    if (!negated(text, match.index, starts, line)) return true;
  }
  return false;
}

function introducesIncompatibility(text: string): boolean {
  return NOT_COMPATIBLE.test(text) || hasUnnegatedMatch(BREAKING_PROSE, text);
}

export function reviewFlags(text: string) {
  const lines = blankLines(normalizeForDetection(text));
  const prose = joinWrapped(lines);
  return {
    breakingChange: BREAKING_FOOTER.test(lines) || BREAKING_BRACKET.test(lines) || hasUnnegatedMatch(BREAKING_SUPPORT, lines) || introducesIncompatibility(lines),
    securitySensitive: VULNERABILITY_TERMS.test(prose) || SECRET_EXPOSURE.test(prose),
  };
}
