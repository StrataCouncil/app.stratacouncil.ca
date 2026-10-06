"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { completeSection } from "@/app/training/actions";
import { BlockView, Transcript } from "@/components/training/BlockView";
import { PhotoCreditLine } from "@/components/training/PhotoPicker";
import { screenRequirements, type ModuleContent, type Screen } from "@/lib/training/content";

type Page =
  | { key: string; kind: "intro"; sectionIndex: number; title: string }
  | { key: string; kind: "recap"; sectionIndex: number; title: string }
  | { key: string; kind: "screen"; sectionIndex: number; title: string; screen: Screen };

type Settings = { largeText: boolean; autoplay: boolean; shortcuts: boolean };
const SETTINGS_KEY = "sc-training-player";
const defaultSettings: Settings = { largeText: false, autoplay: true, shortcuts: true };

/**
 * The learner's module player, one screen at a time: sections down the
 * side (ticked when done, locked until reached), a title bar with a
 * counter, and Prev / Next underneath. Next waits until the screen is
 * finished: narration heard to the end, questions answered, every
 * click-to-reveal item opened. Nothing is graded. Progress saves as each
 * section is finished.
 *
 * `preview` (the builder) never saves and every section can be opened, but
 * each screen still waits like it does for learners unless the author
 * turns on `skipWaits`.
 */
export function ModulePlayer({
  moduleId,
  moduleTitle,
  version,
  content,
  completedSectionIds,
  track,
  nextModule,
  preview = false,
  skipWaits = false,
  startScreenId,
}: {
  moduleId: string;
  moduleTitle: string;
  version: number;
  content: ModuleContent;
  completedSectionIds: string[];
  track: { title: string; slug: string };
  nextModule: { id: string; title: string } | null;
  preview?: boolean;
  /** Author preview only: let Next through without waiting. */
  skipWaits?: boolean;
  startScreenId?: string;
}) {
  const sections = content.sections;
  const pages = useMemo(() => buildPages(content), [content]);
  const [done, setDone] = useState<Set<string>>(() => new Set(completedSectionIds.filter((id) => sections.some((s) => s.id === id))));
  const allDone = sections.length > 0 && sections.every((s) => done.has(s.id));

  // The furthest page the learner may open: everything up to the first page of the first unfinished section.
  const firstOpenPage = (d: Set<string>) => {
    const sec = sections.findIndex((s) => !d.has(s.id));
    return sec < 0 ? pages.length - 1 : pages.findIndex((p) => p.sectionIndex === sec);
  };
  const [reached, setReached] = useState(() => (preview ? pages.length - 1 : Math.max(0, firstOpenPage(done))));
  const [index, setIndex] = useState(() => {
    if (startScreenId) {
      const i = pages.findIndex((p) => p.kind === "screen" && p.screen.id === startScreenId);
      if (i >= 0) return i;
    }
    return allDone || preview ? 0 : Math.max(0, firstOpenPage(done));
  });
  const [finished, setFinished] = useState(false);
  const [credential, setCredential] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [captions, setCaptions] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null");
      if (saved) setSettings({ ...defaultSettings, ...saved });
    } catch {}
  }, []);
  function changeSetting(k: keyof Settings) {
    setSettings((s) => {
      const n = { ...s, [k]: !s[k] };
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(n));
      } catch {}
      return n;
    });
  }

  const page = pages[Math.min(index, pages.length - 1)];
  const screen = page?.kind === "screen" ? page.screen : null;
  const required = useMemo(() => (screen ? screenRequirements(screen) : []), [screen]);
  // What's been finished on the current screen; tied to the screen so moving on starts fresh.
  const [sat, setSat] = useState<{ at: number; ids: Set<string> }>({ at: index, ids: new Set() });
  const satisfied = sat.at === index ? sat.ids : new Set<string>();
  const satisfy = useCallback(
    (id: string) =>
      setSat((s) => {
        const ids = s.at === index ? s.ids : new Set<string>();
        return ids.has(id) ? s : { at: index, ids: new Set(ids).add(id) };
      }),
    [index]
  );
  // Screens the learner has already finished (moved past with Next) don't wait again.
  const [passed, setPassed] = useState<Set<number>>(new Set());
  const alreadyDone =
    skipWaits ||
    passed.has(index) ||
    (!preview && (index < reached || Boolean(page && done.has(sections[page.sectionIndex]?.id))));
  const ready = alreadyDone || required.every((id) => satisfied.has(id));

  // ── Narration ──
  const audio = useRef<HTMLAudioElement>(null);
  const interacted = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const narration = screen?.narration.src ? screen.narration : null;
  useEffect(() => {
    setPlaying(false);
    setProgress(0);
    const a = audio.current;
    if (a && narration && settings.autoplay && interacted.current) a.play().catch(() => {});
  }, [index, narration, settings.autoplay]);
  // Fetch the next screen's narration while this one plays, so it's ready when the learner moves on.
  const nextNarration = (() => {
    const n = pages[index + 1];
    return n?.kind === "screen" ? n.screen.narration.src : "";
  })();
  useEffect(() => {
    if (!nextNarration) return;
    const a = new Audio();
    a.preload = "auto";
    a.src = nextNarration;
    return () => {
      a.removeAttribute("src");
      a.load();
    };
  }, [nextNarration]);

  function togglePlay() {
    const a = audio.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  }
  function replay() {
    const a = audio.current;
    if (!a) return;
    a.currentTime = 0;
    a.play().catch(() => {});
  }

  // ── Moving ──
  const lastOfSection = !pages[index + 1] || pages[index + 1].sectionIndex !== page.sectionIndex;
  const isLast = index === pages.length - 1;

  async function next() {
    interacted.current = true;
    if (!ready || saving) return;
    setError(null);
    const section = sections[page.sectionIndex];
    if (lastOfSection && section && !done.has(section.id)) {
      if (!preview) {
        setSaving(true);
        const r = await completeSection(moduleId, version, section.id);
        setSaving(false);
        if (!r.ok) return setError(r.error);
        if (r.credentialEarned) setCredential(true);
      }
      setDone((d) => new Set(d).add(section.id));
    }
    setPassed((p) => (p.has(index) ? p : new Set(p).add(index)));
    if (isLast) {
      setFinished(true);
    } else {
      setReached((r) => Math.max(r, index + 1));
      setIndex(index + 1);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function prev() {
    interacted.current = true;
    if (index > 0) setIndex(index - 1);
  }
  function goToSection(si: number) {
    const i = pages.findIndex((p) => p.sectionIndex === si);
    if (i >= 0 && i <= reached) {
      interacted.current = true;
      setFinished(false);
      setIndex(i);
      setMenuOpen(false);
    }
  }

  // Keyboard: left and right arrows, unless typing.
  const nextRef = useRef(next);
  nextRef.current = next;
  useEffect(() => {
    if (!settings.shortcuts) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowRight") void nextRef.current();
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settings.shortcuts]);

  if (pages.length === 0 || !page) {
    return (
      <div className="wrap page">
        <p className="lesson-missing">This module has no screens yet.</p>
      </div>
    );
  }

  const currentSection = page.sectionIndex;
  const waitingOn = !ready
    ? required.includes("narration") && !satisfied.has("narration")
      ? "Next unlocks when the narration finishes."
      : "Finish the activity on this screen to continue."
    : null;

  return (
    <div className="player" data-large-text={settings.largeText}>
      <nav className="player__menu" data-open={menuOpen} aria-label="Sections">
        <Link href={preview ? "#" : `/training/${track.slug}`} className="player__back">
          &larr; {track.title}
        </Link>
        <div className="player__module">{moduleTitle}</div>
        <div className="progress-track" aria-hidden="true">
          <div className="progress-track__fill" style={{ width: `${Math.round((done.size / Math.max(1, sections.length)) * 100)}%` }} />
        </div>
        <span className="card__meta">
          {done.size} of {sections.length} sections complete
        </span>
        <ol className="player__sections">
          {sections.map((s, si) => {
            const firstPage = pages.findIndex((p) => p.sectionIndex === si);
            const locked = firstPage > reached;
            const state = done.has(s.id) ? "done" : locked ? "locked" : "open";
            return (
              <li key={s.id}>
                <button
                  type="button"
                  className="player__section"
                  data-active={si === currentSection && !finished}
                  data-state={state}
                  disabled={locked}
                  onClick={() => goToSection(si)}
                >
                  <span>{s.title}</span>
                  <span className="player__section-icon" aria-hidden="true">
                    {state === "done" ? <TickIcon /> : state === "locked" ? <LockIcon /> : null}
                  </span>
                  <span className="visually-hidden">{state === "done" ? " (complete)" : state === "locked" ? " (locked)" : ""}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <main className="player__main">
        <div className="player__top">
          <button type="button" className="player__menu-toggle" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
            <MenuIcon /> Sections
          </button>
          <span className="player__top-title">{moduleTitle}</span>
        </div>

        {finished ? (
          <section className="player__complete">
            <h2>{allDone ? "Module complete" : "Almost there"}</h2>
            <p>{allDone ? `You've finished "${moduleTitle}".` : "Some sections still need finishing. Pick one from the menu."}</p>
            {credential && (
              <p className="sync-note sync-note--ok" role="status">
                You&rsquo;ve completed {track.title}. Your circle is filled in on your training page, and councils
                you&rsquo;re connected to can see it on Council &amp; Roles.
              </p>
            )}
            {!preview && (
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
            )}
          </section>
        ) : (
          <>
            <div className="player__bar">
              <h2>{page.title}</h2>
              <span aria-label={`Screen ${index + 1} of ${pages.length}`}>
                {index + 1}/{pages.length}
              </span>
            </div>

            <div className="player__screen" data-layout={screen?.layout ?? "full"} key={page.key}>
              <div className="player__blocks">
                {page.kind === "intro" && <Intro objectives={content.objectives} />}
                {page.kind === "recap" && <Recap moduleTitle={moduleTitle} objectives={content.objectives} />}
                {screen?.blocks.map((b) => (
                  <div key={b.id} className="lesson__block" data-type={b.type}>
                    <BlockView block={b} onDone={() => satisfy(b.id)} />
                  </div>
                ))}
              </div>
              {screen?.layout === "split" && screen.image.src && (
                <div className="player__aside">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={screen.image.src} alt={screen.image.alt} />
                  <PhotoCreditLine credit={screen.image.credit} />
                </div>
              )}
            </div>

            {captions && narration && (
              <div className="player__captions">
                <Transcript text={narration.transcript || "No transcript for this screen."} label="Captions" />
              </div>
            )}

            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}

            <div className="player__controls">
              {narration ? (
                <>
                  <audio
                    ref={audio}
                    key={page.key}
                    src={narration.src}
                    preload="auto"
                    onPlay={() => setPlaying(true)}
                    onPause={() => setPlaying(false)}
                    onTimeUpdate={(e) => {
                      const a = e.currentTarget;
                      if (a.duration) setProgress(a.currentTime / a.duration);
                    }}
                    onEnded={() => {
                      setPlaying(false);
                      setProgress(1);
                      satisfy("narration");
                    }}
                  />
                  <button type="button" className="player__icon" onClick={togglePlay} aria-label={playing ? "Pause narration" : "Play narration"}>
                    {playing ? <PauseIcon /> : <PlayIcon />}
                  </button>
                  <div className="player__progress" aria-hidden="true">
                    <div style={{ width: `${Math.round(progress * 100)}%` }} />
                  </div>
                  <button type="button" className="player__icon" onClick={replay} aria-label="Replay narration">
                    <ReplayIcon />
                  </button>
                  <button
                    type="button"
                    className="player__text-button"
                    aria-pressed={captions}
                    onClick={() => setCaptions((c) => !c)}
                  >
                    Captions
                  </button>
                </>
              ) : (
                <span className="player__waiting">{waitingOn}</span>
              )}
              <div className="player__settings">
                <button
                  type="button"
                  className="player__icon"
                  aria-expanded={settingsOpen}
                  aria-label="Player settings"
                  onClick={() => setSettingsOpen((o) => !o)}
                >
                  <GearIcon />
                </button>
                {settingsOpen && (
                  <div className="player__settings-menu" role="group" aria-label="Player settings">
                    <Toggle label="Larger text" on={settings.largeText} onChange={() => changeSetting("largeText")} />
                    <Toggle label="Play narration automatically" on={settings.autoplay} onChange={() => changeSetting("autoplay")} />
                    <Toggle label="Arrow-key shortcuts" on={settings.shortcuts} onChange={() => changeSetting("shortcuts")} />
                  </div>
                )}
              </div>
              <button type="button" className="player__nav" onClick={prev} disabled={index === 0}>
                <ChevronIcon dir="left" /> Prev
              </button>
              <button
                type="button"
                className="player__nav player__nav--next"
                onClick={next}
                disabled={!ready || saving}
                title={waitingOn ?? undefined}
                data-testid="player-next"
              >
                {saving ? "Saving…" : isLast ? "Finish" : "Next"} <ChevronIcon dir="right" />
              </button>
            </div>
            {narration && waitingOn && <p className="player__waiting player__waiting--below">{waitingOn}</p>}
          </>
        )}
      </main>
    </div>
  );
}

/** Sections' screens in order, with an opening objectives screen and a closing recap when the module has objectives. */
function buildPages(content: ModuleContent): Page[] {
  const pages: Page[] = [];
  const last = content.sections.length - 1;
  content.sections.forEach((section, si) => {
    if (si === 0 && content.objectives.length) pages.push({ key: "intro", kind: "intro", sectionIndex: 0, title: "Module introduction" });
    for (const screen of section.screens) pages.push({ key: screen.id, kind: "screen", sectionIndex: si, title: screen.title, screen });
    if (si === last && content.objectives.length) pages.push({ key: "recap", kind: "recap", sectionIndex: last, title: "Summary" });
  });
  return pages;
}

function Intro({ objectives }: { objectives: string[] }) {
  return (
    <div className="player__intro">
      <h3>Learning objectives</h3>
      <p>By the end of this module, you&rsquo;ll be able to:</p>
      <ul className="player__objectives">
        {objectives.map((o) => (
          <li key={o}>{o}</li>
        ))}
      </ul>
      <aside className="player__howto">
        <strong>How this works.</strong> Move through the screens with Next. When a screen has narration, a question or
        something to select, Next unlocks once you&rsquo;ve finished it. There&rsquo;s no pass or fail. Your progress saves at
        the end of each section, so you can stop and pick up later.
      </aside>
    </div>
  );
}

function Recap({ moduleTitle, objectives }: { moduleTitle: string; objectives: string[] }) {
  return (
    <div className="player__intro">
      <h3>This concludes {moduleTitle}</h3>
      <p>You should now be able to:</p>
      <ul className="player__objectives">
        {objectives.map((o) => (
          <li key={o}>{o}</li>
        ))}
      </ul>
    </div>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: () => void }) {
  return (
    <label className="player__toggle">
      <span>{label}</span>
      <input type="checkbox" role="switch" checked={on} onChange={onChange} />
    </label>
  );
}

const svg = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
function TickIcon() {
  return (
    <svg {...svg}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}
function LockIcon() {
  return (
    <svg {...svg}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
function MenuIcon() {
  return (
    <svg {...svg}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}
function PlayIcon() {
  return (
    <svg {...svg} fill="currentColor" stroke="none">
      <path d="M7 5v14l12-7z" />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg {...svg} fill="currentColor" stroke="none">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}
function ReplayIcon() {
  return (
    <svg {...svg}>
      <path d="M4 12a8 8 0 1 0 2.5-5.8" />
      <path d="M4 4v4h4" />
    </svg>
  );
}
function GearIcon() {
  return (
    <svg {...svg}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}
function ChevronIcon({ dir }: { dir: "left" | "right" }) {
  return (
    <svg {...svg} width={14} height={14}>
      <path d={dir === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
    </svg>
  );
}
