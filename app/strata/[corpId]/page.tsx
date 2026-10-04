import Link from "next/link";
import { AutoRefresh } from "@/components/AutoRefresh";
import { StrataSphereNav } from "@/components/StrataSphereNav";
import { CouncilRoster } from "@/components/CouncilRoster";
import { getCorporationRoster } from "@/lib/data/roster";
import { getStrataAccess } from "@/lib/data/strata";
import { createClient } from "@/lib/supabase/server";
import { GettingStarted, type GettingStartedStep } from "@/components/GettingStarted";

/**
 * Council & Roles — free the moment a corporation exists (doc03 Stage 5).
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
  const [roster, access] = await Promise.all([getCorporationRoster(corpId), getStrataAccess(corpId)]);

  // Getting started, for the strata's own admin (not a visiting Super Admin).
  let steps: GettingStartedStep[] | null = null;
  if (roster?.isAdmin && access && !access.superAdminOnly) {
    const supabase = await createClient();
    const [{ count: namedLots }, { count: documents }, { count: meetings }] = await Promise.all([
      supabase.from("owners_and_council").select("id", { count: "exact", head: true }).eq("corporation_id", corpId).not("full_name", "is", null),
      supabase.from("documents").select("id", { count: "exact", head: true }).eq("corporation_id", corpId),
      supabase.from("meetings").select("id", { count: "exact", head: true }).eq("corporation_id", corpId),
    ]);
    const others = roster.members.filter((m) => m.userId !== roster.currentUserId).length + roster.invites.length;
    const councilRoles = roster.members.some((m) => m.roles.some((r) => r !== "admin"));
    steps = [
      {
        label: "Invite your council members",
        hint: "Everyone on council gets their own account, the agenda before each meeting, and their own Stratasphere.",
        href: `/strata/${corpId}#invite`,
        done: others > 0,
      },
      {
        label: "Upload your owner roster",
        hint: "Download the template on Strata Lots, fill it in, and upload it.",
        href: `/strata/${corpId}/lots`,
        done: (namedLots ?? 0) > 0,
      },
      {
        label: "Assign council roles",
        hint: "President, Vice President, Treasurer, Secretary, Members at Large.",
        href: `/strata/${corpId}#roster`,
        done: councilRoles,
      },
      {
        label: "Add your governing documents",
        hint: "Bylaws, rules, recent minutes, financial statements, insurance. Stratasphere answers from these.",
        href: `/strata/${corpId}/documents`,
        done: (documents ?? 0) > 0,
      },
      {
        label: "Create your first meeting",
        hint: "Build the agenda; your first meeting in Meeting Mode is free.",
        href: `/strata/${corpId}/meetings`,
        done: (meetings ?? 0) > 0,
      },
    ];
  }

  return (
    <>
      <StrataSphereNav active="home" />
        <AutoRefresh />

      {steps && <GettingStarted corpId={corpId} steps={steps} />}

      {roster ? (
        <CouncilRoster corporationId={corpId} roster={roster} />
      ) : (
        <p className="roster-notice">Couldn&rsquo;t load the roster. Try refreshing the page.</p>
      )}

      {roster?.isAdmin && (
        <div className="admin-entry" data-testid="billing-entry">
          <div>
            <span className="pill">Admin</span>
            <h3 style={{ margin: "0.6rem 0 0.25rem" }}>Billing &amp; subscription</h3>
            <p>Manage your Stratasphere&trade; plan, payment method and invoices.</p>
          </div>
          <Link
            href={`/strata/${corpId}/billing`}
            className="button button-secondary"
            data-testid="billing-link"
          >
            Go to billing
          </Link>
        </div>
      )}
    </>
  );
}
