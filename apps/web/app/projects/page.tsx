import fs from "node:fs/promises";
import path from "node:path";
import { ProjectWorkbench, type WorkbenchProject } from "../../components/project-workbench";
import { queryProjects } from "../../lib/queries";

export const dynamic = "force-dynamic";

type ProjectRow = Awaited<ReturnType<typeof queryProjects>>[number];

async function pathExists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
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

  return candidates[0];
}

async function getCardScreenshotMap(projectIds: string[]) {
  const dataRoot = await resolveDataRoot();
  const pairs = await Promise.all(
    projectIds.map(async (projectId): Promise<[string, string | null]> => {
      const screenshotDir = path.join(dataRoot, "screenshots", projectId);
      const entries = await fs.readdir(screenshotDir, { withFileTypes: true }).catch(() => []);
      const imageNames = entries
        .filter((entry) => entry.isFile() && /\.(png|jpg|jpeg|webp)$/i.test(entry.name))
        .map((entry) => entry.name);
      if (imageNames.length === 0) {
        return [projectId, null];
      }

      const withStats = await Promise.all(
        imageNames.map(async (fileName) => {
          const filePath = path.join(screenshotDir, fileName);
          const stat = await fs.stat(filePath).catch(() => null);
          return {
            fileName,
            mtimeMs: stat?.mtimeMs || 0
          };
        })
      );
      withStats.sort((left, right) => right.mtimeMs - left.mtimeMs || left.fileName.localeCompare(right.fileName));
      const best = withStats[0]?.fileName;
      if (!best) {
        return [projectId, null];
      }
      return [projectId, `/api/projects/${projectId}/screenshots/${encodeURIComponent(best)}`];
    })
  );

  return new Map(pairs);
}

function toProjectView(project: ProjectRow, cardScreenshotUrl: string | null): WorkbenchProject {
  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    repoPath: project.repoPath,
    summary: project.summary,
    scope: project.scope,
    visibilityType: project.visibilityType,
    activityScore: project.activityScore,
    relationCount: project.relationCount,
    commitCount7d: project.commitCount7d,
    commitCount30d: project.commitCount30d,
    lastCommitAt: project.lastCommitAt,
    updatedAt: project.updatedAt,
    localStartCommand: (project.localStartCommand || "").trim() || "未自动识别，请查看 README",
    productionUrl: project.productionUrl || project.demoUrl || null,
    sourceUrl: project.sourceUrl || project.remoteUrl || null,
    coverHint: project.coverHint || null,
    techStack: project.techStack,
    topRelations: project.topRelations,
    readmePreview: (project.readmePreview || "").trim() || "未检测到 README 内容",
    cardScreenshotUrl
  };
}

export default async function ProjectsPage() {
  const projects = await queryProjects("all", "activity");
  const screenshotMap = await getCardScreenshotMap(projects.map((project) => project.id));
  const projectViews = projects.map((project) => toProjectView(project, screenshotMap.get(project.id) || null));

  return <ProjectWorkbench projects={projectViews} />;
}
