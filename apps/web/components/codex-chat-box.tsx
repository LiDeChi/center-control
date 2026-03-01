"use client";

import { useMemo, useState, type FormEvent } from "react";

type CodexChatBoxProps = {
  projectId: string;
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

export function CodexChatBox({ projectId }: CodexChatBoxProps) {
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [inputKey, setInputKey] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const disabled = useMemo(() => submitting, [submitting]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = message.trim();
    if (!trimmed) {
      setStatusText("请输入消息内容。");
      return;
    }

    setSubmitting(true);
    setStatusText("");

    try {
      const formData = new FormData();
      formData.set("projectId", projectId);
      formData.set("message", trimmed);
      for (const file of files) {
        formData.append("attachments", file);
      }

      const response = await fetch("/api/codex", {
        method: "POST",
        body: formData
      });

      const payload = (await response.json().catch(() => ({}))) as CodexResponse;
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || "Codex request failed");
      }

      const taskId = payload.taskId || "-";
      if (payload.codex?.queued) {
        const pidText = payload.codex.pid ? ` (pid: ${payload.codex.pid})` : "";
        setStatusText(`任务已提交：${taskId}${pidText}`);
      } else {
        setStatusText(`任务已记录：${taskId}（未触发 codex 命令）`);
      }

      setMessage("");
      setFiles([]);
      setInputKey((prev) => prev + 1);
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Codex request failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="codex-chat-box">
      <textarea
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        placeholder="输入要让 Codex CLI 执行的任务..."
        className="codex-chat-input"
      />

      <label className="codex-chat-label">
        附件（文本类）
        <input
          key={inputKey}
          type="file"
          multiple
          accept=".txt,.md,.markdown,.json,.js,.mjs,.cjs,.ts,.tsx,.jsx,.py,.yaml,.yml,.csv,.log,text/plain,text/markdown,application/json"
          className="codex-chat-file"
          onChange={(event) => setFiles(Array.from(event.target.files || []))}
        />
      </label>

      {files.length > 0 ? <p className="muted">已选择 {files.length} 个附件</p> : null}

      <button type="submit" disabled={disabled} className={`codex-chat-submit ${disabled ? "is-disabled" : ""}`}>
        {disabled ? "提交中..." : "发送到 Codex"}
      </button>

      {statusText ? <p className="muted">{statusText}</p> : null}
    </form>
  );
}
