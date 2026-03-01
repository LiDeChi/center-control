import type { GithubMetadata, LocalProjectScan } from "./types";

const EMPTY_METADATA: GithubMetadata = {
  stars: 0,
  forks: 0,
  openIssues: 0,
  openPrs: 0,
  defaultBranch: null,
  latestReleaseTag: null,
  latestReleaseAt: null
};

async function requestGithub<T>(path: string, token: string) {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "center-control"
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`https://api.github.com${path}`, { headers });
  if (!response.ok) {
    throw new Error(`GitHub API ${path} failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function fetchGithubMetadata(project: LocalProjectScan, token: string): Promise<GithubMetadata> {
  if (!project.remoteOwner || !project.remoteName) {
    return EMPTY_METADATA;
  }

  try {
    const repo = await requestGithub<{
      stargazers_count: number;
      forks_count: number;
      open_issues_count: number;
      default_branch: string;
    }>(`/repos/${project.remoteOwner}/${project.remoteName}`, token);

    const [pulls, latestRelease] = await Promise.all([
      requestGithub<Array<{ id: number }>>(
        `/repos/${project.remoteOwner}/${project.remoteName}/pulls?state=open&per_page=50`,
        token
      ).catch(() => []),
      requestGithub<{ tag_name: string; published_at: string }>(
        `/repos/${project.remoteOwner}/${project.remoteName}/releases/latest`,
        token
      ).catch(() => null)
    ]);

    return {
      stars: repo.stargazers_count || 0,
      forks: repo.forks_count || 0,
      openIssues: repo.open_issues_count || 0,
      openPrs: Array.isArray(pulls) ? pulls.length : 0,
      defaultBranch: repo.default_branch || null,
      latestReleaseTag: latestRelease?.tag_name || null,
      latestReleaseAt: latestRelease?.published_at ? new Date(latestRelease.published_at) : null
    };
  } catch {
    return EMPTY_METADATA;
  }
}
