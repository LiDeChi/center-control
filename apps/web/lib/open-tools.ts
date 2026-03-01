import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CHECK_TIMEOUT_MS = 1_200;
const CACHE_TTL_MS = 30_000;

export const OPEN_TOOL_IDS = ["terminal", "vscode", "finder", "cursor", "xcode"] as const;
export type OpenToolId = (typeof OPEN_TOOL_IDS)[number];

export type OpenToolInfo = {
  id: OpenToolId;
  label: string;
  available: boolean;
  reason: string;
};

type OpenToolDefinition = {
  id: OpenToolId;
  label: string;
  appNames?: string[];
  appPaths?: string[];
  cliBinary?: string;
  alwaysAvailableOnMac?: boolean;
};

const TOOL_DEFINITIONS: OpenToolDefinition[] = [
  {
    id: "terminal",
    label: "Terminal",
    appNames: ["Terminal"],
    alwaysAvailableOnMac: true
  },
  {
    id: "finder",
    label: "Finder",
    appNames: ["Finder"],
    alwaysAvailableOnMac: true
  },
  {
    id: "vscode",
    label: "Visual Studio Code",
    appNames: ["Visual Studio Code", "Visual Studio Code - Insiders", "Code"],
    appPaths: [
      "/Applications/Visual Studio Code.app",
      "/Applications/Visual Studio Code - Insiders.app",
      "~/Applications/Visual Studio Code.app",
      "~/Applications/Visual Studio Code - Insiders.app"
    ],
    cliBinary: "code"
  },
  {
    id: "cursor",
    label: "Cursor",
    appNames: ["Cursor", "Cursor Nightly"],
    appPaths: ["/Applications/Cursor.app", "~/Applications/Cursor.app"],
    cliBinary: "cursor"
  },
  {
    id: "xcode",
    label: "Xcode",
    appNames: ["Xcode"],
    appPaths: ["/Applications/Xcode.app"]
  }
];

type DetectResult = {
  platform: NodeJS.Platform;
  tools: OpenToolInfo[];
};

let cachedDetection: { at: number; result: DetectResult } | null = null;

async function commandExists(binary: string) {
  try {
    await execFileAsync("which", [binary], {
      timeout: CHECK_TIMEOUT_MS,
      maxBuffer: 64 * 1024
    });
    return true;
  } catch {
    return false;
  }
}

function expandHomePath(rawPath: string) {
  if (!rawPath.startsWith("~/")) {
    return rawPath;
  }
  const home = process.env.HOME || "";
  if (!home) {
    return rawPath.slice(1);
  }
  return `${home}${rawPath.slice(1)}`;
}

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function appExistsViaPaths(appPaths: string[]) {
  if (appPaths.length === 0) {
    return false;
  }
  const checks = await Promise.all(appPaths.map((candidate) => fileExists(expandHomePath(candidate))));
  return checks.some(Boolean);
}

function toUnavailableReason(platform: NodeJS.Platform) {
  if (platform === "linux") {
    return "当前服务运行在 Linux 环境，无法直接调用 macOS 应用。";
  }
  if (platform === "win32") {
    return "当前服务运行在 Windows 环境，尚未接入本机应用拉起。";
  }
  return `当前服务运行在 ${platform}，暂不支持自动打开 IDE。`;
}

export async function detectOpenTools() {
  if (cachedDetection && Date.now() - cachedDetection.at <= CACHE_TTL_MS) {
    return cachedDetection.result;
  }

  const platform = process.platform;

  if (platform !== "darwin") {
    const result = {
      platform,
      tools: TOOL_DEFINITIONS.map(
        (tool): OpenToolInfo => ({
          id: tool.id,
          label: tool.label,
          available: false,
          reason: toUnavailableReason(platform)
        })
      )
    };
    cachedDetection = {
      at: Date.now(),
      result
    };
    return result;
  }

  const toolChecks = await Promise.all(
    TOOL_DEFINITIONS.map(async (tool): Promise<OpenToolInfo> => {
      if (tool.alwaysAvailableOnMac) {
        return {
          id: tool.id,
          label: tool.label,
          available: true,
          reason: "系统内置"
        };
      }

      const [appReady, cliReady] = await Promise.all([
        appExistsViaPaths(tool.appPaths || []),
        tool.cliBinary ? commandExists(tool.cliBinary) : Promise.resolve(false)
      ]);
      const available = appReady || cliReady;
      const reason = available
        ? cliReady
          ? "可用（CLI）"
          : "可用（App）"
        : "未检测到本机安装";

      return {
        id: tool.id,
        label: tool.label,
        available,
        reason
      };
    })
  );

  const result = {
    platform,
    tools: toolChecks
  };
  cachedDetection = {
    at: Date.now(),
    result
  };
  return result;
}
