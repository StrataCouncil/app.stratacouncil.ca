import { SANDBOX_PERSONAS } from "@/lib/demo";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Email on the demo site (lib/demo.ts). Visitors' demos never send email.
 * A Super Admin's sandbox does, but only ever to the Super Admin who made
 * it (demo_visitors.email_to), never to the address on the email, with a
 * subject saying who it was for. Server only, demo site only.
 */
export async function sandboxRecipient(to: string, corporationId?: string): Promise<{ to: string; label: string } | null> {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const address = to.trim().toLowerCase();

  // One of a sandbox's own people.
  const { data: person } = await admin
    .from("demo_visitors")
    .select("full_name, persona, email_to")
    .eq("email", address)
    .not("sandbox_id", "is", null)
    .gt("expires_at", now)
    .limit(1)
    .maybeSingle();
  if (person?.email_to) {
    const role = person.persona === "admin" ? "Admin" : SANDBOX_PERSONAS.find((p) => p.key === person.persona)?.label;
    return { to: person.email_to as string, label: role ? `${person.full_name}, ${role}` : (person.full_name as string) };
  }

  // Anyone else, from a sandbox strata (an invitation to a new address).
  if (corporationId) {
    const { data: box } = await admin
      .from("demo_visitors")
      .select("email_to")
      .eq("corporation_id", corporationId)
      .not("sandbox_id", "is", null)
      .gt("expires_at", now)
      .limit(1)
      .maybeSingle();
    if (box?.email_to) return { to: box.email_to as string, label: address };
  }
  return null;
}
