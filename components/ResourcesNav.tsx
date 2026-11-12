import Link from "next/link";

/**
 * The second-level menu in Resources (components/TopNav.tsx): Council
 * Training and the Library. Both belong to the person, not a strata, and
 * both work on phones.
 */
export function ResourcesNav({ active }: { active: "training" | "library" }) {
  return (
    <nav className="substrata-nav" aria-label="Resources">
      <Link href="/training" data-active={active === "training"} data-testid="nav-training">
        Council Training
      </Link>
      <Link href="/library" data-active={active === "library"} data-testid="nav-library">
        Library
      </Link>
    </nav>
  );
}
