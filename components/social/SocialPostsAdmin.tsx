"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createSocialPost, deleteSocialPost } from "@/app/admin/social/actions";
import type { SocialPostSummary } from "@/lib/data/social";
import { AUDIENCE_LABELS, AUDIENCES, DESTINATIONS, TEMPLATE_LABELS, TEMPLATES, type Audience, type Destination, type Template } from "@/lib/social/post";

const PACIFIC = "America/Los_Angeles";
const time = (iso: string) =>
  new Date(iso).toLocaleString("en-CA", { timeZone: PACIFIC, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** The Social tab's list: start a post from a topic (the AI drafts it), open one, or delete one for good. */
export function SocialPostsAdmin({ posts }: { posts: SocialPostSummary[] }) {
  const router = useRouter();
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
    router.push(`/admin/social/${r.id}`);
  }

  async function remove(p: SocialPostSummary) {
    if (!window.confirm(`Delete "${p.title}" for good? Its slides, captions and uploaded pictures are removed and can't be recovered.`)) return;
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
                      <Link href={`/admin/social/${p.id}`}>{p.title}</Link>
                      <div className="roster-table__meta">{p.campaign}</div>
                    </td>
                    <td>{p.slideCount}</td>
                    <td>{time(p.updatedAt)}</td>
                    <td className="demo-links__actions">
                      <Link href={`/admin/social/${p.id}`} className="button button-secondary button-small">
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
