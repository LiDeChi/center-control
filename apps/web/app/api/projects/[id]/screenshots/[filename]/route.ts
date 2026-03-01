import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAFE_FILENAME_PATTERN = /^[a-zA-Z0-9._-]+\.(png|jpg|jpeg|webp)$/i;

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

  await fs.mkdir(candidates[0], { recursive: true });
  return candidates[0];
}

function contentTypeByExt(filename: string) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  return "application/octet-stream";
}

export async function GET(_: Request, context: { params: { id: string; filename: string } }) {
  const projectId = context.params.id;
  const filename = context.params.filename;

  if (!projectId || !filename || !SAFE_FILENAME_PATTERN.test(filename)) {
    return NextResponse.json({ error: "Invalid screenshot path" }, { status: 400 });
  }

  const dataRoot = await resolveDataRoot();
  const filePath = path.join(dataRoot, "screenshots", projectId, filename);
  const safeRoot = path.join(dataRoot, "screenshots", projectId);

  const [realFilePath, realRoot] = await Promise.all([
    fs.realpath(filePath).catch(() => filePath),
    fs.realpath(safeRoot).catch(() => safeRoot)
  ]);
  const relative = path.relative(realRoot, realFilePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return NextResponse.json({ error: "Screenshot is outside allowed directory" }, { status: 403 });
  }

  const content = await fs.readFile(realFilePath).catch(() => null);
  if (!content) {
    return NextResponse.json({ error: "Screenshot not found" }, { status: 404 });
  }

  return new NextResponse(content, {
    status: 200,
    headers: {
      "Content-Type": contentTypeByExt(filename),
      "Cache-Control": "public, max-age=600"
    }
  });
}
