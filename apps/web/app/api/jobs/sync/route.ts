import { NextResponse } from "next/server";
import { runSyncPipeline } from "@center/core";

export const dynamic = "force-dynamic";

let syncing = false;

export async function POST() {
  if (syncing) {
    return NextResponse.json({ error: "Sync already running" }, { status: 409 });
  }

  syncing = true;
  try {
    const result = await runSyncPipeline();
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown sync failure"
      },
      { status: 500 }
    );
  } finally {
    syncing = false;
  }
}
