const MASK = "***";
const MIN_MASKABLE_LENGTH = 3; // avoid masking trivially short/common substrings

/**
 * Replaces every occurrence of any secret value with `***`, mirroring
 * GitHub Actions' own log masking. Values shorter than a few characters are
 * skipped since masking them would redact unrelated text (GitHub applies a
 * similar minimum-length rule).
 */
function maskableValues(secrets: Record<string, string>): string[] {
  return (
    Object.values(secrets)
      .filter((v) => v && v.length >= MIN_MASKABLE_LENGTH)
      // Mask longer values first so a short secret that's a substring of a
      // longer one doesn't fragment the longer value's mask.
      .sort((a, b) => b.length - a.length)
  );
}

export function maskSecrets(text: string, secrets: Record<string, string>): string {
  let out = text;
  for (const value of maskableValues(secrets)) {
    if (!out.includes(value)) continue;
    out = out.split(value).join(MASK);
  }
  return out;
}

interface Range {
  start: number;
  end: number;
}

/** Non-overlapping spans to redact, longest secret first so a short value
 * that is a substring of a longer one can't carve it up. */
function redactionRanges(text: string, values: string[]): Range[] {
  const ranges: Range[] = [];
  for (const value of values) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(value, from);
      if (at === -1) break;
      const end = at + value.length;
      if (!ranges.some((r) => at < r.end && end > r.start)) ranges.push({ start: at, end });
      from = end;
    }
  }
  return ranges.sort((a, b) => a.start - b.start);
}

/**
 * Masks a tagged, ordered list of output chunks.
 *
 * Masking each chunk on its own misses any secret split across two of them:
 * a process that writes a token in two `write()` calls produced two chunks
 * holding one half each, neither matching the full value, so the redacted
 * stdout read `***` while the interleaved view still showed the whole token
 * once the chunks were displayed end to end. Redaction is therefore computed
 * over the concatenation and the result re-split on the original boundaries,
 * which also covers a secret straddling a stdout/stderr switch. The mask is
 * emitted in the chunk where the secret begins; the rest of it is dropped
 * from the chunks it continues into, so nothing is masked twice.
 */
export function maskChunks<T extends { text: string }>(
  chunks: T[],
  secrets: Record<string, string>
): T[] {
  const values = maskableValues(secrets);
  if (values.length === 0 || chunks.length === 0) return chunks;

  const full = chunks.map((c) => c.text).join("");
  const ranges = redactionRanges(full, values);
  if (ranges.length === 0) return chunks;

  const out: T[] = [];
  let offset = 0;
  for (const chunk of chunks) {
    const start = offset;
    const end = offset + chunk.text.length;
    offset = end;

    let text = "";
    let i = start;
    while (i < end) {
      const covering = ranges.find((r) => r.start <= i && i < r.end);
      if (covering) {
        // Only where it begins - a range continuing from an earlier chunk has
        // already contributed its mask there.
        if (covering.start === i) text += MASK;
        i = Math.min(covering.end, end);
        continue;
      }
      const next = ranges.find((r) => r.start > i);
      const stop = next ? Math.min(next.start, end) : end;
      text += full.slice(i, stop);
      i = stop;
    }
    out.push({ ...chunk, text });
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
