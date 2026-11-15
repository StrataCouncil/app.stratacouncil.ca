import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/data/admin";
import { getBuilderModule } from "@/lib/data/training";
import { exportFileName, moduleAsText } from "@/lib/training/export-text";
import { tz } from "@/lib/time-zone";

/**
 * Download as text (Super Admin): the whole module as one plain-text file,
 * for review outside the builder. Read only. Super Admins only, in a
 * two-step-verified session (requireSuperAdmin); module authors can be
 * added later.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ moduleId: string }> }) {
  if (!(await requireSuperAdmin())) return new NextResponse("Not found", { status: 404 });
  const { moduleId } = await params;
  const module = await getBuilderModule(moduleId);
  if (!module) return new NextResponse("Not found", { status: 404 });

  const now = new Date();
  const exportedAt =
    now.toLocaleString("en-CA", { timeZone: tz("America/Vancouver", now), year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }) + " PT";
  const name = exportFileName(module.title);
  return new NextResponse(moduleAsText(module, exportedAt), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
