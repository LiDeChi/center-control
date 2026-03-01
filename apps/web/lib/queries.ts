import { getDashboardSummary, getProjectById, getProjects, getRelations, getReportByDate, getReports } from "@center/db";

export type ProjectSort = "activity" | "updatedAt" | "relationScore";

function toArrayString(data: unknown): string[] {
  if (!Array.isArray(data)) {
    return [];
  }
  return data.map((item) => String(item));
}

export async function queryProjects(scope: "tracked" | "external" | "all", sort: ProjectSort = "activity") {
  const rows = await getProjects(scope === "all" ? "all" : scope);

  const mapped = rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    repoPath: row.repoPath,
    remoteUrl: row.remoteUrl,
    visibilityType: row.visibilityType,
    summary: row.summary,
    techStack: toArrayString(row.techStack),
    tags: toArrayString(row.tags),
    activityScore: row.activityScore,
    lastCommitAt: row.lastCommitAt?.toISOString() || null,
    commitCount7d: row.commitCount7d,
    commitCount30d: row.commitCount30d,
    stars: row.stars,
    openIssues: row.openIssues,
    openPrs: row.openPrs,
    relationCount: row.relationsFrom.length,
    topRelations: row.relationsFrom.map((relation) => ({
      slug: relation.relatedProject.slug,
      name: relation.relatedProject.name,
      score: relation.score,
      type: relation.type,
      evidence: toArrayString(relation.evidence),
      explanation: relation.explanation
    })),
    coverHint: row.coverHint,
    demoUrl: row.demoUrl,
    sourceUrl: row.sourceUrl,
    readmePath: row.readmePath,
    readmePreview: row.readmePreview,
    readmeLinks: toArrayString(row.readmeLinks),
    instructionFiles: toArrayString(row.instructionFiles),
    localStartCommand: row.localStartCommand,
    productionUrl: row.productionUrl,
    hasClaudeLikeInstruction: row.hasClaudeLikeInstruction,
    scope: row.scope,
    updatedAt: row.updatedAt.toISOString()
  }));

  if (sort === "updatedAt") {
    mapped.sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1));
  }

  if (sort === "relationScore") {
    mapped.sort((a, b) => b.relationCount - a.relationCount || b.activityScore - a.activityScore);
  }

  return mapped;
}

export async function queryProjectById(projectId: string) {
  const row = await getProjectById(projectId);
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    repoPath: row.repoPath,
    remoteUrl: row.remoteUrl,
    visibilityType: row.visibilityType,
    summary: row.summary,
    techStack: toArrayString(row.techStack),
    tags: toArrayString(row.tags),
    activityScore: row.activityScore,
    lastCommitAt: row.lastCommitAt?.toISOString() || null,
    commitCount7d: row.commitCount7d,
    commitCount30d: row.commitCount30d,
    stars: row.stars,
    openIssues: row.openIssues,
    openPrs: row.openPrs,
    relationCount: row.relationsFrom.length + row.relationsTo.length,
    coverHint: row.coverHint,
    demoUrl: row.demoUrl,
    sourceUrl: row.sourceUrl,
    readmePath: row.readmePath,
    readmePreview: row.readmePreview,
    readmeLinks: toArrayString(row.readmeLinks),
    instructionFiles: toArrayString(row.instructionFiles),
    localStartCommand: row.localStartCommand,
    productionUrl: row.productionUrl,
    hasClaudeLikeInstruction: row.hasClaudeLikeInstruction,
    scope: row.scope,
    relations: [
      ...row.relationsFrom.map((relation) => ({
        direction: "outgoing",
        target: relation.relatedProject,
        type: relation.type,
        score: relation.score,
        evidence: relation.evidence,
        explanation: relation.explanation
      })),
      ...row.relationsTo.map((relation) => ({
        direction: "incoming",
        target: relation.project,
        type: relation.type,
        score: relation.score,
        evidence: relation.evidence,
        explanation: relation.explanation
      }))
    ]
  };
}

export async function queryRelations(projectId?: string) {
  const rows = await getRelations(projectId);
  return rows.map((row) => ({
    id: row.id,
    project: row.project,
    relatedProject: row.relatedProject,
    type: row.type,
    score: row.score,
    evidence: toArrayString(row.evidence),
    explanation: row.explanation,
    updatedAt: row.updatedAt.toISOString()
  }));
}

export async function queryReports(limit = 30) {
  const rows = await getReports(limit);
  return rows.map((row) => ({
    id: row.id,
    date: row.date,
    highlights: toArrayString(row.highlights),
    newlyActive: toArrayString(row.newlyActive),
    coolingDown: toArrayString(row.coolingDown),
    relationFindings: toArrayString(row.relationFindings),
    portfolioUpdates: toArrayString(row.portfolioUpdates),
    markdownPath: row.markdownPath,
    generatedAt: row.generatedAt.toISOString()
  }));
}

export async function queryReportByDate(date: string) {
  const row = await getReportByDate(date);
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    date: row.date,
    highlights: toArrayString(row.highlights),
    newlyActive: toArrayString(row.newlyActive),
    coolingDown: toArrayString(row.coolingDown),
    relationFindings: toArrayString(row.relationFindings),
    portfolioUpdates: toArrayString(row.portfolioUpdates),
    markdownPath: row.markdownPath,
    generatedAt: row.generatedAt.toISOString()
  };
}

export async function queryDashboard() {
  const summary = await getDashboardSummary();
  return {
    trackedCount: summary.trackedCount,
    externalCount: summary.externalCount,
    reportsCount: summary.reportsCount,
    latestReport: summary.latestReport
      ? {
          date: summary.latestReport.date,
          highlights: toArrayString(summary.latestReport.highlights)
        }
      : null,
    hotProjects: summary.hotProjects
  };
}
