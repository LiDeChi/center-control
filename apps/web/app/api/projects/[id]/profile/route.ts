import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { NextResponse } from "next/server";
import { queryProjectById } from "../../../../../lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_README_BYTES = 140_000;
const MAX_SCREENSHOTS = 3;
const SCREENSHOT_STALE_MS = 12 * 60 * 60 * 1000;
const SCREENSHOT_CAPTURE_TIMEOUT_MS = 16_000;
const LOCAL_HOST_PATTERN = /(localhost|127\.0\.0\.1|0\.0\.0\.0|\.local)$/i;

type EnvironmentKind = "local" | "staging" | "production" | "reference";

type ProfileEnvironment = {
  id: string;
  label: string;
  url: string;
  kind: EnvironmentKind;
  source: string;
};


type ProfileScreenshot = {
  id: string;
  label: string;
  sourceUrl: string;
  url: string;
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

async function pathExists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
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

function toPosixPath(inputPath: string) {
  return inputPath.split(path.sep).join("/");
}

function normalizeUrl(raw: string) {
  try {
    const parsed = new URL(raw.trim());
    if (!/^https?:$/i.test(parsed.protocol)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function classifyEnvironment(urlText: string): EnvironmentKind {
  try {
    const parsed = new URL(urlText);
    const host = parsed.hostname.toLowerCase();
    if (LOCAL_HOST_PATTERN.test(host)) {
      return "local";
    }
    if (
      host.includes("staging") ||
      host.includes("preview") ||
      host.includes("test") ||
      host.startsWith("dev.") ||
      host.includes(".dev")
    ) {
      return "staging";
    }
    if (host.includes("github.com")) {
      return "reference";
    }
    return "production";
  } catch {
    return "reference";
  }
}

function environmentLabel(kind: EnvironmentKind, urlText: string, index: number) {
  if (kind === "local") {
    return `local-${index + 1}`;
  }
  if (kind === "staging") {
    return `staging-${index + 1}`;
  }
  if (kind === "production") {
    return `production-${index + 1}`;
  }
  return `reference-${index + 1}`;
}

function dedupeUrls(urls: string[]) {
  const seen = new Set<string>();
  const results: string[] = [];
  for (const raw of urls) {
    const normalized = normalizeUrl(raw);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    results.push(normalized);
  }
  return results;
}

function extractPortsFromText(text: string) {
  const ports = new Set<number>();
  const patterns = [
    /(?:--port|-p|PORT=)\s*(\d{2,5})/gi,
    /localhost:(\d{2,5})/gi,
    /\b(\d{2,5})\s*:\s*\d{2,5}\b/g
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = Number.parseInt(match[1] || "", 10);
      if (Number.isFinite(value) && value >= 80 && value <= 65535) {
        ports.add(value);
      }
    }
  }

  return Array.from(ports);
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

async function inferStartCommands(repoPath: string, primary: string | null) {
  const commands: string[] = [];
  if (primary && primary.trim()) {
    commands.push(primary.trim());
  }

  const packageJsonPath = path.join(repoPath, "package.json");
  if (await pathExists(packageJsonPath)) {
    try {
      const content = await fs.readFile(packageJsonPath, "utf8");
      const parsed = JSON.parse(content) as { scripts?: Record<string, string> };
      const scripts = parsed.scripts || {};
      const packageManager = await detectPackageManager(repoPath);
      const scriptCandidates = [
        ["dev", "dev"],
        ["start", "start"],
        ["preview", "preview"],
        ["serve", "serve"]
      ] as const;

      for (const [scriptName, fallbackName] of scriptCandidates) {
        if (typeof scripts[scriptName] !== "string" || !scripts[scriptName]?.trim()) {
          continue;
        }
        if (packageManager === "yarn") {
          commands.push(`yarn ${fallbackName}`);
        } else if (packageManager === "bun") {
          commands.push(`bun run ${fallbackName}`);
        } else if (packageManager === "pnpm") {
          commands.push(`pnpm run ${fallbackName}`);
        } else {
          commands.push(`npm run ${fallbackName}`);
        }
      }
    } catch {
      // Ignore malformed package.json
    }
  }

  if ((await pathExists(path.join(repoPath, "docker-compose.yml"))) || (await pathExists(path.join(repoPath, "docker-compose.yaml")))) {
    commands.push("docker compose up");
  }

  const unique = Array.from(new Set(commands.map((item) => item.trim()).filter(Boolean)));
  return {
    primary: unique[0] || "未自动识别，请查看 README",
    alternatives: unique.slice(1, 8)
  };
}

async function inferLocalUrls(repoPath: string, localStartCommand: string | null, readmeLinks: string[]) {
  const localFromReadme = readmeLinks.filter((link) => {
    try {
      const parsed = new URL(link);
      return LOCAL_HOST_PATTERN.test(parsed.hostname);
    } catch {
      return false;
    }
  });

  const ports = new Set<number>();
  if (localStartCommand) {
    for (const port of extractPortsFromText(localStartCommand)) {
      ports.add(port);
    }
  }

  const packageJsonPath = path.join(repoPath, "package.json");
  if (await pathExists(packageJsonPath)) {
    try {
      const content = await fs.readFile(packageJsonPath, "utf8");
      for (const port of extractPortsFromText(content)) {
        ports.add(port);
      }
    } catch {
      // Ignore parse failure.
    }
  }

  const composeCandidates = [path.join(repoPath, "docker-compose.yml"), path.join(repoPath, "docker-compose.yaml")];
  for (const composePath of composeCandidates) {
    if (!(await pathExists(composePath))) {
      continue;
    }
    const content = await fs.readFile(composePath, "utf8").catch(() => "");
    for (const port of extractPortsFromText(content)) {
      ports.add(port);
    }
  }

  const localFromPorts = Array.from(ports)
    .sort((left, right) => left - right)
    .slice(0, 6)
    .map((port) => `http://localhost:${port}`);

  return dedupeUrls([...localFromReadme, ...localFromPorts]);
}

function cleanMarkdownLine(rawLine: string) {
  return rawLine
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/[*_>#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isLowValueReadmeLine(line: string) {
  const lowered = line.toLowerCase();
  if (!line) {
    return true;
  }
  if (line.startsWith("http://") || line.startsWith("https://")) {
    return true;
  }
  if (lowered.startsWith("url:")) {
    return true;
  }
  if (lowered.includes("replace_with_project_id")) {
    return true;
  }
  if (line.includes("/api/") || /\/v\d+($|[/?#])/i.test(line)) {
    return true;
  }
  if (
    /^(npm|pnpm|yarn|bun|npx|pip|python|uv|go|cargo|docker)\b/i.test(lowered) ||
    lowered.startsWith("```") ||
    lowered.includes("http://*") ||
    lowered.includes("https://*")
  ) {
    return true;
  }
  const chars = (line.match(/[a-z0-9\u4e00-\u9fa5]/gi) || []).length;
  if (chars < 8) {
    return true;
  }
  return false;
}

function firstMeaningfulParagraph(content: string) {
  const lines = content.split(/\r?\n/);
  const paragraph: string[] = [];

  for (const rawLine of lines) {
    const cleaned = cleanMarkdownLine(rawLine);
    if (!cleaned) {
      if (paragraph.length > 0) {
        break;
      }
      continue;
    }
    if (isLowValueReadmeLine(cleaned)) {
      continue;
    }
    paragraph.push(cleaned);
    if (paragraph.join(" ").length > 220 || paragraph.length >= 3) {
      break;
    }
  }

  if (paragraph.length > 0) {
    return paragraph.join(" ");
  }

  const fallback = lines.map((line) => cleanMarkdownLine(line)).find((line) => !isLowValueReadmeLine(line));
  return fallback || "";
}

function extractSection(content: string, keywords: string[]) {
  const lines = content.split(/\r?\n/);
  let captureStart = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    const headingMatch = line.match(/^#{1,6}\s+(.+)/);
    if (!headingMatch) {
      continue;
    }
    const headingText = headingMatch[1].toLowerCase();
    if (keywords.some((keyword) => headingText.includes(keyword))) {
      captureStart = index + 1;
      break;
    }
  }

  if (captureStart < 0) {
    return "";
  }

  const picked: string[] = [];
  for (let index = captureStart; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) {
      if (picked.length > 0) {
        break;
      }
      continue;
    }
    if (/^#{1,6}\s+/.test(line)) {
      break;
    }
    const cleaned = cleanMarkdownLine(line);
    if (!cleaned || isLowValueReadmeLine(cleaned)) {
      continue;
    }
    picked.push(cleaned);
    if (picked.length >= 4) {
      break;
    }
  }

  return picked.join(" ");
}

async function readReadmeContent(repoPath: string, readmePath: string | null) {
  const candidates = [readmePath || "", "README.md", "readme.md", path.join("docs", "README.md")].filter(Boolean);
  for (const candidate of candidates) {
    const absolutePath = path.join(repoPath, candidate);
    if (!(await pathExists(absolutePath))) {
      continue;
    }
    const content = await fs.readFile(absolutePath, "utf8").catch(() => "");
    if (content) {
      return {
        path: toPosixPath(candidate),
        content: content.slice(0, MAX_README_BYTES)
      };
    }
  }
  return {
    path: null,
    content: ""
  };
}

function buildEnvironmentRows(input: { localUrls: string[]; projectUrls: string[]; readmeUrls: string[]; referenceUrls: string[] }) {
  const localUrls = dedupeUrls(input.localUrls).map((url) => ({ url, source: "local-inference" }));
  const projectUrls = dedupeUrls(input.projectUrls)
    .filter((url) => isLikelyUiUrl(url))
    .map((url) => ({ url, source: "project-config" }));
  const readmeUrls = dedupeUrls(input.readmeUrls)
    .filter((url) => isLikelyUiUrl(url))
    .map((url) => ({ url, source: "readme-link" }));
  const referenceUrls = dedupeUrls(input.referenceUrls).map((url) => ({ url, source: "repo-reference" }));

  const ordered = [...localUrls, ...projectUrls, ...readmeUrls, ...referenceUrls];
  const uniqueRows: Array<{ url: string; source: string }> = [];
  const seen = new Set<string>();
  for (const item of ordered) {
    if (seen.has(item.url)) {
      continue;
    }
    seen.add(item.url);
    uniqueRows.push(item);
  }

  return uniqueRows.map((item, index) => {
    const kind = classifyEnvironment(item.url);
    return {
      id: `env_${index + 1}_${Buffer.from(item.url).toString("base64").slice(0, 8)}`,
      label: environmentLabel(kind, item.url, index),
      url: item.url,
      kind,
      source: item.source
    };
  });
}

function isLikelyUiUrl(urlText: string) {
  try {
    if (urlText.toLowerCase().includes("replace_with")) {
      return false;
    }
    const parsed = new URL(urlText);
    const host = parsed.hostname.toLowerCase();
    const pathName = parsed.pathname.toLowerCase();

    if (!/^https?:$/i.test(parsed.protocol)) {
      return false;
    }
    if (host === "*" || host.includes("*") || pathName.includes("*")) {
      return false;
    }
    if (host === "api.openai.com" || host.startsWith("api.") || host.startsWith("docs.") || host === "raw.githubusercontent.com") {
      return false;
    }
    if (
      pathName.includes("/api/") ||
      /^\/v\d+($|\/)/.test(pathName) ||
      pathName.includes("/health") ||
      pathName.includes("/metrics") ||
      pathName.includes("/status")
    ) {
      return false;
    }
    if (pathName.endsWith(".json") || pathName.endsWith(".md") || pathName.endsWith(".yaml") || pathName.endsWith(".yml")) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function toCaptureUrl(urlText: string) {
  const normalized = normalizeUrl(urlText);
  if (!normalized) {
    return null;
  }

  try {
    const parsed = new URL(normalized);
    if (process.env.GITHUB_ROOT === "/data/github" && LOCAL_HOST_PATTERN.test(parsed.hostname)) {
      parsed.hostname = "host.docker.internal";
      return parsed.toString();
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

async function captureScreenshot(urlText: string, outputPath: string) {
  const captureUrl = toCaptureUrl(urlText);
  if (!captureUrl) {
    return false;
  }

  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({
      headless: true
    });
    try {
      const page = await browser.newPage({
        viewport: { width: 1400, height: 900 }
      });
      await page.goto(captureUrl, {
        waitUntil: "domcontentloaded",
        timeout: SCREENSHOT_CAPTURE_TIMEOUT_MS
      });
      if (page.url().startsWith("chrome-error://")) {
        return false;
      }
      await page.waitForTimeout(1200);
      await page.screenshot({
        path: outputPath,
        fullPage: false
      });
    } finally {
      await browser.close();
    }
    return true;
  } catch {
    return false;
  }
}

function screenshotFileName(sourceUrl: string, index: number) {
  const hash = createHash("sha1").update(sourceUrl).digest("hex").slice(0, 12);
  return `shot-${index + 1}-${hash}.png`;
}

async function listScreenshots(projectId: string, environments: ProfileEnvironment[]) {
  const dataRoot = await resolveDataRoot();
  const screenshotDir = path.join(dataRoot, "screenshots", projectId);
  await fs.mkdir(screenshotDir, { recursive: true });

  const prioritized = [...environments]
    .filter((item) => Boolean(item.url) && item.kind !== "reference")
    .filter((item) => item.source === "local-inference" || item.source === "project-config")
    .sort((left, right) => {
      const sourceWeight = (source: string) => {
        if (source === "local-inference") {
          return 0;
        }
        if (source === "project-config") {
          return 1;
        }
        return 2;
      };
      const kindWeight = (kind: EnvironmentKind) => {
        if (kind === "local") {
          return 0;
        }
        if (kind === "staging") {
          return 1;
        }
        if (kind === "production") {
          return 2;
        }
        return 3;
      };
      return sourceWeight(left.source) - sourceWeight(right.source) || kindWeight(left.kind) - kindWeight(right.kind);
    })
    .slice(0, MAX_SCREENSHOTS * 2);

  const screenshots: ProfileScreenshot[] = [];

  for (let index = 0; index < prioritized.length; index += 1) {
    if (screenshots.length >= MAX_SCREENSHOTS) {
      break;
    }

    const environment = prioritized[index];
    const fileName = screenshotFileName(environment.url, index);
    const filePath = path.join(screenshotDir, fileName);

    let canUseExisting = false;
    try {
      const stat = await fs.stat(filePath);
      if (Date.now() - stat.mtimeMs <= SCREENSHOT_STALE_MS) {
        canUseExisting = true;
      }
    } catch {
      // Missing old screenshot, continue capture.
    }

    if (!canUseExisting) {
      const captured = await captureScreenshot(environment.url, filePath);
      if (!captured) {
        continue;
      }
    }

    screenshots.push({
      id: `${environment.id}_${index + 1}`,
      label: environment.label,
      sourceUrl: environment.url,
      url: `/api/projects/${projectId}/screenshots/${encodeURIComponent(fileName)}`
    });
  }

  return screenshots;
}

export async function GET(_: Request, context: { params: { id: string } }) {
  try {
    const project = await queryProjectById(context.params.id);
    if (!project) {
      throw new HttpError(404, "Project not found");
    }

    const repoPath = await resolveAllowedRepoPath(project.repoPath);
    const readme = await readReadmeContent(repoPath, project.readmePath || null);
    const readmeContent = readme.content || "";
    const fallbackParagraph = firstMeaningfulParagraph(readmeContent);
    const summaryFallback = project.readmePreview || project.summary || fallbackParagraph || "暂无界面描述，请补充 README。";
    const uiSummary =
      extractSection(readmeContent, ["ui", "界面", "页面", "screen", "frontend", "design"]) ||
      summaryFallback;
    const interactionSummary =
      extractSection(readmeContent, ["交互", "interaction", "workflow", "使用", "操作", "feature", "功能"]) ||
      project.readmePreview ||
      project.summary ||
      fallbackParagraph ||
      "暂无交互说明，请补充 README。";

    const startCommands = await inferStartCommands(repoPath, project.localStartCommand || null);
    const localUrls = await inferLocalUrls(repoPath, project.localStartCommand || null, project.readmeLinks || []);
    const projectUrls = [project.productionUrl || "", project.demoUrl || ""].filter(Boolean);
    const readmeUrls = [...(project.readmeLinks || [])];
    const referenceUrls = [project.sourceUrl || ""].filter(Boolean);
    const environments = buildEnvironmentRows({
      localUrls,
      projectUrls,
      readmeUrls,
      referenceUrls
    });
    const screenshots = await listScreenshots(project.id, environments);

    return NextResponse.json({
      ok: true,
      projectId: project.id,
      repoPath: project.repoPath,
      readmePath: readme.path,
      uiSummary,
      interactionSummary,
      startCommands,
      environments,
      screenshots
    });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json(
      {
        ok: false,
        error: toErrorMessage(error)
      },
      { status }
    );
  }
}
