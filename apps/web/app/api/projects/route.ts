import { NextRequest, NextResponse } from "next/server";
import { queryProjects, type ProjectSort } from "../../../lib/queries";

export const dynamic = "force-dynamic";

const allowedScope = new Set(["tracked", "external", "all"]);
const allowedSort = new Set(["activity", "updatedAt", "relationScore"]);

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const scopeRaw = searchParams.get("scope") || "tracked";
  const sortRaw = searchParams.get("sort") || "activity";

  const scope = allowedScope.has(scopeRaw) ? (scopeRaw as "tracked" | "external" | "all") : "tracked";
  const sort = allowedSort.has(sortRaw) ? (sortRaw as ProjectSort) : "activity";

  const projects = await queryProjects(scope, sort);
  return NextResponse.json({ count: projects.length, projects });
}
