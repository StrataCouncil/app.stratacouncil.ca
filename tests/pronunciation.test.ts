import { test } from "node:test";
import assert from "node:assert/strict";
import { forSpeech } from "../lib/media/pronunciation.ts";

test("narration says strata the BC way, and the script keeps its spelling", () => {
  assert.equal(forSpeech("A strata corporation"), "A strahda corporation");
  assert.equal(forSpeech("Strata Property Act, STRATA PLAN"), "Strahda Property Act, STRAHDA PLAN");
  assert.equal(forSpeech("Ask Stratasphere on StrataCouncil.ca"), "Ask Strahdasphere on StrahdaCouncil.ca");
  assert.equal(forSpeech("the stratas in BC"), "the strahdas in BC");
  // Only at the start of a word.
  assert.equal(forSpeech("substrata"), "substrata");
  const script = "Your strata";
  forSpeech(script);
  assert.equal(script, "Your strata");
});
