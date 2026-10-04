/**
 * What Stratasphere™ does for a council, in one place (note 3,
 * 2026-10-05): sells what it solves rather than listing what's free.
 * Used on the strata's subscribe prompt and on the billing page.
 */
export const STRATASPHERE_HEADLINE = "Unlock Stratasphere™ for your council";

export function StratasphereValue() {
  return (
    <ul className="stratasphere-value">
      <li>
        <strong>Meetings run by the book.</strong> Meeting Mode guides the chair through quorum, motions and votes the
        way the Strata Property Act requires.
      </li>
      <li>
        <strong>Minutes the moment you adjourn.</strong> Draft minutes are written as the meeting happens, ready to
        review and finalize.
      </li>
      <li>
        <strong>A council that never forgets.</strong> Ask anything and get answers from your own bylaws, minutes and
        every decision council has made, with the sources shown.
      </li>
    </ul>
  );
}
