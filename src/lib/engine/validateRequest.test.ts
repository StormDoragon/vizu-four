import { describe, expect, it } from "vitest";
import { validateRunConfigPatch } from "./validateRequest";

describe("validateRunConfigPatch", () => {
  it("allows undefined (no config given)", () => {
    expect(validateRunConfigPatch(undefined)).toBeNull();
  });

  it("rejects a non-object config", () => {
    expect(validateRunConfigPatch("oops")).toMatch(/must be an object/);
    expect(validateRunConfigPatch(42)).toMatch(/must be an object/);
    expect(validateRunConfigPatch(["a"])).toMatch(/must be an object/);
  });

  it("rejects a string field that isn't a string", () => {
    expect(validateRunConfigPatch({ actor: 123 })).toMatch(/'config.actor' must be a string/);
    expect(validateRunConfigPatch({ ref: null })).toMatch(/'config.ref' must be a string/);
  });

  it("rejects a string-map field that isn't a record of strings - the exact 500 this guards against", () => {
    // This is the concrete case from the audit: vars: "oops" reaching
    // Object.entries downstream instead of failing here with a clear 400.
    expect(validateRunConfigPatch({ vars: "oops" })).toMatch(/'config.vars' must be an object/);
    expect(validateRunConfigPatch({ secrets: { TOKEN: 123 } })).toMatch(
      /'config.secrets' must be an object/
    );
    expect(validateRunConfigPatch({ envOverrides: ["a", "b"] })).toMatch(
      /'config.envOverrides' must be an object/
    );
  });

  it("rejects a non-object workflowInputs", () => {
    expect(validateRunConfigPatch({ workflowInputs: "oops" })).toMatch(
      /'config.workflowInputs' must be an object/
    );
  });

  it("accepts a well-formed partial config", () => {
    expect(
      validateRunConfigPatch({
        eventName: "push",
        vars: { DEPLOY_ENV: "staging" },
        secrets: { TOKEN: "abc" },
        workflowInputs: { count: 3, nested: { ok: true } },
      })
    ).toBeNull();
  });
});
