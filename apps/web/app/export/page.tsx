import { queryProjects } from "../../lib/queries";

export const dynamic = "force-dynamic";

export default async function ExportPage() {
  const projects = await queryProjects("tracked", "activity");

  return (
    <div className="page-stack">
      <section className="panel">
        <h2>Portfolio Export</h2>
        <p className="muted">个人网站可直接消费接口：/api/portfolio/projects.json</p>
      </section>

      <section className="panel">
        <h3>预览字段（前 8 个项目）</h3>
        <div className="json-preview">
          <pre>
            {JSON.stringify(
              projects.slice(0, 8).map((project) => ({
                id: project.id,
                name: project.name,
                slug: project.slug,
                summary: project.summary,
                techStack: project.techStack,
                activityScore: project.activityScore,
                relationCount: project.relationCount,
                topRelations: project.topRelations
              })),
              null,
              2
            )}
          </pre>
        </div>
      </section>
    </div>
  );
}
