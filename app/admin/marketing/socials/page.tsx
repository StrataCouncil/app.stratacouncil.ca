import { notFound } from "next/navigation";
import { AdminTabs } from "@/components/AdminTabs";
import { MarketingTabs } from "@/components/MarketingTabs";
import { AppShell } from "@/components/AppShell";
import { SocialPostsAdmin } from "@/components/social/SocialPostsAdmin";
import { getCurrentProfile } from "@/lib/data/profile";
import { getSocialPosts } from "@/lib/data/social";
import { listSocialTemplates } from "./actions";

/** Super Admin: carousel posts for Instagram, Facebook, LinkedIn, TikTok and X (0068). */
export default async function AdminSocialPage() {
  const profile = await getCurrentProfile();
  if (!profile?.isSuperAdmin) notFound();
  const [posts, library] = await Promise.all([getSocialPosts(), listSocialTemplates()]);
  const templates = library.ok ? library.templates : [];
  const templatesError = library.ok ? library.savedError : library.error;

  return (
    <AppShell active="admin">
      <div className="wrap page">
        <AdminTabs active="marketing" />
        <MarketingTabs active="socials" />
        <div className="page-header">
          <h1>Social</h1>
          <p>Carousel posts for Instagram, Facebook, LinkedIn, TikTok, and X, started from a template or drafted by AI and edited here, exported as one ZIP with a folder per platform.</p>
        </div>
        <SocialPostsAdmin posts={posts} templates={templates} templatesError={templatesError} />
      </div>
    </AppShell>
  );
}

// Drafting a post with the AI can take a minute.
export const maxDuration = 120;
