"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { completeLesson } from "@/app/training/actions";
import { LessonView } from "@/components/training/LessonView";
import type { ModuleContent } from "@/lib/training/content";

/**
 * A learner working through a published module: lessons down the side
 * with ticks, one lesson at a time, Continue once its questions are
 * answered. Progress saves on Continue.
 */
export function ModulePlayer({
  moduleId,
  moduleTitle,
  version,
  content,
  completedLessonIds,
  track,
  nextModule,
}: {
  moduleId: string;
  moduleTitle: string;
  version: number;
  content: ModuleContent;
  completedLessonIds: string[];
  track: { title: string; slug: string };
  nextModule: { id: string; title: string } | null;
}) {
  const ids = content.lessons.map((l) => l.id);
  const [done, setDone] = useState<Set<string>>(new Set(completedLessonIds.filter((id) => ids.includes(id))));
  const firstOpen = content.lessons.find((l) => !done.has(l.id))?.id ?? content.lessons[0]?.id;
  const [current, setCurrent] = useState<string | "complete">(firstOpen ?? "complete");
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [credential, setCredential] = useState(false);
  const onReady = useCallback((r: boolean) => setReady(r), []);

  const index = ids.indexOf(current as string);
  const lesson = content.lessons[index];
  const allDone = ids.every((id) => done.has(id));

  async function next() {
    if (!lesson) return;
    setSaving(true);
    setError(null);
    const r = await completeLesson(moduleId, version, lesson.id);
    setSaving(false);
    if (!r.ok) return setError(r.error);
    const nextDone = new Set(done).add(lesson.id);
    setDone(nextDone);
    if (r.credentialEarned) setCredential(true);
    const following = content.lessons.slice(index + 1).find(() => true);
    setCurrent(following ? following.id : "complete");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="player">
      <nav className="player__nav" aria-label="Lessons">
        <Link href={`/training/${track.slug}`} className="card__meta">
          &larr; {track.title}
        </Link>
        <div className="player__module">{moduleTitle}</div>
        <div className="progress-track" aria-hidden="true">
          <div className="progress-track__fill" style={{ width: `${Math.round((done.size / Math.max(1, ids.length)) * 100)}%` }} />
        </div>
        <span className="card__meta">
          {done.size} of {ids.length} lessons
        </span>
        <ol>
          {content.lessons.map((l, i) => (
            <li key={l.id}>
              <button type="button" className="player__lesson" data-active={l.id === current} onClick={() => setCurrent(l.id)}>
                <span className="player__tick" data-done={done.has(l.id)} aria-hidden="true">
                  {done.has(l.id) ? <Tick /> : i + 1}
                </span>
                <span>{l.title}</span>
                <span className="visually-hidden">{done.has(l.id) ? " (completed)" : ""}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <main className="player__main">
        {current === "complete" || !lesson ? (
          <section className="player__complete">
            <h2>{allDone ? "Module complete" : "Almost there"}</h2>
            <p>
              {allDone
                ? `You've finished "${moduleTitle}".`
                : "Some lessons still need finishing. Pick one from the list to complete it."}
            </p>
            {credential && (
              <p className="sync-note sync-note--ok" role="status">
                You&rsquo;ve earned the {track.title} credential. It shows on your training page, and councils you&rsquo;re
                connected to can see it on Council &amp; Roles.
              </p>
            )}
            <div className="text-actions">
              {nextModule && allDone && (
                <Link href={`/training/${track.slug}/${nextModule.id}`} className="button button-primary">
                  Next module: {nextModule.title}
                </Link>
              )}
              <Link href={`/training/${track.slug}`} className="button button-secondary">
                Back to {track.title}
              </Link>
            </div>
          </section>
        ) : (
          <>
            <LessonView key={lesson.id} lesson={lesson} onReadyChange={onReady} />
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="lesson-nav">
              <button type="button" className="text-action" disabled={index <= 0} onClick={() => setCurrent(ids[index - 1])}>
                &larr; Previous
              </button>
              <span className="card__meta">{!ready && "Answer the questions above to continue."}</span>
              <button type="button" className="button button-primary" disabled={!ready || saving} onClick={next} data-testid="lesson-continue">
                {saving ? "Saving…" : index === ids.length - 1 ? "Finish module" : "Continue"}
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function Tick() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path d="M3 8.5l3 3 7-7" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
