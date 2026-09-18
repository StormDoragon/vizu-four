const MASK = "***";
const MIN_MASKABLE_LENGTH = 3; // avoid masking trivially short/common substrings

/**
 * Replaces every occurrence of any secret value with `***`, mirroring
 * GitHub Actions' own log masking. Values shorter than a few characters are
 * skipped since masking them would redact unrelated text (GitHub applies a
 * similar minimum-length rule).
 */
export function maskSecrets(text: string, secrets: Record<string, string>): string {
  let out = text;
  const values = Object.values(secrets)
    .filter((v) => v && v.length >= MIN_MASKABLE_LENGTH)
    // Mask longer values first so a short secret that's a substring of a
    // longer one doesn't fragment the longer value's mask.
    .sort((a, b) => b.length - a.length);
  for (const value of values) {
    if (!out.includes(value)) continue;
    out = out.split(value).join(MASK);
  }
  return out;
}

export function maskObjectStrings<T>(value: T, secrets: Record<string, string>): T {
  if (typeof value === "string") {
    return maskSecrets(value, secrets) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => maskObjectStrings(v, secrets)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = maskObjectStrings(v, secrets);
    }
    return out as T;
  }
  return value;
}
