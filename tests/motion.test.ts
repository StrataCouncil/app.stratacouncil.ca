import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Motion (05-brand-design-system.md): every animation is switched off for
// people who ask for reduced motion, and the rolling number keeps the plain
// value readable for screen readers and tests.
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const motion = css.slice(css.indexOf("Motion (05-brand-design-system.md, Motion)\n   Sink"));
const reduced = motion.slice(motion.indexOf("@media (prefers-reduced-motion: reduce)"));
// Cards, menus, and the account panel have their own reduced-motion block just before.

test("the motion section exists with its tokens", () => {
  assert.ok(motion.length > 0);
  for (const token of ["--ease-spring", "--ease-out", "--dur-open"]) assert.match(css, new RegExp(`${token}:`));
});

test("every animated class is switched off under reduced motion", () => {
  for (const sel of [".button", ".icon-button", ".live-vote__button", ".roll__digit::before", ".success-tick__circle", ".success-tick__tick", ".lesson-accordion__body", ".lesson-card__face", ".directive-card__body", ".float-win:not([hidden])"]) {
    assert.ok(reduced.includes(sel), `${sel} is not covered by reduced motion`);
  }
});

test("cards and text menus move, and stop under reduced motion", () => {
  for (const sel of ["a.kb-card", "a.track-card", "a.folder-card", ".lesson-card", ".app-nav a", ".substrata-nav a", ".substrata-nav__locked", ".account-menu__item", ".substrata-nav a::after", ".account-menu__panel"]) {
    assert.ok(reduced.includes(sel), `${sel} is not covered by reduced motion`);
  }
});

test("completed training steps use the drawn tick", () => {
  for (const f of ["../components/training/TrackPath.tsx", "../components/training/ModulePlayer.tsx", "../components/training/TrainingOverview.tsx"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.match(src, /<SuccessTick/, `${f} does not use SuccessTick`);
  }
});

test("RollingNumber keeps the plain number and hides the drawn digits", () => {
  const src = readFileSync(new URL("../components/motion/RollingNumber.tsx", import.meta.url), "utf8");
  assert.match(src, /className="visually-hidden">\{n\}/);
  assert.match(src, /aria-hidden="true"/);
});

test("SuccessTick is decorative", () => {
  const src = readFileSync(new URL("../components/motion/SuccessTick.tsx", import.meta.url), "utf8");
  assert.match(src, /aria-hidden="true"/);
});
