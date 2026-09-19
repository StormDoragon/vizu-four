/**
 * Deployment-shape switches, read from the environment.
 *
 * The default is deliberately "behave like the local-first tool this is":
 * real `run:` execution stays ON unless an operator explicitly opts out.
 * Defaulting the other way would break every local user, who installed this
 * precisely to run their workflow for real.
 *
 * That does mean an operator deploying publicly has to remember to set the
 * flag, so `warnIfUnsafeDeployment()` shouts on startup when a production
 * build is running with execution still enabled.
 */

const TRUTHY = new Set(["1", "true", "yes", "on"]);

function flag(name: string): boolean {
  const value = process.env[name];
  return typeof value === "string" && TRUTHY.has(value.trim().toLowerCase());
}

/**
 * Simulation-only: `run:` steps are never spawned. Everything else - the
 * expression engine, matrix expansion, `if:` evaluation, breakpoints,
 * `uses:` simulation - behaves exactly as it does locally.
 */
export function isSimulationOnly(): boolean {
  return flag("VIZU_DEMO_MODE");
}

const WARNED_KEY = "__vizuDeploymentWarned__";

/**
 * `run:` steps execute with this process's own shell privileges, so a
 * production build serving more than one person needs simulation-only mode.
 * Nothing can enforce that from in here - the best we can do is make
 * forgetting it loud rather than silent.
 */
export function warnIfUnsafeDeployment(): void {
  const g = globalThis as unknown as Record<string, boolean | undefined>;
  if (g[WARNED_KEY]) return;
  g[WARNED_KEY] = true;

  if (process.env.NODE_ENV === "production" && !isSimulationOnly()) {
    console.warn(
      "\n[vizu-four] WARNING: production build with real `run:` execution enabled.\n" +
        "  Debugged workflows run shell commands as this server process.\n" +
        "  If anyone but you can reach this instance, set VIZU_DEMO_MODE=1.\n"
    );
  }
}
