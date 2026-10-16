// Shown on the Library and on each Library item: the content is general
// reference, not legal advice, and it's up to the reader to verify it.
export function LibraryDisclaimer({ compact = false }: { compact?: boolean }) {
  return (
    <aside className="library-disclaimer" role="note" data-testid="library-disclaimer">
      <strong>For general reference only. This isn&rsquo;t legal advice.</strong>
      {compact ? (
        <p>
          Check it against the current Strata Property Act, the Strata Property Regulation and your strata&rsquo;s own
          bylaws, and confirm with a qualified professional before acting on it.
        </p>
      ) : (
        <p>
          The Library shares general information to help councils get started. Laws change, and every strata&rsquo;s
          bylaws and circumstances are different, so check anything you rely on against the current Strata Property Act,
          the Strata Property Regulation and your strata&rsquo;s own bylaws and rules, and confirm with a qualified
          professional, such as a lawyer, strata manager or accountant, before acting. Verifying it is up to your council.
        </p>
      )}
    </aside>
  );
}
