// Verifies a production build configured the way the public demo runs -
// simulation-only (VIZU_DEMO_MODE=1) with an AI key set - over real HTTP,
// against a stand-in for the Anthropic API, so no provider is called and
// nothing is spent.
//
//   npm run build && npm run verify:deployment
//
// Demo mode: /api/config reports simulation-only; a `run:` step is never
// executed (the file it would create never appears); host workspace
// browsing and the working-tree opt-in are refused; another visitor gets 404.
//
// AI cost controls: provider calls never exceed VIZU_AI_MAX_CALLS_PER_WINDOW,
// in-flight calls never exceed VIZU_AI_MAX_CONCURRENT, a hung provider is
// abandoned after VIZU_AI_TIMEOUT_MS, no prompt exceeds MAX_PROMPT_BYTES,
// every refusal still answers with the offline explanation, and one visitor
// hits the per-visitor explain limit (429).

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const NEXT_BIN = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");

const MAX_CALLS = 4;
const MAX_CONCURRENT = 2;
const TIMEOUT_MS = 3000;
/** Mirrors MAX_PROMPT_BYTES in src/lib/ai/explain.ts. */
const MAX_PROMPT_BYTES = 16 * 1024;
/** How long the stand-in provider takes to answer: long enough for a burst
 * of calls to overlap, well inside TIMEOUT_MS so none of them time out. */
const PROVIDER_DELAY_MS = 1000;
/** The oversized step name, and what of it proves that prompt arrived. */
const OVERSIZED_NAME = "n".repeat(300_000);
/** A step name containing this makes the stand-in provider never answer. */
const HANG_MARKER = "verify-hang";

const failures = [];

function check(name, ok, detail = "") {
  if (ok) {
    console.log(`ok    ${name}`);
  } else {
    failures.push(name);
    console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`);
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function startProvider() {
  const stats = { requests: 0, inFlight: 0, maxInFlight: 0, maxPromptBytes: 0, sawOversized: false };
  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || !req.url.startsWith("/v1/messages")) {
      res.writeHead(404).end();
      return;
    }
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      stats.requests++;
      stats.inFlight++;
      stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
      let open = true;
      res.on("close", () => {
        if (open) stats.inFlight--;
        open = false;
      });
      const prompt = JSON.parse(body).messages[0].content;
      stats.maxPromptBytes = Math.max(stats.maxPromptBytes, Buffer.byteLength(prompt, "utf8"));
      if (prompt.includes(OVERSIZED_NAME.slice(0, 200))) stats.sawOversized = true;
      if (prompt.includes(HANG_MARKER)) return; // never answers
      setTimeout(() => {
        const reply = {
          summary: "Stand-in explanation.",
          causes: [{ title: "Stand-in cause", detail: "From the verification provider.", confidence: "high" }],
        };
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "msg_verify",
            type: "message",
            role: "assistant",
            model: "verify",
            stop_reason: "end_turn",
            usage: { input_tokens: 1, output_tokens: 1 },
            content: [{ type: "text", text: JSON.stringify(reply) }],
          })
        );
      }, PROVIDER_DELAY_MS);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, stats, port: server.address().port }));
  });
}

function startApp(port, providerPort) {
  let log = "";
  const child = spawn(process.execPath, [NEXT_BIN, "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: ROOT,
    env: {
      ...process.env,
      VIZU_DEMO_MODE: "1",
      ANTHROPIC_API_KEY: "verify-not-a-real-key",
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${providerPort}`,
      VIZU_AI_MAX_CALLS_PER_WINDOW: String(MAX_CALLS),
      VIZU_AI_MAX_CONCURRENT: String(MAX_CONCURRENT),
      VIZU_AI_TIMEOUT_MS: String(TIMEOUT_MS),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  return { child, log: () => log };
}

async function waitUntilUp(base, app) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (app.child.exitCode !== null) throw new Error(`the app exited early:\n${app.log()}`);
    try {
      if ((await fetch(`${base}/api/config`)).ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`the app did not come up within 60s:\n${app.log()}`);
}

/** One visitor: carries the `vizu_owner` cookie the app hands out. */
function visitor(base) {
  let cookie = "";
  return async (method, pathname, body) => {
    const res = await fetch(`${base}${pathname}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(cookie ? { cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      if (c.startsWith("vizu_owner=")) cookie = c.split(";")[0];
    }
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: res.status, json };
  };
}

async function createSession(call, yaml) {
  const res = await call("POST", "/api/sessions", { workflowYaml: yaml });
  if (res.status !== 200) throw new Error(`creating a session answered ${res.status}: ${JSON.stringify(res.json)}`);
  return res.json.session;
}

/** A session whose only step has been mocked to fail and then run. */
async function failedStep(call, stepName) {
  const yaml = [
    "name: Verify",
    "on: [push]",
    "jobs:",
    "  build:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    `      - name: ${JSON.stringify(stepName)}`,
    '        run: echo "only ever mocked here"',
    "",
  ].join("\n");
  const session = await createSession(call, yaml);
  const stepKey = session.workflow.jobs.build.steps[0].key;
  const mocked = await call("POST", `/api/sessions/${session.id}/mock-outputs`, {
    jobId: "build",
    stepKey,
    mock: { outputs: {}, exitCode: 1, stderr: "verify: mocked failure" },
  });
  if (mocked.status !== 200) throw new Error(`mocking answered ${mocked.status}`);
  const ran = await call("POST", `/api/sessions/${session.id}/control`, { action: "runAll" });
  const laneId = ran.json.session.laneOrder[0];
  if (ran.json.session.lanes[laneId].steps[0].status !== "failure") throw new Error("the mocked step did not fail");
  return { sessionId: session.id, laneId };
}

function explain(call, step) {
  return call("POST", `/api/sessions/${step.sessionId}/explain`, { laneId: step.laneId, stepIndex: 0 });
}

async function waitFor(condition, ms) {
  const deadline = Date.now() + ms;
  while (!condition() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  return condition();
}

async function verifyDemoMode(base) {
  const call = visitor(base);

  const config = await call("GET", "/api/config");
  check("/api/config reports simulation-only", config.json?.simulationOnly === true, JSON.stringify(config.json));

  const scratch = mkdtempSync(path.join(os.tmpdir(), "vizu-verify-"));
  const marker = path.join(scratch, "run-step-executed");
  try {
    const session = await createSession(
      call,
      [
        "name: Verify",
        "on: [push]",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        `      - run: touch '${marker}'`,
        "",
      ].join("\n")
    );
    const ran = await call("POST", `/api/sessions/${session.id}/control`, { action: "runAll" });
    const step = ran.json.session.lanes[ran.json.session.laneOrder[0]].steps[0];
    check("a run: step is never executed", !existsSync(marker), `${marker} exists`);
    check(
      "the step reports what it would have run instead",
      step.simulated === true && /simulation-only/.test(step.simulationNote ?? ""),
      JSON.stringify({ simulated: step.simulated, note: step.simulationNote })
    );

    const stranger = visitor(base);
    const theirs = await stranger("GET", `/api/sessions/${session.id}`);
    check("another visitor's session answers 404", theirs.status === 404, `got ${theirs.status}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  const browse = await call("POST", "/api/workspace/workflows", { directory: "." });
  check("host workspace browsing is refused", browse.status === 403, `got ${browse.status}`);

  const optIn = await call("POST", "/api/sessions", {
    workflowYaml: "name: x\non: [push]\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n",
    workingTreeDir: ".",
  });
  check("the real working-tree opt-in is refused", optIn.status === 403, `got ${optIn.status}`);
}

async function verifyAiCostControls(base, provider) {
  const call = visitor(base);
  const { stats } = provider;

  // A provider that never answers: the call must be abandoned at the deadline.
  const hung = await failedStep(call, `Deploy (${HANG_MARKER})`);
  const started = Date.now();
  const hungReply = await explain(call, hung);
  const elapsed = Date.now() - started;
  check(
    `a hung provider call is abandoned after VIZU_AI_TIMEOUT_MS (${TIMEOUT_MS} ms)`,
    hungReply.json?.explanation?.source === "heuristic" && elapsed >= TIMEOUT_MS * 0.9 && elapsed < TIMEOUT_MS + 5000,
    `source ${hungReply.json?.explanation?.source}, took ${elapsed} ms`
  );
  await waitFor(() => stats.inFlight === 0, 5000);

  // A burst: only VIZU_AI_MAX_CONCURRENT reach the provider, the rest degrade.
  const normal = await failedStep(call, "Run tests");
  stats.maxInFlight = 0;
  const burst = await Promise.all(Array.from({ length: MAX_CONCURRENT + 2 }, () => explain(call, normal)));
  const sources = burst.map((r) => r.json?.explanation?.source);
  check(
    `in-flight provider calls never exceed VIZU_AI_MAX_CONCURRENT (${MAX_CONCURRENT})`,
    stats.maxInFlight === MAX_CONCURRENT &&
      sources.filter((s) => s === "claude").length === MAX_CONCURRENT &&
      sources.filter((s) => s === "heuristic").length === 2,
    `provider saw ${stats.maxInFlight} at once; sources ${sources.join(", ")}`
  );

  // A step name far past any sane size still produces a bounded prompt.
  const oversized = await failedStep(call, OVERSIZED_NAME);
  const big = await explain(call, oversized);
  check(
    `no prompt exceeds MAX_PROMPT_BYTES (${MAX_PROMPT_BYTES})`,
    big.json?.explanation?.source === "claude" && stats.sawOversized && stats.maxPromptBytes <= MAX_PROMPT_BYTES,
    `largest prompt ${stats.maxPromptBytes} bytes, oversized one seen: ${stats.sawOversized}, source ${big.json?.explanation?.source}`
  );

  // The window is spent now: further calls degrade without reaching the provider.
  const before = stats.requests;
  const spent = await explain(call, normal);
  check(
    `provider calls stop at VIZU_AI_MAX_CALLS_PER_WINDOW (${MAX_CALLS})`,
    stats.requests === MAX_CALLS && before === MAX_CALLS && spent.json?.explanation?.source === "heuristic",
    `provider saw ${stats.requests} calls; last source ${spent.json?.explanation?.source}`
  );

  // One visitor cannot take the whole instance budget: the explain route
  // itself answers 429 past the per-visitor limit.
  let accepted = 0;
  let limited = false;
  for (let i = 0; i < 200 && !limited; i++) {
    const res = await explain(call, normal);
    if (res.status === 429) limited = true;
    else if (res.status === 200) accepted++;
    else break;
  }
  check("one visitor hits the per-visitor explain limit (429)", limited, `no 429 after ${accepted} more requests`);
  check("the provider saw no further calls", stats.requests === MAX_CALLS, `provider saw ${stats.requests}`);
}

async function main() {
  if (!existsSync(path.join(ROOT, ".next", "BUILD_ID"))) {
    console.error("No production build found - run `npm run build` first.");
    process.exit(1);
  }

  const provider = await startProvider();
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const app = startApp(port, provider.port);
  try {
    await waitUntilUp(base, app);
    console.log(`production build up at ${base} (VIZU_DEMO_MODE=1, stand-in AI provider)\n`);
    await verifyDemoMode(base);
    await verifyAiCostControls(base, provider);
    check(
      "no unsafe-deployment warning in demo mode",
      !app.log().includes("WARNING: production build with real `run:` execution enabled")
    );
  } catch (err) {
    failures.push("unexpected error");
    console.log(`FAIL  ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    app.child.kill("SIGTERM");
    provider.server.closeAllConnections();
    provider.server.close();
  }

  if (failures.length > 0) {
    console.log(`\n${failures.length} check(s) failed. App log:\n${app.log()}`);
    process.exit(1);
  }
  console.log("\nall deployment checks passed");
}

await main();
