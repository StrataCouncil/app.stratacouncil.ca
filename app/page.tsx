import { redirect } from "next/navigation";

/**
 * The signed-in landing screen is Council Training (2026-10-06): it has
 * everything the old Home page did, including StrataCouncil.ca
 * announcements, so "/" goes straight there.
 */
export default function HomePage() {
  redirect("/training");
}
