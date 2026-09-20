import { describe, expect, it } from "vitest";
import { validateRunConfigPatch, validateWhatIfPatch } from "./validateRequest";

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

describe("validateWhatIfPatch", () => {
  it("accepts a well-formed patch", () => {
    expect(
      validateWhatIfPatch({
        env: { A: "1", B: null },
        vars: {},
        secrets: { T: "x" },
        inputs: { n: 1, o: { deep: true } },
        eventName: "push",
        ref: "refs/heads/main",
        breakOnFailure: false,
      })
    ).toBeNull();
  });

  it("accepts an empty patch", () => {
    expect(validateWhatIfPatch({})).toBeNull();
  });

  it("rejects a non-object body", () => {
    expect(validateWhatIfPatch("nope")).toMatch(/must be an object/);
    expect(validateWhatIfPatch(null)).toMatch(/must be an object/);
    expect(validateWhatIfPatch([1, 2])).toMatch(/must be an object/);
  });

  it("rejects non-string override values", () => {
    // A number here reached a string operation deep in interpolation.
    expect(validateWhatIfPatch({ env: { A: 1 } })).toMatch(/strings or null/);
    expect(validateWhatIfPatch({ vars: { A: {} } })).toMatch(/strings or null/);
    expect(validateWhatIfPatch({ secrets: "oops" })).toMatch(/strings or null/);
  });

  it("rejects wrong types on the scalar fields", () => {
    expect(validateWhatIfPatch({ eventName: 5 })).toMatch(/'eventName' must be a string/);
    expect(validateWhatIfPatch({ ref: {} })).toMatch(/'ref' must be a string/);
    expect(validateWhatIfPatch({ breakOnFailure: "yes" })).toMatch(/must be a boolean/);
  });

  it("rejects an unbounded payload", () => {
    const many = Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`K${i}`, "v"]));
    expect(validateWhatIfPatch({ env: many })).toMatch(/more than 200 keys/);
    expect(validateWhatIfPatch({ env: { A: "x".repeat(100_001) } })).toMatch(/character limit/);
  });

  it("still allows a null value, which is how an override is removed", () => {
    expect(validateWhatIfPatch({ env: { A: null } })).toBeNull();
  });
});
