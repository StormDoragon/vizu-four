import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const origin = "http://127.0.0.1:3219";
const child = spawn(process.execPath, [
  "--import", new URL("./fixtures/github.mjs", import.meta.url).href,
  "node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3219",
], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, VIZU_DEMO_MODE: "1", ANTHROPIC_API_KEY: "", GITHUB_TOKEN: "", NODE_ENV: "production" },
});
let logs = "";
child.stdout.on("data", chunk => { logs = (logs + chunk).slice(-20000); });
child.stderr.on("data", chunk => { logs = (logs + chunk).slice(-20000); });
const stopped = once(child, "exit");
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    assert.equal(child.exitCode, null, `Server exited early: ${logs}`);
    try { ready = (await fetch(origin, { signal: AbortSignal.timeout(1000) })).ok; } catch {}
    if (ready) break;
    await delay(200);
  }
  assert.ok(ready, `Server failed to become ready: ${logs}`);
  for (const [path, marker] of [["/", "Debug"], ["/release", "Understand what shipped."]]) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 200);
    assert.ok((await response.text()).includes(marker), `${path} missing content`);
  }
  const post = (body, headers = {}) => fetch(origin + "/api/releases/analyze", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origin, ...headers },
    body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
  });
  assert.equal((await post({}, { Origin: "https://evil.example" })).status, 403);
  assert.equal((await post({}, { "Content-Type": "text/plain" })).status, 415);
  assert.equal((await post({ repository: "http://localhost/private", base: "v1", head: "main" })).status, 400);
  const response = await post({ repository: "example/project", base: "release/v1", head: "main", useAi: true });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(result.analysis.source, "deterministic");
  assert.equal(result.analysis.changes.length, 2);
  assert.equal(result.analysis.changes[1].releaseWorthy, false);
  assert.equal(result.analysis.files[0].url, `https://github.com/example/project/blob/${"b".repeat(40)}/src/Report%20%C3%A9.ts`);
  for (const notes of Object.values(result.notes)) {
    assert.ok(notes.includes("add CSV export"));
    assert.ok(notes.includes("https://github.com/example/project/pull/7"));
    assert.ok(!notes.includes("update Linux runner"));
  }
  const debugResponse = await fetch(origin + "/api/sessions", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workflowYaml: "name: Smoke\non: [push]\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - run: exit 99\n" }),
  });
  assert.equal(debugResponse.status, 200);
  const { session } = await debugResponse.json();
  assert.equal(session.simulationOnly, true);
  const cookie = debugResponse.headers.get("set-cookie").split(";")[0];
  const sessionUrl = `${origin}/api/sessions/${session.id}`;
  assert.equal((await fetch(sessionUrl)).status, 404, "Session ownership must remain enforced");
  const run = await fetch(sessionUrl + "/control", {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ action: "runAll" }),
  });
  assert.equal(run.status, 200);
  const completed = (await run.json()).session;
  assert.equal(completed.lanes[completed.laneOrder[0]].status, "success", "Demo must simulate exit 99 instead of executing it");
  assert.equal((await fetch(sessionUrl, { method: "DELETE", headers: { Cookie: cookie } })).status, 200);
  console.log(`Production smoke passed on ${process.platform}, Node ${process.versions.node}: Debug, Release, API validation, collection, evidence, no-key fallback, both note outputs.`);
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  child.kill();
  await Promise.race([stopped, delay(5000).then(() => { if (child.exitCode === null) child.kill("SIGKILL"); })]);
}
