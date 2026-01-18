import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { getSession } from "@/lib/sessionStore";
import { getSessionDir } from "@/lib/persistence";

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const state = getSession(params.id);
  const vttPath = state?.captions?.vttPath;
  if (!state || !vttPath) {
    return NextResponse.json({ error: "captions not found" }, { status: 404 });
  }
  const absolute = path.join(getSessionDir(params.id), vttPath);
  try {
    const data = await fs.readFile(absolute);
    return new NextResponse(data, {
      headers: {
        "Content-Type": "text/vtt; charset=utf-8",
        "Content-Disposition": `attachment; filename="captions_${params.id}.vtt"`,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
