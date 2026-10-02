import { describe, expect, it } from "vitest";
import { normalizeForDetection, reviewFlags } from "./flags";

const cp = (...codes: number[]) => String.fromCodePoint(...codes);
const security = (text: string) => reviewFlags(text).securitySensitive;
const breaking = (text: string) => reviewFlags(text).breakingChange;
const FILLER = "filler text ".repeat(150);

describe("detection normalization", () => {
  it("maps CRLF, bare CR, and Unicode line separators to LF", () => {
    expect(normalizeForDetection("a\r\nb\rc" + cp(0x2028) + "d" + cp(0x2029) + "e")).toBe("a\nb\nc\nd\ne");
  });
  it("folds full-width forms, Unicode dashes and spaces, and strips zero-width characters", () => {
    expect(normalizeForDetection(cp(0xff33, 0xff33, 0xff32, 0xff26))).toBe("SSRF");
    expect(normalizeForDetection(`backwards${cp(0x2011)}incompatible`)).toBe("backwards-incompatible");
    expect(normalizeForDetection(`a${cp(0x2013)}b${cp(0x2212)}c`)).toBe("a-b-c");
    expect(normalizeForDetection(`a${cp(0x00a0)}b${cp(0x3000)}c\td`)).toBe("a b c d");
    expect(normalizeForDetection(`le${cp(0x200b)}ak${cp(0x00ad)}ed`)).toBe("leaked");
  });
  it("does not normalize confusables, which is the documented limit", () => {
    expect(security(`Stop leaking API keys`.replace("a", cp(0x0430)))).toBe(false);
  });
});

describe("security flag: vulnerability phrases", () => {
  it.each([
    "Stop a timing attack on login", "Fix buffer overflow in the decoder", "Prevent zip slip on extract", "Fix prototype pollution in merge",
    "Replace unsafe deserialization of cookies", "Fix insecure deserialization", "Fix deserialization of untrusted input", "Block SSRF via webhooks",
    "Disable external entities against XXE", "Fix open redirect", "Prevent privilege escalation", "Fix directory traversal", "Fix remote code execution",
    "Sanitize HTML in bios", "Fix CVE-2026-1234", "Fix a SQL injection",
  ])("flags %s", text => expect(security(text)).toBe(true));
});

describe("security flag: secret exposure in either order", () => {
  it.each([
    // verb first
    "Stop leaking API keys in logs", "Prevent exposure of session tokens", "Stop printing the private key", "Stop dumping access keys", "Remove hardcoded secret", "Stop logging passwords", "Disclosure of credentials",
    // noun first
    "API-key leaked in logs", `API${cp(0x2011)}key leaked in logs`, "apikey exposed in logs", "API keys are in the logs", "Remove API keys from the logs", "Stop writing the API key to the log", "API key logged on startup", "Stop logging API keys", "Print the api key",
    "Secrets exposure in build logs", "Password disclosure through errors", "API key leak in crash reports", "Session token exposure in headers", "Bearer tokens logged on 401", "Access keys dumped by debug endpoint", "Credentials hard-coded in config", "Private key printed to console",
  ])("flags %s", text => expect(security(text)).toBe(true));

  it.each([
    "Print parser tokens for debugging", "Dump design tokens to JSON", "Log object keys when validation fails", "Fix memory leak in the websocket client",
    "Fix memory leak when caching cache keys", "Replace hardcoded colors with theme variables", "Expose theme tokens to plugins", "Log lexer tokens", "Print keys of the object",
  ])("does not flag %s", text => expect(security(text)).toBe(false));

  it("does not treat a bare token or key as a secret", () => {
    for (const text of ["Stop logging tokens", "Stop printing keys", "Tokens are leaked into the AST"]) expect(security(text), text).toBe(false);
  });
});

describe("line endings and wrapping", () => {
  it("gives identical flags for LF and CRLF, for security and breaking", () => {
    const samples = ["Stop leaking\nAPI keys in logs", "This change is not\nbackwards compatible", "feat: x\n\nBREAKING CHANGE: drop api", "fix: y\n\nSecurity: patched"];
    for (const lf of samples) {
      const crlf = lf.replace(/\n/g, "\r\n"); const cr = lf.replace(/\n/g, "\r");
      expect(reviewFlags(crlf), lf).toEqual(reviewFlags(lf)); expect(reviewFlags(cr), lf).toEqual(reviewFlags(lf));
    }
    expect(security("Stop leaking\r\nAPI keys")).toBe(true); expect(breaking("not\r\nbackwards compatible")).toBe(true);
  });
  it("finds a footer after more than 1200 characters, even behind a bare CR", () => {
    expect(breaking(`feat: x\r${FILLER}\rBREAKING CHANGE: drop api`)).toBe(true);
    expect(breaking(`feat: x\n${FILLER}\nBREAKING CHANGE: drop api`)).toBe(true);
    expect(security(`fix: y\r\n${FILLER}\r\nThis closes an authentication bypass.`)).toBe(true);
  });
  it("joins ordinary wrapped lines but never bridges a blank line", () => {
    expect(security("Stop leaking\nAPI keys")).toBe(true);
    expect(security("Stop leaking memory.\n\nUpdate API keys docs")).toBe(false);
    expect(security("Fix leak\n\nAPI keys")).toBe(false);
  });
  it.each([
    ["LF blank line", "\n\n"], ["CRLF blank line", "\r\n\r\n"], ["spaces-only line", "\n   \n"], ["tab-only line", "\n\t\n"], ["CRLF spaces-only line", "\r\n  \r\n"], ["CRLF tab-only line", "\r\n\t\t\r\n"], ["bare-CR spaces-only line", "\r \r"], ["non-breaking-space-only line", "\n" + cp(0x00a0, 0x00a0) + "\n"],
  ])("a %s is a paragraph break that exposure phrases do not bridge", (_name, gap) => {
    expect(security(`Fix memory leak.${gap}Update API keys docs`)).toBe(false);
    expect(security(`Stop leaking${gap}API keys`)).toBe(false);
  });
  it.each([["LF", "\n"], ["CRLF", "\r\n"], ["bare CR", "\r"], ["trailing spaces", " \n"], ["trailing tab", "\t\n"]])("a single %s still joins a wrapped phrase", (_name, wrap) => {
    expect(security(`Stop leaking${wrap}API keys`)).toBe(true);
  });
  it("keeps footer line structure: a footer must start a line", () => {
    expect(breaking("docs: show BREAKING CHANGE: example")).toBe(false);
    expect(breaking("feat: x\nBREAKING CHANGE: y")).toBe(true);
  });
  it("scans a large message in bounded time (finite bridge, no unrestricted .*)", () => {
    const large = ("leaked " + "x".repeat(60) + " ").repeat(15_000);
    const started = performance.now();
    expect(security(large)).toBe(false); expect(breaking(large)).toBe(false);
    expect(security(large + "\nStop leaking API keys")).toBe(true);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe("breaking flag", () => {
  it.each([
    "feat!: drop it", "refactor(api)!: rename", "feat: x\n\nBREAKING CHANGE: y", "feat: x\n\nBREAKING CHANGES: y", "feat: x\n\nbreaking change: y", "BREAKING: remove flag",
    "[BREAKING] change port", "[breaking-change] rename api", "[breaking change] rename api", "feat(api): [BREAKING] rename", "Rename flag (breaking change)", "Rename flag (breaking)",
    "Drop support for Node 16", "Dropped support for Python 3.8", "Remove support for the legacy format", "Removing compatibility with v1", "End of support for v1 configs", "The client no longer supports Node 16",
    "A new format, not backwards compatible", "A new format (backwards-incompatible)", "backward incompatible storage change",
  ])("flags %s", text => expect(breaking(text), text).toBe(true));

  it.each(["fix: ship backwards-incompatible output", "Fix the API by making it backwards incompatible", "Fixes: backwards-incompatible rename of --out", "Fixed config loading; now backwards incompatible"])(
    "a leading fix is not evidence of preserved compatibility: flags %s", text => expect(breaking(text), text).toBe(true));

  it.each([
    "fix: avoid backwards-incompatible output", "fix: avoid dropping support for Node 16", "fix: don't remove support for Python 3.8", "Do not remove support for Node 16", "Avoid ending support for v1",
    "Prevent dropping support for Python 3.8", "We won't drop support for Node 16", "Restore support for Node 16", "Keep support for the legacy format; do not remove support for v1",
  ])("negation applies to support removal and incompatibility: does not flag %s", text => expect(breaking(text), text).toBe(false));

  it.each([
    "Avoid backwards-incompatible changes", "Prevent backward incompatible behavior", "Add a test ensuring no backwards-incompatible behavior", "Never ship a backwards incompatible change", "Fix: avoid breaking the layout",
    "Remove the unused spinner", "Remove deprecated v1 endpoints", "Fix breaking tests on Windows", "Add a breaking-change label", "docs: explain how to use [breaking] markers in the changelog",
    "docs: show BREAKING CHANGE: footer", "Fix chart that was not compatible with dark mode", "Support removal of items from the cart",
  ])("does not flag %s", text => expect(breaking(text), text).toBe(false));

  describe("scope of negation", () => {
    it.each([
      "fix: prevent crashes; drop support for Node 16", "fix: preserve logging; drop support for Node 16", "fix: prevent crashes\nDrop support for Node 16", "fix: prevent crashes\r\nDrop support for Node 16",
      "fix: prevent crashes\rDrop support for Node 16", "Drop support for Node 16", "Drop support\nfor Node 16", "Drop support\r\nfor Node 16", "Drop\nsupport for Node 16",
      "fix: prevent crashes; ship backwards-incompatible output", "fix: avoid crashes.\nDrop support for Node 16", "fix: keep logging\n\nDrop support for Node 16",
    ])("a clause end or a new line starts a new declaration: flags %j", text => expect(breaking(text), text).toBe(true));

    it.each([
      "fix: do not drop support for Node 16", "fix: avoid dropping support for Node 16", "fix: prevent end of support warnings", "fix: do not\ndrop support for Node 16", "fix: do not\r\ndrop support for Node 16",
      "fix: do not,\ndrop support for Node 16", "fix: prevent\nbackwards-incompatible output", "Avoid\ndropping support for Node 16", "fix: prevent crashes", "Do not drop\nsupport for Node 16",
    ])("negation holds within a clause and across a wrap that ends on the negator: does not flag %j", text => expect(breaking(text), text).toBe(false));

    it.each([["trailing space", "Drop support \nfor Node 16"], ["leading space", "Drop support\n for Node 16"], ["spaces on both sides", "Drop support \n for Node 16"], ["several spaces", "Drop support  \n  for Node 16"]])(
      "a phrase wrapped with %s still matches, in LF, CRLF and bare-CR form", (_name, lf) => {
        for (const text of [lf, lf.replace(/\n/g, "\r\n"), lf.replace(/\n/g, "\r")]) expect(breaking(text), JSON.stringify(text)).toBe(true);
      });
    it.each(["Drop support\n\nfor Node 16", "Drop support\n  \nfor Node 16", "Drop support\r\n\r\nfor Node 16", "Drop support\r\n  \r\nfor Node 16", "Drop support \n\n for Node 16", "Drop support\n\t\nfor Node 16"])(
      "a paragraph break inside the phrase never matches: does not flag %j", text => expect(breaking(text), text).toBe(false));
    it("matches a wrapped incompatibility with a space after the break (R16)", () => {
      expect(breaking("This is backwards\n incompatible")).toBe(true);
      expect(breaking("This is backwards\r\n incompatible")).toBe(true);
      expect(breaking("This is backwards\r incompatible")).toBe(true);
      expect(breaking("This is backwards \n incompatible")).toBe(true);
      expect(breaking("This is backwards\n\nincompatible")).toBe(false);
    });
    it("keeps negation across a wrap with spaces around it", () => {
      expect(breaking("fix: do not \n drop support for Node 16")).toBe(false);
      expect(breaking("fix: prevent crashes \n Drop support for Node 16")).toBe(true);
    });
    it("does not let a blank or whitespace-only line carry negation to the next paragraph", () => {
      for (const gap of ["\n\n", "\n \n", "\n\t\n", "\r\n\r\n"]) expect(breaking(`fix: do not${gap}drop support for Node 16`), JSON.stringify(gap)).toBe(true);
    });
    it("keeps the 30-character window: a far negator does not reach the phrase", () => {
      expect(breaking("fix: avoid " + "x".repeat(40) + " drop support for Node 16")).toBe(true);
      expect(breaking("fix: avoid dropping now; drop support for Node 16")).toBe(true);
    });
  });
  describe("negation scan is linear (R15)", () => {
    // Large fixtures live here, not in the corpus. 50,000 repeats is roughly 1.8 MB on ONE line, the worst case
    // for a per-match scan back to the previous newline (quadratic) and for a per-match prefix copy.
    const BUDGET_MS = 2000;
    it.each([
      ["incompatibility", "avoid backwards-incompatible output; "],
      ["support removal", "avoid dropping support for Node 16; "],
    ])("a long run of negated %s is scanned in bounded time and stays unflagged", (_name, unit) => {
      const text = unit.repeat(50_000);
      const started = performance.now();
      expect(breaking(text)).toBe(false);
      expect(performance.now() - started).toBeLessThan(BUDGET_MS);
    });
    it.each([
      ["incompatibility", "avoid backwards-incompatible output; "],
      ["support removal", "avoid dropping support for Node 16; "],
    ])("still finds a late new-line declaration after a long run of negated %s", (_name, unit) => {
      const text = unit.repeat(50_000) + "\nDrop support for Node 16";
      const started = performance.now();
      expect(breaking(text)).toBe(true);
      expect(performance.now() - started).toBeLessThan(BUDGET_MS);
    });
    it("handles many short lines in bounded time too", () => {
      const text = "fix: avoid dropping support for Node 16\n".repeat(50_000);
      const started = performance.now();
      expect(breaking(text)).toBe(false);
      expect(breaking(text + "Drop support for Node 16")).toBe(true);
      expect(performance.now() - started).toBeLessThan(BUDGET_MS * 2);
    });
  });
  describe("trailing-negator scan has no quadratic backtracking (R17)", () => {
    const BUDGET_MS = 2000;
    // A bare negator followed by a long run of spaces, then a non-space: the shape that made two adjacent
    // `[ \t]*` runs (with an optional comma between them) split the same spaces every possible way.
    const support = (spaces: number) => "avoid" + " ".repeat(spaces) + "x\nDrop support for Node 16";
    const incompat = (spaces: number) => "avoid" + " ".repeat(spaces) + "x\nbackwards-incompatible output";

    it.each([8_000, 16_000, 32_000, 64_000, 128_000])("flags a new-line declaration after a negator and %i spaces, in bounded time", spaces => {
      for (const make of [support, incompat]) {
        const text = make(spaces);
        const started = performance.now();
        expect(breaking(text)).toBe(true);
        expect(performance.now() - started, `${spaces} spaces`).toBeLessThan(BUDGET_MS);
      }
    });
    it("handles the exact 64,000-space reproduction", () => {
      const text = "avoid" + " ".repeat(64_000) + "x\nDrop support for Node 16";
      expect(text.length).toBe(64_031);
      const started = performance.now();
      expect(breaking(text)).toBe(true);
      expect(performance.now() - started).toBeLessThan(BUDGET_MS);
    });
    it.each(["fix: do not\nDrop support for Node 16", "fix: do not,\nDrop support for Node 16", "fix: do not   ,   \nDrop support for Node 16", "fix: do not:\nDrop support for Node 16", "fix: do not  \r\nDrop support for Node 16"])(
      "a negator that ends the previous line, with optional punctuation and spaces, still negates: does not flag %j", text => expect(breaking(text), text).toBe(false));
    it("does not let a negator followed by more words, or by a long gap and text, negate the next line", () => {
      expect(breaking("fix: do not crash\nDrop support for Node 16")).toBe(true);
      expect(breaking("fix: do not" + " ".repeat(5_000) + "x\nDrop support for Node 16")).toBe(true);
    });
    it("stays fast on hostile shapes: long runs of one character class next to each phrase's first word", () => {
      const n = 64_000;
      const shapes = [
        " ".repeat(n) + "x", "\t".repeat(n) + "x", "\n".repeat(n), " \n".repeat(n / 2), "\r".repeat(n), "drop" + " ".repeat(n) + "x", "backwards" + " ".repeat(n) + "x",
        "not" + " ".repeat(n) + "backwards", "leak" + " ".repeat(n) + "x", "leaked ".repeat(n / 7), "API key ".repeat(n / 8), "feat(" + "a".repeat(n), "[breaking ".repeat(n / 10),
        "do not" + " ".repeat(n) + "\ndrop support for x", "not\n".repeat(n / 4) + "drop support", "end of ".repeat(n / 7),
      ];
      const started = performance.now();
      for (const text of shapes) reviewFlags(text);
      // 16 inputs of 64,000 characters. Measured at ~5 ms total; the budget only catches super-linear behaviour.
      expect(performance.now() - started).toBeLessThan(BUDGET_MS);
    });
  });
  it("bracket markers count only at the start or end of a line", () => {
    expect(breaking("[breaking] x")).toBe(true); expect(breaking("x\n[breaking] y")).toBe(true); expect(breaking("x [breaking]\ny")).toBe(true);
    expect(breaking("use [breaking] tags for x")).toBe(false);
  });
  it("honors a Unicode hyphen and plain-space normalization", () => {
    expect(breaking(`new format (backwards${cp(0x2011)}incompatible)`)).toBe(true);
    expect(breaking(`Drop${cp(0x00a0)}support${cp(0x00a0)}for Node 16`)).toBe(true);
  });
});
