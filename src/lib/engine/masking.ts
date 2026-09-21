const MASK = "***";
const MIN_MASKABLE_LENGTH = 3; // avoid masking trivially short/common substrings

/**
 * The set of values to redact. Deliberately a list of values, not a map of
 * name to value: masking never cares what a secret is called, and the one
 * time this was a map it had to invent names for retired values, which
 * collided with real ones - a secret actually named `__retired_0` was
 * dropped from the set and printed in full.
 */
export type SecretValues = readonly string[];

/**
 * Values to redact: everything that is a secret now, plus everything that
 * was one earlier in this session.
 *
 * Masking stored data against only the current secrets lets a secret escape
 * by being removed - What-If deletes it, and every snapshot and record that
 * still holds the old value is suddenly matched against a set that no longer
 * contains it. Retired values are never dropped, so a value that was ever
 * secret here stays redacted. Masking something that is no longer secret
 * costs nothing; the reverse does not.
 *
 * This is a read-side view. It is never the thing to write a secret change
 * into - that is `session.config.secrets`, the live map.
 */
export function secretsToMask(
  current: Record<string, string>,
  retired: readonly string[]
): SecretValues {
  return [...Object.values(current), ...retired];
}

function maskableValues(secrets: SecretValues): string[] {
  return (
    [...new Set(secrets)]
      .filter((v) => v && v.length >= MIN_MASKABLE_LENGTH)
      // Mask longer values first so a short secret that's a substring of a
      // longer one doesn't fragment the longer value's mask.
      .sort((a, b) => b.length - a.length)
  );
}

interface Range {
  start: number;
  end: number;
}

/**
 * Spans to redact, with overlapping ones merged.
 *
 * Merging is the whole point. Two secrets can overlap in the text - `abcdef`
 * and `defghi` both occur in `abcdefghi` - and handling them one at a time
 * destroys the evidence the other needed: replacing the first match leaves
 * `***ghi`, with half of the second secret sitting in the output. Dropping
 * the overlapping match instead leaves the same fragment. Deciding every
 * span first and merging what touches redacts the whole run, so a chain of
 * overlapping secrets masks to a single `***`.
 *
 * Occurrences of one value are also scanned overlapping (`at + 1`, not
 * `at + length`), so `aa` in `aaa` covers all three characters rather than
 * leaving a trailing one.
 *
 * Strictly overlapping spans merge; merely adjacent ones do not, so two
 * different secrets written back to back still read as two masks.
 */
function redactionRanges(text: string, values: string[]): Range[] {
  const raw: Range[] = [];
  for (const value of values) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(value, from);
      if (at === -1) break;
      raw.push({ start: at, end: at + value.length });
      from = at + 1;
    }
  }
  if (raw.length === 0) return raw;
  raw.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: Range[] = [raw[0]];
  for (const range of raw.slice(1)) {
    const last = merged[merged.length - 1];
    if (range.start < last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

/**
 * Replaces every occurrence of any secret value with `***`, mirroring
 * GitHub Actions' own log masking. Values shorter than a few characters are
 * skipped since masking them would redact unrelated text (GitHub applies a
 * similar minimum-length rule).
 *
 * Built on `redactionRanges` rather than a sequence of replacements: doing
 * them one value at a time is what let overlapping secrets leak, and it is
 * the same decision `maskChunks` and `StreamMasker` need, so all three share
 * it instead of each getting the edge cases right separately.
 */
export function maskSecrets(text: string, secrets: SecretValues): string {
  const ranges = redactionRanges(text, maskableValues(secrets));
  if (ranges.length === 0) return text;
  let out = "";
  let at = 0;
  for (const range of ranges) {
    out += text.slice(at, range.start) + MASK;
    at = range.end;
  }
  return out + text.slice(at);
}

/**
 * Masks a tagged, ordered list of output chunks.
 *
 * Masking each chunk on its own misses a secret split across two of them: a
 * process writing a token in two `write()` calls leaves one half in each,
 * and neither matches the whole value. Reading the chunks end to end then
 * shows the token that the separately-masked stdout reported as `***`.
 *
 * Redaction is therefore computed over concatenations and projected back
 * onto the chunks. Three of them, because no single one catches everything:
 * the interleaved whole (a secret spanning a stdout/stderr switch), and each
 * stream on its own (a secret split across two writes of one stream with a
 * line from the other arriving in between - which breaks the interleaved
 * concatenation, since the unrelated line lands inside the value).
 */
export function maskChunks<T extends { text: string; stream?: string }>(
  chunks: T[],
  secrets: SecretValues
): T[] {
  const values = maskableValues(secrets);
  if (values.length === 0 || chunks.length === 0) return chunks;

  const lengths = chunks.map((c) => c.text.length);
  const starts: number[] = [];
  let acc = 0;
  for (const len of lengths) {
    starts.push(acc);
    acc += len;
  }

  const redact = new Uint8Array(acc);
  const projections: number[][] = [chunks.map((_, i) => i)];
  for (const stream of new Set(chunks.map((c) => c.stream))) {
    if (stream === undefined) continue;
    projections.push(chunks.map((_, i) => i).filter((i) => chunks[i].stream === stream));
  }

  for (const indexes of projections) {
    if (indexes.length === 0) continue;
    const text = indexes.map((i) => chunks[i].text).join("");
    for (const range of redactionRanges(text, values)) {
      let local = 0;
      for (const i of indexes) {
        const segmentStart = local;
        local += lengths[i];
        const from = Math.max(range.start, segmentStart);
        const to = Math.min(range.end, local);
        if (from >= to) continue;
        const globalFrom = starts[i] + (from - segmentStart);
        redact.fill(1, globalFrom, globalFrom + (to - from));
      }
    }
  }
  if (!redact.includes(1)) return chunks;

  const full = chunks.map((c) => c.text).join("");
  return chunks.map((chunk, i) => {
    let text = "";
    const end = starts[i] + lengths[i];
    for (let p = starts[i]; p < end; p++) {
      if (!redact[p]) {
        text += full[p];
        continue;
      }
      // One mask per contiguous redacted run, emitted where the run starts -
      // a run continuing from the previous chunk already produced its own.
      if (p === 0 || !redact[p - 1]) text += MASK;
    }
    return { ...chunk, text };
  });
}

/**
 * Redacts a stream incrementally, holding back just enough of its tail to
 * recognise a secret split across two writes.
 *
 * Capture truncates: a head is frozen, a tail window slides, and whole
 * chunks are dropped past a cap. Masking afterwards is too late, because the
 * discarded half of a secret is what the remaining half needed to be matched
 * against - a value straddling the head boundary left its prefix sitting in
 * the retained output with nothing left to match. Redacting here means
 * nothing leaves this class unmasked, so callers may truncate freely.
 */
// A chain of overlapping occurrences (a repeating secret pattern) merges
// into one range that keeps touching the end of the buffer, which would
// otherwise pull `safeEnd` back to 0 forever and hold the entire stream in
// `carry` - unbounded memory from a crafted input, never flushed until the
// stream ends. This caps how much a single in-progress match can ever make
// `push` hold back, on top of the ordinary one-secret-length lookback.
const MAX_HELD_CHARS = 64 * 1024;

export class StreamMasker {
  private carry = "";
  private readonly values: string[];
  private readonly longest: number;

  constructor(private readonly secrets: SecretValues) {
    this.values = maskableValues(secrets);
    this.longest = this.values.reduce((max, v) => Math.max(max, v.length), 0);
  }

  /** Masked text that is safe to emit; the rest is held for the next call. */
  push(text: string): string {
    if (this.longest === 0) return text;
    const buffered = this.carry + text;
    // Anything within one secret-length of the end could still be the start
    // of a match completed by the next write, so it waits.
    let safeEnd = Math.max(0, buffered.length - (this.longest - 1));
    const ranges = redactionRanges(buffered, this.values);
    for (const range of ranges) {
      if (range.start < safeEnd && range.end > safeEnd) safeEnd = range.start;
    }
    // Never let the cap above be defeated by a match that keeps growing:
    // once held-back text would exceed the cap, emit anyway. Do it from the
    // ranges already computed over the *whole* buffer, not by re-masking a
    // truncated slice - a range clipped at the cut is still fully masked,
    // rather than silently going unmatched because half of it fell outside
    // a freshly-scanned substring.
    safeEnd = Math.max(safeEnd, buffered.length - MAX_HELD_CHARS);
    this.carry = buffered.slice(safeEnd);
    let out = "";
    let at = 0;
    for (const range of ranges) {
      if (range.start >= safeEnd) break;
      out += buffered.slice(at, range.start) + MASK;
      at = Math.min(range.end, safeEnd);
    }
    return out + buffered.slice(at, safeEnd);
  }

  /** Whatever is still held back, masked. Call once the stream has ended. */
  flush(): string {
    if (this.longest === 0) return "";
    const out = maskSecrets(this.carry, this.secrets);
    this.carry = "";
    return out;
  }
}

/**
 * Masks, then shortens - in that order, always.
 *
 * Truncating first and masking what is left is a leak, not a nuance: the
 * discarded tail is exactly what the retained head needed to be matched
 * against, so a secret straddling the cut leaves its prefix sitting in the
 * output with nothing left to recognise it by. Anywhere a string built from
 * interpolated or captured data has to be shortened for display, it goes
 * through here rather than through `.slice()` and a later `maskSecrets`.
 */
export function maskThenTruncate(
  text: string,
  secrets: SecretValues,
  limit: number
): string {
  const masked = maskSecrets(text, secrets);
  return masked.length > limit ? `${masked.slice(0, limit)}…` : masked;
}

/**
 * Masks nested string values - and, just as importantly, object keys.
 *
 * A secret can end up as a property name, not just a value: an expression
 * like `fromJSON(...)` or a `github-script` object literal can use a secret
 * as a map key, and a value-only mask would return it in full as `k` while
 * dutifully redacting everything under `v`. Keys go through the same
 * `maskSecrets` pass as values so neither side of an entry can leak one.
 */
export function maskObjectStrings<T>(value: T, secrets: SecretValues): T {
  if (typeof value === "string") {
    return maskSecrets(value, secrets) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => maskObjectStrings(v, secrets)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[maskSecrets(k, secrets)] = maskObjectStrings(v, secrets);
    }
    return out as T;
  }
  return value;
}
