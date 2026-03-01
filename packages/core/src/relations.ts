import type { RelationType } from "@center/db";
import { explainRelationWithLlm } from "./ai";
import { daysSince } from "./scoring";
import type { RelationCandidate, ScoredProject } from "./types";

const GENERIC_TECH_TOKENS = new Set([
  "nodejs",
  "python",
  "go",
  "rust",
  "docker",
  "api",
  "backend",
  "frontend",
  "service",
  "worker",
  "web",
  "app",
  "server",
  "client",
  "library",
  "cli",
  "local",
  "github"
]);

const IGNORED_RELATION_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "github.com", "raw.githubusercontent.com"]);

function jaccard(a: string[], b: string[]) {
  const aSet = new Set(a.map((item) => item.toLowerCase()));
  const bSet = new Set(b.map((item) => item.toLowerCase()));
  const intersection = Array.from(aSet).filter((item) => bSet.has(item)).length;
  const union = new Set([...aSet, ...bSet]).size;
  if (union === 0) {
    return 0;
  }
  return intersection / union;
}

function normalizeToken(raw: string) {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^\w@./-]+/g, "")
    .replace(/^[@./-]+|[@./-]+$/g, "");
}

function aliasVariants(raw: string) {
  const normalized = normalizeToken(raw);
  if (!normalized || normalized.length < 3) {
    return [];
  }

  const compact = normalized.replace(/[^a-z0-9]/g, "");
  const variants = new Set<string>([
    normalized,
    normalized.replace(/_/g, "-"),
    normalized.replace(/-/g, "_"),
    compact
  ]);
  return Array.from(variants).filter((item) => item.length >= 3);
}

function buildProjectAliases(project: ScoredProject) {
  const aliases = new Set<string>();
  const candidates = [project.slug, project.name, project.remoteName || ""];
  for (const candidate of candidates) {
    for (const variant of aliasVariants(candidate)) {
      aliases.add(variant);
    }
  }
  return aliases;
}

function isConcreteLibrary(raw: string) {
  const normalized = normalizeToken(raw);
  if (!normalized || normalized.length < 2) {
    return false;
  }
  if (GENERIC_TECH_TOKENS.has(normalized)) {
    return false;
  }
  if (normalized.includes("localhost")) {
    return false;
  }
  if (/\.(md|txt|json|ya?ml|toml|ini|py|tsx?|jsx?)$/i.test(normalized)) {
    return false;
  }
  if (/^\d/.test(normalized)) {
    return false;
  }
  return true;
}

function findSharedLibraries(projectA: ScoredProject, projectB: ScoredProject) {
  const aMap = new Map<string, string>();
  const bMap = new Map<string, string>();

  for (const item of projectA.techStack) {
    const normalized = normalizeToken(item);
    if (!isConcreteLibrary(normalized)) {
      continue;
    }
    if (!aMap.has(normalized)) {
      aMap.set(normalized, item);
    }
  }

  for (const item of projectB.techStack) {
    const normalized = normalizeToken(item);
    if (!isConcreteLibrary(normalized)) {
      continue;
    }
    if (!bMap.has(normalized)) {
      bMap.set(normalized, item);
    }
  }

  const shared = Array.from(aMap.keys())
    .filter((item) => bMap.has(item))
    .sort((left, right) => left.localeCompare(right))
    .slice(0, 8)
    .map((item) => aMap.get(item) || bMap.get(item) || item);

  return shared;
}

function parseHost(rawUrl: string) {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    const normalizedHost = host.startsWith("www.") ? host.slice(4) : host;
    if (IGNORED_RELATION_HOSTS.has(normalizedHost) || normalizedHost.endsWith(".local")) {
      return "";
    }
    return normalizedHost;
  } catch {
    return "";
  }
}

function collectServiceHosts(project: ScoredProject) {
  const hosts = new Set<string>();
  const candidates = [project.productionUrl, project.demoUrl].filter((item): item is string => Boolean(item));
  for (const candidate of candidates) {
    const host = parseHost(candidate);
    if (host) {
      hosts.add(host);
    }
  }
  return hosts;
}

function collectOutboundApiHosts(project: ScoredProject) {
  const hosts = new Set<string>();

  for (const urlText of project.readmeLinks) {
    try {
      const parsed = new URL(urlText);
      const host = parseHost(urlText);
      if (!host) {
        continue;
      }
      const pathName = parsed.pathname.toLowerCase();
      if (pathName.includes("/api/") || pathName.startsWith("/api") || host.startsWith("api.")) {
        hosts.add(host);
      }
    } catch {
      continue;
    }
  }

  return hosts;
}

function detectDependencyHints(source: ScoredProject, target: ScoredProject) {
  const targetAliases = buildProjectAliases(target);
  if (targetAliases.size === 0) {
    return [];
  }

  const hits = new Set<string>();

  for (const token of source.techStack) {
    const variants = aliasVariants(token);
    if (variants.some((item) => targetAliases.has(item))) {
      hits.add(`依赖包 ${token}`);
    }
  }

  for (const tag of source.tags) {
    const variants = aliasVariants(tag);
    if (variants.some((item) => targetAliases.has(item))) {
      hits.add(`文档提及 ${tag}`);
    }
  }

  const sourceHosts = collectOutboundApiHosts(source);
  const targetHosts = collectServiceHosts(target);
  for (const host of sourceHosts) {
    if (targetHosts.has(host)) {
      hits.add(`API 主机 ${host}`);
    }
  }

  return Array.from(hits).slice(0, 4);
}

function relationTypeLabel(type: RelationType) {
  if (type === "tech_overlap") {
    return "技术共享";
  }
  if (type === "theme_similarity") {
    return "主题相近";
  }
  if (type === "workflow_dependency") {
    return "流程依赖";
  }
  return "时间邻近";
}

function pickRelationType(signals: {
  techOverlap: number;
  keywordOverlap: number;
  timelineScore: number;
  sharedOwner: number;
  dependencySignal: number;
  projectA: ScoredProject;
  projectB: ScoredProject;
}): RelationType {
  const { projectA, projectB } = signals;

  if (signals.dependencySignal > 0) {
    return "workflow_dependency";
  }

  const hasApiHint = [...projectA.tags, ...projectA.techStack].some((tag) =>
    ["api", "backend", "worker", "service", "registry"].includes(tag.toLowerCase())
  );
  const hasUiHint = [...projectB.tags, ...projectB.techStack].some((tag) =>
    ["web", "frontend", "next", "react", "dashboard"].includes(tag.toLowerCase())
  );

  if (hasApiHint && hasUiHint && signals.sharedOwner > 0) {
    return "workflow_dependency";
  }

  const ranking: Array<{ type: RelationType; value: number }> = [
    { type: "tech_overlap", value: signals.techOverlap },
    { type: "theme_similarity", value: signals.keywordOverlap },
    { type: "timeline_cluster", value: signals.timelineScore },
    { type: "workflow_dependency", value: signals.sharedOwner }
  ];

  ranking.sort((a, b) => b.value - a.value);
  return ranking[0].type;
}

function relationScore(projectA: ScoredProject, projectB: ScoredProject) {
  const techOverlap = jaccard(projectA.techStack, projectB.techStack);
  const keywordOverlap = jaccard(projectA.tags, projectB.tags);
  const sharedOwner = projectA.remoteOwner && projectB.remoteOwner && projectA.remoteOwner === projectB.remoteOwner ? 1 : 0;
  const sharedLibraries = findSharedLibraries(projectA, projectB);
  const projectADependsOnB = detectDependencyHints(projectA, projectB);
  const projectBDependsOnA = detectDependencyHints(projectB, projectA);
  const dependencySignal = projectADependsOnB.length > 0 || projectBDependsOnA.length > 0 ? 1 : 0;

  const deltaDays = Math.abs(daysSince(projectA.lastCommitAt) - daysSince(projectB.lastCommitAt));
  const timelineScore = deltaDays <= 3 ? 1 : deltaDays <= 10 ? 0.6 : deltaDays <= 21 ? 0.3 : 0;

  const baseScore =
    techOverlap * 0.32 + keywordOverlap * 0.25 + timelineScore * 0.15 + sharedOwner * 0.08 + dependencySignal * 0.2;
  const score = dependencySignal > 0 ? Math.max(baseScore, 0.32) : baseScore;

  return {
    score,
    techOverlap,
    keywordOverlap,
    timelineScore,
    sharedOwner,
    dependencySignal,
    sharedLibraries,
    projectADependsOnB,
    projectBDependsOnA
  };
}

export async function buildRelations(
  projects: ScoredProject[],
  config: {
    llmBaseUrl: string;
    llmApiKey: string;
    llmModel: string;
  }
): Promise<RelationCandidate[]> {
  const tracked = projects.filter((project) => project.scope === "tracked");
  const relations: RelationCandidate[] = [];

  for (let i = 0; i < tracked.length; i += 1) {
    for (let j = i + 1; j < tracked.length; j += 1) {
      const projectA = tracked[i];
      const projectB = tracked[j];
      const signals = relationScore(projectA, projectB);
      if (signals.score < 0.25) {
        continue;
      }

      const type = pickRelationType({ ...signals, projectA, projectB });
      const sharedLibrariesLine = signals.sharedLibraries.length
        ? `共享库: ${signals.sharedLibraries.slice(0, 6).join(", ")}`
        : "共享库: 暂未发现可确认的共享第三方库";
      const pairCallHints: string[] = [];
      if (signals.projectADependsOnB.length > 0) {
        pairCallHints.push(
          `${projectA.name} -> ${projectB.name}（${signals.projectADependsOnB.slice(0, 3).join(", ")}）`
        );
      }
      if (signals.projectBDependsOnA.length > 0) {
        pairCallHints.push(
          `${projectB.name} -> ${projectA.name}（${signals.projectBDependsOnA.slice(0, 3).join(", ")}）`
        );
      }
      const callLine =
        pairCallHints.length > 0 ? `调用关系: ${pairCallHints.join("；")}` : "调用关系: 暂未检测到明确的直接调用";

      const pairEvidence = [
        sharedLibrariesLine,
        callLine,
        `辅助信号: 技术重叠 ${signals.techOverlap.toFixed(2)} / 关键词 ${signals.keywordOverlap.toFixed(2)} / 时间邻近 ${signals.timelineScore.toFixed(2)}`
      ];

      const defaultExplanation = `${projectA.name} 与 ${projectB.name} 的主要关系为 ${relationTypeLabel(type)}。${sharedLibrariesLine}；${callLine}。`;
      const explanation =
        signals.score >= 0.55
          ? await explainRelationWithLlm(
              {
                projectName: projectA.name,
                relatedProjectName: projectB.name,
                relationType: type,
                evidence: pairEvidence,
                score: signals.score
              },
              {
                baseUrl: config.llmBaseUrl,
                apiKey: config.llmApiKey,
                model: config.llmModel
              }
            )
          : defaultExplanation;

      const evidenceAtoB = [
        sharedLibrariesLine,
        signals.projectADependsOnB.length > 0
          ? `调用关系: ${projectA.name} -> ${projectB.name}（${signals.projectADependsOnB.slice(0, 3).join(", ")}）`
          : signals.projectBDependsOnA.length > 0
            ? `调用关系: ${projectB.name} -> ${projectA.name}（${signals.projectBDependsOnA.slice(0, 3).join(", ")}）`
            : "调用关系: 暂未检测到明确的直接调用",
        `关系类型: ${relationTypeLabel(type)}`
      ];

      const evidenceBtoA = [
        sharedLibrariesLine,
        signals.projectBDependsOnA.length > 0
          ? `调用关系: ${projectB.name} -> ${projectA.name}（${signals.projectBDependsOnA.slice(0, 3).join(", ")}）`
          : signals.projectADependsOnB.length > 0
            ? `调用关系: ${projectA.name} -> ${projectB.name}（${signals.projectADependsOnB.slice(0, 3).join(", ")}）`
            : "调用关系: 暂未检测到明确的直接调用",
        `关系类型: ${relationTypeLabel(type)}`
      ];

      relations.push(
        {
          projectSlug: projectA.slug,
          relatedProjectSlug: projectB.slug,
          type,
          score: Number(signals.score.toFixed(4)),
          evidence: evidenceAtoB,
          explanation
        },
        {
          projectSlug: projectB.slug,
          relatedProjectSlug: projectA.slug,
          type,
          score: Number(signals.score.toFixed(4)),
          evidence: evidenceBtoA,
          explanation
        }
      );
    }
  }

  return relations;
}
