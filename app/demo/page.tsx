import { notFound } from "next/navigation";
import { Logo } from "@/components/Logo";
import { IS_DEMO } from "@/lib/demo";

/**
 * The demo site's front door (lib/demo.ts): the demo opens only from a
 * personal link, so anyone without one, or whose link has ended, lands
 * here. Not part of the live site.
 */
const MESSAGES: Record<string, { title: string; body: string }> = {
  expired: {
    title: "Your demo has ended",
    body:
      "Demo links work until midnight (Pacific time) on the day they're sent, and everything made in the demo is cleared overnight. Thanks for trying StrataCouncil.ca! To look again, ask us for a new link.",
  },
  unknown: {
    title: "This link doesn't work",
    body: "Check that you opened the whole link from your email. If it still doesn't work, ask us for a new one.",
  },
  busy: {
    title: "We couldn't open your demo",
    body: "Something went wrong while setting it up. Try your link again in a minute. If it keeps happening, let us know.",
  },
};

const WELCOME = {
  title: "The StrataCouncil.ca demo",
  body:
    "The demo opens from a personal link we email you. You'll have your own fictional strata to try everything in, as its admin, until midnight. To get a link, ask us.",
};

export default async function DemoPage({ searchParams }: { searchParams: Promise<{ link?: string }> }) {
  if (!IS_DEMO) notFound();
  const { link } = await searchParams;
  const message = (link && MESSAGES[link]) || WELCOME;
  return (
    <div className="auth-shell">
      <div className="auth-card" data-testid="demo-front-door">
        <a href="https://stratacouncil.ca" className="auth-card__brand">
          <Logo className="auth-card__mark" />
          <span className="auth-card__wordmark">StrataCouncil.ca</span>
        </a>
        <h1>{message.title}</h1>
        <p>{message.body}</p>
        <p>
          <a href="mailto:support@stratacouncil.ca?subject=StrataCouncil.ca%20demo" className="button button-primary">
            Email support@stratacouncil.ca
          </a>
        </p>
      </div>
    </div>
  );
}

export const metadata = { title: "Demo", robots: { index: false, follow: false } };
