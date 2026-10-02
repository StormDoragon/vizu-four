import { checkLimit } from "../engine/rateLimit";

const globalState = globalThis as typeof globalThis & { __vizuReleaseInFlight?: number };
export function acquireReleaseSlot(): (() => void) | null {
  if ((globalState.__vizuReleaseInFlight ?? 0) >= 2) return null;
  globalState.__vizuReleaseInFlight = (globalState.__vizuReleaseInFlight ?? 0) + 1;
  let released = false;
  return () => {
    if (!released) globalState.__vizuReleaseInFlight = Math.max(0, (globalState.__vizuReleaseInFlight ?? 0) - 1);
    released = true;
  };
}

export function checkReleaseLimit(owner: string, address: string | null) {
  return checkLimit("release", owner, address, { owner: 5, address: 10, global: 20 });
}
