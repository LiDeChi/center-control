import Link from "next/link";
import { queryReports } from "../../lib/queries";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const reports = await queryReports(30);

  return (
    <div className="page-stack">
      <section className="panel">
        <h2>日报历史</h2>
        <p className="muted">应用内浏览 + 本地 Markdown 文件归档</p>
      </section>

      <section className="panel">
        <ul className="report-list">
          {reports.length === 0 ? <li>暂无日报，等待 worker 自动生成。</li> : null}
          {reports.map((report) => (
            <li key={report.id}>
              <div>
                <strong>{report.date}</strong>
                <p>重点 {report.highlights.length} 条 · 关联 {report.relationFindings.length} 条</p>
              </div>
              <div className="report-links">
                <Link href={`/reports/${report.date}`}>查看</Link>
                <span className="muted">{report.markdownPath}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
