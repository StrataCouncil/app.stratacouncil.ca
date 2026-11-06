"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { VideoJoin } from "@/app/strata/[corpId]/meetings/[meetingId]/live/actions";
import { fetchVideoJoin } from "@/lib/meetings/live-client";
import { bestGrid } from "@/lib/meetings/video-grid";

type Phase = "loading" | "joining" | "joined" | "reconnecting" | "ended" | "failed";

/** One person in the video session, as the tiles need them. */
type Person = { userId: number; name: string; video: boolean; muted: boolean; reconnecting: boolean };
type Device = { id: string; label: string };

/* The SDK is browser-only and large: loaded when a meeting's video opens, never on the server. */
type Sdk = typeof import("@zoom/videosdk");
type Client = ReturnType<Sdk["default"]["createClient"]>;
type Stream = ReturnType<Client["getMediaStream"]>;

/**
 * The meeting's video, at the top of the right-hand column in Meeting Mode and
 * on the members' page (Zoom Video SDK, lib/zoom/video-sdk.ts). Everything
 * here is ours: a tile per person ("Name, SL###"), a microphone and a camera
 * button, and a larger view. None of Zoom's interface appears, and none of
 * its features (chat, recording, sharing) is used.
 *
 * Everyone joins as soon as their page opens; nobody waits for anyone. People
 * join with the camera on; sound starts with a click on "Turn on sound"
 * (browsers require one), microphone still off until they unmute. "Devices"
 * picks the camera and microphone. A dropped connection
 * reconnects by itself. At adjournment (`ended`) the person running the
 * meeting ends the session for everyone, and every screen leaves it.
 *
 * In-person meetings show nothing; the demo site shows tiles in place of video.
 */
export function VideoPanel(props: {
  meetingId: string;
  isRunner: boolean;
  /** The meeting has adjourned: leave (and, for the Runner, end) the session. */
  ended?: boolean;
  people: Array<{ key: string; name: string; lot: string | null }>;
}) {
  const { meetingId } = props;
  const [join, setJoin] = useState<VideoJoin | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [problem, setProblem] = useState<{ message: string; reason?: string } | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [me, setMe] = useState<number | null>(null);
  const [micOn, setMicOn] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [busy, setBusy] = useState<"mic" | "camera" | null>(null);
  const [large, setLarge] = useState(false);
  const [showDevices, setShowDevices] = useState(false);
  const [devices, setDevices] = useState<{ cameras: Device[]; mics: Device[]; camera: string; mic: string }>({ cameras: [], mics: [], camera: "", mic: "" });
  const [attempt, setAttempt] = useState(0);

  const chosenCamera = useRef<string | null>(null);
  // The video box's size, so the tiles can fill it (lib/meetings/video-grid.ts).
  const frameRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = frameRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => e && setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [join]);
  const sdk = useRef<{ mod: Sdk; client: Client; stream: Stream } | null>(null);
  const slots = useRef(new Map<number, HTMLDivElement>());
  const showReasons = join?.kind === "join" && join.showReasons;

  const fail = useCallback(
    (message: string, err?: unknown) => {
      const e = err as { errorCode?: number; reason?: string; message?: string; type?: string } | undefined;
      const reason = e ? [e.reason || e.message || e.type, e.errorCode != null ? `(${e.errorCode})` : ""].filter(Boolean).join(" ") : undefined;
      if (err) console.error("[video]", reason);
      setProblem({ message, reason: reason || undefined });
      setPhase("failed");
    },
    []
  );

  // Who's in the session, from the SDK's own list.
  const refreshPeople = useCallback(() => {
    const s = sdk.current;
    if (!s) return;
    const all = s.client.getAllUser();
    setPeople(
      all.map((u) => ({
        userId: u.userId,
        name: u.displayName,
        video: Boolean(u.bVideoOn),
        muted: u.audio === "" || Boolean(u.muted),
        reconnecting: Boolean(u.isInFailover),
      }))
    );
  }, []);

  // Cameras and microphones to choose from (a laptop's own camera, an external one, a virtual one).
  const refreshDevices = useCallback(() => {
    const s = sdk.current;
    if (!s) return;
    try {
      setDevices({
        cameras: s.stream.getCameraList().map((d) => ({ id: d.deviceId, label: d.label || "Camera" })),
        mics: s.stream.getMicList().map((d) => ({ id: d.deviceId, label: d.label || "Microphone" })),
        camera: s.stream.getActiveCamera() ?? "",
        mic: s.stream.getActiveMicrophone() ?? "",
      });
    } catch {
      // Lists aren't ready until the browser has granted access.
    }
  }, []);

  // A person's camera, drawn into their tile.
  const attach = useCallback(async (userId: number) => {
    const s = sdk.current;
    const slot = slots.current.get(userId);
    if (!s || !slot || slot.querySelector("video-player")) return;
    const el = await s.stream.attachVideo(userId, s.mod.VideoQuality.Video_360P).catch(() => null);
    if (el && el instanceof HTMLElement && !slot.contains(el)) slot.appendChild(el);
  }, []);
  const detach = useCallback(async (userId: number) => {
    const s = sdk.current;
    if (!s) return;
    const els = await s.stream.detachVideo(userId).catch(() => null);
    for (const el of Array.isArray(els) ? els : els ? [els] : []) el.remove();
  }, []);

  // Join details from our server, then into the session.
  useEffect(() => {
    let cancelled = false;
    setPhase("loading");
    setProblem(null);
    void fetchVideoJoin(meetingId)
      .catch((): VideoJoin => ({ kind: "message", tone: "error", message: "Couldn't reach the server for the video. Try again." }))
      .then(async (j) => {
        if (cancelled) return;
        setJoin(j);
        if (j.kind !== "join") return;
        setPhase("joining");
        try {
          const mod = await import("@zoom/videosdk");
          if (cancelled) return;
          const client = mod.default.createClient();
          await client.init("en-US", "Global", {
            patchJsMedia: true,
            leaveOnPageUnload: true,
            stayAwake: true,
            enforceMultipleVideos: { disableRenderLimits: true },
          });
          await client.join(j.topic, j.token, j.userName);
          if (cancelled) {
            void client.leave();
            return;
          }
          const stream = client.getMediaStream();
          sdk.current = { mod, client, stream };
          setMe(client.getCurrentUserInfo().userId);

          client.on("user-added", refreshPeople);
          client.on("user-removed", refreshPeople);
          client.on("user-updated", refreshPeople);
          client.on("peer-video-state-change", ({ action, userId }) => {
            refreshPeople();
            void (action === "Start" ? attach(userId) : detach(userId));
          });
          client.on("connection-change", (p) => {
            if (p.state === "Connected") setPhase("joined");
            else if (p.state === "Reconnecting") setPhase("reconnecting");
            else if (p.state === "Closed") setPhase("ended");
            else if (p.state === "Fail") fail("The video connection was lost.", { reason: String(p.reason ?? "") });
          });
          client.on("active-media-failed", (p) => {
            setProblem({ message: "The camera or microphone stopped working. Check it isn't in use by another app, then try again.", reason: `${p.message ?? ""} (${p.code})` });
          });
          setPhase("joined");
          refreshPeople();

          client.on("auto-play-audio-failed", () => {
            setProblem({ message: "Click anywhere on this page to hear the meeting." });
          });
          client.on("device-change", () => refreshDevices());

          // Camera on (the browser asks permission once). Sound waits for a
          // click on "Turn on sound": browsers block audio started without one
          // (Zoom's guide; it timed out in the first sandbox test).
          try {
            await stream.startVideo();
            setCameraOn(true);
          } catch (err) {
            setProblem({ message: blockedOr(err, "Couldn't start your camera. Turn it on with the camera button."), reason: describe(err) });
          }
          refreshPeople();
          refreshDevices();
        } catch (err) {
          if (!cancelled) fail("The video couldn't connect. Check your connection, then try again. The meeting itself isn't affected.", err);
        }
      });
    return () => {
      cancelled = true;
      const s = sdk.current;
      sdk.current = null;
      if (s) {
        void s.client
          .leave()
          .catch(() => undefined)
          .finally(() => s.mod.default.destroyClient());
      }
    };
  }, [meetingId, attempt, attach, detach, refreshPeople, refreshDevices, fail]);

  // Cameras already on when we joined, and ours once it starts: drawn as their tiles appear.
  useEffect(() => {
    for (const p of people) if (p.video) void attach(p.userId);
  }, [people, attach]);

  // Adjourned: the Runner ends the session for everyone; everyone else just leaves.
  useEffect(() => {
    if (!props.ended || !sdk.current) return;
    const s = sdk.current;
    void s.client.leave(props.isRunner).catch(() => undefined);
    setPhase("ended");
  }, [props.ended, props.isRunner]);

  // Escape returns the larger video to the column.
  useEffect(() => {
    if (!large) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setLarge(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [large]);

  async function toggleMic() {
    const s = sdk.current;
    if (!s || busy) return;
    setBusy("mic");
    try {
      if (!audioReady) {
        // Sound on, microphone still off: people unmute when they speak.
        await s.stream.startAudio({ mute: true });
        setAudioReady(true);
        setMicOn(false);
        refreshDevices();
      } else if (micOn) {
        await s.stream.muteAudio();
        setMicOn(false);
      } else {
        await s.stream.unmuteAudio();
        setMicOn(true);
      }
      setProblem(null);
    } catch (err) {
      setProblem({ message: blockedOr(err, "Couldn't change the microphone. Try again."), reason: describe(err) });
    } finally {
      setBusy(null);
      refreshPeople();
    }
  }

  async function chooseDevice(kind: "camera" | "mic", id: string) {
    const s = sdk.current;
    if (!s || !id) return;
    try {
      if (kind === "camera") {
        chosenCamera.current = id;
        // Switching needs a running camera; with it off, start it on the one chosen.
        if (s.stream.isCapturingVideo()) await s.stream.switchCamera(id);
        else {
          await s.stream.startVideo({ cameraId: id });
          setCameraOn(true);
        }
      } else {
        await s.stream.switchMicrophone(id);
      }
      setProblem(null);
    } catch (err) {
      setProblem({ message: `Couldn't switch the ${kind === "camera" ? "camera" : "microphone"}. Try another, or check it isn't in use by another app.`, reason: describe(err) });
    }
    refreshDevices();
    refreshPeople();
  }

  async function toggleCamera() {
    const s = sdk.current;
    if (!s || busy) return;
    setBusy("camera");
    try {
      if (cameraOn) {
        await s.stream.stopVideo();
        if (me != null) await detach(me);
        setCameraOn(false);
      } else {
        await s.stream.startVideo(chosenCamera.current ? { cameraId: chosenCamera.current } : undefined);
        setCameraOn(true);
      }
      setProblem(null);
    } catch (err) {
      setProblem({ message: blockedOr(err, "Couldn't change the camera. Try again."), reason: describe(err) });
    } finally {
      setBusy(null);
      refreshPeople();
    }
  }

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

  if (join.kind === "message") {
    return (
      <section className="mm-video mm-video--message" aria-label="Meeting video" data-testid="video-message">
        <p className={join.tone === "error" ? "mm-video__msg mm-video__msg--error" : "mm-video__msg"} role="status">
          {join.message}
        </p>
        {join.tone === "error" && (
          <button type="button" className="button button-secondary button-small" onClick={() => setAttempt((a) => a + 1)} data-testid="video-retry">
            Try again
          </button>
        )}
      </section>
    );
  }

  const over = phase === "ended" || phase === "failed";
  const { cols, rows } = bestGrid(people.length, box.w, box.h);
  return (
    <section className={large ? "mm-video mm-video--large" : "mm-video"} aria-label="Meeting video" data-testid="video-panel" data-phase={phase}>
      {large && <div className="mm-video__scrim" onClick={() => setLarge(false)} aria-hidden="true" />}
      <div className="mm-video__frame" ref={frameRef}>
        <video-player-container
          className="mm-video__grid"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
        >
          {people.map((p) => (
            <div key={p.userId} className="mm-video__person" data-video={p.video || undefined} data-testid="video-person">
              <span className="mm-video__initials" aria-hidden="true">
                {initials(p.name)}
              </span>
              <div
                className="mm-video__slot"
                ref={(el) => {
                  if (el) slots.current.set(p.userId, el);
                  else slots.current.delete(p.userId);
                }}
              />
              <span className="mm-video__label">
                {p.muted && <MicOffIcon />}
                {p.name}
                {p.userId === me ? " (you)" : ""}
                {p.reconnecting ? " · reconnecting" : ""}
              </span>
            </div>
          ))}
        </video-player-container>
        {phase !== "joined" && (
          <div className="mm-video__overlay" role="status">
            {phase === "loading" || phase === "joining"
              ? "Connecting the video…"
              : phase === "reconnecting"
                ? "Reconnecting the video…"
                : phase === "ended"
                  ? props.ended
                    ? "The meeting has adjourned. The video has ended."
                    : "The video ended. Rejoin to carry on. The meeting itself isn't affected."
                  : (problem?.message ?? "The video couldn't connect.")}
            {showReasons && over && problem?.reason && <span className="mm-video__reason">Zoom says: {problem.reason}</span>}
            {over && !props.ended && (
              <button type="button" className="button button-primary button-small" onClick={() => setAttempt((a) => a + 1)} data-testid="video-rejoin">
                Rejoin video
              </button>
            )}
          </div>
        )}
      </div>
      {phase === "joined" && problem && (
        <p className="mm-video__problem" role="status">
          {problem.message}
          {showReasons && problem.reason && <span className="mm-video__reason">Zoom says: {problem.reason}</span>}
        </p>
      )}
      <div className="mm-video__bar">
        <button
          type="button"
          className="mm-video__ctl"
          data-on={micOn || undefined}
          data-call={(!audioReady && phase === "joined") || undefined}
          onClick={() => void toggleMic()}
          disabled={phase !== "joined" || busy !== null}
          aria-pressed={micOn}
          data-testid="video-mic"
        >
          {micOn ? <MicIcon /> : <MicOffIcon />} {!audioReady ? "Turn on sound" : micOn ? "Mute" : "Unmute"}
        </button>
        <button
          type="button"
          className="mm-video__ctl"
          data-on={cameraOn || undefined}
          onClick={() => void toggleCamera()}
          disabled={phase !== "joined" || busy !== null}
          aria-pressed={cameraOn}
          data-testid="video-camera"
        >
          <CameraIcon /> {cameraOn ? "Stop camera" : "Start camera"}
        </button>
        <button type="button" className="mm-video__size mm-video__push" onClick={() => setShowDevices((d) => !d)} aria-expanded={showDevices} disabled={phase !== "joined"} data-testid="video-devices">
          Devices
        </button>
        <button type="button" className="mm-video__size" onClick={() => setLarge((l) => !l)} aria-pressed={large} data-testid="video-size">
          {large ? "Smaller video" : "Larger video"}
        </button>
      </div>
      {phase === "joined" && !audioReady && !problem && (
        <p className="mm-video__hint">Turn on sound to hear the meeting. Your microphone stays off until you unmute.</p>
      )}
      {showDevices && phase === "joined" && (
        <div className="mm-video__devices">
          <label>
            <span>Camera</span>
            <select value={devices.camera} onChange={(e) => void chooseDevice("camera", e.target.value)} data-testid="video-camera-choice">
              {devices.cameras.length === 0 && <option value="">No camera found</option>}
              {devices.cameras.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Microphone</span>
            <select value={devices.mic} onChange={(e) => void chooseDevice("mic", e.target.value)} disabled={!audioReady} data-testid="video-mic-choice">
              {!audioReady && <option value="">Turn on sound first</option>}
              {audioReady && devices.mics.length === 0 && <option value="">No microphone found</option>}
              {devices.mics.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </section>
  );
}

function describe(err: unknown): string | undefined {
  const e = err as { errorCode?: number; reason?: string; type?: string; message?: string } | undefined;
  if (!e) return undefined;
  return [e.reason || e.message || e.type, e.errorCode != null ? `(${e.errorCode})` : ""].filter(Boolean).join(" ") || undefined;
}

/** The browser said no to the camera or microphone: say how to allow it. */
function blockedOr(err: unknown, otherwise: string): string {
  const text = describe(err) ?? "";
  return /permission|denied|notallowed/i.test(text)
    ? "The browser blocked the camera or microphone. Allow them for this site (the icon in the address bar), then try again."
    : otherwise;
}

function initials(name: string) {
  return (
    name
      .replace(/,\s*SL\s?\d+$/i, "")
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

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

function MicOffIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3l18 18" />
      <path d="M9 9v2a3 3 0 0 0 5 2.2M15 9.3V6a3 3 0 0 0-5.7-1.3" />
      <path d="M5 11a7 7 0 0 0 11.5 5.3M19 11a7 7 0 0 1-.6 2.8M12 18v3" />
    </svg>
  );
}
