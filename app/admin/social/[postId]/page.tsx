import { notFound } from "next/navigation";
import { AdminTabs } from "@/components/AdminTabs";
import { AppShell } from "@/components/AppShell";
import { SocialEditor } from "@/components/social/SocialEditor";
import { getCurrentProfile } from "@/lib/data/profile";
import { getSocialPost } from "@/lib/data/social";

/** Super Admin: edit one carousel post and export it. */
export default async function AdminSocialPostPage({ params }: { params: Promise<{ postId: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile?.isSuperAdmin) notFound();
  const { postId } = await params;
  const post = await getSocialPost(postId);
  if (!post) notFound();

  return (
    <AppShell active="admin">
      <div className="wrap wrap--wide page">
        <AdminTabs active="social" />
        <SocialEditor initial={post} />
      </div>
    </AppShell>
  );
}

// Rewriting a slide with the AI can take a little while.
export const maxDuration = 60;
