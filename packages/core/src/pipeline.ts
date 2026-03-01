import path from "node:path";
import {
  closeDb,
  enums,
  finishSyncRun,
  getAllTrackedProjectsForExport,
  getProjects,
  getLatestSnapshotsByProject,
  startSyncRun,
  upsertDailyReport,
  upsertProjects,
  createSnapshots,
  replaceRelations
} from "@center/db";
import { loadConfig, getLocalDateKey } from "./config";
import { writePortfolioExport, writeProjectInventoryExport } from "./exporter";
import { fetchGithubMetadata } from "./github";
import { buildRelations } from "./relations";
import { buildDailyReportDraft, writeReportMarkdown } from "./report";
import { scanGithubWorkspace } from "./scanner";
import { computeActivityScore } from "./scoring";
import type { ScoredProject } from "./types";

function inferCoverHint(project: { name: string; tags: string[]; techStack: string[] }) {
  const tokens = [...project.tags, ...project.techStack].map((token) => token.toLowerCase());
  if (tokens.includes("manim") || tokens.includes("video")) {
    return "animation";
  }
  if (tokens.includes("notion") || tokens.includes("notes")) {
    return "knowledge";
  }
  if (tokens.includes("dashboard") || tokens.includes("monitor")) {
    return "dashboard";
  }
  if (tokens.includes("chrome") || tokens.includes("extension")) {
    return "extension";
  }
  return "project";
}

export type SyncResult = {
  syncRunId: string;
  projectCount: number;
  trackedCount: number;
  externalCount: number;
  relationCount: number;
  reportDate: string;
  reportPath: string;
  exportPath: string;
  inventoryJsonPath: string;
  inventoryMarkdownPath: string;
};

export async function runSyncPipeline(): Promise<SyncResult> {
  const config = loadConfig();
  const syncRun = await startSyncRun();

  try {
    const scannedProjects = await scanGithubWorkspace(config.githubRoot, config.ownerLogin);

    const enrichedProjects: ScoredProject[] = [];
    for (const project of scannedProjects) {
      const githubMeta = await fetchGithubMetadata(project, config.githubToken);
      const activityScore = computeActivityScore({
        commitCount7d: project.commitCount7d,
        commitCount30d: project.commitCount30d,
        lastCommitAt: project.lastCommitAt,
        dirtyWorkingTree: project.dirtyWorkingTree,
        stars: githubMeta.stars
      });

      enrichedProjects.push({
        ...project,
        ...githubMeta,
        activityScore,
        coverHint: inferCoverHint(project),
        demoUrl: null
      });
    }

    const upserted = await upsertProjects(
      enrichedProjects.map((project) => ({
        name: project.name,
        slug: project.slug,
        repoPath: project.repoPath,
        remoteUrl: project.remoteUrl,
        remoteOwner: project.remoteOwner,
        remoteName: project.remoteName,
        scope: project.scope,
        visibilityType: project.visibilityType,
        summary: project.summary,
        techStack: project.techStack,
        tags: project.tags,
        activityScore: project.activityScore,
        lastCommitAt: project.lastCommitAt,
        commitCount7d: project.commitCount7d,
        commitCount30d: project.commitCount30d,
        dirtyWorkingTree: project.dirtyWorkingTree,
        stars: project.stars,
        forks: project.forks,
        openIssues: project.openIssues,
        openPrs: project.openPrs,
        defaultBranch: project.defaultBranch,
        latestReleaseTag: project.latestReleaseTag,
        latestReleaseAt: project.latestReleaseAt,
        coverHint: project.coverHint,
        demoUrl: project.demoUrl,
        readmePath: project.readmePath,
        readmePreview: project.readmePreview,
        readmeLinks: project.readmeLinks,
        instructionFiles: project.instructionFiles,
        localStartCommand: project.localStartCommand,
        productionUrl: project.productionUrl,
        hasClaudeLikeInstruction: project.hasClaudeLikeInstruction,
        sourceUrl: project.sourceUrl
      }))
    );

    const slugToId = new Map(upserted.map((row) => [row.slug, row.id]));
    const previousSnapshotMap = new Map<
      string,
      {
        projectSlug: string;
        previousCommitCount7d: number;
        previousActivityScore: number;
      }
    >();

    for (const project of enrichedProjects) {
      const projectId = slugToId.get(project.slug);
      if (!projectId) {
        continue;
      }
      const snapshots = await getLatestSnapshotsByProject(projectId, 1);
      if (snapshots.length > 0) {
        previousSnapshotMap.set(project.slug, {
          projectSlug: project.slug,
          previousCommitCount7d: snapshots[0].commitCount7d,
          previousActivityScore: snapshots[0].activityScore
        });
      }
    }

    const relations = await buildRelations(enrichedProjects, {
      llmBaseUrl: config.llmBaseUrl,
      llmApiKey: config.llmApiKey,
      llmModel: config.llmModel
    });

    await replaceRelations(relations);

    const snapshotRows: { id: string; activityScore: number; commitCount7d: number; commitCount30d: number; lastCommitAt: Date | null }[] = [];
    for (const project of enrichedProjects) {
      const id = slugToId.get(project.slug);
      if (!id) {
        continue;
      }
      snapshotRows.push({
        id,
        activityScore: project.activityScore,
        commitCount7d: project.commitCount7d,
        commitCount30d: project.commitCount30d,
        lastCommitAt: project.lastCommitAt
      });
    }

    await createSnapshots(syncRun.id, snapshotRows);

    const date = getLocalDateKey(new Date(), config.timezone);
    const reportDraft = buildDailyReportDraft({
      date,
      projects: enrichedProjects,
      relations,
      previousSnapshotMap
    });

    const reportPath = await writeReportMarkdown(config.reportsDir, reportDraft);

    await upsertDailyReport({
      date: reportDraft.date,
      highlights: reportDraft.highlights,
      newlyActive: reportDraft.newlyActive,
      coolingDown: reportDraft.coolingDown,
      relationFindings: reportDraft.relationFindings,
      portfolioUpdates: reportDraft.portfolioUpdates,
      markdownPath: reportPath
    });

    const trackedForExport = await getAllTrackedProjectsForExport();
    const exportPath = await writePortfolioExport(
      config.exportsDir,
      trackedForExport.map((project) => ({
        id: project.id,
        name: project.name,
        slug: project.slug,
        repoPath: project.repoPath,
        remoteUrl: project.remoteUrl,
        visibilityType: project.visibilityType,
        summary: project.summary,
        techStack: Array.isArray(project.techStack) ? (project.techStack as string[]) : [],
        tags: Array.isArray(project.tags) ? (project.tags as string[]) : [],
        activityScore: project.activityScore,
        lastCommitAt: project.lastCommitAt ? project.lastCommitAt.toISOString() : null,
        commitCount7d: project.commitCount7d,
        commitCount30d: project.commitCount30d,
        stars: project.stars,
        openIssues: project.openIssues,
        openPrs: project.openPrs,
        relationCount: project.relationsFrom.length,
        topRelations: project.relationsFrom.map((relation) => ({
          slug: relation.relatedProject.slug,
          name: relation.relatedProject.name,
          score: relation.score,
          type: relation.type,
          evidence: relation.evidence,
          explanation: relation.explanation
        })),
        coverHint: project.coverHint,
        demoUrl: project.demoUrl,
        sourceUrl: project.sourceUrl,
        readmePath: project.readmePath,
        readmePreview: project.readmePreview,
        readmeLinks: project.readmeLinks,
        instructionFiles: project.instructionFiles,
        localStartCommand: project.localStartCommand,
        productionUrl: project.productionUrl,
        hasClaudeLikeInstruction: project.hasClaudeLikeInstruction,
        scope: project.scope
      }))
    );
    const allForInventory = await getProjects("all");
    const inventoryExport = await writeProjectInventoryExport(config.exportsDir, allForInventory);

    const trackedCount = enrichedProjects.filter((project) => project.scope === "tracked").length;
    const externalCount = enrichedProjects.filter((project) => project.scope === "external").length;

    await finishSyncRun(syncRun.id, {
      status: enums.SyncRunStatus.success,
      message: "sync completed",
      projectCount: enrichedProjects.length,
      trackedCount,
      externalCount,
      relationCount: relations.length
    });

    return {
      syncRunId: syncRun.id,
      projectCount: enrichedProjects.length,
      trackedCount,
      externalCount,
      relationCount: relations.length,
      reportDate: reportDraft.date,
      reportPath,
      exportPath,
      inventoryJsonPath: inventoryExport.jsonPath,
      inventoryMarkdownPath: inventoryExport.markdownPath
    };
  } catch (error) {
    await finishSyncRun(syncRun.id, {
      status: enums.SyncRunStatus.failed,
      message: error instanceof Error ? error.message : "unknown error",
      projectCount: 0,
      trackedCount: 0,
      externalCount: 0,
      relationCount: 0
    });

    throw error;
  } finally {
    if (process.env.NODE_ENV === "test") {
      await closeDb();
    }
  }
}
