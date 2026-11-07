"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { helpFor, type DeviceHelp, type DeviceTrouble } from "@/lib/meetings/device-help";

type Device = { id: string; label: string };

/**
 * Test video and audio (the Meetings tab): the camera, the microphone, and
 * the speakers, checked in this browser before a meeting. Nothing is sent
 * anywhere and no meeting is joined; the browser's own permission is what's
 * being set up, once, for this site. If the browser won't allow the camera
 * or microphone, the page says how to allow them in this browser on this
 * computer, and starts again by itself once they're allowed.
 */
export function VideoCheck() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState<DeviceHelp | null>(null);
  const [trouble, setTrouble] = useState<DeviceTrouble | null>(null);
  const [cameras, setCameras] = useState<Device[]>([]);
  const [mics, setMics] = useState<Device[]>([]);
  const [camera, setCamera] = useState("");
  const [mic, setMic] = useState("");
  const [level, setLevel] = useState(0);
  const [heardYou, setHeardYou] = useState(false);
  const [sound, setSound] = useState<"untested" | "playing" | "asked" | "yes" | "no">("untested");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const watching = useRef(false);

  const stop = useCallback(() => {
    for (const t of streamRef.current?.getTracks() ?? []) t.stop();
    streamRef.current = null;
  }, []);

  const start = useCallback(
    async (cameraId?: string, micId?: string) => {
      setBusy(true);
      setHelp(null);
      try {
        stop();
        const media = await navigator.mediaDevices.getUserMedia({
          video: cameraId ? { deviceId: { exact: cameraId } } : true,
          audio: micId ? { deviceId: { exact: micId } } : true,
        });
        streamRef.current = media;
        setStream(media);
        // Device names are only shown once the browser has allowed them.
        const all = await navigator.mediaDevices.enumerateDevices();
        const list = (kind: MediaDeviceKind, fallback: string) =>
          all.filter((d) => d.kind === kind && d.deviceId).map((d, i) => ({ id: d.deviceId, label: d.label || `${fallback} ${i + 1}` }));
        setCameras(list("videoinput", "Camera"));
        setMics(list("audioinput", "Microphone"));
        setCamera(media.getVideoTracks()[0]?.getSettings().deviceId ?? "");
        setMic(media.getAudioTracks()[0]?.getSettings().deviceId ?? "");
      } catch (err) {
        const found = await helpFor(err, true);
        setTrouble(found.trouble);
        setHelp(found.help);
        if (found.trouble !== "reload") watchPermission();
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stop]
  );

  // Allowed in the browser's settings while the help is showing: start again by itself.
  function watchPermission() {
    if (watching.current || !navigator.permissions?.query) return;
    watching.current = true;
    void Promise.all((["camera", "microphone"] as PermissionName[]).map((n) => navigator.permissions.query({ name: n }).catch(() => null))).then((statuses) => {
      for (const st of statuses) {
        if (!st) continue;
        st.onchange = () => {
          if (statuses.every((x) => !x || x.state === "granted")) {
            watching.current = false;
            void start();
          }
        };
      }
    });
  }

  // The picture.
  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream;
  }, [stream]);

  // The microphone level: a bar that moves when they speak.
  useEffect(() => {
    if (!stream || !stream.getAudioTracks().length) return;
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    let frame = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
      const l = Math.min(1, peak / 64);
      setLevel(l);
      if (l > 0.25) setHeardYou(true);
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(frame);
      void ctx.close();
    };
  }, [stream]);

  useEffect(() => () => {
    stop();
    void audioRef.current?.close();
  }, [stop]);

  // A short chime through the speakers or headphones.
  async function playSound() {
    const ctx = audioRef.current ?? new AudioContext();
    audioRef.current = ctx;
    await ctx.resume();
    setSound("playing");
    const now = ctx.currentTime;
    for (const [i, freq] of [523.25, 659.25, 783.99].entries()) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.25);
      gain.gain.exponentialRampToValueAtTime(0.3, now + i * 0.25 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.25 + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.25);
      osc.stop(now + i * 0.25 + 0.55);
    }
    setTimeout(() => setSound("asked"), 1000);
  }

  const cameraOk = Boolean(stream?.getVideoTracks().some((t) => t.readyState === "live"));
  const allGood = cameraOk && heardYou && sound === "yes";

  return (
    <div className="video-check" data-testid="video-check">
      {!stream && (
        <section className="card video-check__start">
          {help ? (
            <div className="video-check__help" role="alert" data-testid="video-check-help">
              <h3>{help.title}</h3>
              <ol>
                {help.steps.map((st) => (
                  <li key={st}>{st}</li>
                ))}
              </ol>
            </div>
          ) : (
            <p>Your browser will ask to use your camera and microphone. Choose Allow. You only need to do this once in this browser.</p>
          )}
          <button
            type="button"
            className="button button-primary"
            onClick={() => (trouble === "reload" ? window.location.reload() : void start())}
            disabled={busy}
            data-testid="video-check-start"
          >
            {help ? "Try again" : "Turn on my camera and microphone"}
          </button>
        </section>
      )}

      {stream && (
        <div className="video-check__grid">
          <section className="card">
            <h3>1. Camera</h3>
            <video ref={videoRef} className="video-check__preview" autoPlay playsInline muted aria-label="Your camera" />
            {cameras.length > 1 && (
              <label className="field">
                <span>Camera</span>
                <select
                  value={camera}
                  onChange={(e) => {
                    setCamera(e.target.value);
                    void start(e.target.value, mic || undefined);
                  }}
                >
                  {cameras.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <p className="video-check__result" data-ok={cameraOk || undefined}>
              {cameraOk ? "You should see yourself above." : "No picture. Check the camera isn't covered or in use by another app."}
            </p>
          </section>

          <section className="card">
            <h3>2. Microphone</h3>
            <p>Say a few words. The bar moves when the microphone hears you.</p>
            <div className="video-check__meter" aria-hidden="true">
              <span style={{ width: `${Math.round(level * 100)}%` }} />
            </div>
            {mics.length > 1 && (
              <label className="field">
                <span>Microphone</span>
                <select
                  value={mic}
                  onChange={(e) => {
                    setMic(e.target.value);
                    setHeardYou(false);
                    void start(camera || undefined, e.target.value);
                  }}
                >
                  {mics.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <p className="video-check__result" data-ok={heardYou || undefined} role="status">
              {heardYou ? "The microphone hears you." : "Waiting to hear you…"}
            </p>
          </section>

          <section className="card">
            <h3>3. Speakers</h3>
            <p>Play a short chime through your speakers or headphones.</p>
            <button type="button" className="button button-secondary" onClick={() => void playSound()} disabled={sound === "playing"} data-testid="video-check-sound">
              Play a test sound
            </button>
            {(sound === "asked" || sound === "yes" || sound === "no") && (
              <div className="video-check__ask">
                <span>Did you hear it?</span>
                <button type="button" className="button button-secondary button-small" data-selected={sound === "yes" || undefined} onClick={() => setSound("yes")}>
                  Yes
                </button>
                <button type="button" className="button button-secondary button-small" data-selected={sound === "no" || undefined} onClick={() => setSound("no")}>
                  No
                </button>
              </div>
            )}
            {sound === "no" && (
              <p className="video-check__result">
                Turn the volume up, check the sound isn&rsquo;t muted, and if you use headphones, check they&rsquo;re connected. Then play it again.
              </p>
            )}
          </section>
        </div>
      )}

      {stream && (
        <p className={allGood ? "video-check__summary video-check__summary--ok" : "video-check__summary"} role="status" data-testid="video-check-summary">
          {allGood
            ? "Everything works. You're ready for the meeting: in the meeting, press Join with camera and microphone."
            : "Something still needs checking: look for the steps above that haven't turned green."}
        </p>
      )}
    </div>
  );
}
