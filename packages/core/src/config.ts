import path from "node:path";

export type AppConfig = {
  dataRoot: string;
  githubRoot: string;
  ownerLogin: string;
  reportTime: string;
  reportsDir: string;
  exportsDir: string;
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  githubToken: string;
  timezone: string;
};

function resolveDefaultDataRoot() {
  const cwd = process.cwd();
  const inWorkspaceSubdir =
    cwd.includes(`${path.sep}apps${path.sep}`) || cwd.includes(`${path.sep}packages${path.sep}`);
  const candidates = inWorkspaceSubdir
    ? [
        path.resolve(process.cwd(), "../../data"),
        path.resolve(process.cwd(), "../data"),
        path.resolve(process.cwd(), "data")
      ]
    : [
        path.resolve(process.cwd(), "data"),
        path.resolve(process.cwd(), "../data"),
        path.resolve(process.cwd(), "../../data")
      ];

  return candidates[0];
}

export function loadConfig(): AppConfig {
  const timezone = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  const dataRoot = process.env.DATA_ROOT || process.env.CENTER_CONTROL_DATA_ROOT || resolveDefaultDataRoot();
  const reportsDir = process.env.REPORTS_DIR || path.resolve(dataRoot, "reports");
  const exportsDir = process.env.EXPORTS_DIR || path.resolve(dataRoot, "exports");

  return {
    dataRoot,
    githubRoot: process.env.GITHUB_ROOT || "/data/github",
    ownerLogin: process.env.OWNER_LOGIN || "LiDeChi",
    reportTime: process.env.REPORT_TIME || "09:00",
    reportsDir,
    exportsDir,
    llmBaseUrl: process.env.LLM_BASE_URL || "http://127.0.0.1:41400",
    llmApiKey: process.env.LLM_API_KEY || "",
    llmModel: process.env.LLM_MODEL || "gpt-5.2-codex",
    githubToken: process.env.GITHUB_TOKEN || "",
    timezone
  };
}

export function getLocalDateKey(date = new Date(), timezone?: string) {
  const tz = timezone || process.env.TZ || "America/New_York";
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  return formatter.format(date);
}
