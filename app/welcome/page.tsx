import { redirect } from "next/navigation";
import { NameForm } from "./NameForm";
import { getCurrentProfile } from "@/lib/data/profile";
import { safeNext } from "@/lib/safe-next";

/**
 * "What's your name?" — shown once, to an account created by an invite
 * link rather than the signup form (doc01 §4a, doc03 Stage 4). Anyone who
 * already has a name is sent straight on.
 */
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const destination = safeNext(next);
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.fullName.trim()) redirect(destination);

  return <NameForm next={destination} email={profile.email} />;
}
