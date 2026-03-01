import { closeDbConnection, createId, getDb } from "./client";

export type ProjectScope = "tracked" | "external";
export type VisibilityType = "local" | "github";
export type RelationType = "theme_similarity" | "tech_overlap" | "workflow_dependency" | "timeline_cluster";
export type SyncRunStatus = "success" | "failed";

export type ProjectUpsertInput = {
  name: string;
  slug: string;
  repoPath: string;
  remoteUrl?: string | null;
  remoteOwner?: string | null;
  remoteName?: string | null;
  scope: ProjectScope;
  visibilityType: VisibilityType;
  summary: string;
  techStack: string[];
  tags: string[];
  activityScore: number;
  lastCommitAt?: Date | null;
  commitCount7d: number;
  commitCount30d: number;
  dirtyWorkingTree: boolean;
  stars: number;
  forks: number;
  openIssues: number;
  openPrs: number;
  defaultBranch?: string | null;
  latestReleaseTag?: string | null;
  latestReleaseAt?: Date | null;
  coverHint?: string | null;
  demoUrl?: string | null;
  sourceUrl?: string | null;
  readmePath?: string | null;
  readmePreview?: string | null;
  readmeLinks?: string[];
  instructionFiles?: string[];
  localStartCommand?: string | null;
  productionUrl?: string | null;
  hasClaudeLikeInstruction?: boolean;
};

export type RelationUpsertInput = {
  projectSlug: string;
  relatedProjectSlug: string;
  type: RelationType;
  score: number;
  evidence: string[];
  explanation: string;
};

export type DailyReportUpsertInput = {
  date: string;
  highlights: string[];
  newlyActive: string[];
  coolingDown: string[];
  relationFindings: string[];
  portfolioUpdates: string[];
  markdownPath: string;
};

type ProjectRow = {
  id: string;
  name: string;
  slug: string;
  repo_path: string;
  remote_url: string | null;
  remote_owner: string | null;
  remote_name: string | null;
  scope: ProjectScope;
  visibility_type: VisibilityType;
  summary: string;
  tech_stack: string;
  tags: string;
  activity_score: number;
  last_commit_at: string | null;
  commit_count_7d: number;
  commit_count_30d: number;
  dirty_working_tree: number;
  stars: number;
  forks: number;
  open_issues: number;
  open_prs: number;
  default_branch: string | null;
  latest_release_tag: string | null;
  latest_release_at: string | null;
  cover_hint: string | null;
  demo_url: string | null;
  source_url: string | null;
  readme_path: string | null;
  readme_preview: string | null;
  readme_links: string | null;
  instruction_files: string | null;
  local_start_command: string | null;
  production_url: string | null;
  has_claude_like_instruction: number;
  synced_at: string;
  created_at: string;
  updated_at: string;
};

function nowIso() {
  return new Date().toISOString();
}

function parseJsonArray(value: string | null): string[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function normalizeProject(row: ProjectRow) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    repoPath: row.repo_path,
    remoteUrl: row.remote_url,
    remoteOwner: row.remote_owner,
    remoteName: row.remote_name,
    scope: row.scope,
    visibilityType: row.visibility_type,
    summary: row.summary,
    techStack: parseJsonArray(row.tech_stack),
    tags: parseJsonArray(row.tags),
    activityScore: row.activity_score,
    lastCommitAt: row.last_commit_at ? new Date(row.last_commit_at) : null,
    commitCount7d: row.commit_count_7d,
    commitCount30d: row.commit_count_30d,
    dirtyWorkingTree: Boolean(row.dirty_working_tree),
    stars: row.stars,
    forks: row.forks,
    openIssues: row.open_issues,
    openPrs: row.open_prs,
    defaultBranch: row.default_branch,
    latestReleaseTag: row.latest_release_tag,
    latestReleaseAt: row.latest_release_at ? new Date(row.latest_release_at) : null,
    coverHint: row.cover_hint,
    demoUrl: row.demo_url,
    sourceUrl: row.source_url,
    readmePath: row.readme_path,
    readmePreview: row.readme_preview,
    readmeLinks: parseJsonArray(row.readme_links),
    instructionFiles: parseJsonArray(row.instruction_files),
    localStartCommand: row.local_start_command,
    productionUrl: row.production_url,
    hasClaudeLikeInstruction: Boolean(row.has_claude_like_instruction),
    syncedAt: new Date(row.synced_at),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  };
}

function getProjectIdBySlug(slug: string) {
  const db = getDb();
  const row = db.prepare(`SELECT id FROM projects WHERE slug = ?`).get(slug) as { id: string } | undefined;
  return row?.id || null;
}

function getTopRelationsForProject(projectId: string, take = 3) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT pr.id, pr.type, pr.score, pr.evidence, pr.explanation,
              p.id AS related_id, p.name AS related_name, p.slug AS related_slug, p.scope AS related_scope
       FROM project_relations pr
       JOIN projects p ON p.id = pr.related_project_id
       WHERE pr.project_id = ?
       ORDER BY pr.score DESC, pr.updated_at DESC
       LIMIT ?`
    )
    .all(projectId, take) as Array<{
    id: string;
    type: RelationType;
    score: number;
    evidence: string;
    explanation: string;
    related_id: string;
    related_name: string;
    related_slug: string;
    related_scope: ProjectScope;
  }>;

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    score: row.score,
    evidence: parseJsonArray(row.evidence),
    explanation: row.explanation,
    relatedProject: {
      id: row.related_id,
      name: row.related_name,
      slug: row.related_slug,
      scope: row.related_scope
    }
  }));
}

export async function startSyncRun() {
  const db = getDb();
  const id = createId("sync");
  const startedAt = nowIso();

  db.prepare(
    `INSERT INTO sync_runs (id, started_at, status, message, project_count, tracked_count, external_count, relation_count)
     VALUES (?, ?, ?, ?, 0, 0, 0, 0)`
  ).run(id, startedAt, "success", null);

  return {
    id,
    startedAt: new Date(startedAt),
    status: "success" as SyncRunStatus
  };
}

export async function finishSyncRun(
  syncRunId: string,
  input: {
    status: SyncRunStatus;
    message?: string;
    projectCount: number;
    trackedCount: number;
    externalCount: number;
    relationCount: number;
  }
) {
  const db = getDb();
  db.prepare(
    `UPDATE sync_runs
     SET finished_at = ?, status = ?, message = ?, project_count = ?, tracked_count = ?, external_count = ?, relation_count = ?
     WHERE id = ?`
  ).run(
    nowIso(),
    input.status,
    input.message || null,
    input.projectCount,
    input.trackedCount,
    input.externalCount,
    input.relationCount,
    syncRunId
  );

  return { id: syncRunId, ...input };
}

export async function upsertProjects(inputs: ProjectUpsertInput[]) {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO projects (
      id, name, slug, repo_path, remote_url, remote_owner, remote_name, scope, visibility_type, summary,
      tech_stack, tags, activity_score, last_commit_at, commit_count_7d, commit_count_30d, dirty_working_tree,
      stars, forks, open_issues, open_prs, default_branch, latest_release_tag, latest_release_at,
      cover_hint, demo_url, source_url, readme_path, readme_preview, readme_links, instruction_files,
      local_start_command, production_url, has_claude_like_instruction, synced_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      name = excluded.name,
      repo_path = excluded.repo_path,
      remote_url = excluded.remote_url,
      remote_owner = excluded.remote_owner,
      remote_name = excluded.remote_name,
      scope = excluded.scope,
      visibility_type = excluded.visibility_type,
      summary = excluded.summary,
      tech_stack = excluded.tech_stack,
      tags = excluded.tags,
      activity_score = excluded.activity_score,
      last_commit_at = excluded.last_commit_at,
      commit_count_7d = excluded.commit_count_7d,
      commit_count_30d = excluded.commit_count_30d,
      dirty_working_tree = excluded.dirty_working_tree,
      stars = excluded.stars,
      forks = excluded.forks,
      open_issues = excluded.open_issues,
      open_prs = excluded.open_prs,
      default_branch = excluded.default_branch,
      latest_release_tag = excluded.latest_release_tag,
      latest_release_at = excluded.latest_release_at,
      cover_hint = excluded.cover_hint,
      demo_url = excluded.demo_url,
      source_url = excluded.source_url,
      readme_path = excluded.readme_path,
      readme_preview = excluded.readme_preview,
      readme_links = excluded.readme_links,
      instruction_files = excluded.instruction_files,
      local_start_command = excluded.local_start_command,
      production_url = excluded.production_url,
      has_claude_like_instruction = excluded.has_claude_like_instruction,
      synced_at = excluded.synced_at,
      updated_at = excluded.updated_at`
  );

  const ids: { slug: string; id: string }[] = [];

  for (const input of inputs) {
    const existingId = getProjectIdBySlug(input.slug);
    const id = existingId || createId("proj");
    const now = nowIso();

    stmt.run(
      id,
      input.name,
      input.slug,
      input.repoPath,
      input.remoteUrl || null,
      input.remoteOwner || null,
      input.remoteName || null,
      input.scope,
      input.visibilityType,
      input.summary,
      JSON.stringify(input.techStack),
      JSON.stringify(input.tags),
      input.activityScore,
      input.lastCommitAt ? input.lastCommitAt.toISOString() : null,
      input.commitCount7d,
      input.commitCount30d,
      input.dirtyWorkingTree ? 1 : 0,
      input.stars,
      input.forks,
      input.openIssues,
      input.openPrs,
      input.defaultBranch || null,
      input.latestReleaseTag || null,
      input.latestReleaseAt ? input.latestReleaseAt.toISOString() : null,
      input.coverHint || null,
      input.demoUrl || null,
      input.sourceUrl || null,
      input.readmePath || null,
      input.readmePreview || null,
      JSON.stringify(input.readmeLinks || []),
      JSON.stringify(input.instructionFiles || []),
      input.localStartCommand || null,
      input.productionUrl || null,
      input.hasClaudeLikeInstruction ? 1 : 0,
      now,
      now,
      now
    );

    ids.push({ slug: input.slug, id });
  }

  return ids;
}

export async function createSnapshots(
  syncRunId: string,
  projectRows: { id: string; activityScore: number; commitCount7d: number; commitCount30d: number; lastCommitAt?: Date | null }[]
) {
  if (projectRows.length === 0) {
    return;
  }

  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO project_snapshots
     (id, project_id, sync_run_id, activity_score, commit_count_7d, commit_count_30d, last_commit_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const now = nowIso();
  for (const row of projectRows) {
    stmt.run(
      createId("snap"),
      row.id,
      syncRunId,
      row.activityScore,
      row.commitCount7d,
      row.commitCount30d,
      row.lastCommitAt ? row.lastCommitAt.toISOString() : null,
      now
    );
  }
}

export async function replaceRelations(inputs: RelationUpsertInput[]) {
  const db = getDb();
  const relationInsert = db.prepare(
    `INSERT INTO project_relations
     (id, project_id, related_project_id, type, score, evidence, explanation, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const slugRows = db.prepare(`SELECT id, slug FROM projects`).all() as Array<{ id: string; slug: string }>;
  const slugToId = new Map(slugRows.map((row) => [row.slug, row.id]));

  db.exec("BEGIN;");
  try {
    db.exec("DELETE FROM project_relations;");
    const now = nowIso();

    for (const input of inputs) {
      const projectId = slugToId.get(input.projectSlug);
      const relatedProjectId = slugToId.get(input.relatedProjectSlug);
      if (!projectId || !relatedProjectId) {
        continue;
      }

      relationInsert.run(
        createId("rel"),
        projectId,
        relatedProjectId,
        input.type,
        input.score,
        JSON.stringify(input.evidence),
        input.explanation,
        now,
        now
      );
    }

    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

export async function upsertDailyReport(input: DailyReportUpsertInput) {
  const db = getDb();
  const now = nowIso();
  const existing = db.prepare(`SELECT id FROM daily_reports WHERE date = ?`).get(input.date) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE daily_reports
       SET highlights = ?, newly_active = ?, cooling_down = ?, relation_findings = ?, portfolio_updates = ?, markdown_path = ?, generated_at = ?, updated_at = ?
       WHERE date = ?`
    ).run(
      JSON.stringify(input.highlights),
      JSON.stringify(input.newlyActive),
      JSON.stringify(input.coolingDown),
      JSON.stringify(input.relationFindings),
      JSON.stringify(input.portfolioUpdates),
      input.markdownPath,
      now,
      now,
      input.date
    );
    return { id: existing.id, ...input, generatedAt: new Date(now) };
  }

  const id = createId("report");
  db.prepare(
    `INSERT INTO daily_reports
     (id, date, highlights, newly_active, cooling_down, relation_findings, portfolio_updates, markdown_path, generated_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.date,
    JSON.stringify(input.highlights),
    JSON.stringify(input.newlyActive),
    JSON.stringify(input.coolingDown),
    JSON.stringify(input.relationFindings),
    JSON.stringify(input.portfolioUpdates),
    input.markdownPath,
    now,
    now,
    now
  );

  return { id, ...input, generatedAt: new Date(now) };
}

export async function getProjects(scope: ProjectScope | "all" = "all") {
  const db = getDb();
  const rows =
    scope === "all"
      ? (db.prepare(`SELECT * FROM projects ORDER BY activity_score DESC, updated_at DESC`).all() as ProjectRow[])
      : (db
          .prepare(`SELECT * FROM projects WHERE scope = ? ORDER BY activity_score DESC, updated_at DESC`)
          .all(scope) as ProjectRow[]);

  return rows.map((row) => ({
    ...normalizeProject(row),
    relationsFrom: getTopRelationsForProject(row.id)
  }));
}

export async function getProjectById(id: string) {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(id) as ProjectRow | undefined;
  if (!row) {
    return null;
  }

  const relationsFrom = db
    .prepare(
      `SELECT pr.id, pr.type, pr.score, pr.evidence, pr.explanation,
              p.id AS project_id, p.name AS project_name, p.slug AS project_slug, p.scope AS project_scope
       FROM project_relations pr
       JOIN projects p ON p.id = pr.related_project_id
       WHERE pr.project_id = ?
       ORDER BY pr.score DESC, pr.updated_at DESC`
    )
    .all(id) as Array<{
    id: string;
    type: RelationType;
    score: number;
    evidence: string;
    explanation: string;
    project_id: string;
    project_name: string;
    project_slug: string;
    project_scope: ProjectScope;
  }>;

  const relationsTo = db
    .prepare(
      `SELECT pr.id, pr.type, pr.score, pr.evidence, pr.explanation,
              p.id AS project_id, p.name AS project_name, p.slug AS project_slug, p.scope AS project_scope
       FROM project_relations pr
       JOIN projects p ON p.id = pr.project_id
       WHERE pr.related_project_id = ?
       ORDER BY pr.score DESC, pr.updated_at DESC`
    )
    .all(id) as Array<{
    id: string;
    type: RelationType;
    score: number;
    evidence: string;
    explanation: string;
    project_id: string;
    project_name: string;
    project_slug: string;
    project_scope: ProjectScope;
  }>;

  return {
    ...normalizeProject(row),
    relationsFrom: relationsFrom.map((relation) => ({
      id: relation.id,
      type: relation.type,
      score: relation.score,
      evidence: parseJsonArray(relation.evidence),
      explanation: relation.explanation,
      relatedProject: {
        id: relation.project_id,
        name: relation.project_name,
        slug: relation.project_slug,
        scope: relation.project_scope
      }
    })),
    relationsTo: relationsTo.map((relation) => ({
      id: relation.id,
      type: relation.type,
      score: relation.score,
      evidence: parseJsonArray(relation.evidence),
      explanation: relation.explanation,
      project: {
        id: relation.project_id,
        name: relation.project_name,
        slug: relation.project_slug,
        scope: relation.project_scope
      }
    }))
  };
}

export async function getRelations(projectId?: string) {
  const db = getDb();
  const rows = projectId
    ? (db
        .prepare(
          `SELECT pr.id, pr.type, pr.score, pr.evidence, pr.explanation, pr.updated_at,
                  p1.id AS project_id, p1.name AS project_name, p1.slug AS project_slug, p1.scope AS project_scope,
                  p2.id AS related_project_id, p2.name AS related_project_name, p2.slug AS related_project_slug, p2.scope AS related_project_scope
           FROM project_relations pr
           JOIN projects p1 ON p1.id = pr.project_id
           JOIN projects p2 ON p2.id = pr.related_project_id
           WHERE pr.project_id = ? OR pr.related_project_id = ?
           ORDER BY pr.score DESC, pr.updated_at DESC`
        )
        .all(projectId, projectId) as Array<any>)
    : (db
        .prepare(
          `SELECT pr.id, pr.type, pr.score, pr.evidence, pr.explanation, pr.updated_at,
                  p1.id AS project_id, p1.name AS project_name, p1.slug AS project_slug, p1.scope AS project_scope,
                  p2.id AS related_project_id, p2.name AS related_project_name, p2.slug AS related_project_slug, p2.scope AS related_project_scope
           FROM project_relations pr
           JOIN projects p1 ON p1.id = pr.project_id
           JOIN projects p2 ON p2.id = pr.related_project_id
           ORDER BY pr.score DESC, pr.updated_at DESC`
        )
        .all() as Array<any>);

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    score: row.score,
    evidence: parseJsonArray(row.evidence),
    explanation: row.explanation,
    updatedAt: new Date(row.updated_at),
    project: {
      id: row.project_id,
      name: row.project_name,
      slug: row.project_slug,
      scope: row.project_scope
    },
    relatedProject: {
      id: row.related_project_id,
      name: row.related_project_name,
      slug: row.related_project_slug,
      scope: row.related_project_scope
    }
  }));
}

export async function getReports(limit = 30) {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM daily_reports ORDER BY date DESC LIMIT ?`)
    .all(limit) as Array<{
    id: string;
    date: string;
    highlights: string;
    newly_active: string;
    cooling_down: string;
    relation_findings: string;
    portfolio_updates: string;
    markdown_path: string;
    generated_at: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    date: row.date,
    highlights: parseJsonArray(row.highlights),
    newlyActive: parseJsonArray(row.newly_active),
    coolingDown: parseJsonArray(row.cooling_down),
    relationFindings: parseJsonArray(row.relation_findings),
    portfolioUpdates: parseJsonArray(row.portfolio_updates),
    markdownPath: row.markdown_path,
    generatedAt: new Date(row.generated_at)
  }));
}

export async function getReportByDate(date: string) {
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM daily_reports WHERE date = ?`)
    .get(date) as
    | {
        id: string;
        date: string;
        highlights: string;
        newly_active: string;
        cooling_down: string;
        relation_findings: string;
        portfolio_updates: string;
        markdown_path: string;
        generated_at: string;
      }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    date: row.date,
    highlights: parseJsonArray(row.highlights),
    newlyActive: parseJsonArray(row.newly_active),
    coolingDown: parseJsonArray(row.cooling_down),
    relationFindings: parseJsonArray(row.relation_findings),
    portfolioUpdates: parseJsonArray(row.portfolio_updates),
    markdownPath: row.markdown_path,
    generatedAt: new Date(row.generated_at)
  };
}

export async function getLatestSnapshotsByProject(projectId: string, take = 2) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, activity_score, commit_count_7d, commit_count_30d, last_commit_at, created_at
       FROM project_snapshots
       WHERE project_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(projectId, take) as Array<{
    id: string;
    activity_score: number;
    commit_count_7d: number;
    commit_count_30d: number;
    last_commit_at: string | null;
    created_at: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    activityScore: row.activity_score,
    commitCount7d: row.commit_count_7d,
    commitCount30d: row.commit_count_30d,
    lastCommitAt: row.last_commit_at ? new Date(row.last_commit_at) : null,
    createdAt: new Date(row.created_at)
  }));
}

export async function getAllTrackedProjectsForExport() {
  const projects = await getProjects("tracked");
  return projects;
}

export async function getDashboardSummary() {
  const db = getDb();
  const trackedCount = (db.prepare(`SELECT COUNT(*) AS count FROM projects WHERE scope = 'tracked'`).get() as { count: number }).count;
  const externalCount = (db.prepare(`SELECT COUNT(*) AS count FROM projects WHERE scope = 'external'`).get() as { count: number }).count;
  const reportsCount = (db.prepare(`SELECT COUNT(*) AS count FROM daily_reports`).get() as { count: number }).count;
  const latestReport = (await getReports(1))[0] || null;

  const hotRows = db
    .prepare(
      `SELECT id, name, slug, activity_score, updated_at, commit_count_7d, visibility_type
       FROM projects
       WHERE scope = 'tracked'
       ORDER BY activity_score DESC, updated_at DESC
       LIMIT 5`
    )
    .all() as Array<{
    id: string;
    name: string;
    slug: string;
    activity_score: number;
    updated_at: string;
    commit_count_7d: number;
    visibility_type: VisibilityType;
  }>;

  return {
    trackedCount,
    externalCount,
    reportsCount,
    latestReport,
    hotProjects: hotRows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      activityScore: row.activity_score,
      updatedAt: new Date(row.updated_at),
      commitCount7d: row.commit_count_7d,
      visibilityType: row.visibility_type
    }))
  };
}

export async function closeDb() {
  closeDbConnection();
}

export const enums = {
  ProjectScope: {
    tracked: "tracked",
    external: "external"
  },
  VisibilityType: {
    local: "local",
    github: "github"
  },
  RelationType: {
    theme_similarity: "theme_similarity",
    tech_overlap: "tech_overlap",
    workflow_dependency: "workflow_dependency",
    timeline_cluster: "timeline_cluster"
  },
  SyncRunStatus: {
    success: "success",
    failed: "failed"
  }
} as const;

export type DbProject = Awaited<ReturnType<typeof getProjects>>[number];
