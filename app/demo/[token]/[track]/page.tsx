import { notFound } from "next/navigation";
import { DemoShell } from "@/components/DemoShell";
import { TrackPath } from "@/components/training/TrackPath";
import { getDemoLink, getDemoTracks } from "@/lib/data/training-demo";

/** A track's learning path, through a demo link (0040). */
export default async function DemoTrackPage({ params }: { params: Promise<{ token: string; track: string }> }) {
  const { token, track: slug } = await params;
  const link = await getDemoLink(token);
  if (!link) notFound();
  const tracks = await getDemoTracks(link);
  const track = tracks.find((t) => t.slug === slug);
  if (!track) notFound();
  return (
    <DemoShell label={link.label}>
      <TrackPath track={track} tracks={tracks} hrefBase={`/demo/${token}`} demo />
    </DemoShell>
  );
}

export const metadata = { robots: { index: false, follow: false } };
