import { NextResponse } from "next/server";
import { queryReportByDate } from "../../../../lib/queries";

export const dynamic = "force-dynamic";

export async function GET(_: Request, context: { params: { date: string } }) {
  const report = await queryReportByDate(context.params.date);
  if (!report) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  return NextResponse.json(report);
}
