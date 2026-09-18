import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXAMPLES_DIR = path.join(process.cwd(), "examples", "workflows");

export async function GET() {
  let files: string[] = [];
  try {
    files = (await fs.readdir(EXAMPLES_DIR)).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
  } catch {
    return NextResponse.json({ examples: [] });
  }

  const examples = await Promise.all(
    files.sort().map(async (file) => ({
      name: file,
      content: await fs.readFile(path.join(EXAMPLES_DIR, file), "utf8"),
    }))
  );

  return NextResponse.json({ examples });
}
