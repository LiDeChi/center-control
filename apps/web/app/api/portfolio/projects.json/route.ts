import { NextResponse } from "next/server";
import { queryProjects } from "../../../../lib/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  const projects = await queryProjects("tracked", "activity");
  return NextResponse.json(
    {
      generatedAt: new Date().toISOString(),
      count: projects.length,
      projects
    },
    {
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}
