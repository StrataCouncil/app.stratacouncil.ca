import { DISCLAIMER } from "@/lib/investors/briefing";

/** The legal disclaimer every investor accepts (lib/investors/briefing.ts). */
export function Disclaimer() {
  return (
    <div className="investor-disclaimer">
      {DISCLAIMER.map((section, i) => (
        <section key={i}>
          {section.heading && <h3>{section.heading}</h3>}
          {section.paragraphs.map((p, j) => (
            <p key={j}>{p}</p>
          ))}
          {section.points && (
            <ul>
              {section.points.map(([label, text]) => (
                <li key={label}>
                  <strong>{label}:</strong> {text}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
