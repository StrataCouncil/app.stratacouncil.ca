"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ChatLine } from "@/lib/meetings/video-room";

/**
 * What the meeting's video knows (components/meetings/VideoPanel.tsx, which
 * owns the Zoom session), shared with the People and Chat tabs beside it
 * (components/meetings/MeetingChrome.tsx). The video publishes; the tabs
 * read and call the actions. Nothing here is stored: it lives in this
 * browser while the meeting's video does, and goes when it ends.
 */

export interface RoomPerson {
  userId: number;
  /** Our user id without dashes (lib/zoom/video-identity.ts). */
  identity: string;
  name: string;
  /** Their sound has started (Zoom's "computer audio"); until it has, they can't hear or be heard. */
  audio: boolean;
  muted: boolean;
  video: boolean;
  isHost: boolean;
  isManager: boolean;
  speaking: boolean;
  spotlit: boolean;
  /** May be made a co-host: can run meetings, and isn't the host. */
  canCoHost: boolean;
}

export interface RoomState {
  joined: boolean;
  me: number | null;
  /** Running the meeting (the session's host). */
  amHost: boolean;
  /** A co-host (Zoom's "manager"): sees the queue and mutes, like the host. */
  amManager: boolean;
  people: RoomPerson[];
  /** Raised hands, in order, by Zoom user id. The host's and co-hosts' screens show it; others see only their own place. */
  queue: number[];
  myHand: boolean;
  chat: ChatLine[];
  /** Chat is on for everyone (the host can turn it off). */
  chatOpen: boolean;
}

export interface RoomActions {
  raiseHand: (up: boolean) => void;
  lowerHand: (userId: number) => void;
  askUnmute: (userId: number) => void;
  mute: (userId: number) => void;
  muteAll: () => void;
  spotlight: (userId: number | null) => void;
  setCoHost: (userId: number, on: boolean) => void;
  remove: (userId: number) => void;
  /** Sends to everyone; resolves to an error message, or null. */
  sendChat: (text: string) => Promise<string | null>;
  setChatOpen: (on: boolean) => void;
}

export const EMPTY_ROOM: RoomState = { joined: false, me: null, amHost: false, amManager: false, people: [], queue: [], myHand: false, chat: [], chatOpen: true };

const noop = () => undefined;
const IDLE: RoomActions = {
  raiseHand: noop,
  lowerHand: noop,
  askUnmute: noop,
  mute: noop,
  muteAll: noop,
  spotlight: noop,
  setCoHost: noop,
  remove: noop,
  sendChat: async () => "Join the video to chat.",
  setChatOpen: noop,
};

interface RoomContextValue {
  state: RoomState;
  actions: RoomActions;
  publish: (state: RoomState) => void;
  bind: (actions: RoomActions | null) => void;
}

const RoomContext = createContext<RoomContextValue | null>(null);

export function VideoRoomProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<RoomState>(EMPTY_ROOM);
  const bound = useRef<RoomActions | null>(null);
  // Stable functions that call whatever the video has bound, so the tabs never hold a stale one.
  const actions = useMemo<RoomActions>(
    () => ({
      raiseHand: (up) => (bound.current ?? IDLE).raiseHand(up),
      lowerHand: (id) => (bound.current ?? IDLE).lowerHand(id),
      askUnmute: (id) => (bound.current ?? IDLE).askUnmute(id),
      mute: (id) => (bound.current ?? IDLE).mute(id),
      muteAll: () => (bound.current ?? IDLE).muteAll(),
      spotlight: (id) => (bound.current ?? IDLE).spotlight(id),
      setCoHost: (id, on) => (bound.current ?? IDLE).setCoHost(id, on),
      remove: (id) => (bound.current ?? IDLE).remove(id),
      sendChat: (text) => (bound.current ?? IDLE).sendChat(text),
      setChatOpen: (on) => (bound.current ?? IDLE).setChatOpen(on),
    }),
    []
  );
  const publish = useCallback((s: RoomState) => setState(s), []);
  const bind = useCallback((a: RoomActions | null) => {
    bound.current = a;
  }, []);
  const value = useMemo(() => ({ state, actions, publish, bind }), [state, actions, publish, bind]);
  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>;
}

/** For the tabs: the room, or an empty one outside a meeting. */
export function useVideoRoom(): { state: RoomState; actions: RoomActions } {
  const v = useContext(RoomContext);
  return v ?? { state: EMPTY_ROOM, actions: IDLE };
}

/** For the video: where to publish (null outside a provider, as on the video check page). */
export function useVideoRoomPublisher() {
  const v = useContext(RoomContext);
  const publish = v?.publish;
  const bind = v?.bind;
  // The same object on every render (publish and bind never change), so effects that use it don't run again and again.
  return useMemo(() => (publish && bind ? { publish, bind } : null), [publish, bind]);
}
