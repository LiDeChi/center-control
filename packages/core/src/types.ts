import type { ProjectScope, RelationType, VisibilityType } from "@center/db";

export type LocalProjectScan = {
  name: string;
  slug: string;
  repoPath: string;
  remoteUrl: string | null;
  remoteOwner: string | null;
  remoteName: string | null;
  scope: ProjectScope;
  visibilityType: VisibilityType;
  currentBranch: string | null;
  lastCommitAt: Date | null;
  commitCount7d: number;
  commitCount30d: number;
  dirtyWorkingTree: boolean;
  summary: string;
  techStack: string[];
  tags: string[];
  fileCountEstimate: number;
  readmePath: string | null;
  readmePreview: string | null;
  readmeLinks: string[];
  instructionFiles: string[];
  localStartCommand: string | null;
  productionUrl: string | null;
  hasClaudeLikeInstruction: boolean;
  sourceUrl: string | null;
};

export type GithubMetadata = {
  stars: number;
  forks: number;
  openIssues: number;
  openPrs: number;
  defaultBranch: string | null;
  latestReleaseTag: string | null;
  latestReleaseAt: Date | null;
};

export type ScoredProject = LocalProjectScan &
  GithubMetadata & {
    activityScore: number;
    coverHint: string | null;
    demoUrl: string | null;
  };

export type RelationCandidate = {
  projectSlug: string;
  relatedProjectSlug: string;
  type: RelationType;
  score: number;
  evidence: string[];
  explanation: string;
};

export type DailyReportDraft = {
  date: string;
  highlights: string[];
  newlyActive: string[];
  coolingDown: string[];
  relationFindings: string[];
  portfolioUpdates: string[];
  markdown: string;
};

export type SyncOptions = {
  githubRoot: string;
  ownerLogin: string;
  reportTime: string;
  reportsDir: string;
  exportsDir: string;
};
