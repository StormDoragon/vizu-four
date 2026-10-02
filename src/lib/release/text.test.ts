import { describe, expect, it } from "vitest";
import { markdownText } from "./text";

describe("markdownText", () => {
  it("escapes Markdown syntax and flattens newlines", () => {
    expect(markdownText("a *b*\n[c](d)")).toBe("a \\*b\\* \\[c\\]\\(d\\)");
  });
  it("breaks bare URLs, www hosts, emails and mentions so they cannot autolink or ping", () => {
    const out = markdownText("see https://evil.example www.evil.example a@b.co @octocat");
    expect(out).not.toMatch(/:\/\//); expect(out).not.toMatch(/www\./); expect(out).not.toMatch(/@(?!​)/);
    expect(out.replace(/​/g, "")).toBe("see https://evil.example www.evil.example a@b.co @octocat");
  });
});

describe("markdownText autolink cases", () => {
  it.each([
    ["@user", /@(?!​)/],
    ["https://evil.example", /:\/\//],
    ["www.example.com", /www\./],
    ["foo@example.com", /@(?!​)/],
  ])("neutralizes %s", (input, pattern) => {
    const out = markdownText(input);
    expect(out).not.toMatch(pattern);
    expect(out.replace(/​/g, "")).toBe(input);
  });
});
