"use client";

import { tz } from "@/lib/time-zone";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createSocialPost, createSocialPostFromTemplate, deleteSocialPost, deleteSocialTemplate } from "@/app/admin/marketing/socials/actions";
import type { SocialPostSummary } from "@/lib/data/social";
import type { PostTemplate } from "@/lib/social/templates";
import { ScaledSlide, SlideCanvas } from "@/components/social/SlideCanvas";
import { socialFontClass } from "@/components/social/fonts";
import { AUDIENCE_LABELS, AUDIENCES, DESTINATIONS, TEMPLATE_LABELS, TEMPLATES, type Audience, type Destination, type Template } from "@/lib/social/post";

const PACIFIC = "America/Vancouver";
const time = (iso: string) =>
  new Date(iso).toLocaleString("en-CA", { timeZone: tz(PACIFIC, iso), month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** The Social tab's list: start a post from a template or a topic (the AI drafts it), open one, or delete one for good. */
export function SocialPostsAdmin({ posts, templates, templatesError }: { posts: SocialPostSummary[]; templates: PostTemplate[]; templatesError?: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"template" | "ai">("template");
  const [topic, setTopic] = useState("");
  const [audience, setAudience] = useState<Audience>("council");
  const [template, setTemplate] = useState<Template>("list");
  const [slideCount, setSlideCount] = useState(7);
  const [destination, setDestination] = useState<Destination>("home");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy("create");
    setError(null);
    const r = await createSocialPost({ topic, audience, template, slideCount, destination });
    if (!r.ok) {
      setBusy(null);
      return setError(r.error);
    }
    router.push(`/admin/marketing/socials/${r.id}`);
  }

  async function fromTemplate(t: PostTemplate) {
    setBusy(t.ref);
    setError(null);
    const r = await createSocialPostFromTemplate(t.ref, destination);
    if (!r.ok) {
      setBusy(null);
      return setError(r.error);
    }
    router.push(`/admin/marketing/socials/${r.id}`);
  }

  async function removeTemplate(t: PostTemplate) {
    if (!window.confirm(`Delete the template "${t.name}"? Posts already started from it stay as they are.`)) return;
    setBusy(t.ref);
    setError(null);
    const r = await deleteSocialTemplate(t.ref);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    router.refresh();
  }

  async function remove(p: SocialPostSummary) {
    if (!window.confirm(`Delete "${p.title}" for good? Its slides, captions, and uploaded pictures are removed and can't be recovered.`)) return;
    setBusy(p.id);
    setError(null);
    const r = await deleteSocialPost(p.id);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    router.refresh();
  }

  return (
    <>
      <section className="card" style={{ marginBottom: "2.5rem" }} data-testid="social-new">
        <h2>New post</h2>
        <div className="social-editor__platforms" role="tablist" aria-label="Start from">
          <button type="button" role="tab" aria-selected={mode === "template"} className="button button-secondary button-small" data-active={mode === "template"} onClick={() => setMode("template")} data-testid="social-mode-template">
            Start from a template
          </button>
          <button type="button" role="tab" aria-selected={mode === "ai"} className="button button-secondary button-small" data-active={mode === "ai"} onClick={() => setMode("ai")} data-testid="social-mode-ai">
            Draft with AI
          </button>
        </div>
        {mode === "template" ? (
          <>
            <p className="card__meta">
              Pick a starting point and make it yours: you get your own copy to edit, and the template stays as it is. Save any post as a template from its editor.
            </p>
            <label className="field" style={{ maxWidth: 280 }}>
              <span>Links go to</span>
              <select value={destination} onChange={(e) => setDestination(e.target.value as Destination)}>
                {(Object.keys(DESTINATIONS) as Destination[]).map((d) => (
                  <option key={d} value={d}>
                    {DESTINATIONS[d].label}
                  </option>
                ))}
              </select>
            </label>
            {templatesError && <p className="card__meta">{templatesError}</p>}
            <div className={`social-templates ${socialFontClass}`} data-testid="social-templates">
              {templates.map((t) => (
                <div key={t.ref} className="social-templates__item">
                  <button type="button" className="social-templates__pick" disabled={busy !== null || t.slides.length === 0} onClick={() => fromTemplate(t)} aria-label={`Start a post from ${t.name}`}>
                    <span className="social-templates__stack">
                      {t.slides.slice(0, 3).map((s, i) => (
                        <span key={s.id} style={{ zIndex: 3 - i, transform: `translate(${i * 14}px, ${i * 8}px)` }}>
                          <ScaledSlide scale={140 / 1080} width={1080} height={1350}>
                            <SlideCanvas post={{ template: "list", theme: "paper", destination, showSlideNumbers: t.showSlideNumbers }} slide={s} index={i} total={t.slides.length} platform="instagram" />
                          </ScaledSlide>
                        </span>
                      ))}
                    </span>
                    <strong>{busy === t.ref ? "Starting…" : t.name}</strong>
                    <span className="card__meta">
                      {t.slides.length} {t.slides.length === 1 ? "slide" : "slides"}
                      {t.description ? `. ${t.description}` : ""}
                    </span>
                  </button>
                  {!t.builtIn && (
                    <button type="button" className="link-button" disabled={busy !== null} onClick={() => removeTemplate(t)}>
                      Delete template
                    </button>
                  )}
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
        <p className="card__meta">
          Say what the post is about and who it&rsquo;s for. The AI drafts the slides and a caption for each platform; you edit everything
          before exporting.
        </p>
        <form className="social-new" onSubmit={create}>
          <label className="field field--wide">
            <span>Topic</span>
            <textarea
              rows={3}
              value={topic}
              maxLength={2000}
              required
              placeholder="e.g. Five things to do before your first council meeting"
              onChange={(e) => setTopic(e.target.value)}
              data-testid="social-topic"
            />
          </label>
          <label className="field">
            <span>Audience</span>
            <select value={audience} onChange={(e) => setAudience(e.target.value as Audience)}>
              {AUDIENCES.map((a) => (
                <option key={a} value={a}>
                  {AUDIENCE_LABELS[a]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Template</span>
            <select value={template} onChange={(e) => setTemplate(e.target.value as Template)} data-testid="social-new-template">
              {TEMPLATES.map((t) => (
                <option key={t} value={t}>
                  {TEMPLATE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Slides</span>
            <select value={slideCount} onChange={(e) => setSlideCount(Number(e.target.value))}>
              {[4, 5, 6, 7, 8, 9, 10].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Links go to</span>
            <select value={destination} onChange={(e) => setDestination(e.target.value as Destination)}>
              {(Object.keys(DESTINATIONS) as Destination[]).map((d) => (
                <option key={d} value={d}>
                  {DESTINATIONS[d].label}
                </option>
              ))}
            </select>
          </label>
          <div className="social-new__submit">
            <button className="button button-primary" disabled={busy !== null || topic.trim().length < 5} data-testid="social-create">
              {busy === "create" ? "Drafting… (about a minute)" : "Draft with AI"}
            </button>
          </div>
        </form>
          </>
        )}
        {error && (
          <p className="form-alert" role="alert">
            {error}
          </p>
        )}
      </section>

      <section className="card" data-testid="social-list">
        <h2>Posts</h2>
        {posts.length === 0 ? (
          <p className="card__meta">No posts yet.</p>
        ) : (
          <div className="roster-table-wrap">
            <table className="roster-table">
              <thead>
                <tr>
                  <th>Post</th>
                  <th>Slides</th>
                  <th>Last changed</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {posts.map((p) => (
                  <tr key={p.id} data-testid={`social-post-${p.id}`}>
                    <td>
                      <Link href={`/admin/marketing/socials/${p.id}`}>{p.title}</Link>
                      <div className="roster-table__meta">{p.campaign}</div>
                    </td>
                    <td>{p.slideCount}</td>
                    <td>{time(p.updatedAt)}</td>
                    <td className="demo-links__actions">
                      <Link href={`/admin/marketing/socials/${p.id}`} className="button button-secondary button-small">
                        Open
                      </Link>
                      <button type="button" className="button button-secondary button-small agenda-danger" disabled={busy !== null} onClick={() => remove(p)}>
                        {busy === p.id ? "Deleting…" : "Delete"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
