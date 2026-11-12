import { AppShell } from "@/components/AppShell";
import { ResourcesNav } from "@/components/ResourcesNav";
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
    <AppShell>
      <TrainingOverview tracks={tracks} nav={<ResourcesNav active="training" />} news={<HomeAnnouncements announcements={announcements} />} />
    </AppShell>
  );
}
