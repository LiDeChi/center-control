import { queryRelations } from "../../lib/queries";

export const dynamic = "force-dynamic";

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

function relationFacts(evidence: string[], explanation: string) {
  const prioritized = evidence.filter(
    (line) =>
      line.startsWith("共享库:") ||
      line.startsWith("调用关系:") ||
      line.startsWith("关系类型:") ||
      line.startsWith("辅助信号:")
  );

  if (prioritized.length > 0) {
    return prioritized.slice(0, 4);
  }

  const fallback = explanation.trim();
  if (!fallback) {
    return [];
  }

  return [fallback];
}

export default async function RelationsPage({ searchParams }: { searchParams: { projectId?: string } }) {
  const relations = await queryRelations(searchParams.projectId);

  return (
    <div className="page-stack">
      <section className="panel">
        <h2>关联发现</h2>
        <p className="muted">规则引擎 + LiteLLM 摘要，支持按项目过滤</p>
      </section>

      <section className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>项目A</th>
              <th>项目B</th>
              <th>类型</th>
              <th>关系事实</th>
              <th>备注</th>
            </tr>
          </thead>
          <tbody>
            {relations.length === 0 ? (
              <tr>
                <td colSpan={5}>暂无关系数据，先执行同步。</td>
              </tr>
            ) : null}
            {relations.map((relation) => {
              const facts = relationFacts(relation.evidence, relation.explanation);
              return (
                <tr key={relation.id}>
                  <td>{relation.project.name}</td>
                  <td>{relation.relatedProject.name}</td>
                  <td>{relationTypeLabel(relation.type)}</td>
                  <td>
                    {facts.length === 0 ? (
                      <span className="muted">暂无关系事实</span>
                    ) : (
                      <ul className="relation-evidence-list">
                        {facts.map((fact, index) => (
                          <li key={`${relation.id}-${index}`}>{fact}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td>{relation.explanation}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
