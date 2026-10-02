"use client";

import { useEffect, useState } from "react";
import { isInteractive, type Lesson } from "@/lib/training/content";
import { BlockView } from "@/components/training/BlockView";

/**
 * A lesson's blocks, top to bottom. Reports whether every knowledge check
 * and scenario has been answered, which is what the learner's Continue
 * waits on. Remount it (key) to reset answers between lessons.
 */
export function LessonView({ lesson, onReadyChange }: { lesson: Lesson; onReadyChange?: (ready: boolean) => void }) {
  const required = lesson.blocks.filter(isInteractive).map((b) => b.id);
  const [answered, setAnswered] = useState<Set<string>>(new Set());
  const ready = required.every((id) => answered.has(id));

  useEffect(() => {
    onReadyChange?.(ready);
  }, [ready, onReadyChange]);

  return (
    <article className="lesson">
      <h2 className="lesson__title">{lesson.title}</h2>
      {lesson.blocks.length === 0 && <p className="lesson-missing">This lesson has no content yet.</p>}
      {lesson.blocks.map((b) => (
        <div key={b.id} className="lesson__block" data-type={b.type}>
          <BlockView block={b} onAnswered={() => setAnswered((s) => new Set(s).add(b.id))} />
        </div>
      ))}
    </article>
  );
}
