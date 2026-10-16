/**
 * Words the narration voice says wrongly, respelled the way they're said.
 * Only the text sent to text-to-speech changes; the script, captions and
 * transcript keep the real spelling.
 *
 * "strata" is said STRAH-tuh in BC; read as written, the voice says
 * "STRAY-tuh". It's matched at the start of a word, so "Stratasphere" and
 * "StrataCouncil.ca" are covered too.
 */
const RESPELLINGS: Array<[RegExp, string]> = [[/\bstrata/gi, "strahta"]];

/** The text as the voice should read it. */
export function forSpeech(text: string): string {
  return RESPELLINGS.reduce((out, [pattern, said]) => out.replace(pattern, (m) => matchCase(m, said)), text);
}

/** "Strata" -> "Strahta", "STRATA" -> "STRAHTA", "strata" -> "strahta". */
function matchCase(original: string, said: string) {
  if (original === original.toUpperCase()) return said.toUpperCase();
  if (original[0] === original[0].toUpperCase()) return said[0].toUpperCase() + said.slice(1);
  return said;
}
