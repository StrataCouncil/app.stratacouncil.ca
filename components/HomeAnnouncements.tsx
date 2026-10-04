"use client";

import { useEffect, useState } from "react";
import type { Announcement } from "@/lib/data/announcements";

const HIDDEN_KEY = "sc-hidden-announcements";

/** News from StrataCouncil.ca on the home page. Each can be hidden on this device. */
export function HomeAnnouncements({ announcements }: { announcements: Announcement[] }) {
  const [hidden, setHidden] = useState<string[]>([]);

  useEffect(() => {
    try {
      setHidden(JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]"));
    } catch {
      // Storage unavailable: show everything.
    }
  }, []);

  function hide(id: string) {
    const next = [...hidden, id];
    setHidden(next);
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify(next.slice(-50)));
    } catch {
      // Hidden for this visit only.
    }
  }

  const visible = announcements.filter((a) => !hidden.includes(a.id));
  if (visible.length === 0) return null;

  return (
    <section className="home-news" aria-label="News from StrataCouncil.ca" data-testid="home-announcements">
      {visible.map((a) => (
        <article key={a.id} className="home-news__item">
          <div>
            <span className="home-news__kicker">
              News &middot; {new Date(a.publishedAt).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })}
            </span>
            <h3>{a.title}</h3>
            <p>{a.body}</p>
            {a.linkUrl && (
              <a href={a.linkUrl} target="_blank" rel="noopener noreferrer" className="home-news__link">
                {a.linkLabel || "Read more"}
              </a>
            )}
          </div>
          <button type="button" className="icon-button home-news__hide" aria-label={`Hide "${a.title}"`} title="Hide" onClick={() => hide(a.id)}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </article>
      ))}
    </section>
  );
}
