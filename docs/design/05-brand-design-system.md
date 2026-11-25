# StrataCouncil.ca: Brand and design system

**Status:** current as of 2026-11-21. Rewritten from the October draft to describe what is built.
**Applies to:** the app (`app.stratacouncil.ca`, this repo), the demo site (`demo.stratacouncil.ca`, the same code), emails, social posts made in the Super Admin console, and the marketing site (a separate repo that copies these tokens).

## 1. Design intent

A serious governance tool that a strata council trusts with legal and financial decisions. Not a consumer app, not generic SaaS. The choices below serve that:

- A serif display face with a plain sans body face, which reads as institutional rather than start-up.
- A restrained, warm palette: ivory ground, navy ink, one clay accent. No gradients, no glassmorphism, no left-border cards.
- No emoji anywhere: interface, emails, AI answers, marketing.
- Real, accessible markup: `<button>` and `<a href>`, `aria-label` on icon-only buttons, `role="switch"` and `aria-checked` on toggles.

## 2. Colour tokens

Defined once on `:root` in `app/globals.css`. Every screen uses these, never a near-variant.

| Token | Value | Use |
|---|---|---|
| `--ink` | `#1B2A41` | Text, the wordmark, dark chrome |
| `--paper` | `#F8F6F1` | Page background (warm ivory) |
| `--surface` | `#FFFFFF` | Cards and panels |
| `--line` | `#E3DFD5` | Borders and dividers |
| `--accent` | `#B4602F` | Clay: the primary action and active states, nothing else |
| `--accent-dark` | `#8F4B24` | Accent hover and pressed |
| `--muted` | `#6B7280` | Secondary text, labels, metadata |
| `--free` | `#2F7355` | Success, carried motions, "For" votes |
| `--free-bg` | `#E6F0EA` | Success tint |
| `--locked` | `#9CA3AF` | Disabled and locked states |
| `--locked-bg` | `#F1F0EC` | Locked tint |
| `--danger` | `#A6342A` | Anything needing attention or that can't be undone: warnings, overdue items, denials, destructive confirmations |
| `--danger-bg` | `#F5E1DE` | Danger tint |

Radius tokens: `--radius-sm` (6px) for buttons, inputs and pills; `--radius-lg` (12px) for cards and panels. Never 0, and never fully round except status pills.

There is one attention colour (`--danger`), not a separate amber tier.

## 3. Typography

- **Fraunces** (variable serif): headings and the "StrataCouncil" wordmark, weight 600 to 700. Never body copy or UI labels.
- **Work Sans** (variable sans): everything else.
- Both are served from the site itself (`app/fonts`, loaded with `next/font/local`), not fetched from Google at build time. Licences are in `app/fonts/*-OFL.txt`.
- Two typefaces only. No monospace: a strata plan number uses Work Sans with letter-spacing.
- The app is dense: 13 to 17px body and labels, about 26px for page headings. The marketing site uses the same faces at a larger, airier scale.

## 4. Logo

- `components/Logo.tsx` renders the mark inline with `fill="currentColor"`, so it takes its colour from CSS (`--ink` on light backgrounds, white or `--paper` on dark). The viewBox is cropped to the mark.
- Lockup beside the wordmark: the mark is 1.51em tall with a 0.33em gap (the wordmark's capitals are 47% of the mark's height).
- Used in the app header, on sign-in, sign-up, two-step, unsubscribe and investor pages, and on the demo's "Setting up your demo" page.
- Static exports exist only where `currentColor` can't reach: `app/icon.svg` (favicon), `app/apple-icon.png`, and the email header.
- The site footer reads "Powered by" with the Trickfilm logo (`components/TrickfilmLogo.tsx`).
- **App header on a phone** (720px and narrower): the mark alone on the left, the account menu on the right, and the sections (Resources, Your Strata, Stratasphere, and Super Admin for staff) centred on one row below them. On the narrowest phones (400px and under) Super Admin reads "Admin" so the row doesn't wrap.

## 5. Visual language

- Flat surfaces, hairline borders. Shadow only as a 1 to 2px cue on floating elements (the Stratasphere window, toggles, menus).
- Icons are inline stroke SVGs (2px stroke, round caps and joins), never an icon font or emoji.
- Status is a small pill (small caps, letter-spaced, tinted background): role badges, item types ("For decision", "For information"), "Sound not on", and similar. One pill style only.
- One clay button per moment. It marks the next step, and it moves: while an agenda has unsaved changes, Save is clay and Launch is secondary and disabled; once saved, they swap.
- Locked features are greyed (`--locked`, `--locked-bg`) with a stroke padlock. Admins are offered a subscription; everyone else is told to ask an admin.
- Floating windows (the Stratasphere assistant) drag by the title bar, resize from the corner, remember where they were left, and fill the screen on phones. The Ask Stratasphere button sits bottom right in the same place on every page except the Stratasphere page itself.

### Motion

Quick and quiet: movement confirms what just happened and never decorates. Tokens in `app/globals.css` (`--ease-spring`, `--ease-roll`, `--ease-out`, `--dur-press`, `--dur-spring`, `--dur-open`); everything below is switched off for anyone whose device asks for reduced motion.

- **Sink, then spring:** every `.button`, icon button, and the members' For/Against/Abstain buttons press in to 95% and spring back.
- **Roll, don't jump** (`components/motion/RollingNumber.tsx`): numbers that change while you watch roll digit by digit, ones digit first, 100 ms apart. Used for the live vote counts the person running the meeting sees. The plain number stays in the page for screen readers. Numbers that don't change on screen (billing prices, closed Discussion results) don't roll.
- **Draw the win** (`components/motion/SuccessTick.tsx`): a green circle draws, then the tick (about half a second). Only for real successes: your vote recorded (in a meeting or from a Discussion email), a motion carried, minutes just finalized, a training module complete. Completed training steps use the filled version (the circle draws, fills green, and a white tick draws), staggered down the list: modules on a track's path, finished topics in a module's menu, and finished tracks under Your progress.
- **Cards** that open something (Library and Forms & Templates items, training tracks, document folders, flip cards) lift 2px with a soft shadow on hover and press in to 98%, springing back like buttons.
- **Text menus** (the top menu, the section tabs, the account menu): colour eases on hover, a tab's underline grows from the centre, a press sinks slightly, and the account menu opens with a short ease-out.
- **Fast, then slow:** things that open (training accordions and flip cards, the People tab sections, Directives, the Stratasphere window) arrive with one 350 ms ease-out.
- Not used: pull-to-refresh, and drag-to-reorder (no drag reordering exists yet). The animations are the same on every plan.

## 6. Writing style

Part of the brand as much as the colours:

- Canadian spelling and the Oxford comma throughout (swept across the app in PR 194).
- Plain words, short sentences, no emoji. Times shown in Pacific Time with "PT".
- Stratasphere's answers are plain text in spaced paragraphs, with no markup symbols.
- Copy never dwells on the product having few customers.

## 7. Other surfaces

- **Emails** (`lib/email`): the logo header, the same colours and fonts with web-safe fallbacks, and a centred footer with the company name and mailing address. Sent only from no-reply addresses.
- **Social posts** (Super Admin console, Marketing > Socials): a brand kit of these colours, Fraunces headlines and Work Sans text, with saved layouts and an MP4 export.
- **Marketing site:** a separate repo. It copies the tokens in §2 and the fonts in §3; this document is the source both have to match. A shared token package can come later if the two drift.

## 8. Open questions

None outstanding. A three-level severity system (info, warning, critical) would be a future addition only if `--danger` proves too blunt.
