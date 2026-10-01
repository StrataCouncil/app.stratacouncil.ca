import { groupByCategory, resolutionTypeShort, type AgendaItem } from "@/lib/meetings/agenda";

/** The agenda as members see it: no editing, no private notes. */
export function AgendaView({ agenda }: { agenda: AgendaItem[] }) {
  if (agenda.length === 0) return <p className="card__meta">The agenda hasn&rsquo;t been built yet.</p>;
  return (
    <div className="agenda-builder" data-testid="agenda-view">
      {groupByCategory(agenda).map((cat) => (
        <div className="agenda-cat" key={cat.id}>
          <div className="agenda-cat__head">
            <h3 className="agenda-cat__label">{cat.name}</h3>
          </div>
          <ol className="agenda-items">
            {cat.items.map((it) => (
              <li className="agenda-item" key={it.id}>
                <span className="agenda-item__num">{it.num}.</span>
                <span className="agenda-item__text">
                  {it.text}
                  {it.motion?.text && <span className="agenda-item__motion">{it.motion.text}</span>}
                </span>
                {it.deferred && <span className="pill">Deferred</span>}
                <span className={`rtag rtag--${it.type.toLowerCase()}`}>{resolutionTypeShort[it.type]}</span>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}
