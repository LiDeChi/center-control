import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

function resolveDatabasePath(databaseUrl: string) {
  if (!databaseUrl.startsWith("file:")) {
    throw new Error(`Unsupported DATABASE_URL: ${databaseUrl}. Only file: URLs are supported.`);
  }

  const raw = databaseUrl.slice("file:".length);
  if (!raw) {
    throw new Error("DATABASE_URL is missing path");
  }

  if (raw.startsWith("/")) {
    return raw;
  }

  return path.resolve(process.cwd(), raw);
}

let db: DatabaseSync | null = null;

function resolveDefaultDatabaseUrl() {
  const cwd = process.cwd();
  const inWorkspaceSubdir = cwd.includes(`${path.sep}apps${path.sep}`) || cwd.includes(`${path.sep}packages${path.sep}`);
  const candidates = inWorkspaceSubdir
    ? [
        path.resolve(process.cwd(), "../../data/db/center-control.db"),
        path.resolve(process.cwd(), "../data/db/center-control.db"),
        path.resolve(process.cwd(), "data/db/center-control.db")
      ]
    : [
        path.resolve(process.cwd(), "data/db/center-control.db"),
        path.resolve(process.cwd(), "../data/db/center-control.db"),
        path.resolve(process.cwd(), "../../data/db/center-control.db")
      ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) || fs.existsSync(path.dirname(candidate))) {
      return `file:${candidate}`;
    }
  }

  return `file:${candidates[0]}`;
}

const PROJECT_COLUMN_MIGRATIONS: Array<{ name: string; definition: string }> = [
  { name: "readme_path", definition: "TEXT" },
  { name: "readme_preview", definition: "TEXT" },
  { name: "readme_links", definition: "TEXT NOT NULL DEFAULT '[]'" },
  { name: "instruction_files", definition: "TEXT NOT NULL DEFAULT '[]'" },
  { name: "local_start_command", definition: "TEXT" },
  { name: "production_url", definition: "TEXT" },
  { name: "has_claude_like_instruction", definition: "INTEGER NOT NULL DEFAULT 0" }
];

function getDatabaseInstance() {
  if (db) {
    return db;
  }

  const databaseUrl = process.env.DATABASE_URL || resolveDefaultDatabaseUrl();
  const databasePath = resolveDatabasePath(databaseUrl);
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });

  db = new DatabaseSync(databasePath);
  db.exec("PRAGMA foreign_keys = ON;");
  return db;
}

declare global {
  // eslint-disable-next-line no-var
  var __centerDbReady: boolean | undefined;
}

export function initDb() {
  if (global.__centerDbReady) {
    return;
  }

  const database = getDatabaseInstance();

  database.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      repo_path TEXT NOT NULL UNIQUE,
      remote_url TEXT,
      remote_owner TEXT,
      remote_name TEXT,
      scope TEXT NOT NULL,
      visibility_type TEXT NOT NULL,
      summary TEXT NOT NULL,
      tech_stack TEXT NOT NULL,
      tags TEXT NOT NULL,
      activity_score INTEGER NOT NULL DEFAULT 0,
      last_commit_at TEXT,
      commit_count_7d INTEGER NOT NULL DEFAULT 0,
      commit_count_30d INTEGER NOT NULL DEFAULT 0,
      dirty_working_tree INTEGER NOT NULL DEFAULT 0,
      stars INTEGER NOT NULL DEFAULT 0,
      forks INTEGER NOT NULL DEFAULT 0,
      open_issues INTEGER NOT NULL DEFAULT 0,
      open_prs INTEGER NOT NULL DEFAULT 0,
      default_branch TEXT,
      latest_release_tag TEXT,
      latest_release_at TEXT,
      cover_hint TEXT,
      demo_url TEXT,
      source_url TEXT,
      readme_path TEXT,
      readme_preview TEXT,
      readme_links TEXT NOT NULL DEFAULT '[]',
      instruction_files TEXT NOT NULL DEFAULT '[]',
      local_start_command TEXT,
      production_url TEXT,
      has_claude_like_instruction INTEGER NOT NULL DEFAULT 0,
      synced_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_projects_scope ON projects(scope);
    CREATE INDEX IF NOT EXISTS idx_projects_activity_score ON projects(activity_score);

    CREATE TABLE IF NOT EXISTS project_relations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      related_project_id TEXT NOT NULL,
      type TEXT NOT NULL,
      score REAL NOT NULL,
      evidence TEXT NOT NULL,
      explanation TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, related_project_id),
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY(related_project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_project_relations_project_id ON project_relations(project_id);
    CREATE INDEX IF NOT EXISTS idx_project_relations_related_project_id ON project_relations(related_project_id);

    CREATE TABLE IF NOT EXISTS daily_reports (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL UNIQUE,
      highlights TEXT NOT NULL,
      newly_active TEXT NOT NULL,
      cooling_down TEXT NOT NULL,
      relation_findings TEXT NOT NULL,
      portfolio_updates TEXT NOT NULL,
      markdown_path TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_runs (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      message TEXT,
      project_count INTEGER NOT NULL DEFAULT 0,
      tracked_count INTEGER NOT NULL DEFAULT 0,
      external_count INTEGER NOT NULL DEFAULT 0,
      relation_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS project_snapshots (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      sync_run_id TEXT NOT NULL,
      activity_score INTEGER NOT NULL,
      commit_count_7d INTEGER NOT NULL,
      commit_count_30d INTEGER NOT NULL,
      last_commit_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY(sync_run_id) REFERENCES sync_runs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_project_snapshots_project_created ON project_snapshots(project_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_project_snapshots_sync_run ON project_snapshots(sync_run_id);
  `);

  const projectColumns = database.prepare(`PRAGMA table_info(projects)`).all() as Array<{ name: string }>;
  const existingColumns = new Set(projectColumns.map((column) => column.name));
  for (const migration of PROJECT_COLUMN_MIGRATIONS) {
    if (existingColumns.has(migration.name)) {
      continue;
    }
    database.exec(`ALTER TABLE projects ADD COLUMN ${migration.name} ${migration.definition};`);
  }

  global.__centerDbReady = true;
}

export function getDb() {
  initDb();
  return getDatabaseInstance();
}

export function closeDbConnection() {
  if (db) {
    db.close();
    db = null;
  }
  global.__centerDbReady = false;
}

export function createId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}
