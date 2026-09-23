import { describe, expect, it } from "vitest";
import { MAX_REQUEST_BODY_BYTES, readJsonBody } from "./http";

/** A Request carrying `text` as a real stream, so the reader path (not the
 * `req.text()` fallback) is what the bounded read meters. */
function streamed(text: string, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: text,
  });
}

describe("readJsonBody", () => {
  it("parses an ordinary JSON body", async () => {
    await expect(readJsonBody(streamed(JSON.stringify({ a: 1 })))).resolves.toEqual({ a: 1 });
  });

  it("returns null for malformed JSON", async () => {
    await expect(readJsonBody(streamed("{not json"))).resolves.toBeNull();
  });

  it("returns null for an empty body", async () => {
    await expect(readJsonBody(streamed(""))).resolves.toBeNull();
  });

  it("round-trips a multi-byte body without mangling it", async () => {
    // Decoding is done once over the joined bytes rather than per chunk, so
    // a character split across a chunk boundary still survives.
    const value = { name: "ünïcödé — 🎬", nested: { deep: ["日本語"] } };
    await expect(readJsonBody(streamed(JSON.stringify(value)))).resolves.toEqual(value);
  });

  it("accepts a body just under the cap", async () => {
    const payload = JSON.stringify({ big: "x".repeat(MAX_REQUEST_BODY_BYTES - 100) });
    expect(payload.length).toBeLessThan(MAX_REQUEST_BODY_BYTES);
    await expect(readJsonBody(streamed(payload))).resolves.toBeTruthy();
  });

  it("refuses a body past the cap", async () => {
    const payload = JSON.stringify({ big: "x".repeat(MAX_REQUEST_BODY_BYTES + 1_000) });
    expect(payload.length).toBeGreaterThan(MAX_REQUEST_BODY_BYTES);
    await expect(readJsonBody(streamed(payload))).resolves.toBeNull();
  });

  it("refuses on an oversized declared Content-Length before reading anything", async () => {
    // The stream itself is tiny and perfectly valid JSON: only the declared
    // length is over the cap, and that alone is enough to refuse.
    const req = streamed(JSON.stringify({ a: 1 }), {
      "content-length": String(MAX_REQUEST_BODY_BYTES + 1),
    });
    await expect(readJsonBody(req)).resolves.toBeNull();
  });

  it("refuses an oversized body that understates its Content-Length", async () => {
    // A header is not a bound - nothing obliges a client to send an honest
    // one, so the bytes actually received are what has to be metered.
    const payload = JSON.stringify({ big: "x".repeat(MAX_REQUEST_BODY_BYTES + 1_000) });
    const req = new Request("http://localhost/api/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(payload));
          controller.close();
        },
      }),
      // Required by fetch when the body is a stream.
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    expect(req.headers.get("content-length")).toBeNull();
    await expect(readJsonBody(req)).resolves.toBeNull();
  });
});
