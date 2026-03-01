import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { classifyProject, slugifyProjectName } from "./classification";
import {
  estimateFileCount,
  inferHasClaudeLikeInstruction,
  inferInstructionFiles,
  inferLocalStartCommand,
  inferProductionUrl,
  inferReadmeMetadata,
  inferSummaryAndTags,
  inferTechStack
} from "./stack";
import type { LocalProjectScan } from "./types";

const execFileAsync = promisify(execFile);

async function runGit(repoPath: string, args: string[]) {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: repoPath,
      maxBuffer: 1024 * 1024
    });
    return stdout.trim();
  } catch {
    return "";
  }
}

async function hasGitDir(repoPath: string) {
  try {
    const stat = await fs.stat(path.join(repoPath, ".git"));
    return stat.isDirectory() || stat.isFile();
  } catch {
    return false;
  }
}

export async function scanGithubWorkspace(githubRoot: string, ownerLogin: string) {
  const entries = await fs.readdir(githubRoot, { withFileTypes: true });
  const projects: LocalProjectScan[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const repoPath = path.join(githubRoot, entry.name);
    if (!(await hasGitDir(repoPath))) {
      continue;
    }

    const remoteUrlOutput = await runGit(repoPath, ["remote", "get-url", "origin"]);
    const remoteUrl = remoteUrlOutput || null;
    const classification = classifyProject(remoteUrl, ownerLogin);

    const [
      branch,
      lastCommitISO,
      commitCount7dRaw,
      commitCount30dRaw,
      statusOutput,
      techStack,
      summaryAndTags,
      fileCountEstimate,
      readmeMetadata,
      instructionFiles,
      localStartCommand
    ] =
      await Promise.all([
        runGit(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]),
        runGit(repoPath, ["log", "-1", "--format=%cI"]),
        runGit(repoPath, ["rev-list", "--count", '--since=7 days ago', "HEAD"]),
        runGit(repoPath, ["rev-list", "--count", '--since=30 days ago', "HEAD"]),
        runGit(repoPath, ["status", "--porcelain"]),
        inferTechStack(repoPath),
        inferSummaryAndTags(repoPath, entry.name),
        estimateFileCount(repoPath),
        inferReadmeMetadata(repoPath),
        inferInstructionFiles(repoPath),
        inferLocalStartCommand(repoPath)
      ]);

    const productionUrl = inferProductionUrl(readmeMetadata.readmeLinks, remoteUrl);
    const hasClaudeLikeInstruction = inferHasClaudeLikeInstruction(instructionFiles);

    projects.push({
      name: entry.name,
      slug: slugifyProjectName(entry.name),
      repoPath,
      remoteUrl,
      remoteOwner: classification.owner,
      remoteName: classification.repo,
      scope: classification.scope,
      visibilityType: classification.visibilityType,
      currentBranch: branch || null,
      lastCommitAt: lastCommitISO ? new Date(lastCommitISO) : null,
      commitCount7d: Number.parseInt(commitCount7dRaw || "0", 10) || 0,
      commitCount30d: Number.parseInt(commitCount30dRaw || "0", 10) || 0,
      dirtyWorkingTree: Boolean(statusOutput),
      summary: summaryAndTags.summary,
      techStack,
      tags: summaryAndTags.tags,
      fileCountEstimate,
      readmePath: readmeMetadata.readmePath,
      readmePreview: readmeMetadata.readmePreview,
      readmeLinks: readmeMetadata.readmeLinks,
      instructionFiles,
      localStartCommand,
      productionUrl,
      hasClaudeLikeInstruction,
      sourceUrl: remoteUrl
    });
  }

  return projects;
}
