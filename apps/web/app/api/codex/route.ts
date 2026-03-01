import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";
import { queryProjectById } from "../../../lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);
const ATTACHMENT_MAX_FILES = 10;
const ATTACHMENT_MAX_BYTES = 512 * 1024;
const DETACHED_START_TIMEOUT_MS = 5_000;
const COMMAND_TIMEOUT_MS = 5_000;
const UNSAFE_FILENAME_PATTERN = /[^a-zA-Z0-9._-]/g;
const MAX_MODEL_LENGTH = 120;
const ALLOWED_REASONING_DEPTHS = new Set(["low", "medium", "high"] as const);
const TEXT_ATTACHMENT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".py",
  ".yaml",
  ".yml",
  ".csv",
  ".log"
]);

type JsonAttachment = {
  name?: unknown;
  content?: unknown;
};

type ParsedPayload = {
  projectId: string;
  message: string;
  attachments: Array<{ name: string; content: string }>;
  planMode: boolean;
  model: string | null;
  reasoningDepth: "low" | "medium" | "high";
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

function sanitizeFilename(rawName: string, index: number) {
  const base = path.basename(rawName || `attachment-${index + 1}.txt`);
  const sanitized = base.replace(UNSAFE_FILENAME_PATTERN, "_");
  return sanitized || `attachment-${index + 1}.txt`;
}

function ensureUniqueName(filename: string, used: Set<string>) {
  const ext = path.extname(filename);
  const stem = ext ? filename.slice(0, -ext.length) : filename;
  let candidate = filename;
  let counter = 2;
  while (used.has(candidate)) {
    candidate = `${stem}-${counter}${ext}`;
    counter += 1;
  }
  used.add(candidate);
  return candidate;
}

function parsePlanMode(value: unknown) {
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function parseModel(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_MODEL_LENGTH) {
    return null;
  }
  return trimmed;
}

function parseReasoningDepth(value: unknown): "low" | "medium" | "high" {
  if (typeof value !== "string") {
    return "medium";
  }
  const normalized = value.trim().toLowerCase() as "low" | "medium" | "high";
  if (!ALLOWED_REASONING_DEPTHS.has(normalized)) {
    return "medium";
  }
  return normalized;
}

function isLikelyTextAttachment(name: string, mimeType: string, content: string) {
  if (content.includes("\u0000")) {
    return false;
  }

  const ext = path.extname(name).toLowerCase();
  if (TEXT_ATTACHMENT_EXTENSIONS.has(ext)) {
    return true;
  }

  if (mimeType.startsWith("text/")) {
    return true;
  }

  return mimeType === "application/json";
}

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

function getDayKey(date: Date) {
  const timezone = process.env.TZ || "America/New_York";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
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

async function hasCodexCommand() {
  try {
    await execFileAsync("codex", ["--version"], {
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: 64 * 1024
    });
    return true;
  } catch {
    return false;
  }
}

function resolveCodexHome() {
  if (process.env.CODEX_HOME && process.env.CODEX_HOME.trim()) {
    return process.env.CODEX_HOME.trim();
  }

  const home = process.env.HOME || process.env.USERPROFILE;
  if (!home) {
    return null;
  }

  return path.join(home, ".codex");
}

async function spawnDetached(binary: string, args: string[], cwd: string) {
  const codexHome = resolveCodexHome();
  const env = codexHome ? { ...process.env, CODEX_HOME: codexHome } : process.env;

  return new Promise<number>((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd,
      detached: true,
      stdio: "ignore",
      env
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

async function parsePayload(request: NextRequest): Promise<ParsedPayload> {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as
      | {
          projectId?: unknown;
          message?: unknown;
          attachments?: JsonAttachment[];
          planMode?: unknown;
          model?: unknown;
          reasoningDepth?: unknown;
        }
      | null;

    if (!body) {
      throw new HttpError(400, "Invalid JSON payload");
    }

    const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const attachments: Array<{ name: string; content: string }> = [];
    const planMode = parsePlanMode(body.planMode);
    const model = parseModel(body.model);
    const reasoningDepth = parseReasoningDepth(body.reasoningDepth);

    if (Array.isArray(body.attachments)) {
      for (let index = 0; index < body.attachments.length; index += 1) {
        const attachment = body.attachments[index];
        if (!attachment || typeof attachment !== "object") {
          continue;
        }
        const name = typeof attachment.name === "string" ? attachment.name : `attachment-${index + 1}.txt`;
        const content = typeof attachment.content === "string" ? attachment.content : "";
        attachments.push({ name: sanitizeFilename(name, index), content });
      }
    }

    return { projectId, message, attachments, planMode, model, reasoningDepth };
  }

  const formData = await request.formData();
  const projectId = String(formData.get("projectId") || "").trim();
  const message = String(formData.get("message") || "").trim();
  const planMode = parsePlanMode(formData.get("planMode"));
  const model = parseModel(formData.get("model"));
  const reasoningDepth = parseReasoningDepth(formData.get("reasoningDepth"));
  const attachments: Array<{ name: string; content: string }> = [];
  const files = formData.getAll("attachments");

  for (let index = 0; index < files.length; index += 1) {
    const entry = files[index];
    if (!(entry instanceof File)) {
      continue;
    }

    if (entry.size > ATTACHMENT_MAX_BYTES) {
      throw new HttpError(400, `Attachment "${entry.name}" exceeds ${ATTACHMENT_MAX_BYTES} bytes`);
    }

    const name = sanitizeFilename(entry.name, index);
    const content = await entry.text();
    if (!isLikelyTextAttachment(name, entry.type, content)) {
      throw new HttpError(400, `Attachment "${entry.name}" is not a supported text file`);
    }

    attachments.push({ name, content });
  }

  return { projectId, message, attachments, planMode, model, reasoningDepth };
}

function buildCodexPrompt(input: {
  projectName: string;
  projectId: string;
  message: string;
  attachmentPaths: string[];
  planMode: boolean;
  model: string | null;
  reasoningDepth: "low" | "medium" | "high";
}) {
  const attachmentSection =
    input.attachmentPaths.length === 0
      ? "No attachments."
      : `Attachment files (read from disk):\n${input.attachmentPaths.map((item) => `- ${item}`).join("\n")}`;

  const modeHints = [
    `Plan mode requested: ${input.planMode ? "yes" : "no"}`,
    `Model preference: ${input.model || "default"}`,
    `Reasoning depth: ${input.reasoningDepth}`
  ];

  const behaviorHint = input.planMode
    ? "Please provide a concise execution plan first, then perform the work."
    : "You can execute the task directly.";

  return [
    `Project: ${input.projectName} (${input.projectId})`,
    modeHints.join(" | "),
    behaviorHint,
    `User message:\n${input.message}`,
    attachmentSection
  ].join("\n\n");
}

function buildCodexArgs(prompt: string, model: string | null) {
  const args = ["exec"];
  if (model) {
    args.push("--model", model);
  }
  args.push(prompt);
  return args;
}

async function appendTaskLog(filePath: string, payload: Record<string, unknown>) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(payload)}\n`, "utf8");
}

export async function POST(request: NextRequest) {
  const now = new Date();
  const taskId = `codex_task_${now.getTime().toString(36)}_${randomUUID().slice(0, 8)}`;
  const taskLog: Record<string, unknown> = {
    taskId,
    createdAt: now.toISOString(),
    status: "received"
  };

  let taskLogPath = "";

  try {
    const dataRoot = await resolveDataRoot();
    const payload = await parsePayload(request);
    const projectId = payload.projectId;
    const message = payload.message;
    const model = payload.model;
    const reasoningDepth = payload.reasoningDepth;
    const planMode = payload.planMode;

    taskLogPath = path.join(dataRoot, "codex-tasks", `${getDayKey(now)}.jsonl`);
    taskLog.projectId = projectId;
    taskLog.message = message;
    taskLog.model = model;
    taskLog.reasoningDepth = reasoningDepth;
    taskLog.planMode = planMode;

    if (!projectId) {
      throw new HttpError(400, "projectId is required");
    }
    if (!message) {
      throw new HttpError(400, "message is required");
    }
    if (payload.attachments.length > ATTACHMENT_MAX_FILES) {
      throw new HttpError(400, `Too many attachments. Max allowed: ${ATTACHMENT_MAX_FILES}`);
    }

    const project = await queryProjectById(projectId);
    if (!project) {
      throw new HttpError(404, "Project not found");
    }

    const repoPath = await resolveAllowedRepoPath(project.repoPath);
    taskLog.repoPath = repoPath;

    const timestamp = now.toISOString().replace(/[:.]/g, "-");
    const attachmentRoot = path.join(dataRoot, "codex-attachments", timestamp);
    await fs.mkdir(attachmentRoot, { recursive: true });

    const usedNames = new Set<string>();
    const attachmentPaths: string[] = [];
    const attachmentNames: string[] = [];

    for (let index = 0; index < payload.attachments.length; index += 1) {
      const attachment = payload.attachments[index];
      const uniqueName = ensureUniqueName(sanitizeFilename(attachment.name, index), usedNames);
      const filePath = path.join(attachmentRoot, uniqueName);

      if (!isLikelyTextAttachment(uniqueName, "text/plain", attachment.content)) {
        throw new HttpError(400, `Attachment "${attachment.name}" is not a supported text file`);
      }

      await fs.writeFile(filePath, attachment.content, "utf8");
      attachmentPaths.push(filePath);
      attachmentNames.push(uniqueName);
    }

    taskLog.attachmentPaths = attachmentPaths;
    taskLog.attachmentNames = attachmentNames;

    const prompt = buildCodexPrompt({
      projectName: project.name,
      projectId,
      message,
      attachmentPaths,
      model,
      reasoningDepth,
      planMode
    });

    const codexAvailable = await hasCodexCommand();
    taskLog.codexAvailable = codexAvailable;

    if (!codexAvailable) {
      taskLog.status = "logged-only";
      taskLog.codexStatus = "command-not-found";
      return NextResponse.json({
        ok: true,
        taskId,
        codex: {
          queued: false,
          reason:
            "未检测到 codex CLI。任务已记录但未执行。若你在 Docker 里运行 Web，这通常意味着容器无法直接使用宿主机的 codex/skills，请改为在宿主机启动 Web，或在容器内安装 codex 并挂载 CODEX_HOME。"
        }
      });
    }

    const codexArgs = buildCodexArgs(prompt, model);
    taskLog.codexArgs = codexArgs;
    const pid = await spawnDetached("codex", codexArgs, repoPath);
    taskLog.status = "queued";
    taskLog.codexStatus = "queued";
    taskLog.pid = pid;

    return NextResponse.json({
      ok: true,
      taskId,
      codex: {
        queued: true,
        pid
      }
    });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    taskLog.status = "failed";
    taskLog.error = toErrorMessage(error);

    return NextResponse.json(
      {
        ok: false,
        taskId,
        error: toErrorMessage(error)
      },
      { status }
    );
  } finally {
    if (!taskLogPath) {
      const fallbackDataRoot = await resolveDataRoot().catch(() => path.resolve(process.cwd(), "data"));
      taskLogPath = path.join(fallbackDataRoot, "codex-tasks", `${getDayKey(now)}.jsonl`);
    }

    try {
      await appendTaskLog(taskLogPath, taskLog);
    } catch {
      // Swallow logging errors to preserve API response.
    }
  }
}
