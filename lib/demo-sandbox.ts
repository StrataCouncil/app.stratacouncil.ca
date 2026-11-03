import { cache } from "react";
import { IS_DEMO } from "@/lib/demo";
import { createClient } from "@/lib/supabase/server";

/**
 * Whether the signed-in person is in a Super Admin's sandbox on the demo
 * site (lib/demo.ts, SANDBOX_*). Their account's app_metadata says so,
 * and only the service role can set it (lib/demo-server.ts), so a demo
 * visitor can't make themselves one. Server only.
 */
export interface SandboxSession {
  sandboxId: string;
  persona: string;
  name: string;
}

export const sandboxSession = cache(async (): Promise<SandboxSession | null> => {
  if (!IS_DEMO) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const meta = user?.app_metadata as Record<string, unknown> | undefined;
  if (!meta || typeof meta.demo_sandbox_id !== "string" || typeof meta.demo_persona !== "string") return null;
  return {
    sandboxId: meta.demo_sandbox_id,
    persona: meta.demo_persona,
    name: String((user?.user_metadata as Record<string, unknown> | undefined)?.full_name ?? ""),
  };
});

/**
 * The demo's restrictions (uploads, one meeting, a set agenda, question
 * limits) apply: on the demo site, to everyone but a sandbox. Billing,
 * extra stratas and the activity stats stay off for sandboxes too.
 */
export async function demoRestricted(): Promise<boolean> {
  if (!IS_DEMO) return false;
  return (await sandboxSession()) === null;
}
