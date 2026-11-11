# Marketing tab (design)

Status: the tab is built (2026-11-11), with Socials and Emails under it.
The Socials editor and the Newsletter are designed below (2026-11-11);
Interactives still needs its own design. Each is built after the owner's
Go.

## The Marketing tab

One Super Admin tab, **Marketing** (`/admin/marketing`), with sub-tabs:

- **Socials** (the old Social tab, moved). To
  become a basic Canva: see "Socials editor" below.
- **Emails** (lifecycle emails, moved).
- **Newsletter** (to build; decided below).
- **Interactives** (to build; the Supademo replacement, below).
- Later: **Presentations**, the real decks (investor deck, council
  briefing, IRAP overview), stored and run from here. That's why the
  product walkthroughs are called Interactives, not Presentations.

Sub-tabs appear only once built; no empty "coming soon" screens. Demo links
and Investors stay where they are for now.

## Decisions, 2026-11-11

- **Interactives:** not a copy of the current Supademo walkthrough ("just
  okay"): something much better. The notes below are a starting point, to
  be redesigned before building.
- **Marketing site, meanwhile:** the Supademo embed is replaced by a still
  of Meeting Mode, and Supademo comes off the privacy policy.
- **Newsletter:** one mailing list, joined from a sign-up form on
  stratacouncil.ca or the opt-in on the app's sign-up page (and the
  Account page's Product news switch). Anyone can unsubscribe at any time
  from any issue. Sent through a completely separate channel from the
  app's sign-in, meeting, and setup emails (Mailtrap's bulk stream, its
  own sending address), so newsletter complaints can't affect them.
- **Socials:** the editor is too limited; it needs a basic version of
  Canva, with video. Designed below, from a clickable mockup the owner
  approved.

## Socials editor (design, 2026-11-11)

A basic Canva for carousel posts, from the clickable mockup the owner
approved ("looks awesome"; small things to find in production). Mockup:
https://claude.ai/artifact/DiGsw4eCkLjpscNc1Qe5AT (its logo is a drawn
stand-in; the editor uses the real logo files).

### Decided

- **Video:** both clips with text over them and slides whose layers
  animate in.
- **Brand kit only:** Fraunces and Work Sans, the six brand colours (ink,
  cream, paper, accent, accent light, white), and the StrataCouncil.ca
  logo. No other fonts or colours.
- **Platforms:** Instagram, Facebook, LinkedIn, and X at 4:5 (1080 by
  1350), TikTok at 9:16 (1080 by 1920).

### The editor

- **Three panes:** slides and layers on the left, the canvas in the
  middle, settings for the selected layer and the brand kit on the right;
  a timeline under the canvas.
- **Layers:** text, photo, video, shape, logo. Drag to move, a corner
  handle to resize, arrow keys to nudge (Shift for more). Snap to the
  centre with a guide. Reorder, hide, lock, delete. Undo and redo, and
  autosave as today.
- **Text:** font (the two brand fonts), weight, size, alignment, colour
  (brand swatches), and "Rewrite with AI".
- **Photos:** Unsplash or uploads, as now; fill, fit, or crop; rounded
  corners; brightness.
- **Video:** uploads (MP4 or MOV) or free stock clips from Pixabay; trim,
  and text layers over the clip. Exported without sound in the first
  version (most people watch muted); keeping the clip's sound comes
  later.
- **Animation:** each layer's entrance (none, fade, rise, pop, wipe), with
  a start time and length, on the timeline; Play previews the slide.
- **Safe areas:** per platform, shaded where the app covers the slide
  (TikTok's buttons, caption, and top bar; the strip X crops in the
  timeline).
- **Layouts:** today's three looks (List, Story, Editorial) become
  starting layouts, and any slide can be saved as a layout of your own.
- **Draft with AI:** as today, but it fills layers, in the brand kit.
- **Export:** one ZIP, a folder per platform, as today: PNG for still
  slides, MP4 for slides with video or animation, plus the caption file.
  Made in the browser, so no server cost.

### How it's built

- **The slide format:** a slide becomes a background and a list of
  layers (position and size in percent of the slide, so one design fits
  every platform; per-platform nudges are stored as overrides). Stored in
  the existing `social_posts.slides` column. Today's slides are converted
  to layers the first time they're opened, so nothing is lost.
- **One renderer:** the editor and the export draw the same layer list.
  Still slides export as PNG through the same path as today
  (html-to-image).
- **Video and animation export:** each frame is drawn to a canvas (the
  video's current frame, then the layers at that moment), encoded in the
  browser with WebCodecs, and packed into an MP4. 30 frames a second, up
  to 60 seconds a slide. Works in current Chrome, Edge, Safari, and
  Firefox; an older browser is told to update.
- **Uploads:** videos go to the existing private `social-media` bucket,
  with its size limit raised for video (to about 200 MB) and video types
  allowed (a small migration, with grants unchanged).
- **Stock video:** Pixabay's free API (Pexels paused new API keys,
  2026-11-11). Needs a `PIXABAY_API_KEY` in Vercel (free account). No
  credit line is required; the editor shows the source anyway.
- **Saved layouts:** a server-only table of named layouts (a slide's
  layers), Super Admins only, in the same migration.
- **Not in the first version:** keyframe animation beyond entrances,
  background removal, real-time co-editing, and other fonts or colours.

### Build

1. Built 2026-11-11 (0087): the layer model, conversion of existing
   slides, and the new editor (canvas, layers, text, photos, shapes, logo,
   brand kit, safe areas, undo, saved layouts), with PNG export.
2. Built 2026-11-11 (0088), parts 2 and 3 together, plus the template
   library and six more layouts:
   - **Layouts:** Giant stat, Pull quote, Full-bleed photo, Checklist,
     Side by side, and Big call to action, beside the five starting
     layouts in the Layouts dialog (`layoutDesign` in
     `lib/social/design.ts`).
   - **Template library:** New post opens on "Start from a template":
     four built-in posts (Tips carousel, Myth vs fact, Single stat,
     Announcement; `lib/social/templates.ts`) and any post saved with
     **Save as template** (`social_templates`, server-only). Starting
     from one copies it with fresh ids; the template never changes.
     Uploaded photos and clips aren't kept in a template.
   - **Animation:** each layer's entrance (fade in, grow, or slide in
     right, left, up, or down) and exit (fade out, shrink, or slide out
     right, left, up, or down), each with a start and length; a slide
     length (5 s by default, up to 60); a timeline under the canvas (with
     a layer selected, that layer's entrance and exit; with none, every
     layer that moves; drag a bar to move it, its end to lengthen it, the
     ruler to see a moment) and Play. Revised 2026-11-11 (part 3); part
     2's rise, pop, and wipe read as slide in up, grow, and slide in right.
   - **Video layers:** upload an MP4 or MOV (up to 200 MB), or a free
     Pixabay clip; trim, fill or fit, corners, brightness; it loops if
     the slide is longer. No sound in this version.
   - **Export:** a slide with an entrance or a clip exports as
     `slide-NN.mp4` plus a still `slide-NN.png` (the last frame), made in
     the browser (`lib/social/video-export.ts`): still layers are drawn
     once, moving layers and clips each frame, encoded with WebCodecs
     (H.264, VP9 only where H.264 isn't available) at 30 frames a second.
     LinkedIn's PDF uses the stills. X and TikTok can't mix pictures and
     video in one post; their text file says so.

3. Built 2026-11-11 (no migration): choosing a photo or clip for a new
   frame now lands (the pick was applied to the slide as it was before
   the frame was added, which removed the frame); exits; and the editor
   on one grid: a top bar (title, Saved, Post settings, Save as template,
   Export), post settings folded away, then slides | add and layers |
   canvas | settings, with the timeline under the canvas.

### Pixabay (stock video)

- `PIXABAY_API_KEY` in Vercel (free account; no "full API access"
  needed: that's only for high-resolution images).
- Searched from the server, so the key never reaches the browser;
  results cached 24 hours, as Pixabay asks; well under 100 requests a
  minute.
- Choosing a clip asks Pixabay for it again by its id (the browser only
  says which one), downloads the sharpest file under 120 MB, and copies
  it into the post's folder of the social-media bucket. Pixabay doesn't
  allow permanent hotlinking.
- The picker says "Videos from Pixabay". No credit is required, but the
  editor shows "Video by <name> on Pixabay" and the export's credits list
  it.

## Newsletter (design, 2026-11-11)

Status: on hold (2026-11-11). Mailtrap's free plan has no room for
another sending domain; the owner will subscribe once there's a paying
customer, then this gets built. Nothing is built yet.

### The list

- **One list.** People join from:
  - a sign-up form on stratacouncil.ca;
  - the opt-in on the app's sign-up page (today's `marketing_opt_in`);
  - the Product news switch on the Account page.
- **Consent:** express, with the date and where it came from kept as
  proof (CASL). The website form uses a confirmation email (double
  opt-in), so nobody can sign someone else up; app sign-ups are already
  confirmed by their sign-in link.
- **Unsubscribe any time:** one click from any issue (with the
  `List-Unsubscribe` headers), or the Account page switch. Unsubscribing
  from the newsletter never stops account, meeting, or setup emails.
- **Data:** a server-only `newsletter_subscribers` table (email, name if
  given, source, consented at, confirmed at, unsubscribed at, a token for
  links). An account's Product news switch and its subscriber row stay in
  step. Names and emails are personal information under PIPA: used only
  to send the newsletter, never given to the AI, and deleted on request.

### The separate channel

- **Mailtrap's bulk stream,** not the transactional one that sends
  sign-in links and meeting emails.
- **Its own sending address on its own subdomain:**
  `newsletter@news.stratacouncil.ca`, with its own SPF, DKIM, and DMARC
  records, so newsletter complaints can never hurt delivery of sign-in
  and meeting emails.

**Setting up the channel (when Mailtrap is on a paid plan):**

1. Mailtrap, Sending Domains, Add Domain: `news.stratacouncil.ca`.
   Mailtrap lists about five records (domain verification, two DKIM
   keys, a return-path record for SPF, and DMARC).
2. Cloudflare (stratacouncil.ca, DNS): add each record exactly as
   Mailtrap shows it, copied, not retyped. Every CNAME **DNS only**
   (grey cloud): proxied CNAMEs break verification. Names like
   `rwmt1._domainkey.news` are entered as shown; Cloudflare adds
   `.stratacouncil.ca`. DMARC starts at `p=none`, tightened once sending
   is clean.
3. Mailtrap: Verify (minutes, up to an hour).
4. Mailtrap: an API token for that domain's Bulk stream, saved in Vercel
   as `MAILTRAP_BULK_API_TOKEN` (never anywhere else).
- **No-reply,** like every other email (decided 2026-11-11).

### The format

From the owner's research on SaaS newsletters (Stripe, Mailchimp, Ahrefs,
Linear): respect the reader's time, no marketing fluff, every update tied
to something practical.

- **Text first.** No hero banner: a short opening note.
- **Three or four short sections,** each tied to what it does for
  council:
  - What's new: a feature in one line, why it matters, a link.
  - One useful guide from the Library.
  - Legislation and CRT updates in plain English.
  - Now and then, a tip from a real meeting.
- **Interactives:** email can't run them, so an issue can carry an
  animated preview (a short GIF) that opens the Interactive.
- **The footer:** company name, mailing address, why they're receiving
  it, and one-click unsubscribe.

### In the console (Marketing, Newsletter)

- **Subscribers:** the list, with source and dates, a count, search,
  remove, and export.
- **Issues:** write an issue in sections (the blocks above), preview it,
  send a test to yourself, then send now or schedule it.
- **Sending:** in batches through Inngest, at a pace Mailtrap's bulk
  stream allows; each send logged.
- **Results:** delivered, clicks per link, and unsubscribes per issue.
  Opens aren't counted (mail apps preload images).

### On the marketing site

- A short sign-up form (email, optional name, one line on what they'll
  get), on the home page and in the footer. It posts to the app, which
  sends the confirmation email.
- The privacy policy adds the newsletter: what's collected, why, and how
  to unsubscribe.

### Build, in two PRs

1. The list, consent and confirmation, unsubscribe, the marketing-site
   form, and the Subscribers screen.
2. Issues: the editor, test sends, sending through the bulk stream,
   scheduling, and results.


## Interactives (first notes, from 2026-11-05)

A presentation is a guided walk through the product: steps, each showing a
real app screen with one spot highlighted, a short caption and a voiceover.
Sent to a prospect as a personal link; we see what they watched. (Written as
"Presentations" on 2026-11-05; renamed Interactives.)

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
5. Marketing site: swap the Meeting Mode still for the interactive.

### Before the Supademo trial ends

Export the Meeting Mode walkthrough's 17 step images and texts from
Supademo (it lists them in its export). They're a reference for rebuilding
the walkthrough as a presentation; the captured HTML replaces the images.
