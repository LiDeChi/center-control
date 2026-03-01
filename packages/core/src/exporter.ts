import fs from "node:fs/promises";
import path from "node:path";
import type { ProjectScope } from "@center/db";

export type PortfolioProjectRecord = {
  id: string;
  name: string;
  slug: string;
  repoPath: string;
  remoteUrl: string | null;
  visibilityType: "local" | "github";
  summary: string;
  techStack: string[];
  tags: string[];
  activityScore: number;
  lastCommitAt: string | null;
  commitCount7d: number;
  commitCount30d: number;
  stars: number;
  openIssues: number;
  openPrs: number;
  relationCount: number;
  topRelations: Array<{
    slug: string;
    name: string;
    score: number;
    type: string;
    evidence?: string[];
    explanation?: string;
  }>;
  coverHint: string | null;
  demoUrl: string | null;
  sourceUrl: string | null;
  scope: ProjectScope;
};

type ExternalConnectionKind = "remote" | "source" | "production" | "demo" | "readme";

export type ProjectInventoryRecord = {
  id: string;
  name: string;
  slug: string;
  scope: ProjectScope;
  repoPath: string;
  visibilityType: "local" | "github";
  purpose: string;
  summary: string;
  techStack: string[];
  localStartCommand: string | null;
  productionUrl: string | null;
  relationCount: number;
  topRelations: Array<{
    slug: string;
    name: string;
    score: number;
    type: string;
    evidence?: string[];
    explanation?: string;
  }>;
  externalConnections: Array<{
    kind: ExternalConnectionKind;
    url: string;
    host: string;
  }>;
  externalHosts: string[];
  screenshots: Array<{
    fileName: string;
    apiPath: string;
    localPath: string;
    updatedAt: string;
  }>;
  screenshotStatus: "ready" | "missing";
};

type InventoryInputProject = {
  id: string;
  name: string;
  slug: string;
  scope: ProjectScope;
  repoPath: string;
  visibilityType: "local" | "github";
  summary: string;
  readmePreview?: string | null;
  techStack: string[];
  localStartCommand?: string | null;
  productionUrl?: string | null;
  remoteUrl?: string | null;
  sourceUrl?: string | null;
  demoUrl?: string | null;
  readmeLinks?: string[];
  relationsFrom: Array<{
    type: string;
    score: number;
    evidence?: string[];
    explanation?: string;
    relatedProject: {
      slug: string;
      name: string;
    };
  }>;
};

function toExternalHost(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    return parsed.host.toLowerCase();
  } catch {
    const sshMatch = rawUrl.match(/^git@([^:]+):/i);
    if (sshMatch?.[1]) {
      return sshMatch[1].toLowerCase();
    }
    const generic = rawUrl.match(/^[a-z]+:\/\/([^/]+)/i);
    if (generic?.[1]) {
      return generic[1].toLowerCase();
    }
    return "unknown";
  }
}

function isLocalHost(host: string) {
  const lowered = host.toLowerCase();
  return (
    lowered === "localhost" ||
    lowered.startsWith("localhost:") ||
    lowered === "127.0.0.1" ||
    lowered.startsWith("127.0.0.1:") ||
    lowered === "0.0.0.0" ||
    lowered.startsWith("0.0.0.0:") ||
    lowered.endsWith(".local")
  );
}

function isInvalidHost(host: string) {
  return host === "unknown" || host === "..." || host.includes("*");
}

function normalizeExternalUrl(rawUrl: string) {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return "";
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (/^git@[^:]+:.+/.test(trimmed)) {
    return trimmed;
  }
  return "";
}

function collectExternalConnections(project: InventoryInputProject) {
  const candidates: Array<{ kind: ExternalConnectionKind; url: string }> = [
    { kind: "remote", url: project.remoteUrl || "" },
    { kind: "source", url: project.sourceUrl || "" },
    { kind: "production", url: project.productionUrl || "" },
    { kind: "demo", url: project.demoUrl || "" },
    ...(project.readmeLinks || []).map((url) => ({ kind: "readme" as const, url }))
  ];
  const seen = new Set<string>();
  const rows: Array<{ kind: ExternalConnectionKind; url: string; host: string }> = [];

  for (const candidate of candidates) {
    const normalizedUrl = normalizeExternalUrl(candidate.url);
    if (!normalizedUrl) {
      continue;
    }
    const key = `${candidate.kind}:${normalizedUrl}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const host = toExternalHost(normalizedUrl);
    if (isInvalidHost(host) || isLocalHost(host)) {
      continue;
    }
    rows.push({
      kind: candidate.kind,
      url: normalizedUrl,
      host
    });
  }

  return rows;
}

async function collectProjectScreenshots(screenshotRoot: string, projectId: string, maxCount: number) {
  const projectDir = path.join(screenshotRoot, projectId);
  const entries = await fs.readdir(projectDir, { withFileTypes: true }).catch(() => []);
  const imageEntries = entries.filter((entry) => entry.isFile() && /\.(png|jpg|jpeg|webp)$/i.test(entry.name));

  const withStats = await Promise.all(
    imageEntries.map(async (entry) => {
      const absolutePath = path.join(projectDir, entry.name);
      const stat = await fs.stat(absolutePath).catch(() => null);
      return {
        fileName: entry.name,
        absolutePath,
        updatedAt: stat ? stat.mtime.toISOString() : new Date(0).toISOString(),
        updatedAtMs: stat ? stat.mtimeMs : 0
      };
    })
  );

  return withStats
    .sort((left, right) => right.updatedAtMs - left.updatedAtMs || left.fileName.localeCompare(right.fileName))
    .slice(0, maxCount)
    .map((item) => ({
      fileName: item.fileName,
      apiPath: `/api/projects/${projectId}/screenshots/${encodeURIComponent(item.fileName)}`,
      localPath: item.absolutePath,
      updatedAt: item.updatedAt
    }));
}

function renderInventoryMarkdown(data: {
  generatedAt: string;
  trackedCount: number;
  externalCount: number;
  projects: ProjectInventoryRecord[];
}) {
  const lines: string[] = [];
  lines.push("# Center Control 项目盘点");
  lines.push("");
  lines.push(`- 生成时间: ${data.generatedAt}`);
  lines.push(`- tracked: ${data.trackedCount}`);
  lines.push(`- external: ${data.externalCount}`);
  lines.push(`- 总项目数: ${data.projects.length}`);
  lines.push("");

  for (const project of data.projects) {
    const hostsText = project.externalHosts.length ? project.externalHosts.join(", ") : "无";
    const screenshotsText = project.screenshots.length
      ? project.screenshots.map((item) => item.localPath).join(" | ")
      : "无";
    lines.push(`## ${project.name}`);
    lines.push(`- 作用: ${project.purpose || project.summary || "暂无摘要"}`);
    lines.push(`- 外部连接域名: ${hostsText}`);
    lines.push(`- 外部连接数: ${project.externalConnections.length}`);
    lines.push(`- 截图状态: ${project.screenshotStatus}（${project.screenshots.length} 张）`);
    lines.push(`- 截图文件: ${screenshotsText}`);
    lines.push("");
  }

  return lines.join("\n");
}

export async function writePortfolioExport(baseDir: string, payload: PortfolioProjectRecord[]) {
  await fs.mkdir(baseDir, { recursive: true });
  const target = path.join(baseDir, "projects.json");
  const output = {
    generatedAt: new Date().toISOString(),
    count: payload.length,
    projects: payload
  };

  await fs.writeFile(target, JSON.stringify(output, null, 2), "utf-8");
  return target;
}

export async function writeProjectInventoryExport(baseDir: string, projects: InventoryInputProject[]) {
  await fs.mkdir(baseDir, { recursive: true });
  const screenshotRoot = path.resolve(baseDir, "..", "screenshots");
  const sorted = [...projects].sort((left, right) => left.name.localeCompare(right.name));

  const inventoryProjects: ProjectInventoryRecord[] = [];
  for (const project of sorted) {
    const screenshots = await collectProjectScreenshots(screenshotRoot, project.id, 3);
    const externalConnections = collectExternalConnections(project);
    const externalHosts = Array.from(new Set(externalConnections.map((item) => item.host))).sort((a, b) =>
      a.localeCompare(b)
    );
    inventoryProjects.push({
      id: project.id,
      name: project.name,
      slug: project.slug,
      scope: project.scope,
      repoPath: project.repoPath,
      visibilityType: project.visibilityType,
      purpose: (project.readmePreview || "").trim() || (project.summary || "").trim(),
      summary: project.summary,
      techStack: project.techStack,
      localStartCommand: project.localStartCommand || null,
      productionUrl: project.productionUrl || null,
      relationCount: project.relationsFrom.length,
      topRelations: project.relationsFrom.slice(0, 3).map((relation) => ({
        slug: relation.relatedProject.slug,
        name: relation.relatedProject.name,
        score: relation.score,
        type: relation.type,
        evidence: Array.isArray(relation.evidence) ? relation.evidence.map((item) => String(item)) : [],
        explanation: relation.explanation || ""
      })),
      externalConnections,
      externalHosts,
      screenshots,
      screenshotStatus: screenshots.length > 0 ? "ready" : "missing"
    });
  }

  const trackedCount = inventoryProjects.filter((project) => project.scope === "tracked").length;
  const externalCount = inventoryProjects.filter((project) => project.scope === "external").length;
  const generatedAt = new Date().toISOString();
  const jsonPayload = {
    generatedAt,
    trackedCount,
    externalCount,
    count: inventoryProjects.length,
    projects: inventoryProjects
  };
  const jsonPath = path.join(baseDir, "project-inventory.json");
  await fs.writeFile(jsonPath, JSON.stringify(jsonPayload, null, 2), "utf-8");

  const markdown = renderInventoryMarkdown({
    generatedAt,
    trackedCount,
    externalCount,
    projects: inventoryProjects
  });
  const markdownPath = path.join(baseDir, "project-inventory.md");
  await fs.writeFile(markdownPath, markdown, "utf-8");

  return {
    jsonPath,
    markdownPath
  };
}
