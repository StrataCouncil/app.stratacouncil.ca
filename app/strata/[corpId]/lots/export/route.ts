import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rosterFields, toRosterCsv, type RosterCsvRow } from "@/lib/roster-csv";

/**
 * The owner roster as a CSV (doc02 §2a): `?template=1` for the blank
 * template — every one of this strata's lots pre-listed, every other cell
 * empty — or the current roster otherwise, ready to edit and re-upload.
 * Same columns either way, and never the four governance fields.
 *
 * Admin-only, matching who can upload. Members can see the roster on the
 * page, but a downloadable file of every owner's contact details is a
 * different thing to hand out (PIPA), so it stays with the role that
 * maintains it.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ corpId: string }> }
) {
  const { corpId } = await params;
  const template = request.nextUrl.searchParams.get("template") === "1";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Not signed in.", { status: 401 });

  const { data: admin } = await supabase
    .from("corporation_role_assignments")
    .select("role")
    .eq("corporation_id", corpId)
    .eq("user_id", user.id)
    .eq("role", "admin")
    .maybeSingle();
  if (!admin) return new NextResponse("Only this strata's admin can download the roster.", { status: 403 });

  const { data: rows, error } = await supabase
    .from("owners_and_council")
    .select(`lot_number, ${rosterFields.join(", ")}`)
    .eq("corporation_id", corpId)
    .order("lot_number");
  if (error) {
    console.error("[roster export]", corpId, error.message);
    return new NextResponse("Couldn't read the roster.", { status: 500 });
  }

  const lots = (rows ?? []) as unknown as RosterCsvRow[];
  const csv = toRosterCsv(template ? lots.map((r) => ({ lot_number: r.lot_number })) : lots);
  const date = new Date().toISOString().slice(0, 10);
  const filename = template ? `${corpId}-owner-roster-template.csv` : `${corpId}-owner-roster-${date}.csv`;

  // BOM so Excel reads it as UTF-8 (accented owner names); parseCsv strips it.
  return new NextResponse("\uFEFF" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
