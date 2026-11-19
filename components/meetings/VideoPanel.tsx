"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { VideoJoin } from "@/app/strata/[corpId]/meetings/[meetingId]/live/actions";
import { fetchVideoJoin } from "@/lib/meetings/live-client";
import { bestGrid } from "@/lib/meetings/video-grid";
import { STEPPED_OUT_VIDEO } from "@/lib/meetings/live";
import { helpFor, type DeviceHelp, type DeviceTrouble } from "@/lib/meetings/device-help";
import { videoIdentity } from "@/lib/zoom/video-identity";
import { demoClip, demoOffset } from "@/lib/demo-video";
import { addChat, applyHand, canCoHost, encodeCommand, MAX_CHAT_LENGTH, myPlace, parseCommand, pruneHands, type ChatLine, type Hand, type RoomCommand } from "@/lib/meetings/video-room";
import { useVideoRoomPublisher, type RoomActions } from "@/components/meetings/VideoRoom";

type Phase = "loading" | "ready" | "joining" | "joined" | "reconnecting" | "ended" | "failed" | "out";

/** One person in the video session, as the tiles need them. */
type Person = { userId: number; identity: string; name: string; video: boolean; audio: boolean; muted: boolean; reconnecting: boolean; isHost: boolean; isManager: boolean };
type Device = { id: string; label: string };

/* The SDK is browser-only and large: loaded when a meeting's video opens, never on the server. */
type Sdk = typeof import("@zoom/videosdk");
type Client = ReturnType<Sdk["default"]["createClient"]>;
type Stream = ReturnType<Client["getMediaStream"]>;

/**
 * The meeting's video, at the top of the right-hand column in Meeting Mode and
 * on the members' page (Zoom Video SDK, lib/zoom/video-sdk.ts). Everything
 * here is ours: a tile per person ("Name, SL###"), a microphone and a camera
 * button, a larger view, speaker and gallery views, pinning, and a raised
 * hand. Chat, the queue of raised hands, and the runner's controls (mute,
 * ask to unmute, spotlight, co-host, remove) are shared with the People and
 * Chat tabs beside it through components/meetings/VideoRoom.tsx. None of
 * Zoom's interface appears; recording and screen sharing aren't used.
 * Nothing that happens in the video is stored or goes in the minutes: chat
 * and hands live in the browser and go when the meeting adjourns.
 *
 * Everyone joins with one click on "Join with camera and microphone" (or
 * "sound only"): the browser asks for both at once, at that moment, and if it
 * can't have them the panel says exactly how to allow them in this browser
 * on this computer (lib/meetings/device-help.ts), then starts by itself once
 * they're allowed, with no reload. Sound comes on with the join, microphone
 * off until they unmute. "Devices" picks the camera and microphone. A dropped
 * connection reconnects by itself. At adjournment (`ended`) the person
 * running the meeting ends the session for everyone, and every screen
 * leaves it.
 *
 * A member who has stepped out for a conflict of interest (`steppedOut`)
 * leaves the session (camera and microphone off, nobody seen or heard) and
 * rejoins by themselves when the meeting moves on; the server won't let them
 * back in meanwhile. The Runner's screen also removes anyone in
 * `removeUsers` who is still in the session.
 *
 * In-person meetings show nothing; the demo site shows tiles in place of video.
 */
export function VideoPanel(props: {
  meetingId: string;
  isRunner: boolean;
  /** The meeting has adjourned: leave (and, for the Runner, end) the session. */
  ended?: boolean;
  people: Array<{ key: string; name: string; lot: string | null }>;
  /** This member has stepped out for the item the meeting is on (a conflict of interest). */
  steppedOut?: boolean;
  /** The Runner's screen: our user ids to remove from the session (stepped out). */
  removeUsers?: string[];
  /** Our user ids of everyone who can run meetings: the people who may be made co-hosts. */
  runners?: string[];
}) {
  const { meetingId } = props;
  const steppedOut = Boolean(props.steppedOut);
  // Joined by a click (with or without the camera); kept so stepping back in rejoins by itself.
  const [want, setWant] = useState<{ camera: boolean } | null>(null);
  const [help, setHelp] = useState<DeviceHelp | null>(null);
  const [trouble, setTrouble] = useState<DeviceTrouble | null>(null);
  const [preparing, setPreparing] = useState(false);
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
  // The room (lib/meetings/video-room.ts): raised hands, chat, views.
  const [queueIds, setQueueIds] = useState<number[]>([]);
  const [myHand, setMyHand] = useState(false);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [chatOpen, setChatOpenState] = useState(true);
  const [speaking, setSpeaking] = useState<number[]>([]);
  const [spotlit, setSpotlit] = useState<number[]>([]);
  const [view, setView] = useState<"gallery" | "speaker">("gallery");
  const [pinned, setPinned] = useState<number | null>(null);
  const [askedToUnmute, setAskedToUnmute] = useState(false);
  const [lastSpeaker, setLastSpeaker] = useState<number | null>(null);
  const hands = useRef<Hand[]>([]);
  const handSeq = useRef(0);
  const myHandRef = useRef<{ up: boolean; at: number }>({ up: false, at: 0 });
  const room = useVideoRoomPublisher();

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
        // Who they are to us: the token's user_identity, or failing that its user_key (our user id).
        identity: u.userIdentity || (u.userKey ? videoIdentity(u.userKey) : ""),
        name: u.displayName,
        video: Boolean(u.bVideoOn),
        audio: Boolean(u.audio),
        muted: !u.audio || Boolean(u.muted),
        reconnecting: Boolean(u.isInFailover),
        isHost: Boolean(u.isHost),
        isManager: Boolean(u.isManager),
      }))
    );
    // The host keeps the queue: anyone who left drops out of it.
    if (s.client.isHost()) {
      const present = new Set(all.map((u) => u.userId));
      const kept = pruneHands(hands.current, present);
      if (kept.length !== hands.current.length) {
        hands.current = kept;
        shareQueue();
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  // The command channel: raised hands (lib/meetings/video-room.ts).
  function send(c: RoomCommand, to?: number) {
    const s = sdk.current;
    if (!s) return;
    void s.client
      .getCommandClient()
      .send(encodeCommand(c), to)
      .catch(() => undefined);
  }
  // The host's order of hands, sent round so everyone's place is the same.
  function shareQueue() {
    const ids = hands.current.map((h) => h.userId);
    setQueueIds(ids);
    send({ t: "queue", ids });
  }
  function setOwnHand(up: boolean) {
    myHandRef.current = { up, at: up ? Date.now() : 0 };
    setMyHand(up);
    send({ t: "hand", up, at: myHandRef.current.at });
  }
  function onCommand(senderId: number, text: string) {
    const s = sdk.current;
    const c = parseCommand(text);
    if (!s || !c) return;
    const sender = s.client.getUser(senderId);
    const fromChair = Boolean(sender?.isHost || sender?.isManager);
    if (c.t === "hand" && s.client.isHost()) {
      hands.current = applyHand(hands.current, senderId, c.up, c.at, ++handSeq.current);
      shareQueue();
    } else if (c.t === "queue" && sender?.isHost && !s.client.isHost()) {
      setQueueIds(c.ids);
    } else if (c.t === "lower" && fromChair && myHandRef.current.up) {
      setOwnHand(false);
    } else if (c.t === "unmute" && fromChair) {
      setAskedToUnmute(true);
    } else if (c.t === "sync" && sender?.isHost && myHandRef.current.up) {
      // The host has (re)joined: say again that our hand is up, keeping its place.
      send({ t: "hand", up: true, at: myHandRef.current.at });
    }
  }
  function addMessage(m: { id?: string; message?: string; sender: { userId: number; name: string }; timestamp: number }) {
    if (!m.message) return;
    const line: ChatLine = { id: m.id ?? `${m.sender.userId}-${m.timestamp}`, fromId: m.sender.userId, fromName: m.sender.name, text: m.message, at: m.timestamp };
    setChat((c) => addChat(c, line));
  }

  // Join details from our server, then into the session.
  useEffect(() => {
    let cancelled = false;
    if (steppedOut) {
      setPhase("out");
      setPeople([]);
      return;
    }
    setPhase("loading");
    setProblem(null);
    void fetchVideoJoin(meetingId)
      .catch((): VideoJoin => ({ kind: "message", tone: "error", message: "Couldn't reach the server for the video. Try again." }))
      .then(async (j) => {
        if (cancelled) return;
        setJoin(j);
        if (j.kind !== "join") return;
        // Nothing starts until they choose to join (one click, and the browser asks then).
        if (!want) {
          setPhase("ready");
          return;
        }
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

          // Raised hands, chat, who's talking, and the spotlight.
          client.on("command-channel-message", (m) => onCommand(Number(m.senderId), m.text));
          const chatClient = client.getChatClient();
          client.on("chat-on-message", (m) => addMessage(m));
          client.on("chat-privilege-change", (p) => setChatOpenState(p.chatPrivilege !== mod.ChatPrivilege.NoOne));
          try {
            setChatOpenState(chatClient.getPrivilege() !== mod.ChatPrivilege.NoOne);
            for (const m of chatClient.getHistory()) addMessage(m);
          } catch {
            // Chat isn't ready yet; messages still arrive.
          }
          client.on("active-speaker", (list) => {
            const ids = list.map((a) => a.userId);
            setSpeaking(ids);
            if (ids[0] != null) setLastSpeaker(ids[0]);
          });
          client.on("video-spotlight-change", (p) => setSpotlit(p.spotlightList.map((x) => x.userId)));
          client.on("host-ask-unmute-audio", () => setAskedToUnmute(true));
          if (client.isHost()) send({ t: "sync" });

          client.on("auto-play-audio-failed", () => {
            setProblem({ message: "Click anywhere on this page to hear the meeting." });
          });
          client.on("device-change", () => refreshDevices());

          // The camera, if they chose it (the browser already allowed it).
          if (want.camera) {
            try {
              await stream.startVideo(chosenCamera.current ? { cameraId: chosenCamera.current } : undefined);
              setCameraOn(true);
            } catch (err) {
              setProblem({ message: await deviceProblem(err, "camera", "Couldn't start your camera. Turn it on with the camera button."), reason: describe(err) });
            }
          }
          // Sound, microphone off. Browsers can refuse sound that didn't come
          // straight from a click; then "Turn on sound" does it.
          try {
            await stream.startAudio({ mute: true });
            if (!cancelled) {
              setAudioReady(true);
              setMicOn(false);
            }
          } catch {
            // "Turn on sound" stays.
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
  }, [meetingId, attempt, want, steppedOut, attach, detach, refreshPeople, refreshDevices, fail]);

  // Leaving the session (stepping out, or a new join) resets what was on.
  useEffect(() => {
    if (phase === "out" || phase === "loading") {
      setAudioReady(false);
      setMicOn(false);
      setCameraOn(false);
    }
    // Chat and hands live only while the meeting's video does: gone when it ends.
    if (phase === "out" || phase === "ended") {
      setChat([]);
      setQueueIds([]);
      setMyHand(false);
      setSpeaking([]);
      setSpotlit([]);
      setAskedToUnmute(false);
      hands.current = [];
      myHandRef.current = { up: false, at: 0 };
    }
  }, [phase]);

  // The Runner removes anyone who has stepped out and is still in the session.
  const removeKey = (props.removeUsers ?? []).join(",");
  useEffect(() => {
    const s = sdk.current;
    if (!props.isRunner || !s || phase !== "joined" || !removeKey) return;
    const out = new Set(removeKey.split(",").map(videoIdentity));
    for (const p of people) {
      if (p.userId !== me && p.identity && out.has(p.identity)) void s.client.removeUser(p.userId).catch(() => undefined);
    }
  }, [props.isRunner, removeKey, people, phase, me]);

  /**
   * Join: the browser asks for the camera and microphone now, together. If
   * it can't have them, say how to allow them here, and try again by itself
   * once they're allowed.
   */
  async function start(camera: boolean) {
    setPreparing(true);
    setHelp(null);
    setProblem(null);
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true, video: camera });
      for (const t of media.getTracks()) t.stop();
      setWant({ camera });
      setAttempt((a) => a + 1);
    } catch (err) {
      const found = await helpFor(err, camera);
      setTrouble(found.trouble);
      setHelp(found.help);
      if (found.trouble !== "reload") watchPermission(camera);
    } finally {
      setPreparing(false);
    }
  }
  const watching = useRef(false);
  function watchPermission(camera: boolean) {
    if (watching.current || !navigator.permissions?.query) return;
    watching.current = true;
    const names = (camera ? ["camera", "microphone"] : ["microphone"]) as PermissionName[];
    void Promise.all(names.map((n) => navigator.permissions.query({ name: n }).catch(() => null))).then((statuses) => {
      for (const st of statuses) {
        if (!st) continue;
        st.onchange = () => {
          if (statuses.every((x) => !x || x.state === "granted")) {
            watching.current = false;
            void start(camera);
          }
        };
      }
    });
  }

  // Who's featured in speaker view: someone pinned here, then the spotlight, then whoever spoke last.
  const featured =
    view === "speaker" && people.length > 1
      ? ([pinned, spotlit[0], lastSpeaker].find((id) => id != null && people.some((p) => p.userId === id)) ?? people.find((p) => p.userId !== me)?.userId ?? null)
      : null;

  // Cameras already on when we joined, and ours once it starts: drawn as their tiles appear (again after a change of view).
  useEffect(() => {
    for (const p of people) if (p.video) void attach(p.userId);
  }, [people, attach, view, featured]);

  // What the People and Chat tabs see (components/meetings/VideoRoom.tsx).
  const runnerKey = (props.runners ?? []).join(",");
  const amHost = phase === "joined" && Boolean(people.find((p) => p.userId === me)?.isHost);
  const amManager = phase === "joined" && Boolean(people.find((p) => p.userId === me)?.isManager);
  useEffect(() => {
    if (!room) return;
    const runners = new Set(runnerKey ? runnerKey.split(",").map(videoIdentity) : []);
    room.publish({
      joined: phase === "joined",
      me,
      amHost,
      amManager,
      people: people.map((p) => ({
        userId: p.userId,
        identity: p.identity,
        name: p.name,
        audio: p.audio,
        muted: p.muted,
        video: p.video,
        isHost: p.isHost,
        isManager: p.isManager,
        speaking: speaking.includes(p.userId),
        spotlit: spotlit.includes(p.userId),
        canCoHost: canCoHost(p.identity, runners, p.isHost),
      })),
      queue: queueIds,
      myHand,
      chat,
      chatOpen,
    });
  }, [room, phase, me, amHost, amManager, people, speaking, spotlit, queueIds, myHand, chat, chatOpen, runnerKey]);

  useEffect(() => {
    if (!room) return;
    const run = (f: (s: NonNullable<typeof sdk.current>) => Promise<unknown> | unknown) => {
      const s = sdk.current;
      if (!s) return;
      void Promise.resolve()
        .then(() => f(s))
        .catch((err) => setProblem({ message: "That didn't work. Try again.", reason: describe(err) }));
    };
    const actions: RoomActions = {
      raiseHand: (up) => setOwnHand(up),
      lowerHand: (userId) =>
        run((s) => {
          if (s.client.isHost()) {
            hands.current = applyHand(hands.current, userId, false, 0, ++handSeq.current);
            shareQueue();
          }
          send({ t: "lower" }, userId);
        }),
      // Zoom's ask reaches only someone whose sound has started. For anyone
      // else (their browser held it back, or they haven't turned it on), we
      // ask over the command channel: their Unmute starts the sound too.
      askUnmute: (userId) =>
        run(async (s) => {
          if (!s.client.getUser(userId)?.audio) return send({ t: "unmute" }, userId);
          try {
            await s.stream.unmuteAudio(userId);
          } catch {
            send({ t: "unmute" }, userId);
          }
        }),
      mute: (userId) => run((s) => s.stream.muteAudio(userId)),
      muteAll: () => run((s) => s.stream.muteAllAudio()),
      spotlight: (userId) => run((s) => (userId == null ? s.stream.removeAllSpotlightedVideos() : s.stream.spotlightVideo(userId, true))),
      setCoHost: (userId, on) => run((s) => (on ? s.client.makeManager(userId) : s.client.revokeManager(userId))),
      remove: (userId) => run((s) => s.client.removeUser(userId)),
      sendChat: async (text) => {
        const s = sdk.current;
        const body = text.trim().slice(0, MAX_CHAT_LENGTH);
        if (!s) return "Join the video to chat.";
        if (!body) return null;
        try {
          const sent = await s.client.getChatClient().sendToAll(body);
          if (sent && !(sent instanceof Error) && "sender" in sent) addMessage(sent as Parameters<typeof addMessage>[0]);
          return null;
        } catch (err) {
          console.error("[video] chat", describe(err));
          return chatOpen ? "Couldn't send that. Try again." : "The person running the meeting has turned chat off.";
        }
      },
      setChatOpen: (on) =>
        run(async (s) => {
          await s.client.getChatClient().setPrivilege(on ? s.mod.ChatPrivilege.All : s.mod.ChatPrivilege.NoOne);
          setChatOpenState(on);
        }),
    };
    room.bind(actions);
    return () => room.bind(null);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // The person running the meeting asked to unmute: do it, and the hand goes down.
  async function acceptUnmute() {
    setAskedToUnmute(false);
    const s = sdk.current;
    if (!s) return;
    try {
      if (!audioReady) {
        await s.stream.startAudio({ mute: false });
        setAudioReady(true);
        setMicOn(true);
      } else if (!micOn) {
        await s.stream.unmuteAudio();
        setMicOn(true);
      }
      if (myHandRef.current.up) setOwnHand(false);
    } catch (err) {
      setProblem({ message: await deviceProblem(err, "microphone", "Couldn't unmute. Try the Unmute button."), reason: describe(err) });
    }
    refreshPeople();
  }

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
        // Speaking now: the hand has done its job.
        if (myHandRef.current.up) setOwnHand(false);
        setAskedToUnmute(false);
      }
      setProblem(null);
    } catch (err) {
      setProblem({ message: await deviceProblem(err, "microphone", "Couldn't change the microphone. Try again."), reason: describe(err) });
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
      setProblem({ message: await deviceProblem(err, "camera", "Couldn't change the camera. Try again."), reason: describe(err) });
    } finally {
      setBusy(null);
      refreshPeople();
    }
  }


  if (phase === "out" || (join?.kind === "message" && join.message === STEPPED_OUT_VIDEO)) {
    return (
      <section className="mm-video mm-video--message" aria-label="Meeting video" data-testid="video-stepped-out">
        <p className="mm-video__msg" role="status">
          {STEPPED_OUT_VIDEO}
        </p>
      </section>
    );
  }

  if (!join || join.kind === "none") return null;

  if (join.kind === "demo") return <DemoTiles people={props.people} />;

  if (join.kind === "join" && phase === "ready") {
    if (props.ended) return null;
    return (
      <section className="mm-video mm-video--message" aria-label="Meeting video" data-testid="video-ready">
        {help ? (
          <div className="mm-video__help" role="alert" data-testid="video-help">
            <strong>{help.title}</strong>
            <ol>
              {help.steps.map((st) => (
                <li key={st}>{st}</li>
              ))}
            </ol>
          </div>
        ) : (
          <p className="mm-video__msg">The meeting has video. Your microphone stays off until you unmute.</p>
        )}
        <div className="mm-video__join">
          <button type="button" className="button button-primary button-small" onClick={() => (trouble === "reload" ? window.location.reload() : void start(true))} disabled={preparing} data-testid="video-join">
            {help ? "Try again" : "Join with camera and microphone"}
          </button>
          <button type="button" className="link-button" onClick={() => void start(false)} disabled={preparing} data-testid="video-join-sound">
            Join with sound only
          </button>
        </div>
      </section>
    );
  }

  if (join.kind === "link") {
    return (
      <section className="mm-video mm-video--message" aria-label="Meeting video" data-testid="video-link">
        {join.url ? (
          <>
            <p className="mm-video__msg">This meeting&rsquo;s video is on the council&rsquo;s own link.</p>
            <div className="mm-video__join">
              <a href={join.url} target="_blank" rel="noopener noreferrer" className="button button-primary button-small" data-testid="video-own-link">
                Open the video link
              </a>
            </div>
          </>
        ) : (
          <p className="mm-video__msg">
            Built-in video comes with Stratasphere&trade;. The meeting works without it; whoever runs meetings can add the
            council&rsquo;s own video link to the meeting&rsquo;s details.
          </p>
        )}
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
  // Speaker view: the featured person large, up to four others in a strip under them.
  const strip = featured != null ? people.filter((p) => p.userId !== featured).slice(0, 4) : [];
  const shown = featured != null ? [people.find((p) => p.userId === featured)!, ...strip] : people;
  // Before the box is measured, lay out for the column's usual 4:3 box.
  const { cols, rows } = bestGrid(people.length, box.w || 400, box.h || 300);
  const gridStyle =
    featured != null
      ? { gridTemplateColumns: `repeat(${Math.max(1, strip.length)}, minmax(0, 1fr))`, gridTemplateRows: strip.length ? "minmax(0, 3fr) minmax(0, 1fr)" : "minmax(0, 1fr)" }
      : { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` };
  const place = myPlace(queueIds, me);
  const seesQueue = amHost || amManager;
  return (
    <section className={large ? "mm-video mm-video--large" : "mm-video"} aria-label="Meeting video" data-testid="video-panel" data-phase={phase}>
      {large && <div className="mm-video__scrim" onClick={() => setLarge(false)} aria-hidden="true" />}
      <div className="mm-video__frame" ref={frameRef}>
        <video-player-container className="mm-video__grid" data-view={featured != null ? "speaker" : "gallery"} style={gridStyle}>
          {shown.map((p) => {
            const hand = queueIds.indexOf(p.userId);
            const showHand = p.userId === me ? myHand : seesQueue && hand >= 0;
            return (
            <div
              key={p.userId}
              className="mm-video__person"
              data-video={p.video || undefined}
              data-featured={p.userId === featured || undefined}
              data-speaking={speaking.includes(p.userId) || undefined}
              data-testid="video-person"
            >
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
                {p.muted && <MicOffIcon title={p.audio ? "Muted" : "Sound not on yet"} />}
                {showHand && (
                  <span className="mm-video__hand" title={p.userId === me ? "Your hand is raised" : `Hand raised, ${hand + 1} in line`}>
                    <HandIcon />
                    {p.userId !== me && seesQueue ? hand + 1 : ""}
                  </span>
                )}
                {p.name}
                {p.userId === me ? " (you)" : ""}
                {p.reconnecting ? " · reconnecting" : ""}
              </span>
              {people.length > 1 && (
                <button
                  type="button"
                  className="mm-video__pin"
                  onClick={() => {
                    if (pinned === p.userId) setPinned(null);
                    else {
                      setPinned(p.userId);
                      setView("speaker");
                    }
                  }}
                  aria-pressed={pinned === p.userId}
                  title={pinned === p.userId ? "Unpin (only on your screen)" : "Pin, so they stay large on your screen"}
                  data-testid="video-pin"
                >
                  {pinned === p.userId ? "Unpin" : "Pin"}
                </button>
              )}
            </div>
            );
          })}
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
      {phase === "joined" && askedToUnmute && (
        <div className="mm-video__ask" role="alert" data-testid="video-ask-unmute">
          <span>The person running the meeting asks you to unmute.</span>
          <span className="mm-video__ask-actions">
            <button type="button" className="button button-primary button-small" onClick={() => void acceptUnmute()} data-testid="video-ask-unmute-yes">
              Unmute
            </button>
            <button type="button" className="button button-secondary button-small" onClick={() => setAskedToUnmute(false)}>
              Stay muted
            </button>
          </span>
        </div>
      )}
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
        {!amHost && (
          <button
            type="button"
            className="mm-video__ctl"
            data-on={myHand || undefined}
            onClick={() => setOwnHand(!myHand)}
            disabled={phase !== "joined"}
            aria-pressed={myHand}
            data-testid="video-hand"
          >
            <HandIcon /> {myHand ? "Lower hand" : "Raise hand"}
          </button>
        )}
        <button
          type="button"
          className="mm-video__size mm-video__push"
          onClick={() => {
            setView((v) => (v === "gallery" ? "speaker" : "gallery"));
            setPinned(null);
          }}
          disabled={phase !== "joined" || people.length < 2}
          data-testid="video-view"
        >
          {view === "gallery" ? "Speaker view" : "Gallery view"}
        </button>
        <button type="button" className="mm-video__size" onClick={() => setShowDevices((d) => !d)} aria-expanded={showDevices} disabled={phase !== "joined"} data-testid="video-devices">
          Devices
        </button>
        <button type="button" className="mm-video__size" onClick={() => setLarge((l) => !l)} aria-pressed={large} data-testid="video-size">
          {large ? "Smaller video" : "Larger video"}
        </button>
      </div>
      {phase === "joined" && myHand && place && (
        <p className="mm-video__hint" role="status" data-testid="video-hand-place">
          Your hand is raised. {place} in line. It goes down when you unmute.
        </p>
      )}
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
/**
 * What to tell someone whose camera or microphone didn't start. Zoom reports
 * "permission denied" (6100) or "capture failed" (6010) both when the browser
 * blocks the device and when another app or tab already has it; the browser's
 * own permission state tells the two apart.
 */
async function deviceProblem(err: unknown, kind: "camera" | "microphone", otherwise: string): Promise<string> {
  const text = describe(err) ?? "";
  if (!/permission|denied|notallowed|notreadable|capture_failed|6100|6010|in use/i.test(text)) return otherwise;
  let state: string | null = null;
  try {
    state = (await navigator.permissions.query({ name: kind as PermissionName })).state;
  } catch {
    // Some browsers can't say; fall through to the general advice.
  }
  if (state === "granted") {
    return `Your ${kind} is in use by another app or browser tab (Zoom, FaceTime, or another meeting window). Close it there, then try again.`;
  }
  return `The browser blocked the ${kind}. Allow it for this site (the icon in the address bar), then try again.`;
}

/**
 * The demo site's video (lib/demo-video.ts): the fictional council's
 * cameras as silent loops of people listening, each starting at a different
 * point so they don't all look down at once. Nobody is shown speaking. A
 * loop that can't play shows its still; with reduced motion only the stills
 * show. Everyone else gets their initials.
 */
export function DemoTiles({ people }: { people: Array<{ key: string; name: string; lot: string | null }> }) {
  const shown = people.slice(0, 9);
  const [still, setStill] = useState(false);
  const [broken, setBroken] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    setStill(Boolean(reduce?.matches));
  }, []);

  return (
    <section className="mm-video" aria-label="Meeting video" data-testid="video-demo">
      <div className="mm-video__tiles">
        {shown.map((p, i) => {
          const clip = demoClip(p.name);
          const label = p.lot ? `${p.name}, ${p.lot}` : p.name;
          if (!clip) {
            return (
              <div key={p.key} className="mm-video__tile">
                <span className="mm-video__initials" aria-hidden="true">
                  {initials(p.name)}
                </span>
                <span className="mm-video__name">{label}</span>
              </div>
            );
          }
          return (
            <div key={p.key} className="mm-video__tile mm-video__tile--media" data-testid="video-demo-camera">
              {still || broken[p.key] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="mm-video__media" src={clip.poster} alt="" />
              ) : (
                <video
                  className="mm-video__media"
                  poster={clip.poster}
                  autoPlay
                  muted
                  loop
                  playsInline
                  preload="auto"
                  aria-hidden="true"
                  onLoadedMetadata={(e) => {
                    const v = e.currentTarget;
                    if (Number.isFinite(v.duration)) v.currentTime = demoOffset(i, v.duration);
                  }}
                >
                  <source src={clip.webm} type="video/webm" />
                  <source
                    src={clip.video}
                    type="video/mp4"
                    // The last source failing means none could play.
                    onError={() => setBroken((b) => ({ ...b, [p.key]: true }))}
                  />
                </video>
              )}
              <span className="mm-video__label">
                <DemoMicIcon />
                <span>{label}</span>
              </span>
            </div>
          );
        })}
        {people.length === 0 && <div className="mm-video__tile mm-video__tile--empty">Nobody has joined yet</div>}
      </div>
      <p className="mm-video__note">
        <CameraIcon /> Sample video. In a real meeting, each person&rsquo;s own camera appears here.
      </p>
    </section>
  );
}

/** Muted: nobody in the sample video speaks. */
function DemoMicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      <path d="M4 4l16 16" />
    </svg>
  );
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

function HandIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12" />
      <path d="M11 11.5V4a1.5 1.5 0 0 1 3 0v7.5" />
      <path d="M14 11.5V5.5a1.5 1.5 0 0 1 3 0V14" />
      <path d="M8 13l-1.6-1.6a1.6 1.6 0 0 0-2.3 2.3L8 18c1.3 1.6 3 3 5.5 3H14a5 5 0 0 0 5-5V8.5a1.5 1.5 0 0 0-3 0" />
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

function MicOffIcon({ title }: { title?: string } = {}) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? "img" : undefined}>
      {title && <title>{title}</title>}
      <path d="M3 3l18 18" />
      <path d="M9 9v2a3 3 0 0 0 5 2.2M15 9.3V6a3 3 0 0 0-5.7-1.3" />
      <path d="M5 11a7 7 0 0 0 11.5 5.3M19 11a7 7 0 0 1-.6 2.8M12 18v3" />
    </svg>
  );
}
