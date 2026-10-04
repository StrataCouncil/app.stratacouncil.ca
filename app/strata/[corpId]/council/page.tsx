import { AutoRefresh } from "@/components/AutoRefresh";
import { StrataSphereNav } from "@/components/StrataSphereNav";
import { CouncilRoster } from "@/components/CouncilRoster";
import { getCorporationRoster } from "@/lib/data/roster";

/**
 * Council (formerly Council & Roles) — free the moment a corporation exists (doc03 Stage 5).
 * Real roster, invites, join requests, roles and meeting permissions from
 * `getCorporationRoster()`; the layout above has already confirmed the
 * signed-in user is an active member of `corpId`.
 */
export default async function CouncilAndRolesPage({
  params,
}: {
  params: Promise<{ corpId: string }>;
}) {
  const { corpId } = await params;
  const roster = await getCorporationRoster(corpId);

  return (
    <>
      <StrataSphereNav active="council" />
      <AutoRefresh />

      {roster ? (
        <CouncilRoster corporationId={corpId} roster={roster} />
      ) : (
        <p className="roster-notice">Couldn&rsquo;t load the roster. Try refreshing the page.</p>
      )}

    </>
  );
}
