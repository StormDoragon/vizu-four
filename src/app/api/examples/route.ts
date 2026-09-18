import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXAMPLES_DIR = path.join(process.cwd(), "examples", "workflows");

/** Friendly labels for the home-page example picker. */
const DISPLAY_NAMES: Record<string, string> = {
  "01-simple-ci.yml": "Simple CI",
  "02-matrix-build.yml": "Matrix Build",
  "03-needs-chain.yml": "Needs Chain",
  "04-expression-pitfalls.yml": "Expression Pitfalls",
  "05-secrets-and-whatif.yml": "Secrets & What-If",
};

export async function GET() {
  let files: string[] = [];
  try {
    files = (await fs.readdir(EXAMPLES_DIR)).filter(
      (f) => f.endsWith(".yml") || f.endsWith(".yaml")
    );
  } catch {
    return NextResponse.json({ examples: [] });
  }

  const examples = await Promise.all(
    files.sort().map(async (file) => ({
      name: file,
      label: DISPLAY_NAMES[file] ?? file.replace(/^\d+-/, "").replace(/\.ya?ml$/, ""),
      content: await fs.readFile(path.join(EXAMPLES_DIR, file), "utf8"),
    }))
  );

  return NextResponse.json({ examples });
}
