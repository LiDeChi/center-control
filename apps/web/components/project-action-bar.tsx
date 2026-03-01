"use client";

import { useMemo, useState } from "react";

type ProjectAction = "open-ide" | "open-folder" | "start-local" | "open-production";

type ProjectActionBarProps = {
  projectId: string;
  defaultLocalStartCommand?: string;
};

type ActionResponse = {
  ok?: boolean;
  error?: string;
  pid?: number;
  productionUrl?: string;
};

const actions: Array<{ id: ProjectAction; label: string }> = [
  { id: "open-ide", label: "IDE 打开" },
  { id: "open-folder", label: "文件夹打开" },
  { id: "start-local", label: "本地启动" },
  { id: "open-production", label: "进入生产" }
];

export function ProjectActionBar({ projectId, defaultLocalStartCommand }: ProjectActionBarProps) {
  const [localStartCommand, setLocalStartCommand] = useState(
    defaultLocalStartCommand && defaultLocalStartCommand.trim() ? defaultLocalStartCommand : "npm run dev"
  );
  const [pendingAction, setPendingAction] = useState<ProjectAction | null>(null);
  const [statusText, setStatusText] = useState("");
  const busy = useMemo(() => pendingAction !== null, [pendingAction]);

  async function runAction(action: ProjectAction) {
    setPendingAction(action);
    setStatusText("");

    try {
      const response = await fetch("/api/project-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          projectId,
          action,
          localStartCommand
        })
      });

      const payload = (await response.json().catch(() => ({}))) as ActionResponse;
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || "Action request failed");
      }

      if (action === "start-local" && payload.pid) {
        setStatusText(`本地进程已启动，PID: ${payload.pid}`);
        return;
      }

      if (action === "open-production" && payload.productionUrl) {
        window.open(payload.productionUrl, "_blank", "noopener,noreferrer");
        setStatusText(`已打开生产地址：${payload.productionUrl}`);
        return;
      }

      setStatusText("动作已完成。");
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "动作执行失败");
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div className="project-action-bar">
      <div className="project-action-grid">
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            className={`project-action-btn ${pendingAction === action.id ? "is-active" : ""}`}
            disabled={busy}
            onClick={() => runAction(action.id)}
          >
            {pendingAction === action.id ? "处理中..." : action.label}
          </button>
        ))}
      </div>

      <label className="project-action-label">
        本地启动命令
        <input
          value={localStartCommand}
          onChange={(event) => setLocalStartCommand(event.target.value)}
          placeholder="npm run dev"
          className="project-action-input"
        />
      </label>

      {statusText ? <p className="muted project-action-status">{statusText}</p> : null}
    </div>
  );
}
