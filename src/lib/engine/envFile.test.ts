import { describe, expect, it } from "vitest";
import { parseEnvFile, parsePathFile } from "./envFile";

describe("parseEnvFile", () => {
  it("parses simple key=value lines", () => {
    expect(parseEnvFile("FOO=bar\nBAZ=qux")).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("parses heredoc-style multiline values", () => {
    const content = ["RESULT<<EOF", "line one", "line two", "EOF", "OTHER=1"].join("\n");
    expect(parseEnvFile(content)).toEqual({
      RESULT: "line one\nline two",
      OTHER: "1",
    });
  });

  it("ignores blank lines", () => {
    expect(parseEnvFile("\nFOO=bar\n\n")).toEqual({ FOO: "bar" });
  });

  it("returns an empty object for empty content", () => {
    expect(parseEnvFile("")).toEqual({});
  });
});

describe("parsePathFile", () => {
  it("splits and trims lines, dropping blanks", () => {
    expect(parsePathFile("/usr/local/bin\n\n/opt/tool/bin\n")).toEqual([
      "/usr/local/bin",
      "/opt/tool/bin",
    ]);
  });
});
