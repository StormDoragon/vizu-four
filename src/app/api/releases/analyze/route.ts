import { NextResponse } from "next/server";
import { ensureOwnerId } from "@/lib/engine/ownership";
import { clientAddressFrom } from "@/lib/engine/rateLimit";
import { readJsonBody } from "@/lib/http";
import { parseReleaseInput, ReleaseError } from "@/lib/release/validation";
import { collectRelease } from "@/lib/release/github";
import { analyzeRelease, renderNotes } from "@/lib/release/analysis";
import { generateReleaseWording } from "@/lib/release/generate";
import { acquireReleaseSlot, checkReleaseLimit } from "@/lib/release/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function reply(body: unknown, status = 200, retryAfter?: number) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}) } });
}

export async function POST(req: Request) {
  // JSON plus an origin check keeps drive-by forms from spending public-demo capacity.
  // Next may reconstruct req.url using an internal hostname/protocol behind a proxy.
  // Browsers cannot override Host; compare the origin against that public authority.
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      const parsed = new URL(origin);
      const host = req.headers.get("host") ?? new URL(req.url).host;
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin !== origin || parsed.host.toLowerCase() !== host.toLowerCase()) throw new Error("origin mismatch");
    } catch { return reply({ error: "Cross-origin release requests are not allowed." }, 403); }
  }
  if (req.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return reply({ error: "Send an application/json request." }, 415);
  const release = acquireReleaseSlot();
  if (!release) return reply({ error: "Release analysis is busy. Try again shortly." }, 429, 15);
  try {
    const bodySignal = AbortSignal.any([req.signal, AbortSignal.timeout(5000)]);
    const body = await readJsonBody<unknown>(req, 8192, bodySignal);
    if (bodySignal.aborted) throw new ReleaseError(408, "Request body timed out or was cancelled.");
    const input = parseReleaseInput(body);
    // Spend the quota only on requests that will reach GitHub; the in-flight slot already bounds concurrency.
    const limit = checkReleaseLimit(await ensureOwnerId(), clientAddressFrom(req.headers));
    if (!limit.allowed) return reply({ error: "Too many release requests. Try again later." }, 429, limit.retryAfterSeconds);
    const collection = await collectRelease(input, fetch, req.signal);
    const analysis = await generateReleaseWording(analyzeRelease(collection), input.useAi, req.signal);
    return reply({ analysis, notes: renderNotes(analysis) });
  } catch (error) {
    return error instanceof ReleaseError ? reply({ error: error.message }, error.status, error.status === 429 ? 60 : undefined) : reply({ error: "Release analysis failed. Please try again." }, 500);
  } finally {
    release();
  }
}
