import { notFound } from "next/navigation";
import { AdminTabs } from "@/components/AdminTabs";
import { AppShell } from "@/components/AppShell";
import { DemoLinksAdmin } from "@/components/DemoLinksAdmin";
import { DemoRequestsAdmin } from "@/components/DemoRequestsAdmin";
import { SandboxAdmin } from "@/components/SandboxAdmin";
import { getDemoVisitors, getSandboxes } from "@/lib/data/demo-visitors";
import { getCurrentProfile } from "@/lib/data/profile";
import { getDemoRequests } from "@/lib/demo-requests-server";

/** Super Admin: demo requests from stratacouncil.ca, personal links to the demo site (lib/demo.ts), and copying content to it. */
export default async function AdminDemoPage() {
  const profile = await getCurrentProfile();
  if (!profile?.isSuperAdmin) notFound();
  const [demoVisitors, demoRequests, sandboxes] = await Promise.all([getDemoVisitors(), getDemoRequests(), getSandboxes()]);

  return (
    <AppShell active="admin">
      <div className="wrap page">
        <AdminTabs active="demo" />
        <div className="page-header">
          <h1>Demo</h1>
          <p>
            Send someone a personal link to demo.stratacouncil.ca. Each link opens on the Stratasphere&trade; or on Council
            Training, gives them a strata of their own, and stops working at midnight Pacific three days after the day it was made.
          </p>
        </div>
        <DemoRequestsAdmin requests={demoRequests} connected={demoVisitors.configured} />
        <DemoLinksAdmin list={demoVisitors} />
        <SandboxAdmin list={sandboxes} />
      </div>
    </AppShell>
  );
}

// Copying training and the Knowledge Base to the demo can take a while.
export const maxDuration = 300;
