import { notFound } from "next/navigation";
import { SlideBuilder } from "@/components/training/SlideBuilder";
import { getCurrentProfile } from "@/lib/data/profile";
import { getBuilderModule, getDefaultVoice } from "@/lib/data/training";

/** Super Admin: the slide builder, full screen. */
export default async function AdminModuleBuilderPage({ params }: { params: Promise<{ moduleId: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile?.isSuperAdmin) notFound();
  const { moduleId } = await params;
  const [module, defaultVoice] = await Promise.all([getBuilderModule(moduleId), getDefaultVoice()]);
  if (!module) notFound();
  return <SlideBuilder module={module} me={profile.id} defaultVoice={defaultVoice} canPublish backHref="/admin/training" />;
}
