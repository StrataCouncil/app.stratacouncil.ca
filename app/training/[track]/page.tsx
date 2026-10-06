import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { TrackPath } from "@/components/training/TrackPath";
import { getTrainingTracks } from "@/lib/data/training";

/** A track's learning path. */
export default async function TrackPage({ params }: { params: Promise<{ track: string }> }) {
  const { track: slug } = await params;
  const tracks = await getTrainingTracks();
  const track = tracks.find((t) => t.slug === slug);
  if (!track) notFound();
  return (
    <AppShell active="training">
      <TrackPath track={track} tracks={tracks} />
    </AppShell>
  );
}
