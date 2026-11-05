# Marketing tab and Presentations (design)

Status: designed 2026-11-05, not built. Replaces Supademo (trial ends
2026-11-18; about $350 to $450 a month after). Build after the owner's Go.

## The Marketing tab

One Super Admin tab, **Marketing**, with sub-tabs:

- **Presentations** (new, below).
- **Social** (today's Social tab, moved).
- **Newsletter** (new; doesn't exist yet. To design separately: who's on
  the list, consent, unsubscribe, sending through Mailtrap).

Demo links and Investors stay where they are for now; Demo could move under
Marketing later, since a presentation and a demo link do similar jobs.

## Presentations

A presentation is a guided walk through the product: steps, each showing a
real app screen with one spot highlighted, a short caption and a voiceover.
Sent to a prospect as a personal link; we see what they watched.

### Steps are captured HTML, not screenshots

Each step is a snapshot of a real app page, kept as HTML and CSS:

- Taken from a **Super Admin sandbox on the demo site**, so only the
  fictional demo strata (Larchwood Commons and its people) can appear.
- A **Capture this screen** button, shown only to a Super Admin in a
  sandbox, saves the page as it looks: the DOM with styles inlined, scripts,
  forms, event handlers and links stripped, images and fonts kept.
- Played back in a **sandboxed frame with no scripts**: sharp at any size,
  text crisp on any screen, and nothing on it can run or submit.
- The **hotspot is pinned to an element** (picked by clicking it in the
  editor, stored as a selector), not to x/y, so it stays on the right button
  whatever the window size. A box or arrow, plus the caption.
- Optional per step: zoom towards the hotspot; hide or blur a region.
- A step can also be a plain card (title, text, buttons): the intro, the
  close, "Start free training".
- Re-capturing a step after the app's look changes keeps its caption,
  script and hotspot (the selector is checked and flagged if it no longer
  matches).

### Voiceover and captions

- Each step has a narration script; **ElevenLabs** makes the audio, in the
  presentation's chosen voice (the same code and voices as Council Training).
- Captions on by default: the script shown as text, so it works muted.
- Play: narration, then the next step. Back, Next, a progress bar, and
  keyboard control. Works on phones.

### Sharing and analytics

- **Public link** (for the website embed): plays for anyone, counts only
  totals (plays, completions, how far people get).
- **Personal link** per recipient (name, email, optional note), made in the
  Presentations tab, like demo links: we see when they opened it, which
  steps they viewed and for how long, whether they finished, and which
  buttons they clicked. Each visit is listed on the recipient's row.
- No cookies, no third-party trackers. The presentation's first screen
  says, in one line, that StrataCouncil.ca sees which parts are viewed
  (personal links only). A link can be switched off.
- Recipients' names and emails are personal information (PIPA): kept only
  for the follow-up, deletable from the tab, and never sent to the AI.

### Pieces

1. Migration: presentations, steps (captured HTML, hotspot selector,
   caption, script, audio), recipients (personal links), view events.
   Super Admins edit; the player reads a published presentation through
   one function, by its public slug or a recipient's token. Storage bucket
   for captures and audio (public read for published ones). Safe to re-run,
   grants stated.
2. Capture button in the app (Super Admin, demo site sandboxes only), and
   the sanitiser (server side: strip scripts, handlers, forms, external
   requests other than our own images and fonts).
3. Marketing tab: Presentations list, step editor (hotspot picker, caption,
   script, voice, generate narration, reorder, preview, publish),
   recipients and their activity.
4. Player page on the app (`/p/<slug>` and `/p/<token>`), embeddable from
   stratacouncil.ca only (a frame-ancestors exception for that domain).
5. Marketing site: swap the Supademo embed for ours, remove Supademo and
   its privacy-policy line.

### Before the Supademo trial ends

Export the Meeting Mode walkthrough's 17 step images and texts from
Supademo (it lists them in its export). They're a reference for rebuilding
the walkthrough as a presentation; the captured HTML replaces the images.
