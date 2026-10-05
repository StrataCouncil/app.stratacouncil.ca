import { Fragment, type ReactNode } from "react";
import { safeHref, type RichNode } from "@/lib/training/content";

/**
 * Renders stored rich text (the safe subset normalizeDoc allows) as real
 * elements. No HTML strings, so nothing in the content can inject markup.
 */
export function RichText({ doc, className }: { doc: RichNode | undefined; className?: string }) {
  if (!doc?.content?.length) return null;
  return <div className={className ?? "rich-text"}>{doc.content.map((n, i) => render(n, i))}</div>;
}

function children(n: RichNode) {
  return n.content?.map((c, i) => render(c, i));
}

function render(n: RichNode, key: number): ReactNode {
  switch (n.type) {
    case "paragraph":
      return <p key={key}>{children(n)}</p>;
    case "heading":
      return n.attrs?.level === 3 ? <h4 key={key}>{children(n)}</h4> : <h3 key={key}>{children(n)}</h3>;
    case "bulletList":
      return <ul key={key}>{children(n)}</ul>;
    case "orderedList":
      return <ol key={key}>{children(n)}</ol>;
    case "listItem":
      return <li key={key}>{children(n)}</li>;
    case "blockquote":
      return <blockquote key={key}>{children(n)}</blockquote>;
    case "hardBreak":
      return <br key={key} />;
    case "text": {
      let out: ReactNode = n.text;
      for (const m of n.marks ?? []) {
        if (m.type === "bold") out = <strong>{out}</strong>;
        if (m.type === "italic") out = <em>{out}</em>;
        if (m.type === "underline") out = <u>{out}</u>;
        if (m.type === "link") {
          const href = safeHref(m.attrs?.href);
          if (href) out = <a href={href} target="_blank" rel="noopener noreferrer">{out}</a>;
        }
      }
      return <Fragment key={key}>{out}</Fragment>;
    }
    default:
      return null;
  }
}
