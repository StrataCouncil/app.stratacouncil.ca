import { AppShell } from "@/components/AppShell";
import { TrainingOverview } from "@/components/training/TrainingOverview";
import { getTrainingTracks } from "@/lib/data/training";

/** Council Training: belongs to the user, not any corporation. */
export default async function CouncilTrainingPage() {
  const tracks = await getTrainingTracks();
  return (
    <AppShell active="training">
      <TrainingOverview tracks={tracks} />
    </AppShell>
  );
}
