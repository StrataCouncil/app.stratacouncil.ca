import Link from "next/link";
import { notFound } from "next/navigation";
import { StrataSphereNav } from "@/components/StrataSphereNav";
import { VideoCheck } from "@/components/meetings/VideoCheck";
import { getStrataAccess } from "@/lib/data/strata";

export const metadata = { title: "Test video and audio" };

/** Test video and audio: anyone who takes part in meetings checks their camera, microphone, and speakers here first. */
export default async function VideoTestPage({ params }: { params: Promise<{ corpId: string }> }) {
  const { corpId } = await params;
  const access = await getStrataAccess(corpId);
  if (!access) notFound();

  return (
    <>
      <StrataSphereNav active="meetings" />
      <Link href={`/strata/${corpId}/meetings`} className="card__meta" style={{ display: "inline-block", marginBottom: "0.75rem" }}>
        &larr; All meetings
      </Link>
      <h2 style={{ marginBottom: "0.5rem" }}>Test video and audio</h2>
      <p className="card__meta" style={{ marginBottom: "1.25rem", maxWidth: 680 }}>
        Check your camera, microphone, and speakers before a meeting. It takes a minute, and you only need to do it once in each browser you use.
        Nothing is recorded or sent anywhere.
      </p>
      <VideoCheck />
    </>
  );
}
