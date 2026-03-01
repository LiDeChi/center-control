import { NextRequest, NextResponse } from "next/server";
import { queryReports } from "../../../lib/queries";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const limit = Number.parseInt(request.nextUrl.searchParams.get("limit") || "30", 10);
  const reports = await queryReports(Number.isFinite(limit) ? Math.max(1, Math.min(limit, 100)) : 30);
  return NextResponse.json({ count: reports.length, reports });
}
