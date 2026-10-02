/** A conversation's title from its first question: one line, cut at a word, at most 60 characters. */
export function titleFromQuestion(question: string): string {
  const line = question.replace(/\s+/g, " ").trim();
  if (!line) return "New conversation";
  if (line.length <= 60) return line;
  const cut = line.slice(0, 60);
  const atWord = cut.lastIndexOf(" ");
  return `${(atWord > 30 ? cut.slice(0, atWord) : cut).replace(/[\s,.;:–-]+$/, "")}…`;
}
