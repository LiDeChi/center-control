import { NextRequest, NextResponse } from "next/server";
import { queryRelations } from "../../../lib/queries";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("projectId") || undefined;
  const relations = await queryRelations(projectId);
  return NextResponse.json({ count: relations.length, relations });
}
