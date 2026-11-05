"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getVideoJoin, type VideoJoin } from "@/app/strata/[corpId]/meetings/[meetingId]/live/actions";

type FrameState = "loading" | "connecting" | "joined" | "reconnecting" | "ended" | "failed";

/**
 * The meeting's Zoom video (0080), at the top of the right-hand column in
 * Meeting Mode and on the members' page. Zoom runs in its own frame
 * (public/zoom-frame.html); this asks the server for join details and
 * shows how the connection is going. In-person meetings show nothing; the
 * demo site shows tiles in place of video.
 */
export function VideoPanel(props: { meetingId: string; isRunner: boolean; people: Array<{ key: string; name: string; lot: string | null }> }) {
  const { meetingId, isRunner } = props;
  const [join, setJoin] = useState<VideoJoin | null>(null);
  const [frame, setFrame] = useState<{ state: FrameState; detail?: string }>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const iframe = useRef<HTMLIFrameElement>(null);

  const load = useCallback(
    async (restart = false) => {
      setBusy(true);
      const j = await getVideoJoin(meetingId, { restart }).catch(
        () => ({ kind: "message", tone: "error", message: "Couldn't reach the server for the video. Try again.", canRestart: true }) as VideoJoin
      );
      setBusy(false);
      setJoin(j);
      setFrame({ state: "loading" });
      setAttempt((a) => a + 1);
    },
    [meetingId]
  );
  useEffect(() => {
    void load();
  }, [load]);

  // Members wait for the Runner's screen to start the video.
  useEffect(() => {
    if (join?.kind !== "waiting") return;
    const t = setInterval(() => void load(), 10000);
    return () => clearInterval(t);
  }, [join, load]);

  // The frame says it's ready; it gets the join details, and reports back.
  useEffect(() => {
    if (join?.kind !== "join") return;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== iframe.current?.contentWindow || e.data?.source !== "sc-zoom") return;
      if (e.data.type === "ready") {
        const r = box.current?.getBoundingClientRect();
        const { kind: _kind, ...config } = join;
        iframe.current?.contentWindow?.postMessage(
          { source: "sc-page", type: "join", config, size: { width: r?.width ?? 320, height: r?.height ?? 300 } },
          window.location.origin
        );
      } else if (e.data.type === "state") {
        setFrame({ state: e.data.state as FrameState, detail: typeof e.data.detail === "string" ? e.data.detail : undefined });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [join, attempt]);

  if (!join || join.kind === "none") return null;

  if (join.kind === "demo") {
    return (
      <section className="mm-video" aria-label="Meeting video" data-testid="video-demo">
        <div className="mm-video__tiles">
          {props.people.slice(0, 9).map((p) => (
            <div key={p.key} className="mm-video__tile">
              <span className="mm-video__initials" aria-hidden="true">
                {initials(p.name)}
              </span>
              <span className="mm-video__name">{p.lot ? `${p.name}, ${p.lot}` : p.name}</span>
            </div>
          ))}
          {props.people.length === 0 && <div className="mm-video__tile mm-video__tile--empty">Nobody has joined yet</div>}
        </div>
        <p className="mm-video__note">
          <CameraIcon /> Video appears here
        </p>
      </section>
    );
  }

  if (join.kind === "message" || join.kind === "waiting") {
    return (
      <section className="mm-video mm-video--message" aria-label="Meeting video" data-testid="video-message">
        <p className={join.kind === "message" && join.tone === "error" ? "mm-video__msg mm-video__msg--error" : "mm-video__msg"} role="status">
          {join.kind === "waiting" ? "The video starts when the person running the meeting opens it." : join.message}
        </p>
        {join.kind === "message" && join.canRestart && (
          <button type="button" className="button button-secondary button-small" onClick={() => void load()} disabled={busy} data-testid="video-retry">
            Try again
          </button>
        )}
      </section>
    );
  }

  const over = frame.state === "ended" || frame.state === "failed";
  return (
    <section className="mm-video" aria-label="Meeting video" data-testid="video-panel" data-state={frame.state}>
      <div ref={box} className="mm-video__frame">
        {!over && (
          <iframe
            key={attempt}
            ref={iframe}
            src="/zoom-frame.html"
            title="Meeting video"
            allow="camera; microphone; display-capture; autoplay; fullscreen"
          />
        )}
        {frame.state !== "joined" && (
          <div className="mm-video__overlay" role="status">
            {frame.state === "loading" || frame.state === "connecting"
              ? "Connecting the video…"
              : frame.state === "reconnecting"
                ? "Reconnecting the video…"
                : frame.state === "ended"
                  ? isRunner
                    ? "The video ended. Zoom's free plan stops meetings after 40 minutes; restart it to carry on. The meeting itself isn't affected."
                    : "The video ended. Rejoin once the person running the meeting restarts it."
                  : videoFailure(frame.detail)}
            {over && (
              <button
                type="button"
                className="button button-primary button-small"
                onClick={() => void load(isRunner && frame.state === "ended")}
                disabled={busy}
                data-testid="video-restart"
              >
                {isRunner && frame.state === "ended" ? "Restart video" : "Rejoin video"}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function videoFailure(detail?: string): string {
  if (detail && /permission|denied|notallowed/i.test(detail)) {
    return "The browser blocked the camera or microphone. Allow them for this site (the icon in the address bar), then rejoin.";
  }
  return "The video couldn't connect. Check your connection, then rejoin. The meeting itself isn't affected.";
}

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?"
  );
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 10l5-3v10l-5-3z" />
      <rect x="3" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}
