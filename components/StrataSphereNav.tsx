import Link from "next/link";
import { currentCorporation } from "@/lib/placeholder-data";

const subscribed = currentCorporation.subscriptionStatus === "active";

/**
 * StrataSphere sub-nav (doc03 "second level"): free sections show fully
 * open, gated sections show a lock affordance rather than being hidden —
 * the tab should read as "your strata's home, some of it unlocked, some
 * of it not," never as a paywall.
 *
 * No standalone "Decisions" item: the decision ledger isn't a place a
 * user navigates to, it's a byproduct — every decision recorded live in
 * Meeting Mode, or parsed out of uploaded historic minutes, lands there
 * automatically. It still exists as a record (and the AI assistant reads
 * it), just not as its own menu destination.
 *
 * No "Calendar" item either — that's a future feature, not built yet.
 *
 * Knowledge Library leads the list on purpose (doc01 §3b): it's free,
 * requires no corporation setup beyond being connected, and is the one
 * section a brand-new council member gets immediate value from before
 * anything else here means much to them — playbooks, policy templates,
 * operational guides, financial insights, legislation updates and
 * emergency playbooks, not just situation playbooks (hence the renamed
 * label, up from "Guides & Playbooks").
 */
const items: Array<{
  slug: string;
  label: string;
  gated: boolean;
}> = [
  { slug: "guides", label: "Knowledge Library", gated: false },
  { slug: "", label: "Council & Roles", gated: false },
  { slug: "lots", label: "Strata Lots", gated: false },
  { slug: "documents", label: "Documents", gated: false },
  { slug: "minutes", label: "Minutes", gated: false },
  { slug: "meetings", label: "Meetings", gated: false },
  { slug: "assistant", label: "Stratasphere™", gated: true },
];

export function StrataSphereNav({ active }: { active: string }) {
  return (
    <nav className="substrata-nav" aria-label="Stratasphere">
      {items.map((item) => (
        <Link
          key={item.slug || "home"}
          href={`/strata/${currentCorporation.id}${item.slug ? `/${item.slug}` : ""}`}
          data-active={active === (item.slug || "home")}
        >
          {item.label}
          {item.gated && !subscribed && <span className="lock-icon">&#128274;</span>}
        </Link>
      ))}
    </nav>
  );
}
