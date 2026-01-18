import { NextResponse } from "next/server";
import { verifyWoodWideAuth } from "@/lib/woodwide";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const result = await verifyWoodWideAuth();
  return NextResponse.json(result);
}

