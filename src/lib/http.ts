import { NextResponse } from "next/server";

/**
 * Ceiling on a request body this app will buffer.
 *
 * Route handlers get no body limit of their own, so every POST here was an
 * unbounded read. The size checks that do exist - the workflow YAML cap, the
 * What-If patch bounds, the accumulated-config limits - all run against an
 * already-parsed body, which is after the memory has been spent: a 500MB
 * upload was fully received and turned into JS values before the first of
 * them got to refuse it. This is the one place every route reads its body,
 * so the bound belongs here rather than in each of them.
 *
 * Comfortably above the largest legitimate request (a 1,000,000-character
 * workflow, plus JSON escaping and the rest of the create-session body) and
 * far below what buffering an arbitrary upload costs the process.
 */
export const MAX_REQUEST_BODY_BYTES = 4 * 1024 * 1024;

/**
 * The body as text, or null when it is unusable - unreadable, or past the cap.
 *
 * Refused while it is still arriving, not after: a declared `Content-Length`
 * is checked before anything is read, and the stream is abandoned the moment
 * the bytes actually received exceed the cap, whatever the header claimed.
 * Checking only the header would be no bound at all, since nothing obliges a
 * client to send an honest one.
 */
async function readBoundedText(req: Request): Promise<string | null> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BODY_BYTES) return null;

  const body = req.body;
  if (!body) {
    // Nothing to meter chunk by chunk - some runtimes (and the Request
    // doubles tests build) expose no stream. The header check above is the
    // only guard available, so re-check the materialized length too.
    try {
      const text = await req.text();
      return text.length > MAX_REQUEST_BODY_BYTES ? null : text;
    } catch {
      return null;
    }
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_REQUEST_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }

  const joined = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

/**
 * Parsed JSON body, or null when there isn't a usable one.
 *
 * An oversized body reads as null exactly like malformed JSON does, so every
 * caller already handles it: from a route's point of view both mean "this
 * body cannot be used", and both are the client's fault. Keeping one failure
 * mode is what lets the bound live here instead of in nine routes.
 */
export async function readJsonBody<T>(req: Request): Promise<T | null> {
  const text = await readBoundedText(req);
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function errorResponse(status: number, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}
