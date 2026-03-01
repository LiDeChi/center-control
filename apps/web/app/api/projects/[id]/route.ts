import { NextResponse } from "next/server";
import { queryProjectById } from "../../../../lib/queries";

export const dynamic = "force-dynamic";

export async function GET(_: Request, context: { params: { id: string } }) {
  const project = await queryProjectById(context.params.id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  return NextResponse.json(project);
}
