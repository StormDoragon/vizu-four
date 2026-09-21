import { describe, expect, it } from "vitest";
import {
  MAX_CONFIG_CHARS,
  MAX_CONFIG_KEYS,
  configMapSizeError,
  validateRunConfigPatch,
  validateWhatIfPatch,
} from "./validateRequest";

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

  it("rejects an oversized scalar string field", () => {
    expect(validateRunConfigPatch({ sha: "x".repeat(100_001) })).toMatch(/'config.sha' exceeds/);
  });

  it("rejects an oversized event payload, which previously had no check at all", () => {
    expect(validateRunConfigPatch({ event: { body: "x".repeat(100_001) } })).toMatch(
      /'config.event' exceeds/
    );
  });

  it("accepts a reasonably sized event payload", () => {
    expect(validateRunConfigPatch({ event: { action: "opened", number: 42 } })).toBeNull();
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

  it("rejects an oversized event payload", () => {
    expect(validateWhatIfPatch({ event: { body: "x".repeat(100_001) } })).toMatch(
      /'event' exceeds/
    );
  });

  it("accepts a reasonably sized event payload", () => {
    expect(validateWhatIfPatch({ event: { action: "opened", number: 42 } })).toBeNull();
  });

  it("rejects an oversized non-string value nested in inputs", () => {
    expect(validateWhatIfPatch({ inputs: { payload: { big: "x".repeat(100_001) } } })).toMatch(
      /'inputs\.payload' exceeds/
    );
  });
});

describe("cumulative configuration limits", () => {
  const bigMap = (n: number, valueChars = 1) =>
    Object.fromEntries(Array.from({ length: n }, (_, i) => [`K${i}`, "x".repeat(valueChars)]));

  it("rejects a session created with an oversized config map", () => {
    expect(validateRunConfigPatch({ envOverrides: bigMap(MAX_CONFIG_KEYS + 1) })).toMatch(
      /more than 1000 keys/
    );
  });

  it("rejects a session created with an oversized config by character count", () => {
    expect(validateRunConfigPatch({ vars: bigMap(10, MAX_CONFIG_CHARS / 5) })).toMatch(
      /more than 2000000 characters/
    );
  });

  it("accepts a config comfortably inside the limits", () => {
    expect(validateRunConfigPatch({ envOverrides: bigMap(100, 100) })).toBeNull();
  });

  it("counts keys as well as values toward the character limit", () => {
    const longKeys = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [`${"k".repeat(100_000)}${i}`, "v"])
    );
    expect(configMapSizeError(longKeys, "env")).toMatch(/more than 2000000 characters/);
  });
});
