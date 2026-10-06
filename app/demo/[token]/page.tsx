import { notFound } from "next/navigation";
import { DemoShell } from "@/components/DemoShell";
import { TrainingOverview } from "@/components/training/TrainingOverview";
import { getDemoLink, getDemoTracks } from "@/lib/data/training-demo";

/** Council Training through a demo link: no sign-in, nothing saved (0040). */
export default async function DemoTrainingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await getDemoLink(token);
  if (!link) notFound();
  const tracks = await getDemoTracks(link);
  return (
    <DemoShell label={link.label}>
      <TrainingOverview tracks={tracks} hrefBase={`/demo/${token}`} demo />
    </DemoShell>
  );
}

export const metadata = { robots: { index: false, follow: false } };
