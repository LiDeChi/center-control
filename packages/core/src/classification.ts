import type { ProjectScope, VisibilityType } from "@center/db";

const GITHUB_REMOTE_RE = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/i;

export type RemoteParseResult = {
  owner: string | null;
  repo: string | null;
};

export function parseGithubRemote(remoteUrl: string | null): RemoteParseResult {
  if (!remoteUrl) {
    return { owner: null, repo: null };
  }

  const match = remoteUrl.match(GITHUB_REMOTE_RE);
  if (!match) {
    return { owner: null, repo: null };
  }

  return {
    owner: match[1],
    repo: match[2]
  };
}

export function classifyProject(remoteUrl: string | null, ownerLogin: string): { scope: ProjectScope; visibilityType: VisibilityType; owner: string | null; repo: string | null } {
  const parsed = parseGithubRemote(remoteUrl);
  if (!remoteUrl || !parsed.owner) {
    return {
      scope: "tracked",
      visibilityType: "local",
      owner: parsed.owner,
      repo: parsed.repo
    };
  }

  if (parsed.owner.toLowerCase() === ownerLogin.toLowerCase()) {
    return {
      scope: "tracked",
      visibilityType: "github",
      owner: parsed.owner,
      repo: parsed.repo
    };
  }

  return {
    scope: "external",
    visibilityType: "github",
    owner: parsed.owner,
    repo: parsed.repo
  };
}

export function slugifyProjectName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "project";
}
