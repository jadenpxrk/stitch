import { NextRequest, NextResponse } from "next/server";
import { executeCapability, hasCapability } from "@/lib/toolAdapter";
import type { CapabilityName } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const capability = body?.capability as CapabilityName | undefined;
  const input = body?.input as unknown;

  if (!capability || typeof capability !== "string") {
    return NextResponse.json({ error: "`capability` is required" }, { status: 400 });
  }

  if (!hasCapability(capability)) {
    return NextResponse.json({ error: `Unknown capability: ${capability}` }, { status: 400 });
  }

  const result = await executeCapability(capability, input);
  return NextResponse.json(result);
}

