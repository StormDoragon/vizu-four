import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { load } from "js-yaml";

describe("CI workflow", () => {
  it("does not hard-code a feature branch in the push trigger", () => {
    const workflow = load(readFileSync(join(process.cwd(), ".github/workflows/ci.yml"), "utf8")) as { on: { push: { branches: string[] } } };
    expect(workflow.on.push.branches).toEqual(["main"]);
  });
});
