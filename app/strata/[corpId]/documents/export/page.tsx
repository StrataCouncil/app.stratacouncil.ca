import Link from "next/link";
import { notFound } from "next/navigation";
import { StrataSphereNav } from "@/components/StrataSphereNav";
import { DocumentExport, type ExportItem } from "@/components/DocumentExport";
import { getStrataAccess } from "@/lib/data/strata";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { IS_DEMO } from "@/lib/demo";
import { hashExportToken } from "@/lib/document-export";
import { folderLabel } from "@/lib/documents";

export const dynamic = "force-dynamic";

/**
 * The emailed "Download everything" link (0062). It works once, within 24
 * hours, for the Admin who asked, while they're signed in. Their browser
 * then fetches every document and builds the ZIP (components/DocumentExport.tsx).
 */
export default async function DocumentExportPage({
  params,
  searchParams,
}: {
  params: Promise<{ corpId: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { corpId } = await params;
  const { t } = await searchParams;
  if (IS_DEMO) notFound();
  const access = await getStrataAccess(corpId);
  if (!access) notFound();

  const refuse = (message: string) => (
    <>
      <StrataSphereNav active="documents" />
      <div className="card" style={{ maxWidth: 560 }} data-testid="document-export-refused">
        <h2>Download everything</h2>
        <p className="card__meta" style={{ margin: "0.5rem 0 1rem" }}>
          {message}
        </p>
        <Link href={`/strata/${corpId}/documents`} className="button button-secondary">
          Back to Documents
        </Link>
      </div>
    </>
  );

  if (!access.isAdmin) return refuse("Only the strata's Admin can download everything.");
  if (!t || t.length < 20 || t.length > 100) return refuse("This link isn't complete. Please open it from the email again.");

  const admin = createAdminClient();
  const { data: request } = await admin
    .from("document_exports")
    .select("id, requested_by, expires_at, opened_at")
    .eq("token_hash", hashExportToken(t))
    .eq("corporation_id", access.corpId)
    .maybeSingle();
  if (!request || request.requested_by !== access.userId) {
    return refuse("This link isn't for you. Ask for your own link with Download everything on the Documents page.");
  }
  if (request.opened_at) return refuse("This link has already been used. Ask for a new one with Download everything on the Documents page.");
  if (Date.parse(request.expires_at) < Date.now()) return refuse("This link has expired. Ask for a new one with Download everything on the Documents page.");
  await admin.from("document_exports").update({ opened_at: new Date().toISOString() }).eq("id", request.id).is("opened_at", null);

  const supabase = await createClient();
  const [{ data: docs }, { data: corp }] = await Promise.all([
    supabase
      .from("documents")
      .select("id, title, file_name, category, source_type, url, uploaded_at, storage_path, uploader:profiles!documents_uploaded_by_fkey(full_name)")
      .eq("corporation_id", access.corpId)
      .eq("is_current", true)
      .order("uploaded_at", { ascending: true }),
    supabase.from("strata_corporations").select("legal_name, building_name").eq("strata_plan_number", access.corpId).maybeSingle(),
  ]);

  // Signed links to every file, grouped by storage bucket, valid long enough to download a large strata.
  type Row = { id: string; title: string | null; file_name: string | null; category: string | null; source_type: string; url: string | null; uploaded_at: string; storage_path: string | null; uploader: { full_name: string | null } | null };
  const rows = (docs ?? []) as unknown as Row[];
  const byBucket = new Map<string, Array<{ id: string; path: string }>>();
  for (const r of rows) {
    if (!r.storage_path) continue;
    const slash = r.storage_path.indexOf("/");
    const bucket = r.storage_path.slice(0, slash);
    byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), { id: r.id, path: r.storage_path.slice(slash + 1) }]);
  }
  const signed = new Map<string, string>();
  for (const [bucket, items] of byBucket) {
    for (let i = 0; i < items.length; i += 100) {
      const chunk = items.slice(i, i + 100);
      const { data } = await admin.storage.from(bucket).createSignedUrls(chunk.map((c) => c.path), 3 * 3600);
      (data ?? []).forEach((d, j) => d.signedUrl && signed.set(chunk[j].id, d.signedUrl));
    }
  }

  const items: ExportItem[] = rows.map((r) => ({
    title: r.title || r.file_name || "Untitled",
    fileName: r.file_name,
    folder: folderLabel(r.category),
    kind: r.source_type,
    url: r.source_type === "link" ? r.url : null,
    uploadedAt: r.uploaded_at,
    uploadedBy: r.uploader?.full_name ?? null,
    downloadUrl: signed.get(r.id) ?? null,
  }));

  return (
    <>
      <StrataSphereNav active="documents" />
      <DocumentExport corpId={access.corpId} strataName={corp?.building_name || corp?.legal_name || access.corpId} items={items} />
    </>
  );
}
