"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";

const MANUAL_ORDER_STORAGE_KEY = "center-control.manual-order.v2";
const DEFAULT_MODEL = "gpt-5.2-codex";
const MODEL_OPTIONS = ["gpt-5.2-codex", "gpt-5.1", "gpt-4.1"] as const;
const IDE_DEFAULT_OPTIONS = ["terminal", "vscode", "finder", "cursor", "xcode"] as const;
const REASONING_DEPTH_OPTIONS = ["low", "medium", "high"] as const;
const CHAT_MIN_LINES = 2;
const CHAT_MAX_LINES = 6;
const HOST_GITHUB_ROOT = process.env.NEXT_PUBLIC_HOST_GITHUB_ROOT || "/Users/lidechi/Documents/Github";

type SortMode = "activity" | "updatedAt" | "relationScore" | "name" | "manual";
type ScopeFilter = "tracked" | "external" | "all";
type IdeTarget = (typeof IDE_DEFAULT_OPTIONS)[number];
type ReasoningDepth = (typeof REASONING_DEPTH_OPTIONS)[number];

export type WorkbenchProject = {
  id: string;
  name: string;
  slug: string;
  repoPath: string;
  summary: string;
  readmePreview: string;
  scope: "tracked" | "external";
  visibilityType: "local" | "github";
  activityScore: number;
  relationCount: number;
  commitCount7d: number;
  commitCount30d: number;
  lastCommitAt: string | null;
  updatedAt: string;
  localStartCommand: string;
  productionUrl: string | null;
  sourceUrl: string | null;
  coverHint: string | null;
  techStack: string[];
  cardScreenshotUrl: string | null;
  topRelations: Array<{
    slug: string;
    name: string;
    type: string;
    score: number;
    evidence: string[];
    explanation: string;
  }>;
};

type ProjectWorkbenchProps = {
  projects: WorkbenchProject[];
};

type GitCommit = {
  hash: string;
  shortHash: string;
  date: string;
  subject: string;
  author: string;
};

type GitInfoPayload = {
  ok?: boolean;
  error?: string;
  branch?: string | null;
  upstream?: string | null;
  syncState?: string;
  ahead?: number;
  behind?: number;
  commits?: GitCommit[];
};

type ProfileEnvironment = {
  id: string;
  label: string;
  url: string;
  kind: "local" | "staging" | "production" | "reference";
  source: string;
};

type ProfileScreenshot = {
  id: string;
  url: string;
  sourceUrl: string;
  label: string;
};

type ScreenshotGroup = {
  id: string;
  kind: "desktop" | "mobile";
  shots: ProfileScreenshot[];
  sourceUrl: string | null;
};

type ProjectProfilePayload = {
  ok?: boolean;
  error?: string;
  uiSummary?: string;
  interactionSummary?: string;
  readmePath?: string | null;
  startCommands?: {
    primary: string;
    alternatives: string[];
  };
  environments?: ProfileEnvironment[];
  screenshots?: ProfileScreenshot[];
};

type ActionPayload = {
  projectId: string;
  action: "start-local" | "open-production" | "open-with-tool";
  localStartCommand?: string;
  productionUrl?: string;
  ideTarget?: IdeTarget;
};

type ActionResponse = {
  ok?: boolean;
  error?: string;
  pid?: number;
  productionUrl?: string;
};

type CodexResponse = {
  ok?: boolean;
  taskId?: string;
  error?: string;
  codex?: {
    queued?: boolean;
    pid?: number;
    reason?: string;
  };
};

type GithubSyncAllResponse = {
  ok?: boolean;
  error?: string;
  summary?: {
    total: number;
    synced: number;
    failed: number;
    skipped: number;
  };
};

type OpenToolInfo = {
  id: IdeTarget;
  label: string;
  available: boolean;
  reason: string;
};

type OpenToolsResponse = {
  ok?: boolean;
  error?: string;
  platform?: string;
  tools?: OpenToolInfo[];
};

function formatDate(value: string | null) {
  if (!value) {
    return "暂无";
  }
  return value.slice(0, 10);
}

function formatCardDate(value: string | null) {
  const formatted = formatDate(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(formatted)) {
    return formatted.slice(5);
  }
  return formatted;
}

function mergeManualOrder(saved: string[], allIds: string[]) {
  const base = saved.filter((id) => allIds.includes(id));
  const missing = allIds.filter((id) => !base.includes(id));
  return [...base, ...missing];
}

function reorderIds(order: string[], draggedId: string, targetId: string) {
  if (!draggedId || !targetId || draggedId === targetId) {
    return order;
  }

  const withoutDragged = order.filter((id) => id !== draggedId);
  const targetIndex = withoutDragged.indexOf(targetId);
  if (targetIndex < 0) {
    return order;
  }

  const next = [...withoutDragged];
  next.splice(targetIndex, 0, draggedId);
  return next;
}

function relationTypeLabel(type: string) {
  if (type === "theme_similarity") {
    return "主题相近";
  }
  if (type === "tech_overlap") {
    return "技术重叠";
  }
  if (type === "workflow_dependency") {
    return "流程依赖";
  }
  if (type === "timeline_cluster") {
    return "同阶段演进";
  }
  return type;
}

function relationFactLines(evidence: string[], explanation: string) {
  const prioritized = evidence.filter(
    (line) =>
      line.startsWith("共享库:") ||
      line.startsWith("调用关系:") ||
      line.startsWith("关系类型:") ||
      line.startsWith("辅助信号:")
  );

  if (prioritized.length > 0) {
    return prioritized.slice(0, 3);
  }

  const fallback = explanation.trim();
  if (!fallback) {
    return [];
  }

  return [fallback];
}

function ideIconGlyph(target: IdeTarget) {
  if (target === "terminal") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3 4.5L6.5 8L3 11.5" />
        <path d="M8.5 11.5H13" />
      </svg>
    );
  }

  if (target === "vscode") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M10.8 2.8L6.2 6.6L3.8 4.8L2.6 6L5.2 8L2.6 10L3.8 11.2L6.2 9.4L10.8 13.2V2.8Z" />
      </svg>
    );
  }

  if (target === "finder") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 2V14" />
        <path d="M5.2 6.2H5.3" />
        <path d="M10.7 6.2H10.8" />
        <path d="M5.2 10.1C6.1 11 7 11.4 8 11.4C9 11.4 9.9 11 10.8 10.1" />
      </svg>
    );
  }

  if (target === "cursor") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3 2.5L11.1 8.2L7.8 8.9L9.6 13.5L7.8 14.1L6 9.4L3.8 11.8L3 2.5Z" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.8 11.8L6.3 8.4L7.7 9.8L4.2 13.2H2.8V11.8Z" />
      <path d="M9.1 3L13 6.9L7.5 12.4L3.6 8.5L9.1 3Z" />
    </svg>
  );
}

function ideIconAsset(target: IdeTarget) {
  if (target === "finder") {
    return "/icons/finder.png";
  }
  if (target === "terminal") {
    return "/icons/terminal.png";
  }
  if (target === "vscode") {
    return "/icons/vscode.png";
  }
  if (target === "xcode") {
    return "/icons/xcode.png";
  }
  return "";
}

function ideLabel(target: IdeTarget) {
  if (target === "terminal") {
    return "Terminal";
  }
  if (target === "vscode") {
    return "VS Code";
  }
  if (target === "finder") {
    return "Finder";
  }
  if (target === "cursor") {
    return "Cursor";
  }
  return "Xcode";
}

function ideShortLabel(target: IdeTarget) {
  if (target === "vscode") {
    return "VS";
  }
  if (target === "terminal") {
    return "Term";
  }
  if (target === "finder") {
    return "Find";
  }
  if (target === "cursor") {
    return "Cur";
  }
  return "Xc";
}

function loadStorage<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") {
    return fallback;
  }
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function saveStorage(key: string, value: unknown) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore localStorage failures.
  }
}

function mapRepoPathToHost(repoPath: string) {
  const normalized = repoPath.replace(/\\/g, "/");
  if (normalized.startsWith("/data/github/")) {
    const suffix = normalized.slice("/data/github/".length).replace(/^\/+/, "");
    const base = HOST_GITHUB_ROOT.replace(/\/+$/, "");
    return `${base}/${suffix}`;
  }
  return normalized;
}

function toEditorUri(scheme: string, absolutePath: string) {
  if (absolutePath.startsWith("/")) {
    return `${scheme}//${encodeURI(absolutePath.slice(1))}`;
  }
  return `${scheme}/${encodeURI(absolutePath)}`;
}

function normalizeUrl(rawUrl: string) {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return "";
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `http://${trimmed}`;
}

function normalizeRepositoryUrl(rawUrl: string | null) {
  if (!rawUrl) {
    return "";
  }

  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return "";
  }

  const sshMatch = trimmed.match(/^git@github\.com:(.+)$/i);
  if (sshMatch?.[1]) {
    return `https://github.com/${sshMatch[1].replace(/\.git$/i, "")}`;
  }

  const sshSchemeMatch = trimmed.match(/^ssh:\/\/git@github\.com\/(.+)$/i);
  if (sshSchemeMatch?.[1]) {
    return `https://github.com/${sshSchemeMatch[1].replace(/\.git$/i, "")}`;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/\.git$/i, "");
  }

  return normalizeUrl(trimmed);
}

function compactCardText(rawText: string, maxLength = 58) {
  const normalized = rawText.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "暂无简介";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}...`;
}

function compactTechTag(rawTag: string, maxLength = 15) {
  const normalized = rawTag.trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}...`;
}

function isMobileScreenshot(screenshot: ProfileScreenshot) {
  const label = screenshot.label.toLowerCase();
  if (/(mobile|phone|ios|android|iphone|ipad|h5)/.test(label)) {
    return true;
  }

  try {
    const parsed = new URL(screenshot.sourceUrl);
    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();
    const search = parsed.search.toLowerCase();

    if (host.startsWith("m.")) {
      return true;
    }
    if (/(mobile|ios|android|h5)/.test(pathname) || /(mobile|ios|android|h5)/.test(search)) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function buildScreenshotGroups(screenshots: ProfileScreenshot[]): ScreenshotGroup[] {
  if (screenshots.length === 0) {
    return [];
  }

  const mobileCandidates = screenshots.filter((item) => isMobileScreenshot(item));
  const mobileShots = mobileCandidates.length >= 2 ? mobileCandidates.slice(0, 2) : [];
  const mobileIds = new Set(mobileShots.map((item) => item.id));
  const desktopShots = mobileShots.length > 0 ? screenshots.filter((item) => !mobileIds.has(item.id)) : screenshots;
  const groups: ScreenshotGroup[] = [];

  if (desktopShots.length > 0) {
    groups.push({
      id: `desktop-${desktopShots[0].id}`,
      kind: "desktop",
      shots: [desktopShots[0]],
      sourceUrl: desktopShots[0].sourceUrl
    });
  }

  if (mobileShots.length > 0) {
    groups.push({
      id: `mobile-${mobileShots[0].id}`,
      kind: "mobile",
      shots: mobileShots.slice(0, 2),
      sourceUrl: mobileShots[0].sourceUrl
    });
  }

  if (groups.length === 0) {
    groups.push({
      id: `fallback-${screenshots[0].id}`,
      kind: "desktop",
      shots: [screenshots[0]],
      sourceUrl: screenshots[0].sourceUrl
    });
  }

  return groups;
}

function clearAttachmentInput(input: HTMLInputElement | null) {
  if (!input) {
    return;
  }
  input.value = "";
}

function resizeChatInput(input: HTMLTextAreaElement | null) {
  if (!input || typeof window === "undefined") {
    return;
  }

  const computed = window.getComputedStyle(input);
  const lineHeight = Number.parseFloat(computed.lineHeight) || 20;
  const paddingTop = Number.parseFloat(computed.paddingTop) || 0;
  const paddingBottom = Number.parseFloat(computed.paddingBottom) || 0;
  const borderTop = Number.parseFloat(computed.borderTopWidth) || 0;
  const borderBottom = Number.parseFloat(computed.borderBottomWidth) || 0;
  const shellHeight = paddingTop + paddingBottom + borderTop + borderBottom;
  const minHeight = lineHeight * CHAT_MIN_LINES + shellHeight;
  const maxHeight = lineHeight * CHAT_MAX_LINES + shellHeight;

  input.style.height = "auto";
  const nextHeight = Math.min(maxHeight, Math.max(minHeight, input.scrollHeight));
  input.style.height = `${nextHeight}px`;
  input.style.overflowY = input.scrollHeight > maxHeight ? "auto" : "hidden";
}

async function runProjectAction(payload: ActionPayload) {
  const response = await fetch("/api/project-actions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const data = (await response.json().catch(() => ({}))) as ActionResponse;
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || "动作执行失败");
  }
  return data;
}

export function ProjectWorkbench({ projects }: ProjectWorkbenchProps) {
  const allIds = useMemo(() => projects.map((project) => project.id), [projects]);
  const slugToId = useMemo(() => new Map(projects.map((project) => [project.slug, project.id])), [projects]);

  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("tracked");
  const [sortMode, setSortMode] = useState<SortMode>("activity");
  const [manualOrder, setManualOrder] = useState<string[]>(allIds);
  const [selectedId, setSelectedId] = useState(projects[0]?.id || "");
  const [draggingId, setDraggingId] = useState("");

  const [selectedIde, setSelectedIde] = useState<IdeTarget>("vscode");
  const [openTools, setOpenTools] = useState<OpenToolInfo[]>([]);
  const [openToolsBusy, setOpenToolsBusy] = useState(false);
  const [openToolsStatus, setOpenToolsStatus] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [actionStatus, setActionStatus] = useState("");
  const [bulkGithubSyncBusy, setBulkGithubSyncBusy] = useState(false);
  const [bulkGithubSyncStatus, setBulkGithubSyncStatus] = useState("");

  const [profile, setProfile] = useState<ProjectProfilePayload | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileStatus, setProfileStatus] = useState("");

  const [gitInfo, setGitInfo] = useState<GitInfoPayload | null>(null);
  const [gitBusy, setGitBusy] = useState(false);
  const [gitStatus, setGitStatus] = useState("");

  const [question, setQuestion] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [reasoningDepth, setReasoningDepth] = useState<ReasoningDepth>("medium");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatStatus, setChatStatus] = useState("");
  const [shotIndex, setShotIndex] = useState(0);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const savedOrder = loadStorage<string[]>(MANUAL_ORDER_STORAGE_KEY, []);
    setManualOrder(mergeManualOrder(savedOrder, allIds));
  }, [allIds]);

  useEffect(() => {
    setManualOrder((previous) => mergeManualOrder(previous, allIds));
  }, [allIds]);

  useEffect(() => {
    saveStorage(MANUAL_ORDER_STORAGE_KEY, manualOrder);
  }, [manualOrder]);

  const filteredProjects = useMemo(() => {
    if (scopeFilter === "all") {
      return projects;
    }
    return projects.filter((project) => project.scope === scopeFilter);
  }, [projects, scopeFilter]);

  const orderedProjects = useMemo(() => {
    if (sortMode === "manual") {
      const indexMap = new Map(manualOrder.map((id, index) => [id, index]));
      return [...filteredProjects].sort((left, right) => {
        const leftIndex = indexMap.get(left.id) ?? Number.MAX_SAFE_INTEGER;
        const rightIndex = indexMap.get(right.id) ?? Number.MAX_SAFE_INTEGER;
        if (leftIndex !== rightIndex) {
          return leftIndex - rightIndex;
        }
        return left.name.localeCompare(right.name);
      });
    }

    if (sortMode === "updatedAt") {
      return [...filteredProjects].sort((left, right) => (left.updatedAt > right.updatedAt ? -1 : 1));
    }

    if (sortMode === "relationScore") {
      return [...filteredProjects].sort(
        (left, right) => right.relationCount - left.relationCount || right.activityScore - left.activityScore
      );
    }

    if (sortMode === "name") {
      return [...filteredProjects].sort((left, right) => left.name.localeCompare(right.name));
    }

    return [...filteredProjects].sort(
      (left, right) => right.activityScore - left.activityScore || right.commitCount7d - left.commitCount7d
    );
  }, [filteredProjects, manualOrder, sortMode]);

  useEffect(() => {
    if (orderedProjects.length === 0) {
      setSelectedId("");
      return;
    }
    if (orderedProjects.some((project) => project.id === selectedId)) {
      return;
    }
    setSelectedId(orderedProjects[0].id);
  }, [orderedProjects, selectedId]);

  const activeProject = useMemo(
    () => orderedProjects.find((project) => project.id === selectedId) ?? orderedProjects[0] ?? null,
    [orderedProjects, selectedId]
  );
  const hostRepoPath = useMemo(
    () => (activeProject ? mapRepoPathToHost(activeProject.repoPath) : ""),
    [activeProject?.repoPath]
  );
  const vscodeUri = useMemo(() => toEditorUri("vscode://file", hostRepoPath), [hostRepoPath]);
  const cursorUri = useMemo(() => toEditorUri("cursor://file", hostRepoPath), [hostRepoPath]);

  const openToolMap = useMemo(() => new Map(openTools.map((tool) => [tool.id, tool])), [openTools]);
  const selectedToolInfo = useMemo(() => openToolMap.get(selectedIde), [openToolMap, selectedIde]);
  const selectedIdeCanOpenViaLink = selectedIde === "vscode" || selectedIde === "cursor";
  const canOpenSelectedIde = selectedIdeCanOpenViaLink || Boolean(selectedToolInfo?.available);
  const ideMenuOptions = useMemo(() => {
    const toolMap = new Map(openTools.map((tool) => [tool.id, tool]));
    return IDE_DEFAULT_OPTIONS.map((id) => {
      const tool = toolMap.get(id);
      return {
        id,
        label: ideLabel(id),
        available: tool?.available ?? false,
        reason: tool?.reason || "当前环境不可用"
      };
    });
  }, [openTools]);
  const openToolLabelMap = useMemo(() => new Map(openTools.map((tool) => [tool.id, tool.label])), [openTools]);

  useEffect(() => {
    if (!activeProject) {
      return;
    }
    setActionStatus("");
    setProfileStatus("");
    setGitStatus("");
    setChatStatus("");
    setQuestion("");
    setAttachments([]);
    clearAttachmentInput(attachmentInputRef.current);
    setShotIndex(0);
  }, [activeProject]);

  useEffect(() => {
    resizeChatInput(chatInputRef.current);
  }, [question, activeProject?.id]);

  useEffect(() => {
    if (!IDE_DEFAULT_OPTIONS.includes(selectedIde)) {
      setSelectedIde("vscode");
    }
  }, [selectedIde]);

  useEffect(() => {
    let active = true;

    async function fetchOpenTools() {
      setOpenToolsBusy(true);
      setOpenToolsStatus("");
      try {
        const response = await fetch("/api/system/open-tools");
        const payload = (await response.json().catch(() => ({}))) as OpenToolsResponse;
        if (!response.ok || payload.ok === false) {
          throw new Error(payload.error || "读取可用打开方式失败");
        }
        if (!active) {
          return;
        }
        const tools = Array.isArray(payload.tools)
          ? payload.tools.filter((tool): tool is OpenToolInfo => IDE_DEFAULT_OPTIONS.includes(tool.id))
          : [];
        setOpenTools(tools);
        if (tools.length === 0) {
          setOpenToolsStatus("未读取到 IDE 检测结果，将使用协议拉起方式。");
          return;
        }
        if (tools.every((tool) => !tool.available)) {
          setOpenToolsStatus("当前 Web 运行在 Docker 容器内，仅 VS Code / Cursor 协议拉起可直接使用。");
        }
      } catch (error) {
        if (!active) {
          return;
        }
        setOpenTools([]);
        setOpenToolsStatus(error instanceof Error ? error.message : "读取可用打开方式失败");
      } finally {
        if (active) {
          setOpenToolsBusy(false);
        }
      }
    }

    void fetchOpenTools();
    return () => {
      active = false;
    };
  }, []);

  async function fetchProjectProfile() {
    if (!activeProject) {
      return;
    }
    setProfileBusy(true);
    setProfileStatus("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/profile`);
      const payload = (await response.json().catch(() => ({}))) as ProjectProfilePayload;
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || "读取项目详情失败");
      }
      setProfile(payload);
    } catch (error) {
      setProfile(null);
      setProfileStatus(error instanceof Error ? error.message : "读取项目详情失败");
    } finally {
      setProfileBusy(false);
    }
  }

  async function fetchGitInfo(syncRemote: boolean) {
    if (!activeProject) {
      return;
    }
    setGitBusy(true);
    setGitStatus("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(activeProject.id)}/git`, {
        method: syncRemote ? "POST" : "GET"
      });
      const payload = (await response.json().catch(() => ({}))) as GitInfoPayload;
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || "读取 Git 信息失败");
      }
      setGitInfo(payload);
      if (syncRemote) {
        setGitStatus("已与远端同步并刷新版本信息。");
      }
    } catch (error) {
      setGitInfo(null);
      setGitStatus(error instanceof Error ? error.message : "读取 Git 信息失败");
    } finally {
      setGitBusy(false);
    }
  }

  useEffect(() => {
    if (!activeProject) {
      setProfile(null);
      setGitInfo(null);
      return;
    }
    void fetchProjectProfile();
    void fetchGitInfo(false);
  }, [activeProject?.id]);

  async function handleOpenProjectRoot() {
    if (!activeProject || !selectedIde) {
      return;
    }
    const ideName = openToolLabelMap.get(selectedIde) || ideLabel(selectedIde);
    const quickOpenUri =
      selectedIde === "vscode" ? vscodeUri : selectedIde === "cursor" ? cursorUri : null;
    if (quickOpenUri && typeof window !== "undefined") {
      window.location.href = quickOpenUri;
      setActionStatus(`已请求 ${ideName} 打开项目目录。`);
      return;
    }
    if (!selectedToolInfo?.available) {
      setActionStatus(selectedToolInfo?.reason || `${ideName} 当前不可用。`);
      return;
    }

    setActionBusy(true);
    setActionStatus("");
    try {
      await runProjectAction({
        projectId: activeProject.id,
        action: "open-with-tool",
        ideTarget: selectedIde
      });
      setActionStatus(`已通过 ${ideName} 打开项目根目录。`);
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : "打开项目目录失败");
    } finally {
      setActionBusy(false);
    }
  }

  async function handleSyncAllGithubRepos() {
    setBulkGithubSyncBusy(true);
    setBulkGithubSyncStatus("");
    try {
      const response = await fetch("/api/jobs/github-sync-all", {
        method: "POST"
      });
      const payload = (await response.json().catch(() => ({}))) as GithubSyncAllResponse;
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || "同步 GitHub 仓库失败");
      }
      if (payload.summary) {
        setBulkGithubSyncStatus(
          `已完成：总计 ${payload.summary.total}，成功 ${payload.summary.synced}，失败 ${payload.summary.failed}，跳过 ${payload.summary.skipped}。`
        );
      } else {
        setBulkGithubSyncStatus("已完成 GitHub 仓库同步。");
      }
    } catch (error) {
      setBulkGithubSyncStatus(error instanceof Error ? error.message : "同步 GitHub 仓库失败");
    } finally {
      setBulkGithubSyncBusy(false);
    }
  }

  async function handleAskCodex(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeProject) {
      return;
    }

    const trimmed = question.trim();
    if (!trimmed) {
      setChatStatus("请输入你希望 Codex 执行的任务。");
      return;
    }

    setChatBusy(true);
    setChatStatus("");
    try {
      const formData = new FormData();
      formData.set("projectId", activeProject.id);
      formData.set("message", trimmed);
      formData.set("planMode", "false");
      formData.set("model", model.trim());
      formData.set("reasoningDepth", reasoningDepth);
      for (const file of attachments) {
        formData.append("attachments", file);
      }

      const response = await fetch("/api/codex", {
        method: "POST",
        body: formData
      });
      const payload = (await response.json().catch(() => ({}))) as CodexResponse;
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || "提交 Codex 任务失败");
      }

      if (payload.codex?.queued) {
        const pidText = payload.codex.pid ? `（PID: ${payload.codex.pid}）` : "";
        setChatStatus(`任务已提交：${payload.taskId || "-"} ${pidText}`);
      } else {
        setChatStatus(`任务已记录：${payload.taskId || "-"}（未直接执行）`);
      }

      setQuestion("");
      setAttachments([]);
      clearAttachmentInput(attachmentInputRef.current);
    } catch (error) {
      setChatStatus(error instanceof Error ? error.message : "提交 Codex 任务失败");
    } finally {
      setChatBusy(false);
    }
  }

  function cycleModel() {
    const index = MODEL_OPTIONS.indexOf(model as (typeof MODEL_OPTIONS)[number]);
    const nextIndex = index < 0 ? 0 : (index + 1) % MODEL_OPTIONS.length;
    setModel(MODEL_OPTIONS[nextIndex]);
  }

  function cycleReasoningDepth() {
    const index = REASONING_DEPTH_OPTIONS.indexOf(reasoningDepth);
    const nextIndex = (index + 1) % REASONING_DEPTH_OPTIONS.length;
    setReasoningDepth(REASONING_DEPTH_OPTIONS[nextIndex]);
  }

  function openAttachmentPicker() {
    attachmentInputRef.current?.click();
  }

  function handleAttachmentChange(event: ChangeEvent<HTMLInputElement>) {
    setAttachments(Array.from(event.target.files || []));
  }

  function handleQuestionChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const nextValue = event.target.value;
    setQuestion(nextValue);
    resizeChatInput(event.target);
  }

  function handleSelectIde(option: IdeTarget) {
    setSelectedIde(option);
  }

  function onDropCard(targetId: string) {
    if (!draggingId || !targetId || draggingId === targetId) {
      return;
    }
    setSortMode("manual");
    setManualOrder((previous) => reorderIds(mergeManualOrder(previous, allIds), draggingId, targetId));
    setDraggingId("");
  }

  if (projects.length === 0) {
    return <section className="panel">暂无项目数据，请先触发同步。</section>;
  }

  if (!activeProject) {
    return <section className="panel">当前筛选条件下没有项目。</section>;
  }

  const remoteStateText =
    gitInfo?.syncState === "synced"
      ? "已同步"
      : gitInfo?.syncState === "ahead"
      ? "本地领先远程"
      : gitInfo?.syncState === "behind"
      ? "本地落后远程"
      : gitInfo?.syncState === "diverged"
      ? "本地与远程分叉"
      : gitInfo?.syncState === "no-upstream"
      ? "未配置 upstream"
      : "仅本地仓库";

  const environments = (profile?.environments || []).filter((environment) => environment.kind !== "reference");
  const screenshotGroups = buildScreenshotGroups((profile?.screenshots || []).slice(0, 3));
  const safeShotIndex = Math.min(shotIndex, Math.max(0, screenshotGroups.length - 1));
  const currentShotGroup = screenshotGroups[safeShotIndex] || null;
  const hasPreviousScreenshot = safeShotIndex > 0;
  const hasNextScreenshot = safeShotIndex < screenshotGroups.length - 1;
  const modelShortcutLabel = model === DEFAULT_MODEL ? "自定义" : model;
  const reasoningShortcutLabel =
    reasoningDepth === "high" ? "超高" : reasoningDepth === "medium" ? "中等" : "低";
  const selectedIdeIcon = ideIconAsset(selectedIde);
  const selectedIdeMenuLabel = ideShortLabel(selectedIde);
  const environmentEntries = environments.map((environment) => ({
    id: environment.id,
    label: environment.label,
    url: normalizeUrl(environment.url),
    kind: environment.kind
  }));
  const knownUrls = new Set(environmentEntries.map((item) => item.url).filter(Boolean));
  const productionEntry = activeProject.productionUrl
    ? {
        id: `${activeProject.id}-production`,
        label: "线上地址",
        url: normalizeUrl(activeProject.productionUrl),
        kind: "production" as const
      }
    : null;
  if (productionEntry?.url) {
    knownUrls.add(productionEntry.url);
  }
  const repositoryEntry = activeProject.sourceUrl
    ? {
        id: `${activeProject.id}-source`,
        label: "GitHub 仓库",
        url: normalizeRepositoryUrl(activeProject.sourceUrl),
        kind: "reference" as const
      }
    : null;
  const accessEntries = [
    ...environmentEntries,
    ...(productionEntry?.url ? [productionEntry] : []),
    ...(repositoryEntry?.url && !knownUrls.has(repositoryEntry.url) ? [repositoryEntry] : [])
  ];
  const inlineChatStatus =
    chatStatus ||
    actionStatus ||
    gitStatus ||
    profileStatus ||
    (openToolsStatus && !openToolsBusy ? openToolsStatus : "");
  const hasChatMeta = attachments.length > 0 || Boolean(inlineChatStatus);

  return (
    <section className="workbench-layout">
      <div className="panel workbench-left">
        <div className="workbench-toolbar">
          <label>
            范围
            <select value={scopeFilter} onChange={(event) => setScopeFilter(event.target.value as ScopeFilter)}>
              <option value="tracked">tracked</option>
              <option value="external">external</option>
              <option value="all">all</option>
            </select>
          </label>
          <label>
            排序
            <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
              <option value="activity">活跃度</option>
              <option value="updatedAt">最近更新</option>
              <option value="relationScore">关联度</option>
              <option value="name">名称</option>
              <option value="manual">手动拖动</option>
            </select>
          </label>
          <button
            type="button"
            className="workbench-sync-all-btn"
            disabled={bulkGithubSyncBusy}
            onClick={handleSyncAllGithubRepos}
            title="同步所有项目到 GitHub 远程"
          >
            {bulkGithubSyncBusy ? "同步中..." : "↻ GitHub"}
          </button>
          {bulkGithubSyncStatus ? <p className="muted workbench-sync-status">{bulkGithubSyncStatus}</p> : null}
        </div>

        <div className="workbench-cards">
          {orderedProjects.map((project) => {
            const cardSummary = compactCardText(project.readmePreview || project.summary);
            const cardTechTags = project.techStack.map((tag) => compactTechTag(tag)).filter(Boolean).slice(0, 2);
            return (
              <article
                key={project.id}
                className={project.id === activeProject.id ? "workbench-card is-active" : "workbench-card"}
                draggable
                onDragStart={() => setDraggingId(project.id)}
                onDragOver={(event: DragEvent<HTMLElement>) => {
                  event.preventDefault();
                }}
                onDrop={() => onDropCard(project.id)}
                onClick={() => setSelectedId(project.id)}
              >
                <div className="workbench-card-shell">
                  <div className="workbench-card-content">
                    <div className="workbench-card-head">
                      <h3>{project.name}</h3>
                      <div className="workbench-card-head-side">
                        <span className="workbench-card-date">{formatCardDate(project.lastCommitAt)}</span>
                        <span
                          className={
                            project.visibilityType === "github"
                              ? "workbench-card-github is-synced"
                              : "workbench-card-github is-unsynced"
                          }
                          title={project.visibilityType === "github" ? "GitHub 已同步" : "未同步 GitHub"}
                          aria-label={project.visibilityType === "github" ? "GitHub 已同步" : "未同步 GitHub"}
                        >
                          <svg viewBox="0 0 16 16" aria-hidden="true">
                            <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38c0-.19-.01-.82-.01-1.49c-2.01.37-2.53-.49-2.69-.94c-.09-.23-.48-.94-.82-1.13c-.28-.15-.68-.52-.01-.53c.63-.01 1.08.58 1.23.82c.72 1.21 1.87.87 2.33.66c.07-.52.28-.87.5-1.07c-1.78-.2-3.64-.89-3.64-3.95c0-.87.31-1.59.82-2.15c-.08-.2-.36-1.02.08-2.12c0 0 .67-.21 2.2.82a7.7 7.7 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82c.44 1.1.16 1.92.08 2.12c.51.56.82 1.27.82 2.15c0 3.07-1.87 3.75-3.65 3.95c.29.25.54.73.54 1.48c0 1.07-.01 1.93-.01 2.2c0 .22.15.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8" />
                          </svg>
                        </span>
                      </div>
                    </div>
                    <p>{cardSummary}</p>
                    {cardTechTags.length > 0 ? (
                      <div className="workbench-card-tech">
                        {cardTechTags.map((tag) => (
                          <span key={`${project.id}-${tag}`}>{tag}</span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className={project.cardScreenshotUrl ? "workbench-card-preview" : "workbench-card-preview is-empty"}>
                    {project.cardScreenshotUrl ? (
                      <img src={project.cardScreenshotUrl} alt={`${project.name} 预览`} loading="lazy" />
                    ) : (
                      <span>暂无预览</span>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>

      <aside className="panel workbench-right">
        <header className="workbench-detail-head">
          <div className="workbench-detail-line">
            <h2>{activeProject.name}</h2>
            <p className="muted">
              最近提交 {formatDate(activeProject.lastCommitAt)} · 30天提交 {activeProject.commitCount30d}
            </p>
          </div>
        </header>

        <section className="workbench-section workbench-section-visual">
          <h3>界面</h3>
          {profileBusy ? <p className="muted">正在分析界面信息并抓取截图...</p> : null}
          <div className={currentShotGroup ? `workbench-shot-stage is-${currentShotGroup.kind}` : "workbench-shot-stage"}>
            {currentShotGroup ? (
              <>
                <div className={`workbench-shot-grid is-${currentShotGroup.kind}`}>
                  {currentShotGroup.shots.map((shot) => (
                    <figure key={shot.id} className="workbench-shot-card is-panel">
                      <img
                        src={shot.url}
                        alt={`${activeProject.name}${currentShotGroup.kind === "mobile" ? "移动端" : "网页端"}截图`}
                        loading="lazy"
                      />
                    </figure>
                  ))}
                </div>
                <div className="workbench-shot-controls">
                  <button
                    type="button"
                    className="workbench-shot-arrow"
                    onClick={() => setShotIndex((previous) => Math.max(0, previous - 1))}
                    disabled={!hasPreviousScreenshot}
                    aria-label="上一组截图"
                  >
                    ‹
                  </button>
                  <span>{currentShotGroup.kind === "mobile" ? "移动端" : "网页端"}</span>
                  <button
                    type="button"
                    className="workbench-shot-arrow"
                    onClick={() => setShotIndex((previous) => Math.min(screenshotGroups.length - 1, previous + 1))}
                    disabled={!hasNextScreenshot}
                    aria-label="下一组截图"
                  >
                    ›
                  </button>
                </div>
                {currentShotGroup.sourceUrl ? (
                  <a href={currentShotGroup.sourceUrl} target="_blank" rel="noreferrer" className="workbench-shot-source">
                    来源
                  </a>
                ) : null}
              </>
            ) : (
              <div className="workbench-shot-empty">暂无可用截图</div>
            )}
          </div>
          {screenshotGroups.length === 0 ? <p className="muted">暂未抓到界面截图，请先启动项目后刷新此页。</p> : null}
        </section>

        <section className="workbench-section">
          <h3>访问入口</h3>
          <div className="workbench-env-list is-scrollable">
            {accessEntries.map((entry) => (
              <article key={entry.id} className="workbench-env-row">
                <p>{entry.label}</p>
                <a href={entry.url} target="_blank" rel="noreferrer">
                  {entry.url}
                </a>
                <span className={`workbench-env-kind is-${entry.kind}`}>
                  {entry.kind === "reference" ? "github" : entry.kind}
                </span>
              </article>
            ))}
          </div>
          {accessEntries.length === 0 ? <p className="muted">暂无可识别访问入口。</p> : null}
        </section>

        <section className="workbench-section">
          <h3>关联</h3>
          {activeProject.topRelations.length === 0 ? (
            <p className="muted">暂无高置信度关联项目。</p>
          ) : (
            <ul className="workbench-relation-list">
              {activeProject.topRelations.slice(0, 8).map((relation) => {
                const relatedId = slugToId.get(relation.slug);
                const relationFacts = relationFactLines(relation.evidence, relation.explanation);
                return (
                  <li key={`${activeProject.id}-${relation.slug}-${relation.type}`}>
                    <div className="workbench-relation-row">
                      <button type="button" disabled={!relatedId} onClick={() => relatedId && setSelectedId(relatedId)}>
                        {relation.name}
                      </button>
                      <span className="workbench-relation-pill">{relationTypeLabel(relation.type)}</span>
                    </div>
                    {relationFacts.length === 0 ? (
                      <p className="workbench-relation-fact is-muted">暂无可解析关系事实</p>
                    ) : (
                      relationFacts.map((fact, factIndex) => (
                        <p key={`${activeProject.id}-${relation.slug}-${factIndex}`} className="workbench-relation-fact">
                          {fact}
                        </p>
                      ))
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="workbench-section is-chat-dock">
          <form className="workbench-chat" onSubmit={handleAskCodex}>
            <textarea
              ref={chatInputRef}
              rows={CHAT_MIN_LINES}
              value={question}
              onChange={handleQuestionChange}
              placeholder="告诉 Codex 下一步要做什么..."
            />
            <div className="workbench-chat-footer">
              <button
                type="button"
                className="workbench-attach-btn"
                onClick={openAttachmentPicker}
                aria-label="添加附件"
                title="添加附件"
              >
                +
              </button>
              <div className="workbench-ide-split">
                <button
                  type="button"
                  className="workbench-ide-main-btn"
                  disabled={actionBusy || !canOpenSelectedIde}
                  onClick={handleOpenProjectRoot}
                >
                  <span className={`workbench-ide-icon is-${selectedIde}`}>
                    {selectedIdeIcon ? <img src={selectedIdeIcon} alt="" aria-hidden="true" /> : ideIconGlyph(selectedIde)}
                  </span>
                  <span>打开</span>
                </button>
                <div className="workbench-ide-menu">
                  <span className="workbench-ide-menu-label">{selectedIdeMenuLabel}</span>
                  <span className="workbench-ide-menu-caret" aria-hidden="true">
                    ⌄
                  </span>
                  <select
                    className="workbench-ide-native"
                    aria-label="选择 IDE"
                    value={selectedIde}
                    onChange={(event) => handleSelectIde(event.target.value as IdeTarget)}
                  >
                    {ideMenuOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.available || option.id === "vscode" || option.id === "cursor"
                          ? option.label
                          : `${option.label}（当前环境不可用）`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <details className="workbench-github-drawer">
                <summary>GitHub</summary>
                <div className="workbench-github-panel">
                  <div className="workbench-github-head">
                    <p className="muted">
                      分支 {gitInfo?.branch || "未知"} · {remoteStateText}
                      {typeof gitInfo?.ahead === "number" && typeof gitInfo?.behind === "number"
                        ? `（ahead ${gitInfo.ahead} / behind ${gitInfo.behind}）`
                        : ""}
                    </p>
                    <button type="button" disabled={gitBusy} onClick={() => fetchGitInfo(true)}>
                      {gitBusy ? "同步中..." : gitInfo?.syncState === "synced" ? "刷新" : "同步"}
                    </button>
                  </div>
                  {gitInfo?.upstream ? <p className="muted">upstream: {gitInfo.upstream}</p> : null}
                  {gitInfo?.commits?.length ? (
                    <div className="workbench-commit-scroll">
                      {gitInfo.commits.map((commit) => (
                        <article key={commit.hash}>
                          <p>{commit.subject}</p>
                          <p className="muted">
                            {commit.shortHash} · {commit.author} · {formatDate(commit.date)}
                          </p>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">暂无提交记录。</p>
                  )}
                </div>
              </details>
              <button type="button" className="workbench-text-toggle" onClick={cycleModel}>
                <span>{modelShortcutLabel}</span>
                <span aria-hidden="true">⌄</span>
              </button>
              <button type="button" className="workbench-text-toggle" onClick={cycleReasoningDepth}>
                <span>{reasoningShortcutLabel}</span>
                <span aria-hidden="true">⌄</span>
              </button>
              <input
                ref={attachmentInputRef}
                type="file"
                multiple
                accept=".txt,.md,.markdown,.json,.js,.mjs,.cjs,.ts,.tsx,.jsx,.py,.yaml,.yml,.csv,.log,text/plain,text/markdown,application/json"
                onChange={handleAttachmentChange}
                className="workbench-hidden-file"
              />
              <button type="submit" className="workbench-send-btn" disabled={chatBusy} aria-label="发送">
                ↑
              </button>
            </div>
            {hasChatMeta ? (
              <div className="workbench-chat-meta">
                {attachments.length ? <p className="muted">已附加 {attachments.length} 个文件</p> : null}
                {inlineChatStatus ? <p className="muted">{inlineChatStatus}</p> : null}
              </div>
            ) : null}
          </form>
        </section>
      </aside>
    </section>
  );
}
