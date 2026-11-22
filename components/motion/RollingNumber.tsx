/**
 * A whole number whose digits roll to a new value instead of jumping
 * ("Roll, don't jump"). Each digit is a column of 0 to 9 moved into place,
 * the ones digit first and each digit to its left 100 ms later. Nothing
 * moves on first render, and nothing moves for people who ask for reduced
 * motion. The value itself is in a visually hidden span, so screen
 * readers, copy and paste, and tests see the plain number; the columns
 * are drawn with CSS and hidden from assistive technology.
 */
export function RollingNumber({ value, className }: { value: number; className?: string }) {
  const n = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  const digits = String(n).split("");
  return (
    <span className={className ? `roll ${className}` : "roll"}>
      <span className="visually-hidden">{n}</span>
      {digits.map((d, i) => {
        // Keyed from the right, so the ones digit stays the same element when the number grows.
        const fromRight = digits.length - 1 - i;
        return (
          <span
            key={`p${fromRight}`}
            className="roll__digit"
            aria-hidden="true"
            style={{ "--d": Number(d), transitionDelay: `${fromRight * 100}ms` } as React.CSSProperties}
          />
        );
      })}
    </span>
  );
}
