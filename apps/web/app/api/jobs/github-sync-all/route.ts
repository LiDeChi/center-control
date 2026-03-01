import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 120_000;
const BACKUP_REMOTE = "center-backup";
const GITHUB_API_BASE = "https://api.github.com";

type RepoSyncResult = {
  name: string;
  repoPath: string;
  status: "synced" | "failed" | "skipped";
  remote: string | null;
  branch: string | null;
  message: string;
};

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function toErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error";
  const runtimeToken = (process.env.GITHUB_TOKEN || "").trim();
  return message
    .replace(/https:\/\/x-access-token:[^@]+@github\.com/gi, "https://x-access-token:***@github.com")
    .replace(runtimeToken ? new RegExp(runtimeToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g") : /$^/, "***");
}

async function hasGitDir(repoPath: string) {
  try {
    const stat = await fs.stat(path.join(repoPath, ".git"));
    return stat.isDirectory() || stat.isFile();
  } catch {
    return false;
  }
}

async function resolveGithubRoot() {
  const candidates = [
    process.env.GITHUB_ROOT,
    path.resolve(process.cwd(), "../../.."),
    path.resolve(process.cwd(), "../.."),
    path.resolve(process.cwd(), ".."),
    "/data/github"
  ].filter((item): item is string => Boolean(item));

  let fallbackDir: string | null = null;
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    const stat = await fs.stat(resolved).catch(() => null);
    if (!stat?.isDirectory()) {
      continue;
    }

    fallbackDir = fallbackDir || resolved;
    const entries = await fs.readdir(resolved, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (await hasGitDir(path.join(resolved, entry.name))) {
        return resolved;
      }
    }
  }

  if (fallbackDir) {
    return fallbackDir;
  }

  throw new HttpError(500, "Cannot resolve github workspace root");
}

async function listWorkspaceRepos(githubRoot: string) {
  const entries = await fs.readdir(githubRoot, { withFileTypes: true });
  const repos: Array<{ name: string; repoPath: string }> = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const repoPath = path.join(githubRoot, entry.name);
    if (!(await hasGitDir(repoPath))) {
      continue;
    }
    repos.push({
      name: entry.name,
      repoPath
    });
  }

  return repos;
}

async function runGit(repoPath: string, args: string[]) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: repoPath,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 2 * 1024 * 1024,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0"
    }
  });
  return stdout.trim();
}

async function safeRunGit(repoPath: string, args: string[]) {
  try {
    return await runGit(repoPath, args);
  } catch {
    return "";
  }
}

function normalizeRepoName(projectName: string) {
  const sanitized = projectName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .slice(0, 90);

  return sanitized || "project";
}

function parseGithubRemote(remoteUrl: string) {
  const httpsMatch = remoteUrl.match(/^https?:\/\/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?$/i);
  if (httpsMatch) {
    return {
      owner: httpsMatch[1],
      repo: httpsMatch[2]
    };
  }

  const sshMatch = remoteUrl.match(/^git@github\.com:([^/]+)\/([^/.]+)(?:\.git)?$/i);
  if (sshMatch) {
    return {
      owner: sshMatch[1],
      repo: sshMatch[2]
    };
  }

  return null;
}

async function ensureGithubRepoExists(owner: string, repo: string, token: string, isPrivate: boolean) {
  if (!token) {
    throw new Error("GITHUB_TOKEN 未配置，无法自动创建/校验远程仓库。");
  }

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28"
  };

  const existing = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}`, {
    method: "GET",
    headers
  });
  if (existing.ok) {
    return;
  }
  if (existing.status !== 404) {
    throw new Error(`GitHub 查询失败（${existing.status}）`);
  }

  const created = await fetch(`${GITHUB_API_BASE}/user/repos`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: repo,
      private: isPrivate,
      auto_init: false
    })
  });

  if (created.ok || created.status === 422) {
    return;
  }

  const detail = await created.text().catch(() => "");
  throw new Error(`GitHub 创建仓库失败（${created.status}）${detail ? `: ${detail.slice(0, 200)}` : ""}`);
}

function authPushUrl(owner: string, repo: string, token: string) {
  const safeToken = encodeURIComponent(token);
  return `https://x-access-token:${safeToken}@github.com/${owner}/${repo}.git`;
}

async function syncSingleRepo(input: {
  repoPath: string;
  projectName: string;
  owner: string;
  token: string;
  privateByDefault: boolean;
  dryRun: boolean;
}) {
  const branch = (await safeRunGit(input.repoPath, ["rev-parse", "--abbrev-ref", "HEAD"])) || "";
  if (!branch || branch === "HEAD") {
    return {
      status: "skipped",
      remote: null,
      branch: branch || null,
      message: "Detached HEAD 或无法识别当前分支，已跳过。"
    } as const;
  }

  const normalizedRepoName = normalizeRepoName(input.projectName);
  const desiredRemoteUrl = `https://github.com/${input.owner}/${normalizedRepoName}.git`;
  const originUrl = (await safeRunGit(input.repoPath, ["remote", "get-url", "origin"])) || "";
  const parsedOrigin = parseGithubRemote(originUrl);
  let pushRemote = "origin";

  if (input.dryRun) {
    const routeHint =
      !originUrl
        ? "将创建 origin 并推送"
        : parsedOrigin?.owner.toLowerCase() === input.owner.toLowerCase() && parsedOrigin.repo === normalizedRepoName
        ? "将推送到 origin"
        : `将推送到 ${BACKUP_REMOTE}`;
    return {
      status: "skipped",
      remote: originUrl ? "origin" : null,
      branch,
      message: `dry-run: ${routeHint} -> ${desiredRemoteUrl}`
    } as const;
  }

  if (!originUrl) {
    await ensureGithubRepoExists(input.owner, normalizedRepoName, input.token, input.privateByDefault);
    await runGit(input.repoPath, ["remote", "add", "origin", desiredRemoteUrl]);
  } else if (parsedOrigin?.owner.toLowerCase() !== input.owner.toLowerCase() || parsedOrigin.repo !== normalizedRepoName) {
    await ensureGithubRepoExists(input.owner, normalizedRepoName, input.token, input.privateByDefault);
    const backupExisting = await safeRunGit(input.repoPath, ["remote", "get-url", BACKUP_REMOTE]);
    if (backupExisting) {
      await runGit(input.repoPath, ["remote", "set-url", BACKUP_REMOTE, desiredRemoteUrl]);
    } else {
      await runGit(input.repoPath, ["remote", "add", BACKUP_REMOTE, desiredRemoteUrl]);
    }
    pushRemote = BACKUP_REMOTE;
  }

  if (input.token) {
    await runGit(input.repoPath, ["push", "-u", authPushUrl(input.owner, normalizedRepoName, input.token), `${branch}:${branch}`]);
  } else {
    await runGit(input.repoPath, ["push", "-u", pushRemote, branch]);
  }

  return {
    status: "synced",
    remote: pushRemote,
    branch,
    message: pushRemote === "origin" ? "已同步到 origin。" : `已同步到 ${pushRemote}。`
  } as const;
}

export async function POST(request: Request) {
  try {
    let dryRun = false;
    try {
      const body = (await request.json()) as { dryRun?: unknown };
      dryRun = body?.dryRun === true;
    } catch {
      dryRun = false;
    }

    const githubRoot = await resolveGithubRoot();
    const owner = (process.env.OWNER_LOGIN || "LiDeChi").trim();
    const token = (process.env.GITHUB_TOKEN || "").trim();
    const privateByDefault = (process.env.GITHUB_SYNC_PRIVATE || "true").toLowerCase() !== "false";
    const repos = await listWorkspaceRepos(githubRoot);

    const results: RepoSyncResult[] = [];
    for (const repo of repos) {
      try {
        const synced = await syncSingleRepo({
          repoPath: repo.repoPath,
          projectName: repo.name,
          owner,
          token,
          privateByDefault,
          dryRun
        });
        results.push({
          name: repo.name,
          repoPath: repo.repoPath,
          status: synced.status,
          remote: synced.remote,
          branch: synced.branch,
          message: synced.message
        });
      } catch (error) {
        results.push({
          name: repo.name,
          repoPath: repo.repoPath,
          status: "failed",
          remote: null,
          branch: null,
          message: toErrorMessage(error)
        });
      }
    }

    const summary = {
      total: results.length,
      synced: results.filter((item) => item.status === "synced").length,
      failed: results.filter((item) => item.status === "failed").length,
      skipped: results.filter((item) => item.status === "skipped").length
    };

    return NextResponse.json({
      ok: true,
      githubRoot,
      owner,
      dryRun,
      summary,
      results
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
