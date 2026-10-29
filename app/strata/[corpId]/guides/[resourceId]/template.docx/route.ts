import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStrataAccess } from "@/lib/data/strata";
import { getPublishedLibraryItem } from "@/lib/data/library";
import { isDownloadableKind, isTemplateLocked } from "@/lib/library/catalogue";
import { policyDocx } from "@/lib/exports/policy-docx";
import { exportFileName, todayInBC } from "@/lib/exports/filename";
import { logDemoActivity } from "@/lib/demo-usage";
import { logUserActivity } from "@/lib/user-activity";

/**
 * A Library policy template or form as an editable .docx, filled in with the
 * strata's name and plan number. Subscribers only, checked here as well as
 * on the page: the template's text never leaves the server otherwise.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ corpId: string; resourceId: string }> }) {
  const { corpId, resourceId } = await params;
  const access = await getStrataAccess(corpId);
  if (!access) return new NextResponse("Not found", { status: 404 });
  const item = await getPublishedLibraryItem(resourceId);
  if (!item || !isDownloadableKind(item.kind)) return new NextResponse("Not found", { status: 404 });
  if (isTemplateLocked(item, access.subscribed)) return new NextResponse("Policy templates and forms require a Stratasphere subscription", { status: 403 });

  const supabase = await createClient();
  const { data: corp } = await supabase
    .from("strata_corporations")
    .select("strata_plan_number, legal_name, building_name")
    .eq("strata_plan_number", corpId)
    .maybeSingle();
  if (!corp) return new NextResponse("Not found", { status: 404 });

  const buffer = await policyDocx({
    corporation: { planNumber: corp.strata_plan_number, name: corp.building_name || corp.legal_name },
    title: item.title,
    markup: item.markup,
    form: item.kind === "form",
    bodyFont: await readFile(path.join(process.cwd(), "lib/exports/fonts/WorkSans-Regular.ttf")).catch(() => undefined),
  });
  await logDemoActivity({ kind: "library.template_downloaded", detail: { resourceId, file: "template.docx" } });
  await logUserActivity({ kind: "template_downloaded", strata: corpId, ref: resourceId, label: item.title });
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${exportFileName(corp.strata_plan_number, todayInBC(), item.title, "docx")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
