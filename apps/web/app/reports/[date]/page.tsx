import { notFound } from "next/navigation";
import { SectionList } from "../../../components/section-list";
import { queryReportByDate } from "../../../lib/queries";

export const dynamic = "force-dynamic";

export default async function ReportDetailPage({ params }: { params: { date: string } }) {
  const report = await queryReportByDate(params.date);
  if (!report) {
    notFound();
  }

  return (
    <div className="page-stack">
      <section className="panel">
        <h2>{report.date} 日报</h2>
        <p className="muted">生成时间 {report.generatedAt}</p>
        <p className="muted">归档路径 {report.markdownPath}</p>
      </section>
      <SectionList title="今日重点" items={report.highlights} />
      <SectionList title="新近活跃项目" items={report.newlyActive} />
      <SectionList title="降温项目" items={report.coolingDown} />
      <SectionList title="关联发现" items={report.relationFindings} />
      <SectionList title="展示候选更新" items={report.portfolioUpdates} />
    </div>
  );
}
