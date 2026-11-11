import Link from "next/link";
import { Logo } from "@/components/Logo";
import { stopSetupTips } from "./actions";

/**
 * "Stop setup tips", from the footer of a lifecycle email. A button, not
 * the link itself, does it: mail scanners open links, and shouldn't
 * unsubscribe anyone. (Mail apps' own Unsubscribe button uses the
 * one-click route, /api/email/unsubscribe.) Works signed in or not.
 */
export const metadata = { title: "Email preferences" };

export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ t?: string; done?: string }> }) {
  const { t = "", done } = await searchParams;
  return (
    <div className="auth-shell">
      <div className="auth-card" data-testid="unsubscribe">
        <Link href="/" className="auth-card__brand">
          <Logo className="auth-card__mark" />
          <span className="auth-card__wordmark">StrataCouncil.ca</span>
        </Link>
        {done === "stopped" ? (
          <>
            <h1>Setup tips stopped</h1>
            <p>We won&rsquo;t send you any more setup tips. Sign-in links, security notices, invitations, and meeting and discussion emails still arrive as usual.</p>
            <p>You can turn setup tips back on from your Account page.</p>
          </>
        ) : done === "invalid" ? (
          <>
            <h1>This link has expired</h1>
            <p>Sign in and use the Emails section of your Account page to choose which emails you get.</p>
          </>
        ) : (
          <>
            <h1>Stop setup tips?</h1>
            <p>Setup tips are the occasional emails that help you get started. Stopping them doesn&rsquo;t affect sign-in links, security notices, invitations, or meeting and discussion emails.</p>
            {done === "error" && <p className="field__hint" style={{ color: "var(--danger, #c0392b)" }}>That didn&rsquo;t work. Please try again.</p>}
            <form action={stopSetupTips}>
              <input type="hidden" name="t" value={t} />
              <button type="submit" className="button button-primary" data-testid="unsubscribe-confirm">
                Stop setup tips
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
