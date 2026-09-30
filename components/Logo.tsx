/**
 * StrataCouncil.ca / StrataSphere mark.
 *
 * Rendered inline (not via <img src>) specifically so it can take its color
 * from CSS `color` on this element or an ancestor — the same mechanism the
 * rest of the design system uses for every other color (see the Neurata
 * project doc `05-brand-design-system.md` §6a). An <img>-referenced SVG
 * can't inherit `currentColor` from the page, which is why this is a
 * component rather than a static file reference.
 *
 * Usage: <Logo /> inherits color from its parent. Set `color` in CSS on
 * that parent (or pass a className) to switch it between --ink on light
 * backgrounds and white on dark ones.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 192.7 188.28"
      fill="currentColor"
      role="img"
      aria-label="StrataCouncil"
    >
      <path d="M46.12,144.38h42.28s-21.8,21.8-21.8,21.8H24.32v-42.28s21.8-21.8,21.8-21.8v42.28ZM104.59,59.82v33.7s42.28,42.28,42.28,42.28v8.58h-42.28s21.8,21.8,21.8,21.8h42.28s0-42.27,0-42.27h0S104.59,59.82,104.59,59.82ZM146.88,85.91l21.8-21.8V21.82s-42.28,0-42.28,0l-21.8,21.8h42.28v42.28ZM88.41,128.18v-33.7s-42.28-42.28-42.28-42.28v-8.58h42.28s-21.8-21.8-21.8-21.8H24.32s0,42.27,0,42.27h0s64.09,64.09,64.09,64.09Z" />
    </svg>
  );
}
