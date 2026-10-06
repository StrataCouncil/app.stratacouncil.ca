import { notFound } from "next/navigation";
import { SlideBuilder } from "@/components/training/SlideBuilder";
import { getCurrentProfile } from "@/lib/data/profile";
import { getBuilderModule, getDefaultVoice } from "@/lib/data/training";

/** An Author's slide builder. RLS only returns the module if they're assigned. */
export default async function AuthorModuleBuilderPage({ params }: { params: Promise<{ moduleId: string }> }) {
  const { moduleId } = await params;
  const [profile, module, defaultVoice] = await Promise.all([getCurrentProfile(), getBuilderModule(moduleId), getDefaultVoice()]);
  if (!profile || !module) notFound();
  return <SlideBuilder module={module} me={profile.id} defaultVoice={defaultVoice} canPublish={profile.isSuperAdmin} backHref="/build" />;
}
