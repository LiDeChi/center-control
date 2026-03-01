import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";

const STACK_FILES = [
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "go.mod",
  "Cargo.toml",
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml"
];

const README_DIRECT_CANDIDATES = [
  "README.md",
  "README.MD",
  "readme.md",
  "README",
  "readme",
  path.join("docs", "README.md"),
  path.join("docs", "README.MD"),
  path.join("docs", "readme.md"),
  path.join("docs", "README"),
  path.join("docs", "readme")
];

const README_FILE_PATTERN = /^readme(?:[._-][a-z0-9-]+)?(?:\.md)?$/i;
const INSTRUCTION_FILE_PATTERN = /^(agents?|claude|instructions?)(\.[a-z0-9_-]+)?\.md$/i;
const INSTRUCTION_PRIORITY: Record<string, number> = {
  "agents.md": 0,
  "agent.md": 1,
  "claude.md": 2
};
const DEFAULT_PYTHON_START = "python main.py";

function safeTokenize(text: string) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+_.-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && token.length <= 40);
}

async function readIfExists(filePath: string) {
  try {
    return await fs.readFile(filePath, "utf-8");
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

function toPosixPath(relativePath: string) {
  return relativePath.split(path.sep).join("/");
}

function readmeVariantRank(filename: string) {
  const lowered = filename.toLowerCase();
  if (lowered === "readme.md") {
    return 0;
  }
  if (lowered === "readme") {
    return 1;
  }
  if (lowered.startsWith("readme.") && lowered.endsWith(".md")) {
    return 2;
  }
  return 3;
}

async function collectReadmeFiles(repoPath: string, relativeDir: string, maxDepth: number) {
  const startPath = path.join(repoPath, relativeDir);
  if (!(await pathExists(startPath))) {
    return [];
  }

  const queue: Array<{ absolutePath: string; relativePath: string; depth: number }> = [
    { absolutePath: startPath, relativePath: relativeDir, depth: 0 }
  ];
  const found: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    let entries;
    try {
      entries = await fs.readdir(current.absolutePath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const childRelativePath = current.relativePath
        ? path.join(current.relativePath, entry.name)
        : entry.name;
      if (entry.isFile() && README_FILE_PATTERN.test(entry.name)) {
        found.push(toPosixPath(childRelativePath));
        continue;
      }

      if (entry.isDirectory() && current.depth < maxDepth) {
        queue.push({
          absolutePath: path.join(current.absolutePath, entry.name),
          relativePath: childRelativePath,
          depth: current.depth + 1
        });
      }
    }
  }

  return found.sort((left, right) => {
    const leftDepth = left.split("/").length;
    const rightDepth = right.split("/").length;
    if (leftDepth !== rightDepth) {
      return leftDepth - rightDepth;
    }

    const leftName = path.basename(left);
    const rightName = path.basename(right);
    const rankDiff = readmeVariantRank(leftName) - readmeVariantRank(rightName);
    if (rankDiff !== 0) {
      return rankDiff;
    }
    return left.localeCompare(right);
  });
}

async function loadReadmeDocument(repoPath: string): Promise<{ relativePath: string; content: string } | null> {
  for (const candidate of README_DIRECT_CANDIDATES) {
    const content = await readIfExists(path.join(repoPath, candidate));
    if (content) {
      return {
        relativePath: toPosixPath(candidate),
        content
      };
    }
  }

  let rootEntries: Dirent[] = [];
  try {
    rootEntries = await fs.readdir(repoPath, { withFileTypes: true });
  } catch {}

  const rootCandidates = rootEntries
    .filter((entry) => entry.isFile() && README_FILE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => {
      const rankDiff = readmeVariantRank(left) - readmeVariantRank(right);
      return rankDiff !== 0 ? rankDiff : left.localeCompare(right);
    })
    .map((entry) => toPosixPath(entry));

  const docsCandidates = await collectReadmeFiles(repoPath, "docs", 3);
  const candidates = Array.from(new Set([...rootCandidates, ...docsCandidates]));

  for (const candidate of candidates) {
    const content = await readIfExists(path.join(repoPath, candidate));
    if (!content) {
      continue;
    }
    return {
      relativePath: toPosixPath(candidate),
      content
    };
  }

  return null;
}

function normalizePreview(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function cleanReadmeLineForPreview(rawLine: string) {
  const trimmed = rawLine.trim();
  if (!trimmed) {
    return "";
  }

  const normalized = trimmed
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/!\[[^\]]*]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[*_~]/g, "");

  return normalizePreview(normalized);
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
  const meaningfulChars = (line.match(/[a-z0-9\u4e00-\u9fa5]/gi) || []).length;
  if (meaningfulChars < 8) {
    return true;
  }
  return false;
}

function buildReadmePreview(content: string) {
  const lines = content.split(/\r?\n/);
  const firstParagraph: string[] = [];
  let inCodeBlock = false;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) {
      continue;
    }

    const cleaned = cleanReadmeLineForPreview(rawLine);
    if (!cleaned) {
      if (firstParagraph.length > 0) {
        break;
      }
      continue;
    }
    if (isLowValueReadmeLine(cleaned)) {
      continue;
    }

    firstParagraph.push(cleaned);
    if (firstParagraph.join(" ").length >= 240 || firstParagraph.length >= 3) {
      break;
    }
  }

  if (firstParagraph.length > 0) {
    return normalizePreview(firstParagraph.join(" ")).slice(0, 220);
  }

  const fallbackLine = lines
    .map((line) => cleanReadmeLineForPreview(line))
    .find((line) => !isLowValueReadmeLine(line));

  return fallbackLine ? fallbackLine.slice(0, 220) : null;
}

function cleanUrlCandidate(raw: string) {
  return raw
    .trim()
    .replace(/^[('"`<]+/, "")
    .replace(/[>'"`),.;:!?]+$/, "");
}

function normalizeHttpUrl(raw: string) {
  const cleaned = cleanUrlCandidate(raw);
  try {
    const parsed = new URL(cleaned);
    if (!/^https?:$/i.test(parsed.protocol)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function extractReadmeLinks(content: string) {
  const links = new Set<string>();

  const markdownLinks = content.matchAll(/\[[^\]]*?\]\((https?:\/\/[^)\s]+)\)/gi);
  for (const match of markdownLinks) {
    const normalized = normalizeHttpUrl(match[1]);
    if (normalized) {
      links.add(normalized);
    }
  }

  const bareLinks = content.matchAll(/https?:\/\/[^\s<>\])]+/gi);
  for (const match of bareLinks) {
    const normalized = normalizeHttpUrl(match[0]);
    if (normalized) {
      links.add(normalized);
    }
  }

  return Array.from(links);
}

function isGithubLikeUrl(urlText: string) {
  try {
    const host = new URL(urlText).hostname.toLowerCase();
    return host.includes("github");
  } catch {
    return false;
  }
}

function isLikelyPublicUrl(urlText: string) {
  try {
    const parsed = new URL(urlText);
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host === "0.0.0.0" || host === "127.0.0.1" || host.endsWith(".local")) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function isLikelyAppHomepage(urlText: string) {
  try {
    if (urlText.toLowerCase().includes("replace_with")) {
      return false;
    }
    const parsed = new URL(urlText);
    const host = parsed.hostname.toLowerCase();
    const pathName = parsed.pathname.toLowerCase();

    if (!isLikelyPublicUrl(urlText) || isGithubLikeUrl(urlText)) {
      return false;
    }
    if (host === "*" || host.includes("*") || pathName.includes("*")) {
      return false;
    }
    if (host.startsWith("api.") || host.startsWith("docs.") || host === "api.openai.com" || host === "raw.githubusercontent.com") {
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
    if (pathName.endsWith(".json") || pathName.endsWith(".yaml") || pathName.endsWith(".yml") || pathName.endsWith(".md")) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function normalizeRemoteUrl(remoteUrl: string | null) {
  if (!remoteUrl) {
    return null;
  }

  if (remoteUrl.startsWith("http://") || remoteUrl.startsWith("https://")) {
    return remoteUrl.replace(/\.git$/i, "");
  }

  const sshMatch = remoteUrl.match(/^git@([^:]+):(.+?)(?:\.git)?$/i);
  if (sshMatch) {
    return `https://${sshMatch[1]}/${sshMatch[2]}`;
  }

  const sshProtocolMatch = remoteUrl.match(/^ssh:\/\/git@([^/]+)\/(.+?)(?:\.git)?$/i);
  if (sshProtocolMatch) {
    return `https://${sshProtocolMatch[1]}/${sshProtocolMatch[2]}`;
  }

  return remoteUrl;
}

function parsePyprojectName(pyprojectContent: string) {
  const match = pyprojectContent.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
  if (!match || !match[1]) {
    return null;
  }
  return match[1].trim().replace(/[-\s]+/g, "_");
}

async function inferPythonStartCommand(repoPath: string, pyprojectContent: string | null) {
  const candidates: Array<{ file: string; command: string }> = [
    { file: "manage.py", command: "python manage.py runserver" },
    { file: "main.py", command: "python main.py" },
    { file: "app.py", command: "python app.py" },
    { file: path.join("src", "main.py"), command: "python src/main.py" }
  ];

  for (const candidate of candidates) {
    if (await pathExists(path.join(repoPath, candidate.file))) {
      return candidate.command;
    }
  }

  const pyprojectName = pyprojectContent ? parsePyprojectName(pyprojectContent) : null;
  if (pyprojectName) {
    return `python -m ${pyprojectName}`;
  }

  return DEFAULT_PYTHON_START;
}

export async function inferReadmeMetadata(repoPath: string) {
  const readme = await loadReadmeDocument(repoPath);
  if (!readme) {
    return {
      readmePath: null,
      readmePreview: null,
      readmeLinks: [] as string[]
    };
  }

  return {
    readmePath: readme.relativePath,
    readmePreview: buildReadmePreview(readme.content),
    readmeLinks: extractReadmeLinks(readme.content)
  };
}

export async function inferInstructionFiles(repoPath: string) {
  const searchRoots = ["", "docs"];
  const found = new Set<string>();

  for (const searchRoot of searchRoots) {
    const startPath = path.join(repoPath, searchRoot);
    if (!(await pathExists(startPath))) {
      continue;
    }

    const queue: Array<{ absolutePath: string; relativePath: string; depth: number }> = [
      { absolutePath: startPath, relativePath: searchRoot, depth: 0 }
    ];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        continue;
      }

      let entries;
      try {
        entries = await fs.readdir(current.absolutePath, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        const relativePath = current.relativePath ? path.join(current.relativePath, entry.name) : entry.name;
        if (entry.isFile() && INSTRUCTION_FILE_PATTERN.test(entry.name)) {
          found.add(toPosixPath(relativePath));
          continue;
        }

        if (entry.isDirectory() && current.depth < 3 && entry.name !== ".git" && entry.name !== "node_modules") {
          queue.push({
            absolutePath: path.join(current.absolutePath, entry.name),
            relativePath,
            depth: current.depth + 1
          });
        }
      }
    }
  }

  return Array.from(found).sort((left, right) => {
    const leftDepth = left.split("/").length;
    const rightDepth = right.split("/").length;
    if (leftDepth !== rightDepth) {
      return leftDepth - rightDepth;
    }

    const leftName = path.basename(left).toLowerCase();
    const rightName = path.basename(right).toLowerCase();
    const leftRank = INSTRUCTION_PRIORITY[leftName] ?? 50;
    const rightRank = INSTRUCTION_PRIORITY[rightName] ?? 50;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    return left.localeCompare(right);
  });
}

export function inferHasClaudeLikeInstruction(instructionFiles: string[]) {
  return instructionFiles.some((instructionFile) =>
    /^(agents?|claude|agent)(\.[a-z0-9_-]+)?\.md$/i.test(path.basename(instructionFile))
  );
}

export async function inferLocalStartCommand(repoPath: string) {
  const packageJsonContent = await readIfExists(path.join(repoPath, "package.json"));
  if (packageJsonContent) {
    try {
      const parsed = JSON.parse(packageJsonContent) as { scripts?: Record<string, string> };
      if (parsed.scripts?.dev) {
        return "npm run dev";
      }
      if (parsed.scripts?.start) {
        return "npm run start";
      }
    } catch {}
  }

  const pyprojectContent = await readIfExists(path.join(repoPath, "pyproject.toml"));
  const hasRequirements = await pathExists(path.join(repoPath, "requirements.txt"));
  if (pyprojectContent || hasRequirements) {
    return inferPythonStartCommand(repoPath, pyprojectContent);
  }

  const hasDockerCompose =
    (await pathExists(path.join(repoPath, "docker-compose.yml"))) ||
    (await pathExists(path.join(repoPath, "docker-compose.yaml")));
  if (hasDockerCompose) {
    return "docker compose up";
  }

  return null;
}

export function inferProductionUrl(readmeLinks: string[], remoteUrl: string | null) {
  const preferredReadmeLink = readmeLinks.find((link) => isLikelyAppHomepage(link));
  if (preferredReadmeLink) {
    return preferredReadmeLink;
  }
  const normalizedRemote = normalizeRemoteUrl(remoteUrl);
  if (normalizedRemote && isLikelyAppHomepage(normalizedRemote)) {
    return normalizedRemote;
  }
  return null;
}

export async function inferTechStack(repoPath: string) {
  const tech = new Set<string>();

  for (const filename of STACK_FILES) {
    const fullPath = path.join(repoPath, filename);
    const content = await readIfExists(fullPath);
    if (!content) {
      continue;
    }

    if (filename === "package.json") {
      try {
        const parsed = JSON.parse(content) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        tech.add("nodejs");
        const deps = { ...(parsed.dependencies || {}), ...(parsed.devDependencies || {}) };
        Object.keys(deps)
          .slice(0, 40)
          .forEach((name) => tech.add(name.toLowerCase()));
      } catch {
        tech.add("nodejs");
      }
    }

    if (filename === "pyproject.toml" || filename === "requirements.txt") {
      tech.add("python");
      safeTokenize(content)
        .filter((token) => !token.startsWith("http"))
        .slice(0, 40)
        .forEach((token) => tech.add(token));
    }

    if (filename === "go.mod") {
      tech.add("go");
      safeTokenize(content)
        .slice(0, 30)
        .forEach((token) => tech.add(token));
    }

    if (filename === "Cargo.toml") {
      tech.add("rust");
      safeTokenize(content)
        .slice(0, 30)
        .forEach((token) => tech.add(token));
    }

    if (filename.toLowerCase().includes("docker")) {
      tech.add("docker");
    }
  }

  const inferred = Array.from(tech)
    .filter((item) => !/^\d/.test(item))
    .slice(0, 25);

  return inferred;
}

export async function inferSummaryAndTags(repoPath: string, projectName: string) {
  const tags = new Set<string>();
  projectName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .forEach((word) => tags.add(word));

  let summary = `${projectName} 项目，等待自动摘要补全。`;

  const readme = await loadReadmeDocument(repoPath);
  if (readme) {
    const preview = buildReadmePreview(readme.content);
    if (preview) {
      summary = preview.slice(0, 160);
    }

    safeTokenize(readme.content)
      .slice(0, 80)
      .forEach((token) => {
        if (token.length >= 3) {
          tags.add(token);
        }
      });
  }

  const filteredTags = Array.from(tags)
    .filter((tag) => !["the", "and", "for", "with", "this", "that"].includes(tag))
    .slice(0, 20);

  return {
    summary,
    tags: filteredTags
  };
}

export async function estimateFileCount(repoPath: string) {
  const queue: string[] = [repoPath];
  let count = 0;

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) {
      continue;
    }
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name.startsWith(".")) {
        continue;
      }
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(full);
      } else {
        count += 1;
      }
      if (count >= 6000) {
        return count;
      }
    }
  }

  return count;
}
