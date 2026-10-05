import { createClient } from "@/lib/supabase/server";
import { normalizePlan, parseSources, type ImportPlan, type ImportSourceRecord } from "@/lib/training/ai";

/** Reads for the AI module builder (0034). RLS limits every table here to Super Admins. */

export type ImportStatus = "queued" | "reading" | "planning" | "planned" | "building" | "built" | "failed" | "needs_text" | "not_readable";

export interface TrainingImport {
  id: string;
  title: string;
  sources: ImportSourceRecord[];
  trackId: string | null;
  instructions: string;
  status: ImportStatus;
  plan: ImportPlan | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

const COLUMNS = "id, title, sources, track_id, instructions, status, plan, error, created_at, updated_at";

function toImport(r: Record<string, unknown>): TrainingImport {
  return {
    id: r.id as string,
    title: r.title as string,
    sources: parseSources(r.sources),
    trackId: (r.track_id as string | null) ?? null,
    instructions: (r.instructions as string) ?? "",
    status: r.status as ImportStatus,
    plan: r.plan ? normalizePlan(r.plan) : null,
    error: (r.error as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export async function listTrainingImports(): Promise<TrainingImport[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("training_imports").select(COLUMNS).order("created_at", { ascending: false }).limit(50);
  return (data ?? []).map(toImport);
}

export async function getTrainingImport(id: string): Promise<TrainingImport | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("training_imports").select(COLUMNS).eq("id", id).maybeSingle();
  return data ? toImport(data) : null;
}

/** Library entries with text, offered as sources. */
export async function listLibrarySources() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("legislation_documents")
    .select("id, title, kind, indexing_status")
    .in("indexing_status", ["indexed"])
    .order("title");
  return (data ?? []).map((d) => ({ id: d.id as string, title: d.title as string, kind: d.kind as string }));
}

export async function listTracksForImport() {
  const supabase = await createClient();
  const { data } = await supabase.from("training_tracks").select("id, code, title").order("order_index");
  return (data ?? []).map((t) => ({ id: t.id as string, code: t.code as string, title: t.title as string }));
}

export const importStatusLabels: Record<ImportStatus, string> = {
  queued: "Waiting to start",
  reading: "Reading the document",
  planning: "Breaking it into modules",
  planned: "Ready for your review",
  building: "Writing modules",
  built: "Modules drafted",
  failed: "Something went wrong",
  needs_text: "Couldn't read the text",
  not_readable: "Couldn't use this document",
};

export const isWorking = (s: ImportStatus) => s === "queued" || s === "reading" || s === "planning" || s === "building";
