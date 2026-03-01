"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { CodexChatBox } from "./codex-chat-box";
import { ProjectActionBar } from "./project-action-bar";
import type { ProjectViewProject } from "./project-card";

type ProjectFocusViewProps = {
  projects: ProjectViewProject[];
};

function formatLastCommit(lastCommitAt: string | null) {
  return lastCommitAt ? lastCommitAt.slice(0, 10) : "暂无";
}

function renderProductionUrl(url: string | null) {
  if (!url) {
    return <span className="muted">未配置</span>;
  }

  return (
    <a className="project-url-link" href={url} target="_blank" rel="noreferrer" title={url}>
      {url}
    </a>
  );
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
    return "时间聚类";
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

export function ProjectFocusView({ projects }: ProjectFocusViewProps) {
  const [activeProjectId, setActiveProjectId] = useState(projects[0]?.id ?? "");
  const scrollRootRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    if (projects.length === 0) {
      setActiveProjectId("");
      return;
    }
    if (projects.some((project) => project.id === activeProjectId)) {
      return;
    }
    setActiveProjectId(projects[0].id);
  }, [projects, activeProjectId]);

  useEffect(() => {
    const root = scrollRootRef.current;
    if (!root || projects.length === 0) {
      return;
    }

    const visibilityById = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const node = entry.target as HTMLElement;
          const projectId = node.dataset.projectId;
          if (!projectId) {
            continue;
          }
          visibilityById.set(projectId, entry.isIntersecting ? entry.intersectionRatio : 0);
        }

        let nextProjectId: string | null = null;
        let bestScore = 0;
        for (const [projectId, score] of visibilityById.entries()) {
          if (score > bestScore) {
            bestScore = score;
            nextProjectId = projectId;
          }
        }

        if (nextProjectId) {
          setActiveProjectId((prev) => (prev === nextProjectId ? prev : nextProjectId));
        }
      },
      {
        root,
        threshold: [0.25, 0.45, 0.7]
      }
    );

    for (const project of projects) {
      const node = itemRefs.current[project.id];
      if (node) {
        observer.observe(node);
      }
    }

    return () => {
      observer.disconnect();
    };
  }, [projects]);

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? projects[0] ?? null,
    [projects, activeProjectId]
  );

  if (!activeProject) {
    return null;
  }

  const defaultCommand =
    activeProject.localStartCommand.includes("未自动识别") || !activeProject.localStartCommand.trim()
      ? "npm run dev"
      : activeProject.localStartCommand;
  const topRelations = activeProject.topRelations.slice(0, 4);

  return (
    <section className="project-focus-layout">
      <div className="panel project-focus-list">
        <div className="project-focus-scroll" ref={scrollRootRef}>
          {projects.map((project) => {
            const isActive = project.id === activeProject.id;
            return (
              <article
                key={project.id}
                ref={(node) => {
                  itemRefs.current[project.id] = node;
                }}
                data-project-id={project.id}
                className={isActive ? "project-focus-item is-active" : "project-focus-item"}
                onClick={() => setActiveProjectId(project.id)}
              >
                <header className="project-focus-head">
                  <h3>{project.name}</h3>
                  <span className="activity-pill">活跃度 {project.activityScore}</span>
                </header>
                <p className="project-meta">
                  {project.visibilityType === "local" ? "本地仓库" : "GitHub 同步"} · {project.scope}
                </p>
                <p className="project-focus-text">{project.summary}</p>
                <p className="project-focus-secondary">{project.readmePreview || "暂无补充详情"}</p>
                <div className="tag-row tag-row-compact">
                  {project.techStack.slice(0, 3).map((tag) => (
                    <span key={`${project.id}-${tag}`}>{tag}</span>
                  ))}
                </div>
                <p className="project-subline">
                  7天提交 {project.commitCount7d} · 最近提交 {formatLastCommit(project.lastCommitAt)} · 关联 {project.relationCount}
                </p>
              </article>
            );
          })}
        </div>
      </div>

      <aside className="panel project-focus-side">
        <div className="project-focus-side-inner">
          <div>
            <p className="project-field-label">当前滑到的项目</p>
            <h3 className="project-focus-side-title">{activeProject.name}</h3>
            <p className="project-meta">
              {activeProject.visibilityType === "local" ? "本地仓库" : "GitHub 同步"} · {activeProject.scope}
            </p>
          </div>

          <div className="project-rich-block">
            <p className="project-field-label">详情</p>
            <p className="project-rich-text">{activeProject.readmePreview || activeProject.summary}</p>
          </div>

          <div className="project-inline-grid">
            <div>
              <p className="project-field-label">生产 URL</p>
              <p className="project-link-wrap">{renderProductionUrl(activeProject.productionUrl)}</p>
            </div>
            <div>
              <p className="project-field-label">本地命令</p>
              <p className="project-command">{activeProject.localStartCommand}</p>
            </div>
          </div>

          <div className="project-focus-stats">
            <span>活跃度 {activeProject.activityScore}</span>
            <span>7天提交 {activeProject.commitCount7d}</span>
            <span>30天提交 {activeProject.commitCount30d}</span>
            <span>关联 {activeProject.relationCount}</span>
          </div>

          <div className="project-rich-block">
            <div className="project-relation-head">
              <p className="project-field-label">关联快览</p>
              <Link href={`/relations?projectId=${encodeURIComponent(activeProject.id)}`} className="project-relation-link">
                查看全部
              </Link>
            </div>
            {topRelations.length === 0 ? (
              <p className="project-rich-text muted">暂无高置信度关联项目</p>
            ) : (
              <ul className="project-relation-list">
                {topRelations.map((relation) => {
                  const facts = relationFactLines(relation.evidence || [], relation.explanation || "");
                  return (
                    <li key={`${activeProject.id}-${relation.slug}-${relation.type}`}>
                      <div className="project-relation-headline">
                        <p className="project-relation-name">{relation.name}</p>
                        <span className="project-relation-pill">{relationTypeLabel(relation.type)}</span>
                      </div>
                      {facts.length === 0 ? (
                        <p className="project-relation-type">暂无可解析关系事实</p>
                      ) : (
                        <div className="project-relation-facts">
                          {facts.map((fact, index) => (
                            <p key={`${activeProject.id}-${relation.slug}-${index}`}>{fact}</p>
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <ProjectActionBar projectId={activeProject.id} defaultLocalStartCommand={defaultCommand} />
          <details className="project-codex-details">
            <summary>Codex Chatbox（可附文件）</summary>
            <CodexChatBox projectId={activeProject.id} />
          </details>
        </div>
      </aside>
    </section>
  );
}
