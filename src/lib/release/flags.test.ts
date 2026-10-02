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

  it.each([
    "Avoid backwards-incompatible changes", "Prevent backward incompatible behavior", "Add a test ensuring no backwards-incompatible behavior", "Never ship a backwards incompatible change", "Fix: avoid breaking the layout",
    "Remove the unused spinner", "Remove deprecated v1 endpoints", "Fix breaking tests on Windows", "Add a breaking-change label", "docs: explain how to use [breaking] markers in the changelog",
    "docs: show BREAKING CHANGE: footer", "Fix chart that was not compatible with dark mode", "Support removal of items from the cart",
  ])("does not flag %s", text => expect(breaking(text), text).toBe(false));

  it("bracket markers count only at the start or end of a line", () => {
    expect(breaking("[breaking] x")).toBe(true); expect(breaking("x\n[breaking] y")).toBe(true); expect(breaking("x [breaking]\ny")).toBe(true);
    expect(breaking("use [breaking] tags for x")).toBe(false);
  });
  it("honors a Unicode hyphen and plain-space normalization", () => {
    expect(breaking(`new format (backwards${cp(0x2011)}incompatible)`)).toBe(true);
    expect(breaking(`Drop${cp(0x00a0)}support${cp(0x00a0)}for Node 16`)).toBe(true);
  });
});
