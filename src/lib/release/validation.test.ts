import { describe, expect, it } from "vitest";
import { parseRef, parseReleaseInput, parseRepository } from "./validation";

describe("release input", () => {
  it.each(["owner/repo", " https://github.com/owner/repo/ ", "https://github.com/owner/repo.git"])("normalizes %s", value => expect(parseRepository(value)).toBe("owner/repo"));
  it.each([null, {}, 7, "", "http://github.com/o/r", "https://github.com.evil/o/r", "https://evil/o/r", "https://user@github.com/o/r", "https://github.com:443/o/r", "o/r?token=secret", "o/r#frag", "o/..", "o/%2e%2e", "o/r/pulls", "o\\r", "-o/r", "o/" + "a".repeat(101)])("rejects unsafe repository %s", value => expect(() => parseRepository(value)).toThrow());
  it.each(["v1.0.0", "main", "release/v2", "a".repeat(40), "refs/tags/v1", "v1.2.0+build", "pkg@1.0.0"])("accepts ref %s", value => expect(parseRef(value)).toBe(value));
  it.each([null, 2, "", "../main", "main...head", "HEAD~1", "HEAD^", "main?x=1", "main#x", "o:branch", "-main", "refs//main", "main/", "main.", "refs/.hidden", "refs/test.lock", "a".repeat(201), "main\nother", "main%2fother"])("rejects unsafe ref %s", value => expect(() => parseRef(value)).toThrow());
  it("defaults to explicit AI opt-out", () => expect(parseReleaseInput({ repository: "o/r", base: "v1", head: "main" })).toEqual({ repository: "o/r", base: "v1", head: "main", useAi: false }));
  it.each([null, [], {}, { repository: "o/r", base: "v1", head: "main", token: "secret" }, { repository: "o/r", base: "v1", head: "main", useAi: "yes" }])("rejects malformed request", value => expect(() => parseReleaseInput(value)).toThrow());
});
