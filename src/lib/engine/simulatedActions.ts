import fs from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import type { JsonValue } from "../workflow/types";

export interface SimulatedActionResult {
  outputs: Record<string, string>;
  conclusion: "success" | "failure";
  note: string;
}

interface HandlerArgs {
  withInputs: Record<string, JsonValue>;
  cwd: string;
  artifactsDir: string;
}

type Handler = (args: HandlerArgs) => SimulatedActionResult;

function str(v: JsonValue | undefined, fallback = ""): string {
  if (v === undefined || v === null) return fallback;
  return String(v);
}

const setupTool = (toolLabel: string, versionKey = "version"): Handler => ({ withInputs }) => ({
  outputs: { [`${versionKey}`]: str(withInputs[versionKey], "(local)"), "cache-hit": "false" },
  conclusion: "success",
  note: `Simulated: ${toolLabel} is not actually installed/switched locally - steps run against whatever is already on PATH. Requested version: ${str(
    withInputs[versionKey],
    "(default)"
  )}.`,
});

const HANDLERS: Record<string, Handler> = {
  "actions/checkout": () => ({
    outputs: {},
    conclusion: "success",
    note: "Simulated: the local working copy on disk is used as-is; ref/token/submodules inputs are ignored.",
  }),
  "actions/setup-node": setupTool("setup-node", "node-version"),
  "actions/setup-python": setupTool("setup-python", "python-version"),
  "actions/setup-go": setupTool("setup-go", "go-version"),
  "actions/setup-java": setupTool("setup-java", "java-version"),
  "actions/cache": () => ({
    outputs: { "cache-hit": "false" },
    conclusion: "success",
    note: "Simulated: local runs always report a cache miss; the cache steps' own commands still run normally.",
  }),
  "actions/upload-artifact": ({ withInputs, cwd, artifactsDir }) => {
    const name = str(withInputs.name, "artifact");
    const patterns = Array.isArray(withInputs.path)
      ? (withInputs.path as JsonValue[]).map((p) => str(p))
      : [str(withInputs.path, "")];
    const dest = path.join(artifactsDir, name);
    fs.mkdirSync(dest, { recursive: true });
    let count = 0;
    for (const pattern of patterns) {
      if (!pattern) continue;
      const matches = fg.sync(pattern, { cwd, dot: true, onlyFiles: true });
      for (const rel of matches) {
        const from = path.join(cwd, rel);
        const to = path.join(dest, path.basename(rel));
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(from, to);
        count++;
      }
    }
    return {
      outputs: { "artifact-id": name },
      conclusion: "success",
      note: `Simulated: copied ${count} file(s) into the local artifact store (.debugger/artifacts/${name}).`,
    };
  },
  "actions/download-artifact": ({ withInputs, cwd, artifactsDir }) => {
    const name = withInputs.name ? str(withInputs.name) : undefined;
    const destDir = path.join(cwd, str(withInputs.path, "."));
    fs.mkdirSync(destDir, { recursive: true });
    const sourceDirs = name
      ? [path.join(artifactsDir, name)]
      : fs.existsSync(artifactsDir)
        ? fs.readdirSync(artifactsDir).map((d) => path.join(artifactsDir, d))
        : [];
    let count = 0;
    for (const dir of sourceDirs) {
      if (!fs.existsSync(dir)) continue;
      for (const file of fs.readdirSync(dir)) {
        fs.copyFileSync(path.join(dir, file), path.join(destDir, file));
        count++;
      }
    }
    return {
      outputs: {},
      conclusion: count > 0 || !name ? "success" : "failure",
      note: `Simulated: restored ${count} file(s) from the local artifact store.`,
    };
  },
};

function actionName(uses: string): string {
  return uses.split("@")[0];
}

/**
 * Third-party and composite actions aren't executed (no Docker/container
 * action support in this MVP) - they're simulated as a no-op success with
 * empty outputs. Use a What-If override to mock any `steps.<id>.outputs.*`
 * a later step in the workflow depends on.
 */
export function runSimulatedAction(
  uses: string,
  withInputs: Record<string, JsonValue>,
  cwd: string,
  artifactsDir: string
): SimulatedActionResult {
  const handler = HANDLERS[actionName(uses)];
  if (handler) return handler({ withInputs, cwd, artifactsDir });
  return {
    outputs: {},
    conclusion: "success",
    note: `Simulated: '${uses}' is a third-party or composite action and isn't executed locally in this MVP. Outputs default to empty — use What-If to mock any outputs a downstream step depends on.`,
  };
}
