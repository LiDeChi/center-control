import type { ReactNode } from "react";
import type { queryProjects } from "../lib/queries";
import { CodexChatBox } from "./codex-chat-box";
import { ProjectActionBar } from "./project-action-bar";

export type ProjectViewProject = Awaited<ReturnType<typeof queryProjects>>[number] & {
  readmePreview: string;
  instructionSummary: string;
  productionUrl: string | null;
  localStartCommand: string;
};

type ProjectActionRenderer = (project: ProjectViewProject) => ReactNode;

type ProjectItemProps = {
  project: ProjectViewProject;
  actions?: ProjectActionRenderer;
};

function renderActionSlot(project: ProjectViewProject, actions?: ProjectActionRenderer) {
  const content = actions ? actions(project) : null;
  if (content) {
    return content;
  }
  return (
    <div className="project-action-stack">
      <ProjectActionBar
        projectId={project.id}
        defaultLocalStartCommand={project.localStartCommand.includes("未自动识别") ? "npm run dev" : project.localStartCommand}
      />
      <details className="project-codex-details">
        <summary>Codex Chatbox（可附文件）</summary>
        <CodexChatBox projectId={project.id} />
      </details>
    </div>
  );
}

function formatLastCommit(lastCommitAt: string | null) {
  return lastCommitAt ? lastCommitAt.slice(0, 10) : "暂无";
}

function renderProductionUrl(productionUrl: string | null) {
  if (!productionUrl) {
    return <span className="muted">未配置</span>;
  }

  return (
    <a className="project-url-link" href={productionUrl} target="_blank" rel="noreferrer" title={productionUrl}>
      {productionUrl}
    </a>
  );
}

export function ProjectCard({ project, actions }: ProjectItemProps) {
  return (
    <article className="project-card">
      <header>
        <div className="project-headline">
          <h3>{project.name}</h3>
          <p className="project-meta">
            {project.visibilityType === "local" ? "本地仓库" : "GitHub 同步"} · {project.scope}
          </p>
        </div>
        <p className="activity-pill">活跃度 {project.activityScore}</p>
      </header>
      <p className="project-summary">{project.summary}</p>
      <p className="project-subline">
        7天提交 {project.commitCount7d} · 最近提交 {formatLastCommit(project.lastCommitAt)} · 关联 {project.relationCount}
      </p>
      <div className="project-rich-block">
        <p className="project-field-label">README 预览</p>
        <p className="project-rich-text">{project.readmePreview}</p>
      </div>
      <div className="project-rich-block">
        <p className="project-field-label">Instruction 摘要</p>
        <p className="project-rich-text">{project.instructionSummary}</p>
      </div>
      <div className="project-inline-grid">
        <div>
          <p className="project-field-label">生产 URL</p>
          <p className="project-link-wrap">{renderProductionUrl(project.productionUrl)}</p>
        </div>
        <div>
          <p className="project-field-label">本地启动命令</p>
          <p className="project-command">{project.localStartCommand}</p>
        </div>
      </div>
      <div className="tag-row">
        {project.techStack.slice(0, 5).map((tag) => (
          <span key={`${project.slug}-${tag}`}>{tag}</span>
        ))}
      </div>
      <footer className="project-actions">{renderActionSlot(project, actions)}</footer>
    </article>
  );
}

export function ProjectListRow({ project, actions }: ProjectItemProps) {
  return (
    <article className="project-list-item">
      <header className="project-list-head">
        <div className="project-list-main">
          <strong>{project.name}</strong>
          <p className="project-meta">
            {project.visibilityType === "local" ? "本地仓库" : "GitHub 同步"} · {project.scope}
          </p>
          <div className="tag-row tag-row-compact">
            {project.techStack.slice(0, 4).map((tag) => (
              <span key={`${project.slug}-list-${tag}`}>{tag}</span>
            ))}
          </div>
        </div>
        <div className="project-list-stats">
          <p>活跃度 {project.activityScore}</p>
          <p>7天提交 {project.commitCount7d}</p>
          <p>最近提交 {formatLastCommit(project.lastCommitAt)}</p>
          <p>关联 {project.relationCount}</p>
        </div>
      </header>

      <section className="project-list-body">
        <div className="project-rich-block">
          <p className="project-field-label">简介 & README</p>
          <p className="project-list-brief">{project.summary}</p>
          <p className="project-list-brief muted">{project.readmePreview}</p>
        </div>

        <div className="project-rich-block">
          <p className="project-field-label">Instruction 摘要</p>
          <p className="project-list-brief">{project.instructionSummary}</p>
        </div>

        <div className="project-inline-grid project-list-inline-grid">
          <div>
            <p className="project-field-label">生产 URL</p>
            <p className="project-link-wrap">{renderProductionUrl(project.productionUrl)}</p>
          </div>
          <div>
            <p className="project-field-label">本地命令</p>
            <p className="project-command">{project.localStartCommand}</p>
          </div>
        </div>
      </section>

      <footer className="project-actions project-actions-inline">{renderActionSlot(project, actions)}</footer>
    </article>
  );
}
