/**
 * "Draw the win": a circle draws itself, then the tick. Used only for real
 * successes (a vote recorded, a motion carried, minutes finalized, a
 * training module finished), so it keeps its meaning. Decorative: the
 * words beside it say what happened. Remount it (change its key) to play
 * it again. Shown complete, with no drawing, under reduced motion.
 *
 * `filled`: the circle fills in green once drawn and the tick is drawn in
 * white, for a completed step's marker (training path, progress list).
 * `delay` (ms) staggers a list of them.
 */
export function SuccessTick({ size = 20, className, filled, delay }: { size?: number; className?: string; filled?: boolean; delay?: number }) {
  const classes = ["success-tick", filled ? "success-tick--filled" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <svg
      className={classes}
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
      style={delay ? ({ "--tick-delay": `${delay}ms` } as React.CSSProperties) : undefined}
    >
      <circle className="success-tick__circle" cx="12" cy="12" r={filled ? 11 : 10} pathLength={1} />
      <path className="success-tick__tick" d="M7.5 12.4l3 3 6-6.4" pathLength={1} />
    </svg>
  );
}
