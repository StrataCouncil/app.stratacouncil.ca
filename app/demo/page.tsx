import { notFound } from "next/navigation";
import { Logo } from "@/components/Logo";
import { IS_DEMO, SIGNUP_URL } from "@/lib/demo";

/**
 * The demo site's front door (lib/demo.ts): the demo opens only from a
 * personal link, so anyone without one, or whose link has ended, lands
 * here. Everything points to making a real account. Not part of the live
 * site.
 */
const MESSAGES: Record<string, { title: string; body: string }> = {
  expired: {
    title: "Your demo has ended",
    body:
      "Demo links work until midnight (Pacific time) on the day they're sent, and everything made in the demo is cleared overnight. Thanks for trying StrataCouncil.ca! Ready for the real thing? Create your free account and set up your own strata.",
  },
  unknown: {
    title: "This link doesn't work",
    body: "Check that you opened the whole link from your email. Or skip the demo and create your free account.",
  },
  busy: {
    title: "We couldn't open your demo",
    body: "Something went wrong while setting it up. Try your link again in a minute.",
  },
};

const WELCOME = {
  title: "The StrataCouncil.ca demo",
  body:
    "The demo opens from a personal link. To use StrataCouncil.ca with your own strata, create your free account: Council Training is free, and your first meeting in Meeting Mode is too.",
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
          <a href={SIGNUP_URL} className="button button-primary" data-testid="demo-front-door-signup">
            Create your free account
          </a>
        </p>
      </div>
    </div>
  );
}

export const metadata = { title: "Demo", robots: { index: false, follow: false } };
