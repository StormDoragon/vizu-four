import { describe, expect, it } from "vitest";
import { StreamMasker, maskChunks, maskObjectStrings, maskSecrets } from "./masking";

describe("maskSecrets", () => {
  it("replaces every occurrence of a secret", () => {
    expect(maskSecrets("a tok-123456 b tok-123456", { T: "tok-123456" })).toBe("a *** b ***");
  });

  it("masks the longer of two overlapping secrets whole", () => {
    const masked = maskSecrets("prefix-and-more", { SHORT: "prefix", LONG: "prefix-and-more" });
    expect(masked).toBe("***");
  });

  it("skips values too short to mask without redacting unrelated text", () => {
    expect(maskSecrets("a b c", { T: "b" })).toBe("a b c");
  });

  it("leaves text without secrets untouched", () => {
    expect(maskSecrets("nothing here", { T: "tok-123456" })).toBe("nothing here");
  });
});

describe("maskObjectStrings", () => {
  it("masks strings nested in objects and arrays", () => {
    const masked = maskObjectStrings(
      { a: "tok-123456", b: [{ c: "x tok-123456" }], n: 1 },
      { T: "tok-123456" }
    );
    expect(masked).toEqual({ a: "***", b: [{ c: "x ***" }], n: 1 });
  });
});

describe("maskChunks", () => {
  const secrets = { TOKEN: "review-secret-value" };

  it("masks a secret split across two chunks", () => {
    const masked = maskChunks(
      [
        { stream: "stdout", text: "review-secret" },
        { stream: "stdout", text: "-value\n" },
      ],
      secrets
    );
    expect(masked.map((c) => c.text).join("")).toBe("***\n");
    expect(masked.map((c) => c.text).join("")).not.toContain("review-secret");
  });

  it("masks a secret split across a stdout/stderr switch", () => {
    const masked = maskChunks(
      [
        { stream: "stdout", text: "start review-" },
        { stream: "stderr", text: "secret-value end" },
      ],
      secrets
    );
    expect(masked.map((c) => c.text).join("")).toBe("start *** end");
  });

  it("keeps the mask in the chunk where the secret begins", () => {
    const masked = maskChunks(
      [
        { stream: "stdout", text: "a review-sec" },
        { stream: "stdout", text: "ret-value b" },
      ],
      secrets
    );
    expect(masked[0].text).toBe("a ***");
    expect(masked[1].text).toBe(" b");
  });

  it("preserves stream tags and chunk count", () => {
    const chunks = [
      { stream: "stdout" as const, text: "one " },
      { stream: "stderr" as const, text: "two" },
    ];
    const masked = maskChunks(chunks, secrets);
    expect(masked).toHaveLength(2);
    expect(masked.map((c) => c.stream)).toEqual(["stdout", "stderr"]);
    expect(masked.map((c) => c.text).join("")).toBe("one two");
  });

  it("agrees with masking the joined text", () => {
    const chunks = [
      { stream: "stdout" as const, text: "a review-secret-value b review-sec" },
      { stream: "stdout" as const, text: "ret-value c" },
    ];
    const joined = chunks.map((c) => c.text).join("");
    expect(maskChunks(chunks, secrets).map((c) => c.text).join("")).toBe(
      maskSecrets(joined, secrets)
    );
  });

  it("masks a secret spanning three chunks", () => {
    const masked = maskChunks(
      [
        { stream: "stdout", text: "review" },
        { stream: "stdout", text: "-secret" },
        { stream: "stdout", text: "-value!" },
      ],
      secrets
    );
    expect(masked.map((c) => c.text).join("")).toBe("***!");
  });

  it("leaves chunks alone when there is nothing to mask", () => {
    const chunks = [{ stream: "stdout" as const, text: "nothing here" }];
    expect(maskChunks(chunks, secrets)).toEqual(chunks);
    expect(maskChunks(chunks, {})).toEqual(chunks);
  });
});

describe("maskChunks across streams", () => {
  const secrets = { TOKEN: "review-secret-value" };

  it("masks a secret split within one stream when the other interleaves", () => {
    // Concatenating every chunk puts the warning inside the value, so the
    // interleaved view alone can never match it - each stream is projected
    // separately as well.
    const masked = maskChunks(
      [
        { stream: "stdout", text: "review-secret" },
        { stream: "stderr", text: "unrelated warning\n" },
        { stream: "stdout", text: "-value\n" },
      ],
      secrets
    );
    const stdoutOnly = masked
      .filter((c) => c.stream === "stdout")
      .map((c) => c.text)
      .join("");
    expect(stdoutOnly).not.toContain("review-secret");
    expect(stdoutOnly).not.toContain("-value");
    expect(masked[1].text).toBe("unrelated warning\n");
  });

  it("still masks a secret spanning a stream switch", () => {
    const masked = maskChunks(
      [
        { stream: "stdout", text: "start review-" },
        { stream: "stderr", text: "secret-value end" },
      ],
      secrets
    );
    expect(masked.map((c) => c.text).join("")).toBe("start *** end");
  });

  it("leaves untagged chunks working as before", () => {
    const masked = maskChunks([{ text: "review-sec" }, { text: "ret-value" }], secrets);
    expect(masked.map((c) => c.text).join("")).toBe("***");
  });
});

describe("StreamMasker", () => {
  const secrets = { TOKEN: "review-secret-value" };

  it("masks a secret split across two writes", () => {
    const m = new StreamMasker(secrets);
    const out = m.push("review-secret") + m.push("-value\n") + m.flush();
    expect(out).toBe("***\n");
  });

  it("masks a secret split across many small writes", () => {
    const m = new StreamMasker(secrets);
    let out = "";
    for (const ch of "xx review-secret-value yy") out += m.push(ch);
    out += m.flush();
    expect(out).toBe("xx *** yy");
  });

  it("never emits an unmasked fragment, so truncating its output is safe", () => {
    const m = new StreamMasker(secrets);
    const first = m.push("padding review-");
    // The tail that could still become a secret is held back rather than
    // emitted - a caller freezing its buffer here keeps no fragment.
    expect(first).not.toContain("review-");
    expect(first + m.push("secret-value") + m.flush()).toBe("padding ***");
  });

  it("passes text through untouched when there are no secrets", () => {
    const m = new StreamMasker({});
    expect(m.push("anything at all")).toBe("anything at all");
    expect(m.flush()).toBe("");
  });

  it("does not hold back text once a secret cannot be pending", () => {
    const m = new StreamMasker({ T: "abc" });
    expect(m.push("hello world") + m.flush()).toBe("hello world");
  });
});
