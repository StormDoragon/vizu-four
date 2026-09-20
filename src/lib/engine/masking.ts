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
  secrets: Record<string, string>
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
export class StreamMasker {
  private carry = "";
  private readonly values: string[];
  private readonly longest: number;

  constructor(private readonly secrets: Record<string, string>) {
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
    for (const range of redactionRanges(buffered, this.values)) {
      if (range.start < safeEnd && range.end > safeEnd) safeEnd = range.start;
    }
    this.carry = buffered.slice(safeEnd);
    return maskSecrets(buffered.slice(0, safeEnd), this.secrets);
  }

  /** Whatever is still held back, masked. Call once the stream has ended. */
  flush(): string {
    if (this.longest === 0) return "";
    const out = maskSecrets(this.carry, this.secrets);
    this.carry = "";
    return out;
  }
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
