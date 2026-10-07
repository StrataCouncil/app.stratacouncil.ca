import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Attachment, AgendaItem } from "@/lib/meetings/agenda";
import { buildMinutes, attendanceLines, clockTime, voteLine, type MinutesContent } from "@/lib/meetings/minutes";
import { minutesPdf } from "@/lib/exports/minutes-pdf";
import { exportFileName, meetingDocumentName } from "@/lib/exports/filename";
import { DOCUMENTS_BUCKET } from "@/lib/documents";
import { MANAGEMENT_LOGOS_BUCKET } from "@/lib/data/management";
import { imageSize, type ManagementDetails } from "@/lib/management";
import { chunkText } from "@/lib/kb/chunk";
import { embed, toVectorLiteral } from "@/lib/kb/embed";
import { loadStripContext, stripForCorporation } from "@/lib/kb/privacy";
import { queueDocumentIndexing } from "@/lib/kb/queue";
import { kitDates, longDate, type KitDates } from "./dates";
import { kitDocuments, type KitDoc } from "./documents";
import { HARBOURLINE_LOGO_PNG_BASE64 } from "./logo";
import { kitMeetings, type KitMeeting } from "./meetings";
import { textPdf } from "./pdf";
import { BUILDING, CAST, MANAGEMENT, OWNERS, council, ownerEmail } from "./people";

/**
 * Fills a visitor's new demo strata (lib/demo.ts) with the fictional kit:
 * the council and manager, the lot roster, the management company and its
 * logo, the Library's documents (PDFs, already indexed for the
 * Stratasphere), two held council meetings with final minutes and their
 * decisions, the next meeting's agenda with attachments, the AGM's
 * resolutions in the decision ledger, and a request to join. Runs on the
 * demo site with the service role, right after demo_create_strata.
 *
 * Documents go through the same PII stripping as real ones before their
 * passages are embedded, and each passage's vector is kept
 * (demo_kit_embeddings) so later visitors reuse it.
 */
export async function buildDemoStrata(admin: SupabaseClient, corpId: string, now: Date = new Date()) {
  const d = kitDates(now);
  const { data: corp } = await admin
    .from("strata_corporations")
    .select("legal_name, building_name, address")
    .eq("strata_plan_number", corpId)
    .single();
  if (!corp) throw new Error("The demo strata wasn't found.");
  const legalName = corp.legal_name as string;

  const cast = await ensureCast(admin);
  const id = (key: string) => cast.get(key)!;
  const dev = id("dev");
  const secretary = id("liam");

  await check(
    admin.from("corporation_memberships").insert([
      ...council().map((c) => ({ user_id: id(c.key), corporation_id: corpId, status: "active", joined_at: at(d.agm, "21:00"), lot_number: c.lot })),
      { user_id: dev, corporation_id: corpId, status: "active", joined_at: at(d.previousFiscalStart, "09:00") },
    ]),
    "council"
  );
  await check(
    admin.from("corporation_role_assignments").insert([
      ...council().map((c) => ({ corporation_id: corpId, role: c.role!, user_id: id(c.key) })),
      { corporation_id: corpId, role: "manager", user_id: dev },
    ]),
    "council roles"
  );

  await check(
    admin.from("owners_and_council").upsert(
      OWNERS.map((o) => ({
        corporation_id: corpId,
        lot_number: o.lot,
        full_name: o.name,
        email: ownerEmail(o.name),
        unit_number: o.unit,
        unit_entitlement: o.entitlement,
        owner_type: o.type,
        parking: o.parking,
        storage: o.storage,
        bike_rack: o.bike,
        strata_fees: o.fee,
      })),
      { onConflict: "corporation_id,lot_number" }
    ),
    "owner roster"
  );
  await check(admin.rpc("sync_council_lots", { p_corporation_id: corpId }), "council lots");

  // The management company, with its logo on the letterhead.
  const logo = Uint8Array.from(Buffer.from(HARBOURLINE_LOGO_PNG_BASE64, "base64"));
  const logoPath = `${corpId}/harbourline-logo.png`;
  await check(admin.storage.from(MANAGEMENT_LOGOS_BUCKET).upload(logoPath, logo, { contentType: "image/png", upsert: true }), "logo");
  const details: ManagementDetails = {
    companyName: MANAGEMENT.companyName,
    address: MANAGEMENT.address,
    phone: MANAGEMENT.phone,
    email: MANAGEMENT.email,
    website: MANAGEMENT.website,
    managers: [MANAGEMENT.manager, MANAGEMENT.assistant],
    logoPath,
  };
  await check(
    admin.from("strata_management").upsert({
      corporation_id: corpId,
      company_name: details.companyName,
      address: details.address,
      phone: details.phone,
      email: details.email,
      website: details.website,
      managers: details.managers,
      logo_path: logoPath,
      updated_by: dev,
    }),
    "management"
  );
  const size = imageSize(logo);
  const letterhead = { details, logo: size ? { bytes: logo, ...size } : null };

  // Every document gets its id up front, so meetings can point at them.
  const docs = kitDocuments(d, legalName);
  const docIds = new Map(docs.map((doc) => [doc.key, randomUUID()]));
  const meetings = kitMeetings(d);
  const meetingIds = new Map(meetings.map((m) => [m.key, randomUUID()]));
  const minutesDocIds = new Map(meetings.filter((m) => m.held).map((m) => [`minutes:${m.key}`, randomUUID()]));
  const titleOf = (key: string) =>
    key.startsWith("minutes:") ? `Minutes - Strata Council Meeting, ${longDate(meetings.find((m) => `minutes:${m.key}` === key)!.date)}` : docs.find((doc) => doc.key === key)!.title;
  const docId = (key: string) => (key.startsWith("minutes:") ? minutesDocIds.get(key)! : docIds.get(key)!);

  // Attachments of the next meeting live in Agenda Attachments, tied to it.
  const upcoming = meetings.find((m) => !m.held)!;
  const attachedTo = new Map<string, string>();
  for (const [itemId, keys] of Object.entries(upcoming.attachments)) for (const k of keys) if (!attachedTo.has(k)) attachedTo.set(k, itemId);

  const withAttachments = (m: KitMeeting): AgendaItem[] =>
    m.agenda.map((it) => ({
      ...it,
      atts: (m.attachments[it.id] ?? []).map((key): Attachment => ({ id: `a_${docId(key)}`, kind: "document", documentId: docId(key), title: titleOf(key) })),
    }));

  // Meetings first (documents refer to them), each in its final state.
  const minutesFor = new Map<string, MinutesContent>();
  const meetingRows = meetings.map((m) => {
    const agenda = withAttachments(m);
    const row: Record<string, unknown> = {
      id: meetingIds.get(m.key),
      corporation_id: corpId,
      type: "council",
      meeting_date: m.date,
      start_time: m.startTime,
      timezone: "America/Vancouver",
      format: "in_person",
      location: m.location,
      chair_name: m.chairName,
      agenda,
      created_by: secretary,
      created_at: at(m.held ? addDays(m.date, -10) : addDays(d.today, -2), "10:00"),
      status: "DRAFT",
      attendance: {},
      attendees: [],
      agenda_approved: false,
      is_trial: false,
    };
    if (m.held) {
      const startAt = at(m.date, m.calledToOrder!);
      const adjournedAt = at(m.date, m.adjourned!);
      const content = buildMinutes({
        corporation: { planNumber: corpId, name: corp.building_name ?? legalName, address: corp.address },
        meeting: {
          type: "council",
          meetingDate: m.date,
          startTime: m.startTime,
          timezone: "America/Vancouver",
          format: "in_person",
          location: m.location,
          chairName: m.chairName,
          actualStartAt: startAt,
        },
        agenda,
        attendance: m.attendance,
        lotCount: BUILDING.units,
        councilCount: council().length,
        adjournedAt,
      });
      minutesFor.set(m.key, content);
      Object.assign(row, {
        status: "ADJOURNED",
        attendance: m.attendance,
        attendees: Object.keys(m.attendance).filter((lot) => m.attendance[lot] === "present"),
        agenda_approved: true,
        launched_by: secretary,
        launched_at: at(m.date, "18:55"),
        actual_start_at: startAt,
        adjourned_at: adjournedAt,
        minutes_state: "FINAL",
        minutes_content: content,
        minutes_finalized_at: at(addDays(m.date, 3), "16:20"),
        minutes_finalized_by: secretary,
      });
    }
    return row;
  });
  // Missing columns take their defaults, not null (the rows differ).
  await check(admin.from("meetings").insert(meetingRows, { defaultToNull: false }), "meetings");

  // The Library: the kit's documents, and the held meetings' final minutes.
  const files: Array<{ id: string; title: string; text: string; row: Record<string, unknown>; pdf: Uint8Array }> = [];
  for (const doc of docs) {
    const pdf = await textPdf(doc.text, `${BUILDING.name} · ${doc.title}`);
    const attachedItem = doc.sourceType === "agenda_attachment" ? attachedTo.get(doc.key) : undefined;
    files.push({
      id: docIds.get(doc.key)!,
      title: doc.title,
      text: doc.text,
      pdf,
      row: {
        category: doc.category,
        title: doc.title,
        file_name: doc.fileName,
        source_type: doc.sourceType ?? "upload",
        doc_type: doc.docType,
        uploaded_at: at(uploadedOn(doc, d), "11:15"),
        meeting_id: attachedItem ? meetingIds.get(upcoming.key) : null,
        agenda_item_id: attachedItem ?? null,
      },
    });
  }
  for (const m of meetings.filter((x) => x.held)) {
    const content = minutesFor.get(m.key)!;
    const finalizedAt = at(addDays(m.date, 3), "16:20");
    const pdf = await minutesPdf(content, { finalizedAt, letterhead });
    files.push({
      id: minutesDocIds.get(`minutes:${m.key}`)!,
      title: titleOf(`minutes:${m.key}`),
      text: minutesText(content),
      pdf,
      row: {
        category: "meetings_records",
        title: titleOf(`minutes:${m.key}`),
        file_name: exportFileName(corpId, m.date, meetingDocumentName("council", "Minutes"), "pdf"),
        source_type: "minutes",
        doc_type: "minutes",
        uploaded_at: finalizedAt,
        meeting_id: meetingIds.get(m.key),
        agenda_item_id: null,
      },
    });
  }

  await Promise.all(
    files.map(async (f) => {
      const path = `${corpId}/${f.id}/${f.row.file_name}`;
      await check(admin.storage.from(DOCUMENTS_BUCKET).upload(path, f.pdf, { contentType: "application/pdf", upsert: true }), "document file");
      f.row.storage_path = `${DOCUMENTS_BUCKET}/${path}`;
    })
  );
  await check(
    admin.from("documents").insert(
      files.map((f) => ({
        id: f.id,
        corporation_id: corpId,
        ...f.row,
        mime_type: "application/pdf",
        size_bytes: f.pdf.byteLength,
        uploaded_by: dev,
        document_text: f.text,
        indexing_status: "processing",
      }))
    ),
    "documents"
  );

  // The decision ledger: the held meetings' carried motions (as adjourning
  // records them) and the AGM's resolutions (as recorded from its minutes).
  const decisions: Record<string, unknown>[] = [];
  for (const m of meetings.filter((x) => x.held)) {
    for (const it of m.agenda) {
      if (it.motion?.outcome !== "CARRIED" || it.text.toLowerCase().includes("adjourn")) continue;
      decisions.push({
        corporation_id: corpId,
        meeting_id: meetingIds.get(m.key),
        meeting_type: "council",
        agenda_item_id: it.id,
        title: it.text,
        description: it.background || null,
        category: it.cat,
        motion_text: it.motion.text,
        mover: it.motion.mover,
        seconder: it.motion.sec,
        decision_type: it.motion.dt,
        votes_for: it.motion.for,
        votes_against: it.motion.against,
        votes_abstain: it.motion.abstain,
        decided_at: at(m.date, m.adjourned!),
      });
    }
  }
  for (const r of agmResolutions(d)) {
    decisions.push({
      corporation_id: corpId,
      meeting_type: "agm",
      source: "historic_minutes",
      source_document_id: docIds.get("agm-minutes"),
      decided_at: at(d.agm, "20:30"),
      ...r,
    });
  }
  await check(admin.from("decisions").insert(decisions, { defaultToNull: false }), "decisions");

  // Someone asking to join: the new owner of unit 305.
  await check(
    admin.from("corporation_join_requests").insert({
      corporation_id: corpId,
      requested_by: id("marisol"),
      status: "pending",
      requested_at: new Date(now.getTime() - 26 * 3_600_000).toISOString(),
    }),
    "join request"
  );

  await indexDocuments(admin, corpId, files);
}

/** The fictional people with accounts, made once and shared by every demo strata. */
async function ensureCast(admin: SupabaseClient): Promise<Map<string, string>> {
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, email")
    .in("email", CAST.map((c) => c.email));
  const byEmail = new Map((profiles ?? []).map((p) => [p.email as string, p.id as string]));
  const out = new Map<string, string>();
  for (const c of CAST) {
    let userId = byEmail.get(c.email);
    if (!userId) {
      const { data, error } = await admin.auth.admin.createUser({
        email: c.email,
        email_confirm: true,
        user_metadata: { full_name: c.fullName },
      });
      if (error || !data.user) throw new Error(`Couldn't create ${c.fullName}: ${error?.message}`);
      userId = data.user.id;
    }
    out.set(c.key, userId);
  }
  await check(
    admin.from("demo_cast").upsert(CAST.map((c) => ({ user_id: out.get(c.key)!, part: c.part }))),
    "fictional people"
  );
  return out;
}

/**
 * Indexes the documents for the Stratasphere the way the indexer does
 * (PII stripped with this strata's roster, chunked, embedded), reusing
 * vectors already made for the same passages. If the embeddings service
 * can't be reached, the documents go to the ordinary indexer instead.
 */
async function indexDocuments(admin: SupabaseClient, corpId: string, files: Array<{ id: string; title: string; text: string }>) {
  try {
    const ctx = await loadStripContext(admin, corpId);
    const pieces = files.flatMap((f) => {
      const title = stripForCorporation(f.title, ctx);
      return chunkText(stripForCorporation(f.text, ctx)).map((chunk, i) => ({
        documentId: f.id,
        title,
        chunk,
        index: i,
        hash: createHash("sha256").update(chunk).digest("hex"),
      }));
    });

    const vectors = new Map<string, string>();
    const hashes = [...new Set(pieces.map((p) => p.hash))];
    for (let i = 0; i < hashes.length; i += 80) {
      const { data } = await admin.from("demo_kit_embeddings").select("text_hash, embedding").in("text_hash", hashes.slice(i, i + 80));
      for (const row of data ?? []) vectors.set(row.text_hash as string, row.embedding as string);
    }
    const missing = pieces.filter((p, i) => !vectors.has(p.hash) && pieces.findIndex((q) => q.hash === p.hash) === i);
    if (missing.length) {
      const made = await embed(missing.map((p) => p.chunk), "document");
      const rows = missing.map((p, i) => ({ text_hash: p.hash, embedding: toVectorLiteral(made[i]) }));
      rows.forEach((r) => vectors.set(r.text_hash, r.embedding));
      await admin.from("demo_kit_embeddings").upsert(rows, { onConflict: "text_hash", ignoreDuplicates: true });
    }

    const chunkRows = pieces.map((p) => ({
      scope: "corporation",
      corporation_id: corpId,
      document_id: p.documentId,
      title: p.title,
      chunk_text: p.chunk,
      embedding: vectors.get(p.hash)!,
      chunk_index: p.index,
    }));
    for (let i = 0; i < chunkRows.length; i += 100) {
      await check(admin.from("knowledge_chunks").insert(chunkRows.slice(i, i + 100)), "search index");
    }
    await check(
      admin
        .from("documents")
        .update({ indexing_status: "indexed", indexed_at: new Date().toISOString() })
        .in("id", files.map((f) => f.id)),
      "indexing status"
    );
  } catch (err) {
    console.error("[demo kit] indexing here failed, queued instead:", err instanceof Error ? err.message : err);
    await admin.from("documents").update({ indexing_status: "pending" }).in("id", files.map((f) => f.id));
    await queueDocumentIndexing(files.map((f) => f.id));
  }
}

/** The AGM's resolutions, for the decision ledger. */
function agmResolutions(d: KitDates) {
  return [
    {
      title: "Approval of the operating budget",
      category: "Budget",
      motion_text: `THAT the operating budget for the fiscal year ${longDate(d.fiscalStart)} to ${longDate(d.fiscalEnd)}, totalling $145,348 including a contribution of $10,000 to the contingency reserve fund, be approved.`,
      mover: "SL019",
      seconder: "SL022",
      decision_type: "MAJORITY",
      votes_for: 16,
      votes_against: 1,
      votes_abstain: 0,
    },
    {
      title: "Roof replacement special levy",
      category: "Special Business",
      motion_text: `BE IT RESOLVED BY A 3/4 VOTE THAT the owners approve a special levy of $380,000 to fund the replacement of the roof, shared by unit entitlement and payable in two equal instalments, due ${longDate(d.levyDue1)} and ${longDate(d.levyDue2)}.`,
      mover: "SL012",
      seconder: "SL005",
      decision_type: "THREE_QUARTER",
      votes_for: 15,
      votes_against: 2,
      votes_abstain: 0,
    },
    {
      title: "Short-term accommodation bylaw",
      category: "Bylaws",
      motion_text:
        "BE IT RESOLVED BY A 3/4 VOTE THAT the bylaws be amended to add Bylaw 10 prohibiting accommodation for periods of less than 90 consecutive days, with a maximum fine of $1,000 for each day of a contravention.",
      mover: "SL008",
      seconder: "SL022",
      decision_type: "THREE_QUARTER",
      votes_for: 14,
      votes_against: 3,
      votes_abstain: 0,
    },
    {
      title: "Ratification of rules",
      category: "Rules",
      motion_text: "THAT the rules made by council during the year (amenity room, bike room and e-bike charging) be ratified.",
      mover: "SL022",
      seconder: "SL012",
      decision_type: "MAJORITY",
      votes_for: 17,
      votes_against: 0,
      votes_abstain: 0,
    },
  ];
}

/** Minutes as text, for the Stratasphere (the PDF is what people see). */
function minutesText(m: MinutesContent): string {
  const lines = [
    `# Minutes: ${m.meeting.typeLabel}`,
    // No plan number: it differs per visitor, and the same text lets
    // every visitor's strata reuse the same search vectors.
    m.corporation.name,
    `Held ${longDate(m.meeting.date)}, ${m.meeting.location ?? ""}. Chair: ${m.meeting.chair ?? ""}.`,
    `Called to order at ${clockTime(m.meeting.calledToOrderAt, m.meeting.timezone)}.`,
    ...attendanceLines(m),
  ];
  for (const section of m.sections) {
    lines.push("", `## ${section.name}`);
    for (const it of section.items) {
      lines.push(`${it.num}. ${it.title}`);
      if (it.summary) lines.push(it.summary);
      if (it.motion?.text) {
        lines.push(`MOTION: ${it.motion.text}`);
        if (it.motion.outcome) lines.push(`Moved by ${it.motion.mover}, seconded by ${it.motion.seconder}. ${voteLine(it.motion)}. ${it.motion.outcome}.`);
      }
      if (it.deferred) lines.push("Deferred to a future meeting.");
    }
  }
  lines.push("", `Adjourned at ${clockTime(m.meeting.adjournedAt, m.meeting.timezone)}.`);
  return lines.join("\n");
}

function uploadedOn(doc: KitDoc, d: KitDates): string {
  const on: Record<string, string> = {
    bylaws: addDays(d.agm, 10),
    rules: addDays(d.agm, 10),
    budget: addDays(d.agm, 2),
    depreciation: addDays(d.depreciationReport, 20),
    insurance: addDays(d.insuranceStart, 5),
    "agm-minutes": addDays(d.agm, 12),
    "roof-assessment": addDays(d.roofAssessment, 3),
    janitorial: addDays(d.meeting1, 2),
    elevator: addDays(d.previousFiscalStart, 14),
    "parking-complaint": addDays(d.parkingComplaint, 1),
    "parking-warning": d.parkingWarning,
    barking: addDays(d.barkingComplaint, 6),
    "leak-report": addDays(d.leak, 12),
  };
  return on[doc.key] ?? addDays(d.today, -3);
}

function addDays(date: string, days: number) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** A Pacific wall-clock time on a date, as an instant. */
function at(date: string, time: string): string {
  for (const offset of ["-07:00", "-08:00"]) {
    const instant = new Date(`${date}T${time}:00${offset}`);
    const local = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Vancouver",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(instant);
    if (local === time) return instant.toISOString();
  }
  return new Date(`${date}T${time}:00-08:00`).toISOString();
}

async function check<T extends { error: { message: string } | null }>(op: PromiseLike<T>, what: string): Promise<T> {
  const result = await op;
  if (result.error) throw new Error(`Demo strata (${what}): ${result.error.message}`);
  return result;
}

