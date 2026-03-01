import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

async function pathExists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function resolveDataRoot() {
  const candidates = [
    process.env.DATA_ROOT,
    process.env.CENTER_CONTROL_DATA_ROOT,
    path.resolve(process.cwd(), "../../data"),
    path.resolve(process.cwd(), "../data"),
    path.resolve(process.cwd(), "data")
  ].filter((item): item is string => Boolean(item));

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

export async function GET() {
  const dataRoot = await resolveDataRoot();
  const filePath = path.join(dataRoot, "exports", "project-inventory.json");
  const raw = await fs.readFile(filePath, "utf-8").catch(() => "");
  if (!raw) {
    return NextResponse.json(
      {
        ok: false,
        error: "project-inventory.json 尚未生成，请先执行一次同步任务。"
      },
      { status: 404 }
    );
  }

  try {
    const payload = JSON.parse(raw) as Record<string, unknown>;
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store"
      }
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: "project-inventory.json 内容损坏，请重新执行同步任务。"
      },
      { status: 500 }
    );
  }
}
