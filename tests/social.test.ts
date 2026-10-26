import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bioLink,
  campaignSlug,
  captionLink,
  normalizeCaptions,
  normalizeHashtag,
  normalizePhoto,
  normalizePostPatch,
  normalizeSlides,
  PLATFORMS,
  PLATFORM_INFO,
  platformTextFile,
  postText,
  readmeFile,
  slideLink,
  slidesFor,
  utmLink,
  wordingProblems,
  xLength,
  type SocialPost,
} from "../lib/social/post.ts";
import { draftRequest, draftSchema } from "../lib/social/draft.ts";

const ID = "11111111-1111-1111-1111-111111111111";
const slide = (n: number, kind = "point") => ({ id: `s${n}`, kind, number: String(n), kicker: "", title: `Slide ${n}`, body: "", photoQuery: "", photo: null });
const post = (over: Partial<SocialPost> = {}): SocialPost => ({
  id: ID,
  title: "First meeting",
  campaign: "first-meeting",
  template: "list",
  theme: "paper",
  destination: "home",
  topic: "x",
  audience: "council",
  slides: normalizeSlides([slide(1, "cover"), slide(2), slide(3), slide(4), slide(5), slide(6, "cta")], ID),
  captions: normalizeCaptions({
    text: { instagram: "Ready for your first meeting?", facebook: "Read this first.", linkedin: "For councils.", tiktok: "First meeting?", x: "Your first council meeting, made easier." },
    hashtags: { instagram: ["#stratasphere", "#bcstrata"], x: ["#stratasphere"] },
  }),
  createdAt: "",
  updatedAt: "",
  ...over,
});

test("handles match the profiles", () => {
  assert.equal(PLATFORM_INFO.instagram.handle, "@stratacouncil.ca");
  assert.equal(PLATFORM_INFO.facebook.handle, "@stratacouncil.ca");
  assert.equal(PLATFORM_INFO.linkedin.handle, "@stratacouncil");
  assert.equal(PLATFORM_INFO.tiktok.handle, "@stratacouncil");
  assert.equal(PLATFORM_INFO.x.handle, "@strata_council");
  assert.equal(PLATFORM_INFO.tiktok.height, 1920);
});

test("every link carries the four campaign tags", () => {
  const u = new URL(slideLink(post(), "linkedin", 2));
  assert.equal(u.searchParams.get("utm_source"), "linkedin");
  assert.equal(u.searchParams.get("utm_medium"), "social");
  assert.equal(u.searchParams.get("utm_campaign"), "first-meeting");
  assert.equal(u.searchParams.get("utm_content"), "slide-3");
  assert.equal(new URL(captionLink(post(), "x")).searchParams.get("utm_content"), "caption");
  assert.equal(new URL(bioLink("instagram")).searchParams.get("utm_campaign"), "bio");
});

test("the demo destination keeps its #demo after the tags", () => {
  const link = utmLink("https://www.stratacouncil.ca/#demo", { platform: "facebook", campaign: "c", content: "caption" });
  assert.match(link, /^https:\/\/www\.stratacouncil\.ca\/\?utm_source=facebook&utm_medium=social&utm_campaign=c&utm_content=caption#demo$/);
});

test("campaign names are tidy slugs", () => {
  assert.equal(campaignSlug("Your First Council Meeting!"), "your-first-council-meeting");
  assert.equal(campaignSlug("  "), "post");
  assert.equal(campaignSlug("Hiver à Montréal"), "hiver-a-montreal");
  assert.ok(campaignSlug("x".repeat(100)).length <= 60);
});

test("X gets 4 slides: the cover, the next two and the call to action", () => {
  const picked = slidesFor("x", post().slides).map((s) => s.index);
  assert.deepEqual(picked, [0, 1, 2, 5]);
  assert.equal(slidesFor("instagram", post().slides).length, 6);
});

test("X's count treats every link as 23 characters", () => {
  assert.equal(xLength("hello"), 5);
  assert.equal(xLength("see https://www.stratacouncil.ca/?utm_source=x&utm_medium=social&utm_campaign=long-campaign-name"), 4 + 23);
  const text = postText(post(), "x");
  assert.ok(xLength(text) <= 280);
});

test("Instagram and TikTok posts point to the bio; others carry the tracked link", () => {
  assert.match(postText(post(), "instagram"), /Link in bio\./);
  assert.doesNotMatch(postText(post(), "instagram"), /utm_/);
  assert.match(postText(post(), "facebook"), /utm_source=facebook/);
  assert.match(postText(post(), "instagram"), /#stratasphere/);
});

test("hashtags are cleaned to one word each", () => {
  assert.equal(normalizeHashtag("Strata Council"), "#StrataCouncil");
  assert.equal(normalizeHashtag("#stratasphere"), "#stratasphere");
  assert.equal(normalizeHashtag("123"), "");
  const c = normalizeCaptions({ hashtags: { instagram: ["#a1", "a1", "", "#b"] } });
  assert.deepEqual(c.hashtags.instagram, ["#a1", "#b"]);
});

test("the wording check catches the house rules", () => {
  assert.deepEqual(wordingProblems(["Run a better meeting."]), []);
  assert.ok(wordingProblems(["Great meeting \u{1F389}"]).some((p) => /emoji/.test(p)));
  assert.ok(wordingProblems(["Covered by PIPEDA"]).some((p) => /PIPA/.test(p)));
  assert.ok(wordingProblems(["We are SOC 2 certified"]).some((p) => /hosting provider/.test(p)));
  assert.ok(wordingProblems(["Learn from the precedent pool"]).some((p) => /precedent/.test(p)));
  assert.deepEqual(wordingProblems(["Our hosting provider is SOC 2 / ISO 27001 compliant."]), []);
});

test("photos: uploads must be in the post's folder; stock photos must be Unsplash with a credit", () => {
  assert.equal(normalizePhoto({ path: `${ID}/a.png`, alt: "x", fit: "cutout" }, ID)?.fit, "cutout");
  assert.equal(normalizePhoto({ path: `${ID}/a.png` }, ID)?.src, "");
  assert.equal(normalizePhoto({ path: "other/a.png" }, ID), null);
  assert.equal(normalizePhoto({ path: `${ID}/../x.png` }, ID), null);
  assert.equal(normalizePhoto({ src: "https://evil.example/x.jpg", credit: null }, ID), null);
  const credit = { source: "unsplash", name: "A", profileUrl: "https://unsplash.com/@a", photoUrl: "https://unsplash.com/photos/x" };
  assert.ok(normalizePhoto({ src: "https://images.unsplash.com/photo-1", credit }, ID));
  assert.equal(normalizePhoto({ src: "https://images.unsplash.com/photo-1", credit: null }, ID), null);
});

test("a save keeps only known fields, trimmed to size", () => {
  const patch = normalizePostPatch({ template: "bogus", theme: "ink", campaign: "Big Launch", slides: [{ kind: "nope", title: "x".repeat(500) }], hack: 1 }, ID);
  assert.equal(patch.template, "list");
  assert.equal(patch.theme, "ink");
  assert.equal(patch.campaign, "big-launch");
  assert.equal(patch.slides?.[0].kind, "point");
  assert.equal(patch.slides?.[0].title.length, 140);
  assert.ok(!("hack" in patch));
  assert.equal(normalizeSlides(Array.from({ length: 30 }, (_, i) => slide(i)), ID).length, 15);
});

test("each platform's text file lists the post, every slide's tracked link, and credits", () => {
  const credit = { source: "unsplash", name: "Jane Doe", profileUrl: "https://unsplash.com/@j", photoUrl: "https://unsplash.com/photos/p" };
  const p = post();
  p.slides[1].photo = { path: null, src: "https://images.unsplash.com/p", alt: "A council meeting", credit: credit as never, fit: "cover" };
  for (const platform of PLATFORMS) {
    const file = platformTextFile(p, platform);
    assert.match(file, new RegExp(`utm_source=${platform}`));
    assert.equal((file.match(/  Link: /g) ?? []).length, slidesFor(platform, p.slides).length, platform);
  }
  assert.match(platformTextFile(p, "linkedin"), /carousel\.pdf/);
  assert.match(platformTextFile(p, "instagram"), /Photo by Jane Doe on Unsplash/);
  assert.match(platformTextFile(p, "instagram"), /Alt text: A council meeting/);
  assert.match(platformTextFile(p, "x"), /Length on X: \d+ of 280/);
  assert.match(readmeFile(p), /Campaign: first-meeting/);
});

test("the draft request asks for the right shape", () => {
  const req = draftRequest({ topic: "First meeting", audience: "council", template: "list", slideCount: 7, destination: "signup" });
  assert.match(req, /exactly 7/);
  assert.match(req, /numbered 1 to 5/);
  assert.match(req, /free training sign-up/);
  assert.deepEqual([...draftSchema.required], ["title", "campaign", "slides", "captions", "hashtags"]);
});
