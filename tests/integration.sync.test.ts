import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let tmpDir = "";

function run(cmd: string, args: string[], cwd: string) {
  execFileSync(cmd, args, { cwd, stdio: "pipe" });
}

async function createRepo(input: {
  root: string;
  name: string;
  remote?: string;
  files: Record<string, string>;
}) {
  const repoPath = path.join(input.root, input.name);
  await fs.mkdir(repoPath, { recursive: true });
  run("git", ["init"], repoPath);
  run("git", ["config", "user.email", "test@example.com"], repoPath);
  run("git", ["config", "user.name", "test"], repoPath);

  for (const [file, content] of Object.entries(input.files)) {
    const target = path.join(repoPath, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf-8");
  }

  run("git", ["add", "."], repoPath);
  run("git", ["commit", "-m", "init"], repoPath);

  if (input.remote) {
    run("git", ["remote", "add", "origin", input.remote], repoPath);
  }
}

describe("sync pipeline integration", () => {
  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "center-control-test-"));
    const githubRoot = path.join(tmpDir, "github");
    const dataRoot = path.join(tmpDir, "data");
    await fs.mkdir(githubRoot, { recursive: true });
    await fs.mkdir(path.join(dataRoot, "reports"), { recursive: true });
    await fs.mkdir(path.join(dataRoot, "exports"), { recursive: true });
    await fs.mkdir(path.join(dataRoot, "db"), { recursive: true });

    await Promise.all([
      createRepo({
        root: githubRoot,
        name: "alpha-dashboard",
        remote: "git@github.com:LiDeChi/alpha-dashboard.git",
        files: {
          "package.json": JSON.stringify({ dependencies: { react: "^18.0.0", next: "^14.0.0" } }),
          "README.md": "# alpha\nDashboard for metrics"
        }
      }),
      createRepo({
        root: githubRoot,
        name: "beta-dashboard",
        remote: "git@github.com:LiDeChi/beta-dashboard.git",
        files: {
          "package.json": JSON.stringify({ dependencies: { react: "^18.0.0", next: "^14.0.0" } }),
          "README.md": "# beta\nAnother dashboard project"
        }
      }),
      createRepo({
        root: githubRoot,
        name: "local-notes",
        files: {
          "requirements.txt": "fastapi\nuvicorn",
          "README.md": "local notes app"
        }
      }),
      createRepo({
        root: githubRoot,
        name: "third-party",
        remote: "https://github.com/vercel/next.js.git",
        files: {
          "README.md": "external mirror"
        }
      }),
      createRepo({
        root: githubRoot,
        name: "worker-tools",
        remote: "git@github.com:LiDeChi/worker-tools.git",
        files: {
          "pyproject.toml": "[project]\nname='worker-tools'",
          "README.md": "tooling project"
        }
      }),
      createRepo({
        root: githubRoot,
        name: "mini-api",
        remote: "git@github.com:LiDeChi/mini-api.git",
        files: {
          "go.mod": "module mini-api",
          "README.md": "api service"
        }
      })
    ]);

    process.env.DATABASE_URL = `file:${path.join(dataRoot, "db", "test.db")}`;
    process.env.GITHUB_ROOT = githubRoot;
    process.env.REPORTS_DIR = path.join(dataRoot, "reports");
    process.env.EXPORTS_DIR = path.join(dataRoot, "exports");
    process.env.OWNER_LOGIN = "LiDeChi";
    process.env.LLM_BASE_URL = "http://127.0.0.1:9";
    process.env.LLM_API_KEY = "test";
    process.env.REPORT_TIME = "09:00";
    process.env.TZ = "America/New_York";

    run("npm", ["run", "db:push"], process.cwd());
  }, 120000);

  afterAll(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("stores projects, relations and report plus portfolio export", async () => {
    const { runSyncPipeline } = await import("@center/core");
    const { getProjects, getRelations, getReports } = await import("@center/db");

    const result = await runSyncPipeline();

    expect(result.projectCount).toBe(6);
    expect(result.trackedCount).toBe(5);
    expect(result.externalCount).toBe(1);
    expect(result.relationCount).toBeGreaterThan(0);

    const [projects, relations, reports] = await Promise.all([getProjects("all"), getRelations(), getReports(10)]);

    expect(projects.length).toBe(6);
    expect(relations.length).toBeGreaterThan(0);
    expect(reports.length).toBe(1);

    const reportExists = await fs
      .access(result.reportPath)
      .then(() => true)
      .catch(() => false);
    expect(reportExists).toBe(true);

    const exportRaw = await fs.readFile(result.exportPath, "utf-8");
    const exportJson = JSON.parse(exportRaw) as { count: number; projects: Array<{ relationCount: number; name: string }> };
    expect(exportJson.count).toBe(5);
    expect(exportJson.projects[0]).toHaveProperty("relationCount");
  }, 120000);
});
