import Link from "next/link";

/**
 * The second-level menu in Resources (components/TopNav.tsx): Council
 * Training, the Library, and Forms & Templates. All belong to the person,
 * not a strata, and all work on phones.
 */
export function ResourcesNav({ active }: { active: "training" | "library" | "templates" }) {
  return (
    <nav className="substrata-nav" aria-label="Resources">
      <Link href="/training" data-active={active === "training"} data-testid="nav-training">
        Council Training
      </Link>
      <Link href="/library" data-active={active === "library"} data-testid="nav-library">
        Library
      </Link>
      <Link href="/templates" data-active={active === "templates"} data-testid="nav-templates">
        Forms &amp; Templates
      </Link>
    </nav>
  );
}
