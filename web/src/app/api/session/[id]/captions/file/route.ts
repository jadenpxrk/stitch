import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { getSession } from "@/lib/sessionStore";
import { getSessionDir } from "@/lib/persistence";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const state = getSession(id);
  const vttPath = state?.captions?.vttPath;
  if (!state || !vttPath) {
    return NextResponse.json({ error: "captions not found" }, { status: 404 });
  }
  const absolute = path.join(getSessionDir(id), vttPath);
  try {
    const data = await fs.readFile(absolute);
    return new NextResponse(data, {
      headers: {
        "Content-Type": "text/vtt; charset=utf-8",
        "Content-Disposition": `attachment; filename="captions_${id}.vtt"`,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
