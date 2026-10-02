import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { emptyManagement, hasManagement, imageSize, type ManagementDetails, type ManagerContact } from "@/lib/management";

export const MANAGEMENT_LOGOS_BUCKET = "management-logos";

/** The strata's management details, read through RLS (members only). */
export async function getManagementDetails(corpId: string): Promise<ManagementDetails> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("strata_management")
    .select("company_name, address, phone, email, website, managers, logo_path")
    .eq("corporation_id", corpId)
    .maybeSingle();
  if (!data) return emptyManagement();
  return {
    companyName: data.company_name ?? "",
    address: data.address ?? "",
    phone: data.phone ?? "",
    email: data.email ?? "",
    website: data.website ?? "",
    managers: (Array.isArray(data.managers) ? (data.managers as Partial<ManagerContact>[]) : []).map((m) => ({
      name: m.name ?? "",
      title: m.title ?? "",
      phone: m.phone ?? "",
      email: m.email ?? "",
    })),
    logoPath: data.logo_path ?? null,
  };
}

/** A short-lived link to the logo, for showing it on the Management tab. */
export async function logoUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data } = await createAdminClient().storage.from(MANAGEMENT_LOGOS_BUCKET).createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}

export interface Letterhead {
  details: ManagementDetails;
  logo: { bytes: Uint8Array; width: number; height: number; type: "png" | "jpg" } | null;
}

/**
 * The letterhead for an agenda or minutes export, or null when the strata
 * has no management details. The caller has already shown the user can
 * see this strata's meetings; the row is read through RLS, the logo file
 * with the service role (Storage has no client policies on this bucket).
 */
export async function loadLetterhead(corpId: string): Promise<Letterhead | null> {
  const details = await getManagementDetails(corpId);
  if (!hasManagement(details)) return null;
  let logo: Letterhead["logo"] = null;
  if (details.logoPath) {
    const { data } = await createAdminClient().storage.from(MANAGEMENT_LOGOS_BUCKET).download(details.logoPath);
    if (data) {
      const bytes = new Uint8Array(await data.arrayBuffer());
      const size = imageSize(bytes);
      if (size) logo = { bytes, ...size };
    }
  }
  return { details, logo };
}
