import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getPublishedLibraryItem } from "@/lib/data/library";
import { isDownloadableKind } from "@/lib/library/catalogue";
import { policyDocx } from "@/lib/exports/policy-docx";
import { documentSlug } from "@/lib/exports/filename";
import { logDemoActivity } from "@/lib/demo-usage";
import { logUserActivity } from "@/lib/user-activity";

/**
 * A Library policy template or form as an editable .docx, blank: the
 * placeholders (strata name, plan number) are left for the council to fill
 * in. Free for anyone signed in (the middleware requires a session).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ resourceId: string }> }) {
  const { resourceId } = await params;
  const item = await getPublishedLibraryItem(resourceId);
  if (!item || !isDownloadableKind(item.kind)) return new NextResponse("Not found", { status: 404 });

  const buffer = await policyDocx({
    corporation: null,
    title: item.title,
    markup: item.markup,
    form: item.kind === "form",
    bodyFont: await readFile(path.join(process.cwd(), "lib/exports/fonts/WorkSans-Regular.ttf")).catch(() => undefined),
  });
  await logDemoActivity({ kind: "library.template_downloaded", detail: { resourceId, file: "template.docx" } });
  await logUserActivity({ kind: "template_downloaded", strata: null, ref: resourceId, label: item.title });
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${documentSlug(item.title)}.docx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
