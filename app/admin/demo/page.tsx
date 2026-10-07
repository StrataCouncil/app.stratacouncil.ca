import { notFound } from "next/navigation";
import { AdminTabs } from "@/components/AdminTabs";
import { AppShell } from "@/components/AppShell";
import { DemoLinksAdmin } from "@/components/DemoLinksAdmin";
import { getDemoVisitors } from "@/lib/data/demo-visitors";
import { getCurrentProfile } from "@/lib/data/profile";

/** Super Admin: personal links to the demo site (lib/demo.ts), and copying content to it. */
export default async function AdminDemoPage() {
  const profile = await getCurrentProfile();
  if (!profile?.isSuperAdmin) notFound();
  const demoVisitors = await getDemoVisitors();

  return (
    <AppShell active="admin">
      <div className="wrap page">
        <AdminTabs active="demo" />
        <div className="page-header">
          <h1>Demo</h1>
          <p>
            Send someone a personal link to demo.stratacouncil.ca. Each link opens on the Stratasphere&trade; or on Council
            Training, gives them a strata of their own, and stops working at midnight Pacific on the day it was made.
          </p>
        </div>
        <DemoLinksAdmin list={demoVisitors} />
      </div>
    </AppShell>
  );
}

// Copying training and the legislation library to the demo can take a while.
export const maxDuration = 300;
