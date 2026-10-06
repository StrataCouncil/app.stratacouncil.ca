import { AppShell } from "@/components/AppShell";
import { HomeAnnouncements } from "@/components/HomeAnnouncements";
import { TrainingOverview } from "@/components/training/TrainingOverview";
import { getCurrentAnnouncements } from "@/lib/data/announcements";
import { getTrainingTracks } from "@/lib/data/training";

/**
 * Council Training: the signed-in landing screen. Belongs to the user, not
 * any corporation. StrataCouncil.ca announcements show at the top.
 */
export default async function CouncilTrainingPage() {
  const [tracks, announcements] = await Promise.all([getTrainingTracks(), getCurrentAnnouncements("home")]);
  return (
    <AppShell active="training">
      <TrainingOverview tracks={tracks} news={<HomeAnnouncements announcements={announcements} />} />
    </AppShell>
  );
}
