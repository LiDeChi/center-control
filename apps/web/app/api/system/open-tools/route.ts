import { NextResponse } from "next/server";
import { detectOpenTools } from "../../../../lib/open-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

export async function GET() {
  try {
    const data = await detectOpenTools();
    return NextResponse.json({
      ok: true,
      ...data
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: toErrorMessage(error)
      },
      { status: 500 }
    );
  }
}
