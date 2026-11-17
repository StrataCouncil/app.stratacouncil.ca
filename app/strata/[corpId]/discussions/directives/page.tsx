import { notFound } from "next/navigation";
import { StrataSphereNav } from "@/components/StrataSphereNav";
import { DiscussionsTabs } from "@/components/discussions/DiscussionsTabs";
import { DirectivesBoard } from "@/components/directives/DirectivesBoard";
import { getStrataAccess } from "@/lib/data/strata";
import { listAssignable, listDirectiveChanges, listDirectives } from "@/lib/data/directives";
import { tz } from "@/lib/time-zone";

/**
 * Directives (0097): what council has decided should be done. Written
 * automatically from carried motions and supported Discussions, or added by
 * hand by whoever runs meetings. Council and those who run meetings see
 * them; the manager sees them and marks them done.
 */
export default async function DirectivesPage({ params }: { params: Promise<{ corpId: string }> }) {
  const { corpId } = await params;
  const access = await getStrataAccess(corpId);
  if (!access?.seesDirectives) notFound();
  const [directives, changes, assignable] = await Promise.all([
    listDirectives(corpId),
    listDirectiveChanges(corpId),
    access.canRunMeetings ? listAssignable(corpId) : Promise.resolve([]),
  ]);
  const now = new Date();
  const today = now.toLocaleDateString("en-CA", { timeZone: tz("America/Vancouver", now) });

  return (
    <>
      <StrataSphereNav active="discussions" />
      <DiscussionsTabs corpId={corpId} active="directives" seesDiscussions={access.seesDiscussions} />
      <div className="doc-header">
        <div>
          <h2>Directives</h2>
          <p className="card__meta">
            What council has decided should be done. Each motion carried at a meeting, and each Discussion council supports, adds its follow-up here
            {access.subscribed ? ", worded by Stratasphere" : ""}. Council, those who run meetings, and the manager see these; owners don&rsquo;t.
          </p>
        </div>
      </div>
      <DirectivesBoard
        corpId={corpId}
        directives={directives}
        changes={changes}
        assignable={assignable}
        canEdit={access.canRunMeetings}
        isManager={access.isManager}
        seesDiscussions={access.seesDiscussions}
        suggestWording={access.canRunMeetings && access.subscribed}
        userId={access.userId}
        today={today}
      />
    </>
  );
}
