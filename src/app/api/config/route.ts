import { NextResponse } from "next/server";
import { isSimulationOnly } from "@/lib/deployment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Deployment-shape flags the client needs before it creates a session -
 * chiefly whether to offer the real-working-tree opt-in at all, rather than
 * showing it and then failing every attempt with a 403.
 */
export async function GET() {
  return NextResponse.json({
    simulationOnly: isSimulationOnly(),
    aiProviderEnabled: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
  });
}
