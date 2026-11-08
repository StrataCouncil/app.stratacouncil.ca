import { test } from "node:test";
import assert from "node:assert/strict";
import { chairForItem, electChairMotion, electedChair, makeItem, newMotion, normalizeAgenda, type AgendaItem } from "../lib/meetings/agenda.ts";
import { buildMinutes } from "../lib/meetings/minutes.ts";
import { itemSteps } from "../lib/meetings/steps.ts";

const carried = (it: AgendaItem, nominee: string): AgendaItem => ({
  ...it,
  nominee,
  done: true,
  motion: { ...it.motion!, outcome: "CARRIED", for: 3, against: 0, abstain: 0, mover: "SL001", sec: "SL002" },
});

test("a chair elected for one item chairs only that item; the meeting's chair is unchanged", () => {
  const roof = { ...makeItem("Roof replacement", "New Business", { type: "FOR_DECISION", motion: newMotion("MAJORITY", "THAT the roof be replaced") }), num: 4 };
  const meetingChair = carried(makeItem("Elect Chairperson", "Chair", { type: "FOR_APPROVAL", motion: newMotion("MAJORITY", electChairMotion("Jeremy McCarron")) }), "Jeremy McCarron");
  const forRoof = carried(
    makeItem("Elect a chair for: Roof replacement", "New Business", { type: "FOR_APPROVAL", motion: newMotion("MAJORITY", electChairMotion("", roof)), forItemId: roof.id }),
    "Cynthia Jones"
  );
  const agenda = [meetingChair, forRoof, roof];
  assert.equal(electedChair(agenda), "Jeremy McCarron");
  assert.equal(chairForItem(agenda, roof.id), "Cynthia Jones");
  assert.equal(chairForItem(agenda, "another"), null);
});

test("the motion names the item and says why", () => {
  assert.equal(
    electChairMotion("Cynthia Jones", { text: "Roof replacement" }),
    'THAT Cynthia Jones chair the meeting for the item "Roof replacement", in place of the chair, who has declared a conflict of interest.'
  );
  assert.equal(electChairMotion("Cynthia Jones"), "THAT Cynthia Jones be elected to chair this meeting.");
});

test("the item a chair election is for survives saving", () => {
  const it = makeItem("Elect a chair for: Roof replacement", "New Business", { type: "FOR_APPROVAL", motion: newMotion("MAJORITY", "THAT x"), forItemId: "item-4" });
  assert.equal(normalizeAgenda(JSON.parse(JSON.stringify([it])))[0].forItemId, "item-4");
});

test("the steps for a chair for one item explain the conflict", () => {
  const it = makeItem("Elect a chair for: Roof replacement", "New Business", { type: "FOR_APPROVAL", motion: newMotion("MAJORITY", "THAT x"), forItemId: "item-4" });
  const steps = itemSteps({ ...it, nominee: "Cynthia Jones" }, { general: false, voteOpen: false, voteClosed: false });
  assert.match(steps[0].label, /Explain why/);
  assert.match(steps[0].hint, /conflict of interest on the next item/);
  assert.ok(steps.some((s) => s.say?.includes("Cynthia Jones will chair the next item")));
});

test("the minutes say who ran the meeting for an item the Runner stepped out of", () => {
  const roof: AgendaItem = {
    ...makeItem("Roof replacement", "New Business", { type: "FOR_DECISION", motion: newMotion("MAJORITY", "THAT the roof be replaced") }),
    num: 4,
    conflicts: [{ lot: "SL061", note: "My company quoted on the roof", left: true }],
    standInRunner: "Abduol Said",
  };
  const minutes = buildMinutes({
    corporation: { planNumber: "EPS9048", name: "Test", address: null },
    meeting: { type: "council", meetingDate: "2026-11-18", startTime: "19:00", timezone: "America/Vancouver", format: "virtual", location: null, chairName: "Jeremy McCarron", actualStartAt: "2026-11-19T03:00:00Z" },
    agenda: [roof],
    attendance: { SL061: "present", SL022: "present", SL060: "present" },
    lotCount: 120,
    councilCount: 7,
    adjournedAt: "2026-11-19T04:00:00Z",
  });
  const summary = minutes.sections.flatMap((s) => s.items).find((i) => i.title === "Roof replacement")!.summary;
  assert.match(summary, /SL061/);
  assert.match(summary, /Abduol Said ran the meeting for this item\./);
});
