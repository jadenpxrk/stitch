import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OUTPUT_ROOT = path.resolve(process.cwd(), process.env.OUTPUT_ROOT || "sessions");

function getContentType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".txt") return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ analysisId: string; path: string[] }> },
) {
  const { analysisId, path: pathParts } = await params;
  const parts = pathParts ?? [];
  if (!analysisId || parts.length === 0) {
    return NextResponse.json({ error: "Missing file path." }, { status: 400 });
  }
  if (!/^[A-Za-z0-9_-]+$/.test(analysisId)) {
    return NextResponse.json({ error: "Invalid analysis id." }, { status: 400 });
  }

  const baseDir = path.resolve(OUTPUT_ROOT, "analysis", analysisId);
  const target = path.resolve(baseDir, ...parts);
  const baseWithSep = `${baseDir}${path.sep}`;
  if (target !== baseDir && !target.startsWith(baseWithSep)) {
    return NextResponse.json({ error: "Invalid path." }, { status: 400 });
  }

  try {
    const stat = await fs.stat(target);
    if (!stat.isFile()) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
  } catch {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const buf = await fs.readFile(target);
  return new NextResponse(buf, {
    headers: {
      "Content-Type": getContentType(target),
      "Cache-Control": "no-store",
    },
  });
}
