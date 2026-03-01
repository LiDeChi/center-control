import fs from "node:fs/promises";
import path from "node:path";
import type { DailyReportDraft, RelationCandidate, ScoredProject } from "./types";

type SnapshotEntry = {
  projectSlug: string;
  previousCommitCount7d: number;
  previousActivityScore: number;
};

function topN<T>(items: T[], n: number) {
  return items.slice(0, n);
}

export function buildDailyReportDraft(input: {
  date: string;
  projects: ScoredProject[];
  relations: RelationCandidate[];
  previousSnapshotMap: Map<string, SnapshotEntry>;
}): DailyReportDraft {
  const tracked = input.projects.filter((project) => project.scope === "tracked");

  const sortedByActivity = [...tracked].sort((a, b) => b.activityScore - a.activityScore);
  const highlights = topN(
    sortedByActivity.map(
      (project) =>
        `${project.name} 活跃度 ${project.activityScore}（7天 ${project.commitCount7d} 次提交，30天 ${project.commitCount30d} 次）`
    ),
    6
  );

  const newlyActive = topN(
    sortedByActivity
      .filter((project) => {
        const prev = input.previousSnapshotMap.get(project.slug);
        return project.commitCount7d > 0 && (!prev || prev.previousCommitCount7d === 0);
      })
      .map((project) => `${project.name} 从低活跃恢复，本周已有 ${project.commitCount7d} 次提交`),
    5
  );

  const coolingDown = topN(
    sortedByActivity
      .filter((project) => {
        const prev = input.previousSnapshotMap.get(project.slug);
        return prev !== undefined && prev.previousCommitCount7d > 0 && project.commitCount7d === 0;
      })
      .map((project) => {
        const prev = input.previousSnapshotMap.get(project.slug);
        if (!prev) {
          return `${project.name} 活跃度下降，需复查`; 
        }
        return `${project.name} 活跃度从 ${prev.previousActivityScore} 降至 ${project.activityScore}`;
      }),
    5
  );

  const relationFindings = topN(
    [...input.relations]
      .sort((a, b) => b.score - a.score)
      .map((relation) => `${relation.projectSlug} -> ${relation.relatedProjectSlug} (${relation.type}, ${relation.score.toFixed(2)})`),
    8
  );

  const portfolioUpdates = topN(
    sortedByActivity.map(
      (project) =>
        `${project.name}：技术栈 ${project.techStack.slice(0, 4).join(", ") || "N/A"}；摘要 ${project.summary.slice(0, 70)}`
    ),
    6
  );

  const markdown = renderReportMarkdown({
    date: input.date,
    highlights,
    newlyActive,
    coolingDown,
    relationFindings,
    portfolioUpdates
  });

  return {
    date: input.date,
    highlights,
    newlyActive,
    coolingDown,
    relationFindings,
    portfolioUpdates,
    markdown
  };
}

function renderSection(title: string, items: string[]) {
  if (!items.length) {
    return `## ${title}\n\n- 暂无\n`;
  }

  return `## ${title}\n\n${items.map((item) => `- ${item}`).join("\n")}\n`;
}

export function renderReportMarkdown(report: Omit<DailyReportDraft, "markdown">) {
  const blocks = [
    `# Center Control 每日项目简报 (${report.date})`,
    "",
    renderSection("今日重点", report.highlights),
    renderSection("新近活跃项目", report.newlyActive),
    renderSection("降温项目", report.coolingDown),
    renderSection("项目关联发现", report.relationFindings),
    renderSection("个人网站展示候选更新", report.portfolioUpdates)
  ];

  return blocks.join("\n");
}

export async function writeReportMarkdown(baseDir: string, report: DailyReportDraft) {
  await fs.mkdir(baseDir, { recursive: true });
  const filePath = path.join(baseDir, `${report.date}.md`);
  await fs.writeFile(filePath, report.markdown, "utf-8");
  return filePath;
}
