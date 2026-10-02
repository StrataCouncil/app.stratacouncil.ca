import { notFound } from "next/navigation";
import { StrataSphereNav } from "@/components/StrataSphereNav";
import { ManagementForm } from "@/components/ManagementForm";
import { getStrataAccess } from "@/lib/data/strata";
import { getManagementDetails, logoUrl } from "@/lib/data/management";

/**
 * Management: the strata management company's details and logo, printed
 * at the top of agendas and minutes. Only the strata's Admin or Manager
 * sees this tab; nobody else can open it.
 */
export default async function ManagementPage({ params }: { params: Promise<{ corpId: string }> }) {
  const { corpId } = await params;
  const access = await getStrataAccess(corpId);
  if (!access || !(access.isAdmin || access.roles.includes("manager"))) notFound();
  const details = await getManagementDetails(corpId);
  const logo = await logoUrl(details.logoPath);

  return (
    <>
      <StrataSphereNav active="management" />
      <div className="page-header" style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ margin: 0 }}>Management</h2>
        <p className="card__meta" style={{ marginTop: "0.35rem" }}>
          Your strata management company&rsquo;s details. They print at the top of every agenda and set of minutes.
          Only the Admin and the Manager can see or change this.
        </p>
      </div>
      <ManagementForm corpId={corpId} initial={details} initialLogoUrl={logo} />
    </>
  );
}
