import { describe, expect, it } from "vitest";
import { buildRelations } from "../relations";
import type { ScoredProject } from "../types";

const baseProject: Omit<ScoredProject, "name" | "slug" | "repoPath" | "summary" | "techStack" | "tags"> = {
  remoteUrl: null,
  remoteOwner: null,
  remoteName: null,
  scope: "tracked",
  visibilityType: "local",
  currentBranch: "main",
  lastCommitAt: new Date(),
  commitCount7d: 3,
  commitCount30d: 10,
  dirtyWorkingTree: false,
  fileCountEstimate: 100,
  readmePath: null,
  readmePreview: null,
  readmeLinks: [],
  instructionFiles: [],
  localStartCommand: "npm run dev",
  productionUrl: null,
  hasClaudeLikeInstruction: false,
  sourceUrl: null,
  stars: 0,
  forks: 0,
  openIssues: 0,
  openPrs: 0,
  defaultBranch: "main",
  latestReleaseTag: null,
  latestReleaseAt: null,
  activityScore: 72,
  coverHint: null,
  demoUrl: null
};

describe("buildRelations", () => {
  it("creates directional relations for related tracked projects", async () => {
    const projects: ScoredProject[] = [
      {
        ...baseProject,
        name: "project-a",
        slug: "project-a",
        repoPath: "/tmp/project-a",
        summary: "a",
        techStack: ["nodejs", "react", "next"],
        tags: ["dashboard", "monitor"]
      },
      {
        ...baseProject,
        name: "project-b",
        slug: "project-b",
        repoPath: "/tmp/project-b",
        summary: "b",
        techStack: ["nodejs", "react", "typescript"],
        tags: ["dashboard", "analytics"]
      }
    ];

    const relations = await buildRelations(projects, {
      llmBaseUrl: "",
      llmApiKey: "",
      llmModel: ""
    });

    expect(relations.length).toBe(2);
    expect(relations[0].projectSlug).toBe("project-a");
    expect(relations[1].projectSlug).toBe("project-b");
    expect(relations[0].score).toBeGreaterThanOrEqual(0.25);
    expect(relations[0].evidence.some((line) => line.startsWith("共享库:"))).toBe(true);
  });
});
