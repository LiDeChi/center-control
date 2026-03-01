type SectionListProps = {
  title: string;
  items: string[];
};

export function SectionList({ title, items }: SectionListProps) {
  return (
    <section className="section-list">
      <h3>{title}</h3>
      <ul>
        {items.length === 0 ? <li>暂无</li> : null}
        {items.map((item, index) => (
          <li key={`${title}-${index}`}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
