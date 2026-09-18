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

function bool(v: JsonValue | undefined, fallback = false): boolean {
  if (v === undefined || v === null) return fallback;
  if (typeof v === "boolean") return v;
  const s = String(v).toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

/** Generic setup-* tool that reports the requested version and a cache miss. */
const setupTool = (
  toolLabel: string,
  versionKey = "version",
  extraOutputs: (inputs: Record<string, JsonValue>) => Record<string, string> = () => ({})
): Handler => {
  return ({ withInputs }) => {
    const version = str(withInputs[versionKey] ?? withInputs.node_version ?? withInputs["node-version"], "(local)");
    return {
      outputs: {
        [versionKey]: version,
        "cache-hit": "false",
        ...extraOutputs(withInputs),
      },
      conclusion: "success",
      note: `Simulated: ${toolLabel} is not actually installed/switched locally — subsequent steps run against whatever is already on PATH. Requested version: ${version}.`,
    };
  };
};

const HANDLERS: Record<string, Handler> = {
  // ---------------------------------------------------------------------------
  // Core GitHub actions
  // ---------------------------------------------------------------------------
  "actions/checkout": ({ withInputs }) => {
    const ref = str(withInputs.ref, "HEAD");
    const fetchDepth = str(withInputs["fetch-depth"], "1");
    const submodules = str(withInputs.submodules, "false");
    return {
      outputs: {
        ref,
        "commit": "local-working-copy",
      },
      conclusion: "success",
      note: `Simulated: the local working copy on disk is used as-is (ref=${ref}, fetch-depth=${fetchDepth}, submodules=${submodules}). Token and remote are ignored.`,
    };
  },

  "actions/setup-node": setupTool("setup-node", "node-version", (inputs) => {
    const architecture = str(inputs.architecture, process.arch);
    return {
      "node-version": str(inputs["node-version"] ?? inputs.version, "(local)"),
      architecture,
    };
  }),

  "actions/setup-python": setupTool("setup-python", "python-version", (inputs) => ({
    "python-version": str(inputs["python-version"] ?? inputs.version, "(local)"),
    "python-path": "python3",
  })),

  "actions/setup-go": setupTool("setup-go", "go-version"),

  "actions/setup-java": setupTool("setup-java", "java-version", (inputs) => ({
    "java-version": str(inputs["java-version"] ?? inputs.version, "(local)"),
    "path": "/usr/lib/jvm/default",
  })),

  "actions/setup-dotnet": setupTool("setup-dotnet", "dotnet-version"),

  "actions/cache": ({ withInputs }) => {
    const key = str(withInputs.key, "(none)");
    const restoreKeys = Array.isArray(withInputs["restore-keys"])
      ? (withInputs["restore-keys"] as JsonValue[]).map(String).join(", ")
      : str(withInputs["restore-keys"]);
    return {
      outputs: { "cache-hit": "false" },
      conclusion: "success",
      note: `Simulated: local runs always report a cache miss (key=${key}${restoreKeys ? `, restore-keys=${restoreKeys}` : ""}). Cache steps' own commands still execute normally.`,
    };
  },

  "actions/cache/restore": ({ withInputs }) => {
    const key = str(withInputs.key, "(none)");
    return {
      outputs: { "cache-hit": "false", "cache-primary-key": key },
      conclusion: "success",
      note: `Simulated: cache restore always misses locally (key=${key}).`,
    };
  },

  "actions/cache/save": ({ withInputs }) => {
    const key = str(withInputs.key, "(none)");
    return {
      outputs: {},
      conclusion: "success",
      note: `Simulated: cache save is a no-op locally (key=${key}).`,
    };
  },

  "actions/upload-artifact": ({ withInputs, cwd, artifactsDir }) => {
    const name = str(withInputs.name, "artifact");
    const patterns = Array.isArray(withInputs.path)
      ? (withInputs.path as JsonValue[]).map((p) => str(p))
      : [str(withInputs.path, "")];
    const retentionDays = str(withInputs["retention-days"], "90");
    const dest = path.join(artifactsDir, name);
    fs.mkdirSync(dest, { recursive: true });
    let count = 0;
    for (const pattern of patterns) {
      if (!pattern) continue;
      const matches = fg.sync(pattern, { cwd, dot: true, onlyFiles: true });
      for (const rel of matches) {
        const from = path.join(cwd, rel);
        const to = path.join(dest, rel); // preserve relative path structure
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(from, to);
        count++;
      }
    }
    return {
      outputs: {
        "artifact-id": name,
        "artifact-url": `file://${dest}`,
      },
      conclusion: "success",
      note: `Simulated: copied ${count} file(s) into the local artifact store (.debugger/artifacts/${name}). Retention: ${retentionDays} days (ignored locally).`,
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
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
      // Recursively copy preserving structure
      const walk = (src: string, relBase = "") => {
        for (const entry of fs.readdirSync(src)) {
          const full = path.join(src, entry);
          const rel = path.join(relBase, entry);
          if (fs.statSync(full).isDirectory()) {
            walk(full, rel);
          } else {
            const target = path.join(destDir, rel);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.copyFileSync(full, target);
            count++;
          }
        }
      };
      walk(dir);
    }
    return {
      outputs: {},
      conclusion: count > 0 || !name ? "success" : "failure",
      note: `Simulated: restored ${count} file(s) from the local artifact store${name ? ` (name=${name})` : ""}.`,
    };
  },

  "actions/upload-artifact/merge": () => ({
    outputs: {},
    conclusion: "success",
    note: "Simulated: artifact merge is a no-op in the local debugger.",
  }),

  // ---------------------------------------------------------------------------
  // Docker / container registry
  // ---------------------------------------------------------------------------
  "docker/login-action": ({ withInputs }) => {
    const registry = str(withInputs.registry, "docker.io");
    const username = str(withInputs.username, "(none)");
    return {
      outputs: {},
      conclusion: "success",
      note: `Simulated: docker login to ${registry} as ${username} is skipped (no real credentials used). Subsequent docker commands use whatever is already authenticated on this machine.`,
    };
  },

  "docker/setup-buildx-action": () => ({
    outputs: {
      name: "local-builder",
      driver: "docker-container",
      endpoint: "local",
    },
    conclusion: "success",
    note: "Simulated: buildx setup is a no-op; uses the default docker builder available on PATH.",
  }),

  "docker/build-push-action": ({ withInputs }) => {
    const tags = Array.isArray(withInputs.tags)
      ? (withInputs.tags as JsonValue[]).map(String).join(", ")
      : str(withInputs.tags, "(none)");
    const push = bool(withInputs.push, false);
    return {
      outputs: {
        digest: "sha256:local-simulated-digest",
        metadata: "{}",
      },
      conclusion: "success",
      note: `Simulated: docker build${push ? " + push" : ""} for tags [${tags}] is not executed. Image is not actually built or pushed.`,
    };
  },

  "docker/metadata-action": ({ withInputs }) => {
    const images = Array.isArray(withInputs.images)
      ? (withInputs.images as JsonValue[]).map(String)
      : [str(withInputs.images, "local/image")];
    const primary = images[0] ?? "local/image";
    return {
      outputs: {
        tags: `${primary}:latest`,
        labels: "",
        "version": "latest",
      },
      conclusion: "success",
      note: `Simulated: generated tags/labels for ${images.join(", ")}.`,
    };
  },

  // ---------------------------------------------------------------------------
  // Common third-party / ecosystem actions (lightweight simulation)
  // ---------------------------------------------------------------------------
  "actions/github-script": ({ withInputs }) => {
    const script = str(withInputs.script, "").slice(0, 80);
    return {
      outputs: { result: "" },
      conclusion: "success",
      note: `Simulated: github-script is not executed (script starts with: ${script || "(empty)"}…). Use What-If to mock the \`result\` output if needed.`,
    };
  },

  "softprops/action-gh-release": () => ({
    outputs: {
      url: "",
      id: "",
      "upload_url": "",
    },
    conclusion: "success",
    note: "Simulated: GitHub Release creation is skipped. No release is published.",
  }),

  "peaceiris/actions-gh-pages": () => ({
    outputs: {},
    conclusion: "success",
    note: "Simulated: gh-pages deploy is skipped. No site is published.",
  }),

  "codecov/codecov-action": () => ({
    outputs: {},
    conclusion: "success",
    note: "Simulated: Codecov upload is skipped.",
  }),

  "actions/labeler": () => ({
    outputs: {},
    conclusion: "success",
    note: "Simulated: PR labeler is a no-op in the local debugger.",
  }),
};

function actionName(uses: string): string {
  // Normalize: "owner/repo@ref" or "owner/repo/path@ref" → "owner/repo" (or with subpath for cache/restore etc.)
  const withoutRef = uses.split("@")[0];
  // Prefer longest matching key (so "actions/cache/restore" wins over "actions/cache")
  return withoutRef;
}

/**
 * Resolve the best handler for a `uses:` value.
 * Tries the full path first (e.g. actions/cache/restore), then falls back
 * to the repo root (actions/cache).
 */
function findHandler(uses: string): Handler | undefined {
  const name = actionName(uses);
  if (HANDLERS[name]) return HANDLERS[name];
  // Fallback: try dropping trailing path segments (actions/cache/restore → actions/cache)
  const parts = name.split("/");
  while (parts.length > 2) {
    parts.pop();
    const candidate = parts.join("/");
    if (HANDLERS[candidate]) return HANDLERS[candidate];
  }
  return undefined;
}

/**
 * Third-party and composite actions aren't executed (no Docker/container
 * action support in this MVP) — they're simulated as a no-op success with
 * empty outputs. Use a What-If override (or the upcoming Mock Outputs UI)
 * to mock any `steps.<id>.outputs.*` a later step depends on.
 */
export function runSimulatedAction(
  uses: string,
  withInputs: Record<string, JsonValue>,
  cwd: string,
  artifactsDir: string
): SimulatedActionResult {
  const handler = findHandler(uses);
  if (handler) return handler({ withInputs, cwd, artifactsDir });
  return {
    outputs: {},
    conclusion: "success",
    note: `Simulated: '${uses}' is a third-party or composite action and isn't executed locally in this MVP. Outputs default to empty — use What-If (or Mock Outputs) to provide any outputs a downstream step depends on.`,
  };
}
