import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { queryProjectById } from "../../../../../lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 12_000;

type CommitRow = {
  hash: string;
  shortHash: string;
  date: string;
  subject: string;
  author: string;
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

async function runGit(repoPath: string, args: string[]) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: repoPath,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 1024 * 1024
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

function parseAheadBehind(raw: string) {
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length !== 2) {
    return {
      ahead: 0,
      behind: 0
    };
  }

  const behind = Number.parseInt(parts[0] || "0", 10) || 0;
  const ahead = Number.parseInt(parts[1] || "0", 10) || 0;
  return {
    ahead,
    behind
  };
}

function inferSyncState(input: { hasRemote: boolean; upstream: string | null; ahead: number; behind: number }) {
  if (!input.hasRemote) {
    return "local-only";
  }
  if (!input.upstream) {
    return "no-upstream";
  }
  if (input.ahead === 0 && input.behind === 0) {
    return "synced";
  }
  if (input.ahead > 0 && input.behind === 0) {
    return "ahead";
  }
  if (input.ahead === 0 && input.behind > 0) {
    return "behind";
  }
  return "diverged";
}

async function readGitInfo(repoPath: string, hasRemote: boolean) {
  const branch = (await safeRunGit(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"])) || null;
  const upstream = (await safeRunGit(repoPath, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"])) || null;
  const aheadBehindRaw = upstream ? await safeRunGit(repoPath, ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]) : "";
  const { ahead, behind } = parseAheadBehind(aheadBehindRaw);
  const syncState = inferSyncState({ hasRemote, upstream, ahead, behind });

  const commitsRaw = await safeRunGit(
    repoPath,
    ["log", "--date=iso-strict", "--pretty=format:%H%x09%h%x09%ad%x09%s%x09%an", "-n", "40"]
  );
  const commits: CommitRow[] = commitsRaw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [hash, shortHash, date, subject, author] = line.split("\t");
      return {
        hash: hash || "",
        shortHash: shortHash || "",
        date: date || "",
        subject: subject || "(no subject)",
        author: author || "unknown"
      };
    })
    .filter((commit) => Boolean(commit.hash));

  return {
    branch,
    upstream,
    ahead,
    behind,
    syncState,
    hasRemote,
    commits
  };
}

async function resolveProjectRepo(projectId: string) {
  const project = await queryProjectById(projectId);
  if (!project) {
    throw new HttpError(404, "Project not found");
  }

  const repoPath = await resolveAllowedRepoPath(project.repoPath);
  const hasRemote = Boolean(project.remoteUrl);

  return {
    project,
    repoPath,
    hasRemote
  };
}

async function readPayload(projectId: string, syncRemote: boolean) {
  const { project, repoPath, hasRemote } = await resolveProjectRepo(projectId);

  if (syncRemote && hasRemote) {
    await safeRunGit(repoPath, ["fetch", "--all", "--prune"]);
  }

  const gitInfo = await readGitInfo(repoPath, hasRemote);
  return {
    ok: true,
    projectId: project.id,
    remoteUrl: project.remoteUrl,
    fetchedAt: new Date().toISOString(),
    ...gitInfo
  };
}

export async function GET(_: Request, context: { params: { id: string } }) {
  try {
    return NextResponse.json(await readPayload(context.params.id, false));
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

export async function POST(_: Request, context: { params: { id: string } }) {
  try {
    return NextResponse.json(await readPayload(context.params.id, true));
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
