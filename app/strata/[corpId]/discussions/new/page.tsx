import Link from "next/link";
import { notFound } from "next/navigation";
import { StrataSphereNav } from "@/components/StrataSphereNav";
import { DiscussionForm } from "@/components/discussions/DiscussionForm";
import { getStrataAccess } from "@/lib/data/strata";

/** Start a council discussion (0070). Any council member; free and unlimited (0090). */
export default async function NewDiscussionPage({ params }: { params: Promise<{ corpId: string }> }) {
  const { corpId } = await params;
  const access = await getStrataAccess(corpId);
  if (!access?.seesDiscussions) notFound();
  return (
    <>
      <StrataSphereNav active="discussions" />
      <Link href={`/strata/${corpId}/discussions`} className="kb-article__back">
        &larr; Discussions
      </Link>
      <div className="doc-header">
        <div>
          <h2>New discussion</h2>
          <p className="card__meta">Put a motion to council between meetings. Council is emailed, votes here, and can comment.</p>
        </div>
      </div>
      <section className="card">
        <DiscussionForm corpId={corpId} />
      </section>
    </>
  );
}
