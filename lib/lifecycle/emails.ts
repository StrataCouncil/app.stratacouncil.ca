/**
 * The sign-up journey's emails (docs/lifecycle-emails.md, journey 0), as
 * reviewed on 2026-11-11. Setup tips: factual, no prices, discounts, or
 * calls to subscribe. Every one carries the company's name and mailing
 * address and a one-click "Stop setup tips" link (CASL). From no-reply;
 * none invites a reply. Pure, so the copy is tested.
 */
import { COMPANY_LEGAL_NAME, COMPANY_MAILING_ADDRESS } from "../company.ts";
import { button, escapeHtml, INK, MUTED, wrap } from "../email/templates.ts";
import type { SignupStep } from "./signup.ts";

export interface SignupEmailParams {
  firstName: string;
  /** Where each link goes, already wrapped for click tracking. */
  links: { training: string; connect: string; module: string | null };
  /** The module to suggest (the one under way, or the first open one). */
  module: { title: string; started: boolean } | null;
  unsubscribeUrl: string;
}

export interface BuiltEmail {
  subject: string;
  preview: string;
  html: string;
  text: string;
}

const P = `margin:0 0 16px;font-size:16px;color:${INK};`;
const LI = `margin:0 0 8px;font-size:16px;color:${INK};`;
const link = (href: string, label: string) => `<a href="${href}" style="color:${INK};font-weight:600;">${label}</a>`;

/** The footer every setup tip carries. */
export function setupFooter(unsubscribeUrl: string) {
  const html = `You&rsquo;re receiving this because you created a StrataCouncil.ca account.<br />
                <a href="${unsubscribeUrl}" style="color:${MUTED};text-decoration:underline;">Stop setup tips</a>`;
  const text = `--\nStrataCouncil.ca is a product of ${COMPANY_LEGAL_NAME}\n${COMPANY_MAILING_ADDRESS}\nstratacouncil.ca\n\nYou're receiving this because you created a StrataCouncil.ca account.\nStop setup tips: ${unsubscribeUrl}`;
  return { html, text };
}

function hi(firstName: string) {
  return firstName.trim() ? `Hi ${firstName.trim()},` : "Hi,";
}

/** A hidden line most mail apps show beside the subject. */
function preheader(text: string) {
  return `<div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(text)}</div>`;
}

function build(subject: string, preview: string, bodyHtml: string, bodyText: string, unsubscribeUrl: string): BuiltEmail {
  const footer = setupFooter(unsubscribeUrl);
  return { subject, preview, html: wrap(preheader(preview) + bodyHtml, footer.html), text: `${bodyText}\n\n${footer.text}` };
}

export function signupEmail(step: SignupStep, p: SignupEmailParams): BuiltEmail | null {
  const name = escapeHtml(hi(p.firstName));
  switch (step) {
    case "welcome":
      return build(
        "Welcome to StrataCouncil.ca",
        "Free council training, and a home for your strata's records.",
        `<p style="${P}">${name}</p>
<p style="${P}">Thanks for joining StrataCouncil.ca. Two free places to start:</p>
<ul style="margin:0 0 8px;padding-left:20px;">
  <li style="${LI}"><strong>Council Training and the Library:</strong> short modules for strata council members at your own pace, and plain-language playbooks, guides, and templates on BC strata law, budgets, bylaws, and more.</li>
  <li style="${LI}"><strong>Your strata:</strong> one place for your council&rsquo;s meetings, documents, minutes, and roster.</li>
</ul>
${button(p.links.training, "Start Council Training")}
<p style="margin:0;font-size:14px;color:${INK};">Or ${link(p.links.connect, "connect your strata")}.</p>`,
        `${hi(p.firstName)}\n\nThanks for joining StrataCouncil.ca. Two free places to start:\n\n- Council Training and the Library: short modules for strata council members at your own pace, and plain-language playbooks, guides, and templates on BC strata law, budgets, bylaws, and more.\n- Your strata: one place for your council's meetings, documents, minutes, and roster.\n\nStart Council Training: ${p.links.training}\n\nOr connect your strata: ${p.links.connect}`,
        p.unsubscribeUrl
      );
    case "training": {
      if (!p.module || !p.links.module) return null;
      const title = escapeHtml(p.module.title);
      if (p.module.started) {
        return build(
          `Pick up where you left off: ${p.module.title}`,
          "Your progress is saved.",
          `<p style="${P}">${name}</p>
<p style="${P}">Your progress in <strong>${title}</strong> is saved, so you can carry on from where you stopped.</p>
${button(p.links.module, "Continue")}`,
          `${hi(p.firstName)}\n\nYour progress in ${p.module.title} is saved, so you can carry on from where you stopped.\n\nContinue: ${p.links.module}`,
          p.unsubscribeUrl
        );
      }
      return build(
        "A good place to start",
        `${p.module.title}, from Council Training.`,
        `<p style="${P}">${name}</p>
<p style="${P}">If you&rsquo;d like to get your bearings, <strong>${title}</strong> is a good place to start. It&rsquo;s short, and your progress saves as you go, so you can stop and pick it up whenever suits you.</p>
${button(p.links.module, "Start the module")}`,
        `${hi(p.firstName)}\n\nIf you'd like to get your bearings, ${p.module.title} is a good place to start. It's short, and your progress saves as you go, so you can stop and pick it up whenever suits you.\n\nStart the module: ${p.links.module}`,
        p.unsubscribeUrl
      );
    }
    case "connect":
      return build(
        "Bring your strata onto StrataCouncil.ca",
        "Join your strata, or add it with its Strata Plan PDF.",
        `<p style="${P}">${name}</p>
<p style="${P}">When you&rsquo;re ready, there are two ways to connect your strata. Start by entering its strata plan number:</p>
<ul style="margin:0 0 16px;padding-left:20px;">
  <li style="${LI}"><strong>If it&rsquo;s already on StrataCouncil.ca,</strong> ask to join. The strata&rsquo;s admin approves your request and sets your role.</li>
  <li style="${LI}"><strong>If it isn&rsquo;t,</strong> you can add it. You&rsquo;ll need the Strata Plan PDF, as filed with the LTSA, and you&rsquo;ll confirm that you&rsquo;re an owner, council member, or authorized agent of the strata. Our team checks the request against the plan before it&rsquo;s set up.</li>
</ul>
<p style="${P}">If someone else on your council would rather set it up, they can invite you once it&rsquo;s there.</p>
<p style="${P}">Once it&rsquo;s connected, your council keeps its documents, minutes, decisions, and roster in one place, and their contents are easier to find, including scans of typed or printed pages.</p>
${button(p.links.connect, "Connect your strata")}`,
        `${hi(p.firstName)}\n\nWhen you're ready, there are two ways to connect your strata. Start by entering its strata plan number:\n\n- If it's already on StrataCouncil.ca, ask to join. The strata's admin approves your request and sets your role.\n- If it isn't, you can add it. You'll need the Strata Plan PDF, as filed with the LTSA, and you'll confirm that you're an owner, council member, or authorized agent of the strata. Our team checks the request against the plan before it's set up.\n\nIf someone else on your council would rather set it up, they can invite you once it's there.\n\nOnce it's connected, your council keeps its documents, minutes, decisions, and roster in one place, and their contents are easier to find, including scans of typed or printed pages.\n\nConnect your strata: ${p.links.connect}`,
        p.unsubscribeUrl
      );
    case "last":
      return build(
        "Anything we can help with?",
        "Two easy places to start.",
        `<p style="${P}">${name}</p>
<p style="${P}">If you haven&rsquo;t had a chance to look around yet, these are the two easiest places to start:</p>
<ul style="margin:0 0 16px;padding-left:20px;">
  <li style="${LI}">${link(p.links.training, "Council Training")}: a short first module, at your own pace.</li>
  <li style="${LI}">${link(p.links.connect, "Connect your strata")}: join your strata, or add it with its Strata Plan PDF.</li>
</ul>
<p style="margin:0;font-size:16px;color:${INK};">This is the last of our setup emails. Your account stays open whenever you&rsquo;re ready.</p>`,
        `${hi(p.firstName)}\n\nIf you haven't had a chance to look around yet, these are the two easiest places to start:\n\n- Council Training: a short first module, at your own pace. ${p.links.training}\n- Connect your strata: join your strata, or add it with its Strata Plan PDF. ${p.links.connect}\n\nThis is the last of our setup emails. Your account stays open whenever you're ready.`,
        p.unsubscribeUrl
      );
  }
}
