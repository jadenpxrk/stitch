import { NextResponse } from "next/server";
import { describeCapability, listCapabilities } from "@/lib/toolAdapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const capabilities = listCapabilities().map((capability) => ({
    capability,
    description: describeCapability(capability),
  }));
  return NextResponse.json({ capabilities });
}

