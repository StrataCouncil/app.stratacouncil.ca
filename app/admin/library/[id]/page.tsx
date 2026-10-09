import { notFound } from "next/navigation";
import { AdminTabs } from "@/components/AdminTabs";
import { AppShell } from "@/components/AppShell";
import { LibraryEditor } from "@/components/library/LibraryEditor";
import { getLibraryDraft } from "@/lib/data/library";

/** One Library item in the console (0049). */
export default async function LibraryItemAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const draft = await getLibraryDraft(id);
  if (!draft) notFound();
  return (
    <AppShell active="admin">
      <div className="wrap page">
        <AdminTabs active="library" />
        <LibraryEditor initial={draft} key={draft.id} />
      </div>
    </AppShell>
  );
}
