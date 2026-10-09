import { Fragment } from "react";
import { inlineParts, parseMarkup, type Block, type BoxTone } from "@/lib/library/markup";

/**
 * A Library item's content (lib/library/markup.ts), as members read it and
 * as the console previews it. Purely informational: checklist items are
 * printed boxes, nothing to tick.
 */
export function LibraryArticle({ markup }: { markup: string }) {
  return (
    <div className="lib-article" data-testid="library-article">
      <Blocks blocks={parseMarkup(markup)} />
    </div>
  );
}

const BOX_LABELS: Record<BoxTone, string | null> = {
  summary: null,
  important: "Important",
  warning: "Caution",
  note: "Note",
  sample: "Sample",
};

function Inline({ text }: { text: string }) {
  return (
    <>
      {inlineParts(text).map((p, i) => (typeof p === "string" ? <Fragment key={i}>{p}</Fragment> : <strong key={i}>{p.bold}</strong>))}
    </>
  );
}

function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.type) {
          case "heading": {
            const H = b.level === 2 ? "h2" : "h3";
            return (
              <H key={i} id={b.id} className={`lib-article__h${b.level}`}>
                <span>
                  <Inline text={b.text} />
                </span>
                {b.timing && <span className="lib-article__timing">{b.timing}</span>}
              </H>
            );
          }
          case "paragraph":
            return (
              <p key={i}>
                <Inline text={b.text} />
              </p>
            );
          case "list": {
            const L = b.style === "number" ? "ol" : "ul";
            return (
              <L key={i} className={`lib-article__list lib-article__list--${b.style}`}>
                {b.items.map((item, j) => (
                  <li key={j}>
                    <Inline text={item} />
                  </li>
                ))}
              </L>
            );
          }
          case "table":
            return (
              <div key={i} className="lib-article__table">
                <table>
                  <thead>
                    <tr>
                      {b.head.map((h, j) => (
                        <th key={j} scope="col">
                          <Inline text={h} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, j) => (
                      <tr key={j}>
                        {r.map((c, k) => (
                          <td key={k}>
                            <Inline text={c} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "box": {
            const label = b.title ?? BOX_LABELS[b.tone];
            return (
              <aside key={i} className={`lib-box lib-box--${b.tone}`}>
                {label && <p className="lib-box__title">{label}</p>}
                <Blocks blocks={b.blocks} />
              </aside>
            );
          }
        }
      })}
    </>
  );
}
