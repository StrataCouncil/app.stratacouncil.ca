import { decisionTypeLabels, isAdjournment, isElectChair, isNextMeeting, type AgendaItem } from "./agenda.ts";
import { takesConflicts } from "./live.ts";

/**
 * The Runner's steps for an agenda item, in order (Meeting Mode): a list
 * to follow, never something to click through. Steps tick themselves from
 * what's on screen (a motion with a mover and seconder, an open or closed
 * vote, the item decided); a step done ticks every step before it too.
 * "hint" and "say" (optional wording) sit collapsed under each step.
 */

export type StepId =
  | "introduce"
  | "conflicts"
  | "motion"
  | "discuss"
  | "vote"
  | "close"
  | "count"
  | "confirm"
  | "questions"
  | "received"
  | "direction"
  | "date";

export interface Step {
  id: StepId;
  label: string;
  /** What to do. */
  hint: string;
  /** Optional wording for the chair. */
  say: string | null;
  done: boolean;
}

export interface StepState {
  general: boolean;
  voteOpen: boolean;
  voteClosed: boolean;
}

/** Council meetings vote on screens, except electing a chair (counted by hand). */
export const usesLiveVoting = (it: AgendaItem, general: boolean) => !general && !isElectChair(it);

export function itemSteps(it: AgendaItem, s: StepState): Step[] {
  const m = it.motion;
  // Nothing on screen records these; they tick once a later step is done.
  const manual = (id: StepId, label: string, hint: string, say: string | null = null): Step => ({ id, label, hint, say, done: false });
  const auto = (id: StepId, label: string, hint: string, done: boolean, say: string | null = null): Step => ({ id, label, hint, say, done });
  const introduce = manual(
    "introduce",
    "Introduce the item",
    "Present the background, financial implications and risks. Use Share on screen to put an attachment on everyone's screen.",
    `"Next is ${it.text}."`
  );
  const steps: Step[] = [];

  if (isNextMeeting(it)) {
    steps.push(
      auto("date", "Agree on the next meeting", "Record the date, time and place.", Boolean(it.nextMeeting?.date), '"When would council like to meet next?"'),
      auto("received", "Move on", "Done, next item.", it.done)
    );
  } else if (m) {
    const counted = m.for + m.against + m.abstain > 0;
    const motionReady = Boolean(m.text.trim() && m.mover && m.sec && (!isElectChair(it) || it.nominee?.trim()));
    if (!isAdjournment(it)) steps.push(introduce);
    if (!s.general && takesConflicts(it.text)) {
      steps.push(
        manual(
          "conflicts",
          "Ask for conflicts of interest",
          "Anyone with a conflict says what it is and steps out for this item. Record it here; they won't vote on it.",
          '"Does anyone have a conflict of interest on this item?"'
        )
      );
    }
    steps.push(
      auto(
        "motion",
        "Get a motion",
        isElectChair(it) ? "Record the nominee, who moved it and who seconded it." : "Check the motion's wording, then record who moved it and who seconded it.",
        motionReady,
        '"Is there a motion? … Moved by …, seconded by …"'
      )
    );
    if (!isAdjournment(it)) steps.push(manual("discuss", "Discussion", "Open the floor for discussion of the motion.", '"Is there any discussion?"'));
    if (usesLiveVoting(it, s.general)) {
      steps.push(
        auto(
          "vote",
          "Open the vote",
          "Members vote on their own screens. Enter votes for anyone on the phone or in the room, or use All in favour.",
          s.voteOpen || s.voteClosed,
          '"The vote is open."'
        ),
        auto("close", "Close the vote", "When everyone has voted, close it. Anyone who hasn't voted is counted as abstaining.", s.voteClosed)
      );
    } else {
      const dt = s.general ? decisionTypeLabels[m.dt] : "majority";
      steps.push(
        auto(
          "count",
          "Count the vote",
          `Count those in favour, opposed and abstaining (${dt}).`,
          counted,
          '"Those in favour? … Those opposed? … Any abstentions?"'
        )
      );
    }
    steps.push(auto("confirm", "Confirm the decision", "Confirm the outcome. It goes in the minutes.", it.done, '"The motion is carried." (or defeated)'));
  } else if (it.type === "FOR_DISCUSSION") {
    steps.push(
      introduce,
      manual("discuss", "Discussion", "Open the floor.", '"The floor is open for discussion."'),
      auto("direction", "Wrap up", "Sum up, then record consensus or move on.", it.done)
    );
  } else {
    steps.push(
      introduce,
      manual("questions", "Questions", "Invite questions or comments.", '"Any questions?"'),
      auto("received", "Received", "Mark it received and move on.", it.done)
    );
  }

  // A later step done means the earlier ones are too.
  for (let i = steps.length - 1, later = false; i >= 0; i--) {
    if (later) steps[i] = { ...steps[i], done: true };
    if (steps[i].done) later = true;
  }
  return steps;
}

/** The first step not done yet, or -1 when the item is finished. */
export const currentStep = (steps: Step[]) => steps.findIndex((st) => !st.done);
