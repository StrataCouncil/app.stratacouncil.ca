import { redirect } from "next/navigation";

/**
 * The Minutes tab is gone (2026-10-20): finalized and historic minutes are
 * in Documents, Meetings & Records, and each meeting's minutes open from
 * the Meetings tab. Old links land on the folder.
 */
export default async function MinutesPage({ params }: { params: Promise<{ corpId: string }> }) {
  const { corpId } = await params;
  redirect(`/strata/${corpId}/documents/meetings_records`);
}
