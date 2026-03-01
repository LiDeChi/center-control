import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";
import { queryProjectById } from "../../../lib/queries";
import { detectOpenTools, type OpenToolId } from "../../../lib/open-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);
const OPEN_TIMEOUT_MS = 8_000;
const DETACHED_START_TIMEOUT_MS = 5_000;
const MAX_START_COMMAND_LENGTH = 200;

const ACTIONS = new Set([
  "start-local",
  "open-production",
  "open-with-tool"
] as const);
const ALLOWED_START_BINARIES = new Set(["npm", "pnpm", "yarn", "bun", "npx", "node", "python", "python3", "uv"]);
const UNSAFE_COMMAND_PATTERN = /[;&|><`$\\\n\r]/;
const SAFE_ARG_PATTERN = /^[a-zA-Z0-9._:/=@%+,-]+$/;
const IDE_TARGETS = new Set(["terminal", "vscode", "finder", "xcode", "cursor"] as const);

type ProjectAction =
  | "start-local"
  | "open-production"
  | "open-with-tool";
type IdeTarget = OpenToolId;

type ActionPayload = {
  projectId?: unknown;
  action?: unknown;
  localStartCommand?: unknown;
  productionUrl?: unknown;
  ideTarget?: unknown;
};

type ParsedCommand = {
  binary: string;
  args: string[];
  normalized: string;
};

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

function toActionErrorMessage(error: unknown) {
  if (error instanceof HttpError) {
    return error.message;
  }
  const errnoError = error as NodeJS.ErrnoException;
  if (errnoError && errnoError.code === "ENOENT") {
    const missing = errnoError.path || errnoError.syscall || "unknown";
    return `系统找不到命令：${missing}。如果你在 Docker 中运行 Web，这是预期限制：容器无法直接打开宿主机 IDE，请改用下方 URI Link 或在宿主机运行 Web。`;
  }
  return toErrorMessage(error);
}

function normalizeProductionUrl(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

async function pathExists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function detectPackageManager(repoPath: string) {
  if (await pathExists(path.join(repoPath, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (await pathExists(path.join(repoPath, "yarn.lock"))) {
    return "yarn";
  }
  if ((await pathExists(path.join(repoPath, "bun.lockb"))) || (await pathExists(path.join(repoPath, "bun.lock")))) {
    return "bun";
  }
  return "npm";
}

async function inferStartCommand(repoPath: string) {
  const packageJsonPath = path.join(repoPath, "package.json");
  if (!(await pathExists(packageJsonPath))) {
    return null;
  }

  try {
    const content = await fs.readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(content) as { scripts?: Record<string, unknown> };
    const scripts = parsed.scripts || {};
    const pm = await detectPackageManager(repoPath);

    if (typeof scripts.dev === "string" && scripts.dev.trim()) {
      if (pm === "yarn") {
        return "yarn dev";
      }
      return `${pm} run dev`;
    }

    if (typeof scripts.start === "string" && scripts.start.trim()) {
      if (pm === "yarn") {
        return "yarn start";
      }
      return `${pm} run start`;
    }

    return null;
  } catch {
    return null;
  }
}

function parseStartCommand(command: string): ParsedCommand | null {
  const trimmed = command.trim();
  if (!trimmed || trimmed.length > MAX_START_COMMAND_LENGTH || UNSAFE_COMMAND_PATTERN.test(trimmed)) {
    return null;
  }

  const tokens = trimmed.split(/\s+/);
  const [binary, ...args] = tokens;
  if (!binary || !ALLOWED_START_BINARIES.has(binary)) {
    return null;
  }
  if (args.some((arg) => !SAFE_ARG_PATTERN.test(arg))) {
    return null;
  }

  return {
    binary,
    args,
    normalized: [binary, ...args].join(" ")
  };
}

async function resolveAllowedRepoPath(repoPath: string) {
  const rootCandidates = [
    process.env.GITHUB_ROOT,
    path.resolve(process.cwd(), ".."),
    path.resolve(process.cwd(), "../.."),
    path.resolve(process.cwd(), "../../.."),
    "/data/github"
  ].filter((item): item is string => Boolean(item));
  const repoResolved = path.resolve(repoPath);

  const [repoRealPath, rootRealPaths] = await Promise.all([
    fs.realpath(repoResolved).catch(() => repoResolved),
    Promise.all(
      rootCandidates.map(async (candidate) => {
        const resolved = path.resolve(candidate);
        return fs.realpath(resolved).catch(() => resolved);
      })
    )
  ]);

  const repoStat = await fs.stat(repoRealPath).catch(() => null);
  if (!repoStat || !repoStat.isDirectory()) {
    throw new HttpError(404, "Repo path does not exist");
  }

  const isInsideRoot = rootRealPaths.some((rootRealPath) => {
    const relative = path.relative(rootRealPath, repoRealPath);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
  if (!isInsideRoot) {
    throw new HttpError(403, "Repo path is outside allowed roots");
  }

  return repoRealPath;
}

async function runOpenCommand(args: string[]) {
  if (process.platform !== "darwin") {
    throw new HttpError(
      409,
      "当前运行环境不支持 macOS open 命令。请在宿主机运行 Web，或使用下方 VSCode/Cursor/Finder Link。"
    );
  }
  await execFileAsync("open", args, {
    timeout: OPEN_TIMEOUT_MS,
    maxBuffer: 128 * 1024
  });
}

async function openInIde(repoPath: string) {
  try {
    await runOpenCommand(["-a", "Visual Studio Code", repoPath]);
    return;
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    await execFileAsync("code", [repoPath], {
      timeout: OPEN_TIMEOUT_MS,
      maxBuffer: 128 * 1024
    });
  }
}

async function openInCursor(repoPath: string) {
  try {
    await runOpenCommand(["-a", "Cursor", repoPath]);
    return;
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    await execFileAsync("cursor", [repoPath], {
      timeout: OPEN_TIMEOUT_MS,
      maxBuffer: 128 * 1024
    });
  }
}

async function openWithTool(repoPath: string, target: IdeTarget) {
  if (target === "finder") {
    await runOpenCommand([repoPath]);
    return;
  }

  if (target === "terminal") {
    await runOpenCommand(["-a", "Terminal", repoPath]);
    return;
  }

  if (target === "vscode") {
    await openInIde(repoPath);
    return;
  }

  if (target === "xcode") {
    await runOpenCommand(["-a", "Xcode", repoPath]);
    return;
  }

  await openInCursor(repoPath);
}

async function ensureToolAvailable(target: IdeTarget) {
  const detected = await detectOpenTools();
  const tool = detected.tools.find((item) => item.id === target);
  if (!tool) {
    throw new HttpError(400, `未知打开方式：${target}`);
  }
  if (!tool.available) {
    throw new HttpError(409, `${tool.label} 不可用：${tool.reason}`);
  }
}

async function spawnDetached(binary: string, args: string[], cwd: string) {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd,
      detached: true,
      stdio: "ignore"
    });

    const timer = setTimeout(() => {
      child.removeAllListeners("spawn");
      child.removeAllListeners("error");
      try {
        child.kill("SIGTERM");
      } catch {
        // Ignore kill failures.
      }
      reject(new Error("Process start timed out"));
    }, DETACHED_START_TIMEOUT_MS);

    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.once("spawn", () => {
      clearTimeout(timer);
      const pid = child.pid;
      child.unref();
      if (!pid) {
        reject(new Error("Process started without pid"));
        return;
      }
      resolve(pid);
    });
  });
}

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json().catch(() => null)) as ActionPayload | null;
    if (!payload) {
      throw new HttpError(400, "Invalid JSON payload");
    }

    const projectId = typeof payload.projectId === "string" ? payload.projectId.trim() : "";
    const actionRaw = typeof payload.action === "string" ? payload.action : "";
    const localStartCommandRaw =
      typeof payload.localStartCommand === "string" ? payload.localStartCommand.trim() : "";
    const productionUrlRaw = typeof payload.productionUrl === "string" ? payload.productionUrl.trim() : "";
    const ideTargetRaw = typeof payload.ideTarget === "string" ? payload.ideTarget.trim().toLowerCase() : "";

    if (!projectId) {
      throw new HttpError(400, "projectId is required");
    }
    if (!ACTIONS.has(actionRaw as ProjectAction)) {
      throw new HttpError(400, "Unsupported action");
    }

    const action = actionRaw as ProjectAction;
    const project = await queryProjectById(projectId);
    if (!project) {
      throw new HttpError(404, "Project not found");
    }

    const repoPath = await resolveAllowedRepoPath(project.repoPath);

    if (action === "open-production") {
      const productionUrl = normalizeProductionUrl(
        productionUrlRaw || project.productionUrl || project.demoUrl || project.sourceUrl
      );
      if (!productionUrl) {
        throw new HttpError(400, "Production URL is not configured for this project");
      }
      return NextResponse.json({ ok: true, action, productionUrl });
    }

    if (action === "open-with-tool") {
      if (!IDE_TARGETS.has(ideTargetRaw as IdeTarget)) {
        throw new HttpError(400, "ideTarget is required and must be one of terminal/vscode/finder/xcode/cursor");
      }
      const ideTarget = ideTargetRaw as IdeTarget;
      await ensureToolAvailable(ideTarget);
      await openWithTool(repoPath, ideTarget);
      return NextResponse.json({
        ok: true,
        action,
        ideTarget
      });
    }

    const localStartCommand = localStartCommandRaw || project.localStartCommand || (await inferStartCommand(repoPath));
    if (!localStartCommand) {
      throw new HttpError(
        400,
        "localStartCommand is required when no package.json dev/start script can be inferred"
      );
    }

    const parsedCommand = parseStartCommand(localStartCommand);
    if (!parsedCommand) {
      throw new HttpError(400, "localStartCommand is not allowed");
    }

    const pid = await spawnDetached(parsedCommand.binary, parsedCommand.args, repoPath);
    return NextResponse.json({
      ok: true,
      action,
      pid,
      command: parsedCommand.normalized
    });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json(
      {
        ok: false,
        error: toActionErrorMessage(error)
      },
      { status }
    );
  }
}
