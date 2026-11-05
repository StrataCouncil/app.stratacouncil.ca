import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { sameOrigin } from "../lib/meetings/same-origin.ts";

/**
 * public/zoom-frame.html's script, run against a stand-in for Zoom's
 * Component View client: who the host's screen lets in from the waiting
 * room, what a member sees before the host starts, and resizing.
 */
const html = readFileSync(new URL("../public/zoom-frame.html", import.meta.url), "utf8");
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)![1]!;
const ORIGIN = "https://demo.stratacouncil.ca";

function frame(opts: { joinError?: unknown; people?: Array<Record<string, unknown>> } = {}) {
  const told: Array<Record<string, unknown>> = [];
  const admitted: number[] = [];
  const resized: unknown[] = [];
  const handlers: Record<string, (p: unknown) => void> = {};
  const listeners: Array<(e: unknown) => void> = [];
  const intervals: Array<() => void> = [];
  const parent = { postMessage: (m: Record<string, unknown>) => told.push(m) };
  const client = {
    init: () => Promise.resolve(),
    join: () => (opts.joinError ? Promise.reject(opts.joinError) : Promise.resolve()),
    on: (name: string, fn: (p: unknown) => void) => (handlers[name] = fn),
    getAttendeeslist: () => opts.people ?? [],
    admit: (id: number) => (admitted.push(id), Promise.resolve()),
    updateVideoOptions: (o: unknown) => resized.push(o),
    leaveMeeting: () => undefined,
  };
  const window: Record<string, unknown> = {
    location: { origin: ORIGIN },
    parent,
    ZoomMtgEmbedded: { createClient: () => client },
    addEventListener: (_: string, fn: (e: unknown) => void) => listeners.push(fn),
  };
  const ctx = vm.createContext({
    window,
    document: { getElementById: () => ({}) },
    setInterval: (fn: () => void) => (intervals.push(fn), intervals.length),
    clearInterval: () => undefined,
    Promise,
    Object,
    Array,
    Math,
    String,
  });
  vm.runInContext(script, ctx);
  const send = (data: Record<string, unknown>) => listeners.forEach((fn) => fn({ origin: ORIGIN, source: parent, data: { source: "sc-page", ...data } }));
  return { told, admitted, resized, handlers, intervals, send };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const joinAs = (host: boolean) => ({ type: "join", config: { host, signature: "s", meetingNumber: "1", passcode: "p", userName: "n", customerKey: "k", zak: host ? "z" : null }, size: { width: 360, height: 360 } });

test("the host's screen lets in people Zoom's join notices mark bHold (not only isHold)", async () => {
  const f = frame();
  f.send(joinAs(true));
  await flush();
  f.handlers["connection-change"]!({ state: "Connected" });
  f.handlers["user-added"]!([{ userId: 16778240, bHold: true }, { userId: 16779264, bHold: false }]);
  f.handlers["user-updated"]!({ userId: 16780288, isHold: true });
  assert.deepEqual(f.admitted, [16778240, 16780288]);
});

test("and every few seconds it checks Zoom's list again, in case a notice was missed", async () => {
  const people: Array<Record<string, unknown>> = [];
  const f = frame({ people });
  f.send(joinAs(true));
  await flush();
  f.handlers["connection-change"]!({ state: "Connected" });
  assert.equal(f.intervals.length, 1);
  people.push({ userId: 42, isHold: true });
  f.intervals[0]!();
  assert.deepEqual(f.admitted, [42]);
});

test("members' screens never let anyone in", async () => {
  const f = frame({ people: [{ userId: 7, isHold: true }] });
  f.send(joinAs(false));
  await flush();
  f.handlers["connection-change"]!({ state: "Connected" });
  assert.equal(f.handlers["user-added"], undefined);
  assert.deepEqual(f.admitted, []);
  assert.equal(f.intervals.length, 0);
});

test("before the host starts, Zoom's 'meeting has not started' (3008) reads as waiting, not a failure", async () => {
  const f = frame({ joinError: { errorCode: 3008, reason: "Meeting has not started" } });
  f.send(joinAs(false));
  await flush();
  await flush();
  assert.equal(f.told.at(-1)!.state, "hostAway");
  const other = frame({ joinError: { errorCode: 3004, reason: "Meeting Passcode wrong." } });
  other.send(joinAs(false));
  await flush();
  await flush();
  assert.equal(other.told.at(-1)!.state, "failed");
  assert.equal(other.told.at(-1)!.code, "3004");
});

test("the video is sized to leave room for Zoom's toolbar, and follows the box when it changes", async () => {
  const f = frame();
  f.send(joinAs(false));
  await flush();
  f.send({ type: "resize", size: { width: 1000, height: 700 } });
  assert.deepEqual(JSON.parse(JSON.stringify(f.resized)), [{ viewSizes: { default: { width: 1000, height: 604 }, ribbon: { width: 1000, height: 604 } } }]);
});

test("meeting POSTs must come from our own pages", () => {
  const req = (origin: string | null, host = "demo.stratacouncil.ca") =>
    ({ headers: new Headers({ ...(origin ? { origin } : {}), host }) }) as unknown as Parameters<typeof sameOrigin>[0];
  assert.equal(sameOrigin(req("https://demo.stratacouncil.ca")), true);
  assert.equal(sameOrigin(req("https://evil.example")), false);
  assert.equal(sameOrigin(req(null)), false);
  assert.equal(sameOrigin(req("not a url")), false);
});
