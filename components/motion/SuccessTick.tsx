/**
 * "Draw the win": a circle draws itself, then the tick. Used only for real
 * successes (a vote recorded, a motion carried, minutes finalized, a
 * training module finished), so it keeps its meaning. Decorative: the
 * words beside it say what happened. Remount it (change its key) to play
 * it again. Shown complete, with no drawing, under reduced motion.
 */
export function SuccessTick({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={className ? `success-tick ${className}` : "success-tick"}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle className="success-tick__circle" cx="12" cy="12" r="10" pathLength={1} />
      <path className="success-tick__tick" d="M7.5 12.4l3 3 6-6.4" pathLength={1} />
    </svg>
  );
}
