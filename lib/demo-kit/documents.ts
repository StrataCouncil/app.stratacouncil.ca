import { longDate, monthYear, monthsBetween, yearOf, type KitDates } from "./dates.ts";
import { BUILDING, MANAGEMENT, OWNERS, TOTAL_ENTITLEMENT, dollars, money, ownerOf } from "./people.ts";

/**
 * The demo strata's records (all fictional), as plain text with light
 * markup: "# " and "## " headings, "- " bullets, blank lines between
 * paragraphs. Each becomes a PDF in the Library and is indexed for the
 * Stratasphere. They tell connected stories the visitor can ask about: the
 * roof replacement and its special levy, a visitor-parking dispute, a
 * water leak and its insurance deductible, an EV charger request and a
 * barking dog. Pure.
 */

export type DocCategory =
  | "legal_governance"
  | "financial_accounting"
  | "insurance"
  | "meetings_records"
  | "building_construction"
  | "contracts_service_agreements"
  | "correspondence"
  | "agenda_attachments";

export interface KitDoc {
  key: string;
  title: string;
  category: DocCategory;
  fileName: string;
  docType: "bylaws" | "minutes" | "financial" | "correspondence" | "contract" | "policy" | "other";
  /** Uploaded AGM minutes: their resolutions go in the decision ledger. */
  sourceType?: "upload" | "historic_minutes" | "agenda_attachment";
  text: string;
}

/** The roof project's numbers, shared by the documents and the meetings. */
export const ROOF = {
  levy: 380_000,
  bids: [
    { name: "Coastline Roofing Ltd.", price: 348_600, warranty: "10-year workmanship, 20-year manufacturer membrane warranty", start: "April", weeks: 9, notes: "Complete scope, including new flashings, scuppers, roof drains and two skylights." },
    { name: "Summit Peak Roofing Inc.", price: 372_900, warranty: "5-year workmanship, 20-year manufacturer membrane warranty", start: "June", weeks: 11, notes: "Complete scope. Adds a $9,500 allowance for deck repairs not in the specification." },
    { name: "North Shore Membrane Co.", price: 319_800, warranty: "2-year workmanship, 15-year manufacturer membrane warranty", start: "April", weeks: 7, notes: "Excludes flashing replacement, the skylights and the building permit. Engineer estimates $36,000 to $42,000 to add them." },
  ],
  engineer: "Fraserview Building Science Ltd.",
  engineerFee: 9_800,
  fieldReview: 13_500,
};

/** Each lot's share of the roof levy, by unit entitlement. */
export const levyShare = (entitlement: number) => Math.round((ROOF.levy * entitlement * 100) / TOTAL_ENTITLEMENT) / 100;

export const ARREARS = { SL014: 1_240.0, SL009: 516.45 };
export const LEAK = { repairs: 31_400, deductible: 25_000 };

export function kitDocuments(d: KitDates, legalName: string): KitDoc[] {
  const fy = `${longDate(d.fiscalStart)} to ${longDate(d.fiscalEnd)}`;
  const fyShort = `${yearOf(d.fiscalStart)}/${yearOf(d.fiscalEnd).slice(2)}`;
  const coastline = ROOF.bids[0];
  const sl014 = ownerOf("SL014");
  const sl016 = ownerOf("SL016");
  const sl021 = ownerOf("SL021");
  const ytd = yearToDate(monthsBetween(d.fiscalStart, d.statementMonthStart) + 1);

  return [
    {
      key: "bylaws",
      title: "Bylaws (consolidated)",
      category: "legal_governance",
      fileName: "Larchwood Commons - Bylaws (consolidated).pdf",
      docType: "bylaws",
      text: `# Bylaws of ${legalName}
${BUILDING.name}, ${BUILDING.address}

Consolidated for convenience by ${MANAGEMENT.companyName}. These bylaws replace the Standard Bylaws, except where the Standard Bylaws are adopted by reference below. Amendments filed at the Land Title Office: 2014, 2019, and at the Annual General Meeting held ${longDate(d.agm)} (short-term accommodation).

## Division 1: Duties of owners, tenants, occupants and visitors

1.1 Payment of strata fees. An owner must pay strata fees on or before the first day of the month to which they relate. A late payment fee of $50 applies to any strata fee more than 30 days overdue. Interest on overdue strata fees accrues at 10% per year, compounded annually.

1.2 Repair and maintenance of property by owner. An owner must repair and maintain the owner's strata lot, except for repair and maintenance that is the responsibility of the strata corporation under these bylaws. An owner who has the use of limited common property, such as a balcony or patio, must repair and maintain it, except for repairs that ordinarily occur less often than once a year.

1.3 Use of property. An owner, tenant, occupant or visitor must not use a strata lot, the common property or common assets in a way that causes a nuisance or hazard to another person, causes unreasonable noise, or unreasonably interferes with the rights of other persons to use and enjoy the common property, common assets or another strata lot.

1.4 Quiet hours are 10:00 p.m. to 7:00 a.m. daily.

1.5 Inform strata corporation. Within two weeks of becoming an owner, an owner must inform the strata corporation of the owner's name, strata lot number and mailing address. An owner who rents a strata lot must give the tenant the current bylaws and rules and a Notice of Tenant's Responsibilities (Form K), and must give the strata corporation a copy of the signed Form K within two weeks of the tenancy starting.

1.6 Obtain approval before altering a strata lot. An owner must obtain the written approval of the strata corporation before making an alteration that involves the structure of the building, the exterior, chimneys, stairs, balconies or other things attached to the exterior, doors or windows on the exterior, fences or railings, common property located within the boundaries of a strata lot, or the plumbing, gas or electrical systems serving more than one strata lot.

## Division 2: Powers and duties of the strata corporation

2.1 Repair and maintenance of property by strata corporation. The strata corporation must repair and maintain common assets, common property, and the structure and exterior of the building, including roofs, exterior walls, windows, doors on the exterior, balconies and patios, and limited common property where repairs ordinarily occur less often than once a year.

2.2 Insurance. The strata corporation must obtain and maintain property insurance on a full replacement value basis, and liability insurance, as required by the Strata Property Act.

## Division 3: Council

3.1 Council size. The council must have at least 3 and not more than 7 members.

3.2 Council members' terms. The term of office of a council member ends at the end of the annual general meeting at which the new council is elected. A council member may stand for re-election.

3.3 Officers. At the first meeting of council held after each annual general meeting, council must elect from among its members a president, a vice president, a secretary and a treasurer. A person may not hold the offices of president and vice president at the same time.

3.4 Calling council meetings. Any council member may call a council meeting by giving the other council members at least one week's notice of the date, time and place of the meeting and the matters to be discussed, unless all council members agree to a shorter notice period.

3.5 Quorum of council. A quorum of the council is a majority of council members.

3.6 Requisition of council hearing. An owner or tenant may request a hearing at a council meeting by applying to the strata corporation in writing. If a hearing is requested, the council must hold a meeting to hear the applicant within one month of the request.

3.7 Electronic attendance. A council member may attend a council meeting by telephone or other electronic means if all council members and other participants can communicate with each other.

3.8 Spending limit. The council may approve an unbudgeted expenditure of up to $5,000 to address matters other than an emergency. An expenditure above that amount requires approval of the owners at a general meeting, unless it is necessary to ensure safety or prevent significant loss or damage.

3.9 Minutes. The council must inform owners of the minutes of all council meetings within two weeks of the meeting, whether or not the minutes are approved.

## Division 4: Enforcement of bylaws and rules

4.1 Maximum fine. The strata corporation may fine an owner or tenant a maximum of $200 for each contravention of a bylaw and $50 for each contravention of a rule, except a contravention of Bylaw 10 (short-term accommodation), for which the maximum fine is $1,000 for each day the contravention continues.

4.2 Continuing contravention. If an activity or lack of activity that constitutes a contravention of a bylaw or rule continues, without interruption, for longer than 7 days, a fine may be imposed every 7 days.

4.3 Before imposing a fine, the council must give the owner or tenant the particulars of the complaint in writing and a reasonable opportunity to answer the complaint, including a hearing if requested, as required by section 135 of the Strata Property Act.

## Division 5: Pets

5.1 An owner, tenant or occupant may keep no more than two pets in a strata lot, of which no more than one may be a dog. Fish or other small aquarium animals, and small caged mammals or birds, are not counted.

5.2 A pet on common property must be leashed or otherwise secured and under the control of a responsible person.

5.3 An owner, tenant or occupant must promptly clean up after their pet, and must not allow a pet to cause a nuisance, including persistent barking.

## Division 6: Parking

6.1 Each strata lot has the use of one parking stall in the parkade, as limited common property shown on the strata plan or assigned by council.

6.2 The four visitor stalls (V1 to V4) are for visitors only. A resident, tenant or occupant must not park in a visitor stall at any time.

6.3 A visitor vehicle may use a visitor stall for no more than 24 consecutive hours, and must display a visitor pass from the strata lot being visited.

6.4 A vehicle parked in contravention of this division may be towed at the owner's expense after written notice, or immediately if it obstructs access or creates a hazard.

6.5 No inoperative, unlicensed or uninsured vehicle may be stored on common property.

## Division 7: Electric vehicle charging

7.1 An owner may apply to council in writing for approval to install an electric vehicle charger serving the owner's parking stall. The application must include a quote and single-line drawing from a licensed electrician, and the proposed metering or cost-recovery method.

7.2 An owner who installs a charger with council approval must pay for its installation, operation, repair and eventual removal, sign an alteration and indemnity agreement in the form council approves, and ensure the installation is permitted and inspected.

7.3 The strata corporation may recover the cost of electricity used by a charger from the owner, through a separate meter or a fee set by council.

## Division 8: Renovations

8.1 Hard-surface flooring installed after ${yearOf(d.previousFiscalStart)} must be laid over an acoustic underlay with a rating of at least IIC 65 and STC 60, and the owner must provide the product specifications to council before installation.

8.2 Renovation work producing noise may be carried out only between 8:00 a.m. and 5:00 p.m. Monday to Friday and 10:00 a.m. to 4:00 p.m. on Saturdays.

8.3 An owner carrying out plumbing work must have the domestic water shut-off coordinated through the strata manager with at least 48 hours' notice to affected residents.

## Division 9: Insurance deductibles and chargebacks

9.1 An owner must notify the strata manager immediately of any leak, flood or damage originating in or affecting the owner's strata lot.

9.2 If an owner is responsible for loss or damage to common property, common assets or another strata lot, the owner must pay the cost of repairing the damage up to the amount of the strata corporation's insurance deductible, and that amount may be charged back to the owner's strata lot.

9.3 An owner is responsible for loss or damage under Bylaw 9.2 whether or not the owner was negligent, where the loss or damage originated in the owner's strata lot or from an appliance, fixture or plumbing serving only that strata lot.

9.4 Owners are encouraged to carry personal insurance that covers the strata corporation's deductibles, which are listed in the strata corporation's insurance summary available from the strata manager.

## Division 10: Short-term accommodation

10.1 A strata lot must not be used to provide accommodation for a period of less than 90 consecutive days, including through an online short-term rental platform.

10.2 A note on rentals: the strata corporation's former rental restriction bylaw (Bylaw 40, filed 2014) can no longer be enforced following the 2022 amendments to the Strata Property Act, and has been removed from this consolidation. Owners who rent must still comply with Bylaw 1.5.

## Division 11: Smoking

11.1 Smoking or vaping tobacco or cannabis is prohibited on common property, on limited common property including balconies and patios, and within 6 metres of any entrance, window or air intake of the building.

## Division 12: Moving in and out

12.1 An owner or tenant moving in or out must book the elevator through the strata manager at least 72 hours in advance and use the protective pads provided.

12.2 A move-in fee of $100 is payable by the owner of the strata lot for each move in, as permitted by the Strata Property Regulation.

## Division 13: Volunteers

13.1 Council members are not personally liable for anything done or omitted in good faith in the exercise of their powers or the performance of their duties as council members.
`,
    },
    {
      key: "rules",
      title: "Rules",
      category: "legal_governance",
      fileName: "Larchwood Commons - Rules.pdf",
      docType: "policy",
      text: `# Rules of ${BUILDING.name}
Made by council under section 125 of the Strata Property Act and ratified at the Annual General Meeting held ${longDate(d.agm)}.

## 1. Amenity room
- The amenity room may be booked through the strata manager for private events of up to 30 guests, from 9:00 a.m. to 10:00 p.m.
- A refundable $200 damage deposit is required. The room must be cleaned and the furniture returned to its place by the end of the booking.
- No more than two bookings per strata lot per month.

## 2. Gym
- The gym is open from 6:00 a.m. to 10:00 p.m.
- Children under 16 must be supervised by an adult resident.
- Wipe down equipment after use. Report broken equipment to the strata manager.

## 3. Bike room
- Bikes must be registered with the strata manager and display the registration sticker. Unregistered bikes may be removed after 30 days' notice.
- One bike rack space per assigned lot. E-bike batteries must not be charged in the bike room.

## 4. Garbage and recycling
- Garbage, mixed recycling, glass, soft plastics and organics go in their marked bins in the garbage room on P1.
- Boxes must be flattened. Large items, furniture and renovation waste must be removed by the resident and may not be left in the garbage room.
- Collection days: garbage Tuesdays, recycling and organics Fridays.

## 5. Visitor parking
- Residents must not use visitor stalls (Bylaw 6.2).
- Visitors must display a visitor pass, available from the strata manager, two per strata lot.

## 6. Balconies
- Barbecues: electric or propane only, with tanks no larger than 20 lb. No charcoal.
- Nothing may be hung from railings. Planters must have drip trays.

## 7. Fines
The maximum fine for each contravention of a rule is $50 (Bylaw 4.1).
`,
    },
    {
      key: "budget",
      title: `Operating budget ${fyShort}`,
      category: "financial_accounting",
      fileName: `Larchwood Commons - Operating budget ${fyShort}.pdf`,
      docType: "financial",
      text: `# Operating budget for the fiscal year ${fy}
Approved by majority vote at the Annual General Meeting held ${longDate(d.agm)}.

## Revenue
- Strata fee contributions: $142,848
- Amenity room rentals: $600
- Move-in fees: $800
- Interest income: $1,100
- Total revenue: $145,348

## Operating expenses
- Strata management fees (${MANAGEMENT.companyName}): $13,800
- Insurance premium: $38,600
- Electricity (common areas): $9,200
- Natural gas (domestic hot water): $6,400
- Water and sewer: $11,800
- Garbage and recycling: $5,900
- Janitorial (Cedar Clean Services): $14,400
- Landscaping: $7,200
- Elevator maintenance (Pacific Lift Services): $4,800
- Fire safety inspections and monitoring: $3,600
- Repairs and maintenance: $9,500
- Window cleaning: $2,200
- Security and entry system: $1,500
- Legal and professional: $2,000
- Bank charges and administration: $600
- Contingency: $3,848
- Total operating expenses: $135,348

## Contingency reserve fund
- Contribution to the contingency reserve fund: $10,000
- Contingency reserve fund balance at the start of the fiscal year: $186,400
- The contribution keeps the fund in line with the depreciation report's recommended funding plan (see "Depreciation report summary").

## Strata fees
Strata fees are shared by unit entitlement (total ${TOTAL_ENTITLEMENT}). Monthly fees for the year:
- One-bedroom homes (unit entitlement 65): ${money(OWNERS.find((o) => o.entitlement === 65)!.fee)}
- Two-bedroom homes (unit entitlement 85): ${money(OWNERS.find((o) => o.entitlement === 85)!.fee)}
- Two-bedroom and den homes (unit entitlement 95): ${money(OWNERS.find((o) => o.entitlement === 95)!.fee)}

## Roof replacement special levy
Separate from the operating budget: a special levy of ${dollars(ROOF.levy)} approved by 3/4 vote at the same meeting, shared by unit entitlement and payable in two equal instalments, due ${longDate(d.levyDue1)} and ${longDate(d.levyDue2)}. Each lot's share: ${money(levyShare(65))} (entitlement 65), ${money(levyShare(85))} (entitlement 85), ${money(levyShare(95))} (entitlement 95).
`,
    },
    {
      key: "depreciation",
      title: "Depreciation report summary",
      category: "financial_accounting",
      fileName: "Larchwood Commons - Depreciation report summary.pdf",
      docType: "financial",
      text: `# Depreciation report summary
Prepared by Westridge Reserve Planning Inc., ${monthYear(d.depreciationReport)}. Summary prepared by the strata manager for owners; the full report (86 pages) is available on request.

The report covers ${BUILDING.name}, built in ${BUILDING.built}: ${BUILDING.description}. It is based on a site visit, the strata plan and the maintenance records, and gives three funding models for the contingency reserve fund over 30 years. The Strata Property Act requires an updated depreciation report every five years.

## Major components and when they are expected to need work
- Roof membrane (2-ply SBS, ${BUILDING.built}): estimated service life 18 to 20 years; replacement recommended within 2 years. Estimated cost $340,000 to $395,000 including flashings and skylights.
- Exterior sealants and caulking: renew within 3 years, about $28,000.
- Exterior paint (fibre cement and trim): repaint within 4 years, about $96,000.
- Windows and sliding doors (vinyl, ${BUILDING.built}): service life 30 years; plan for replacement in about 12 years, about $610,000.
- Parkade membrane and traffic coating: renew within 5 years, about $74,000.
- Domestic hot water boilers (2): replace in 4 to 6 years, about $62,000.
- Elevator modernization: in about 10 years, about $185,000.
- Fire alarm panel: replace in about 7 years, about $38,000.
- Enterphone and access control: replace within 2 years, about $14,000.
- Corridor carpet and paint: renew within 2 years, about $58,000.

## Funding models
- Current funding ($10,000 a year): the fund cannot pay for the roof; a special levy would be needed.
- Recommended model: a roof special levy now, then contributions rising to $24,000 a year over five years, with smaller special levies likely for the windows.
- Fully funded model: contributions of about $71,000 a year, with no special levies.

## Council note
Council adopted the recommended model. Owners approved the roof special levy at the Annual General Meeting held ${longDate(d.agm)}.
`,
    },
    {
      key: "insurance",
      title: "Insurance summary and certificate",
      category: "insurance",
      fileName: "Larchwood Commons - Insurance summary.pdf",
      docType: "other",
      text: `# Summary of insurance coverage
${legalName}, ${BUILDING.address}
Policy period: ${longDate(d.insuranceStart)} to ${longDate(d.insuranceEnd)}
Broker: Pacific Shorelines Insurance Brokers Ltd. Insurers: a subscription of Canadian insurers led by Fraser Mutual Assurance.

## Coverage
- Property, all risks, full replacement value: $14,850,000 (from the replacement cost appraisal completed this year)
- Equipment breakdown: $14,850,000
- Commercial general liability: $10,000,000 per occurrence
- Directors and officers liability (council members): $5,000,000
- Crime (employee dishonesty, including the management company): $100,000
- Volunteer accident: included

## Deductibles
- All risks (unless listed below): $5,000
- Water damage: $25,000
- Sewer backup: $25,000
- Flood: $50,000
- Earthquake: 15% of the loss, minimum $250,000

## Notes for owners
- The strata corporation's policy covers the building, including original fixtures and finishes inside strata lots. It does not cover owners' contents, betterments and improvements, or personal liability.
- Under Bylaw 9.2, an owner responsible for a loss may have to pay up to the deductible, for example $25,000 for water damage. Owners should ask their own insurer for coverage of strata deductibles (including the earthquake deductible, which is shared by unit entitlement).
- Report any damage to the strata manager immediately.
- The Strata Property Act requires the strata corporation to review its insurance coverage at each annual general meeting and to tell owners promptly of any material change.
`,
    },
    {
      key: "agm-minutes",
      title: `Minutes - Annual General Meeting, ${longDate(d.agm)}`,
      category: "meetings_records",
      fileName: `Larchwood Commons - AGM minutes ${d.agm}.pdf`,
      docType: "minutes",
      sourceType: "historic_minutes",
      text: `# Minutes of the Annual General Meeting
${legalName}, ${BUILDING.name}
Held ${longDate(d.agm)} at 7:00 p.m. in the amenity room, with electronic attendance available.

## 1. Call to order
The meeting was called to order at 7:04 p.m. by ${MANAGEMENT.manager.name} of ${MANAGEMENT.companyName}, who chaired at the request of council.

## 2. Certification of proxies and quorum
17 strata lots were represented, 13 in person or electronically and 4 by proxy. Quorum (one third of 24 lots, 8) was confirmed.

## 3. Proof of notice
The notice package was sent ${longDate(isoMinusDays(d.agm, 21))}, more than the two weeks' notice required by the Strata Property Act. Proof of notice was accepted.

## 4. Approval of the agenda
Moved by SL012, seconded by SL008: THAT the agenda be approved as circulated. CARRIED unanimously.

## 5. Approval of the previous AGM minutes
Moved by SL005, seconded by SL019: THAT the minutes of the previous Annual General Meeting be approved. CARRIED unanimously.

## 6. Council report
The president reported on the year: the replacement cost appraisal and depreciation report were completed; the roof condition assessment by ${ROOF.engineer} confirmed the membrane is at the end of its life, with active leaks repaired twice over the winter above units 404 and 405; the parkade sump pump was replaced; and the enterphone was repaired.

## 7. Insurance report
The strata manager reviewed the insurance summary, including the $25,000 water damage deductible and the earthquake deductible, and reminded owners to check their personal coverage for strata deductibles.

## 8. Resolution 1: Approval of the operating budget (majority vote)
Moved by SL019, seconded by SL022: THAT the operating budget for the fiscal year ${fy}, totalling $145,348 including a contribution of $10,000 to the contingency reserve fund, be approved.
VOTE: 16 in favour, 1 opposed. CARRIED.

## 9. Resolution 2: Roof replacement special levy (3/4 vote)
Moved by SL012, seconded by SL005: BE IT RESOLVED BY A 3/4 VOTE THAT the owners approve a special levy of ${dollars(ROOF.levy)} to fund the replacement of the roof, including engineering, permits and a contingency, shared by unit entitlement and payable in two equal instalments, due ${longDate(d.levyDue1)} and ${longDate(d.levyDue2)}. Any money not used for the roof will be returned to owners by unit entitlement, or kept in the contingency reserve fund if it is less than $100 for each strata lot.
Owners discussed the three-instalment option and the cost of delay; the engineer's assessment estimated $18,000 to $30,000 a year in leak repairs if replacement were deferred.
VOTE: 15 in favour, 2 opposed. CARRIED (more than three quarters of the votes cast).

## 10. Resolution 3: Short-term accommodation bylaw (3/4 vote)
Moved by SL008, seconded by SL022: BE IT RESOLVED BY A 3/4 VOTE THAT the bylaws be amended to add Bylaw 10 prohibiting accommodation for periods of less than 90 consecutive days, and Bylaw 4.1 be amended to set a maximum fine of $1,000 for each day of a contravention of Bylaw 10.
VOTE: 14 in favour, 3 opposed. CARRIED. The amendment will be filed at the Land Title Office.

## 11. Ratification of rules
Moved by SL022, seconded by SL012: THAT the rules made by council during the year (amenity room, bike room and e-bike charging) be ratified. CARRIED unanimously.

## 12. Election of council
Five owners were nominated for five positions and were elected by acclamation: Margaret Chen-Whitford (SL012), Tomasz Kowalczyk (SL005), Adaeze Okafor (SL019), Liam Fraser (SL008) and Ruth Gallagher (SL022). Council will elect its officers at its first meeting.

## 13. New business
An owner asked about electric vehicle charging in the parkade. Council will report on options during the year; any owner may apply under Bylaw 7.

## 14. Adjournment
The meeting was adjourned at 8:46 p.m.
`,
    },
    {
      key: "roof-assessment",
      title: "Roof condition assessment",
      category: "building_construction",
      fileName: "Larchwood Commons - Roof condition assessment.pdf",
      docType: "other",
      text: `# Roof condition assessment
Prepared for ${legalName} by ${ROOF.engineer}, ${longDate(d.roofAssessment)}.

## Scope
Visual review of the main roof (about 1,450 square metres), roof drains, scuppers, flashings, the two skylights over the fourth-floor corridor, and the mechanical curbs; moisture survey; two test cuts.

## Findings
- The 2-ply SBS membrane is original (${BUILDING.built}). Granule loss is widespread, with blistering and open laps at the north and west parapets.
- Test cut 1 (above unit 404) found wet insulation over about 6 square metres. Test cut 2 (centre field) was dry.
- Base flashings at the elevator penthouse have pulled away from the wall in two places, the likely source of the leaks above units 404 and 405.
- Two of the five roof drains have cracked clamping rings. The skylights' seals have failed and one unit is fogged.
- The membrane is at the end of its service life. Patching will become less effective and more frequent.

## Recommendations
1. Replace the roof assembly within 12 to 24 months: remove the membrane and wet insulation, install new tapered insulation, a 2-ply SBS membrane, new flashings, drains, scuppers and skylights.
2. Budget $340,000 to $395,000 including GST, a 10% contingency and engineering field review.
3. Until replacement, carry out semi-annual inspections and repair the penthouse flashings now (about $3,500).
4. Tender the work to at least three qualified contractors on a stipulated price contract (CCDC 2) with a performance bond.

${ROOF.engineer} can prepare the specification and manage the tender for a fixed fee of ${dollars(ROOF.engineerFee)} plus GST, with field review during construction estimated at ${dollars(ROOF.fieldReview)} plus GST.
`,
    },
    {
      key: "janitorial",
      title: "Janitorial services agreement (summary)",
      category: "contracts_service_agreements",
      fileName: "Larchwood Commons - Janitorial agreement.pdf",
      docType: "contract",
      text: `# Janitorial services agreement: summary
Between ${legalName} and Cedar Clean Services Ltd. Renewal approved by council on ${longDate(d.meeting1)}.

- Term: two years from the first of the month after approval. Either party may end the agreement on 60 days' written notice.
- Fee: $1,200 a month plus GST (unchanged from the previous term).
- Service: two visits a week. Lobby, elevator and corridors vacuumed and dusted; entrance glass cleaned; garbage room swept and washed; gym and amenity room cleaned; parkade entrance and stairwells swept weekly.
- Extras at hourly rates: carpet shampoo ($0.28 a square foot), move-related cleaning, graffiti removal.
- Insurance: the contractor carries $5,000,000 liability insurance and WorkSafeBC coverage, with certificates on file with the strata manager.
- Contact for issues: the strata manager, not the cleaners directly.
`,
    },
    {
      key: "elevator",
      title: "Elevator maintenance agreement (summary)",
      category: "contracts_service_agreements",
      fileName: "Larchwood Commons - Elevator maintenance agreement.pdf",
      docType: "contract",
      text: `# Elevator maintenance agreement: summary
Between ${legalName} and Pacific Lift Services Inc.

- Type: full maintenance, including parts and labour for covered components, monthly preventive maintenance and the annual safety test required by Technical Safety BC.
- Fee: $400 a month plus GST, adjusted each year by the BC consumer price index.
- Term: five years, ending ${longDate(isoPlusDays(d.fiscalEnd, 730))}. Automatic renewal unless either party gives 90 days' written notice before the end of the term.
- Response times: entrapment calls 1 hour, 24 hours a day; other service calls next business day.
- Exclusions: damage from misuse or vandalism, flooding, and modernization or code upgrades required by Technical Safety BC.
- Council note: the depreciation report expects modernization in about 10 years. Before the term ends, the strata manager will get competing quotes, since the automatic renewal clause applies.
`,
    },
    {
      key: "parking-complaint",
      title: "Letter: visitor parking complaint",
      category: "correspondence",
      fileName: "Letter - visitor parking complaint.pdf",
      docType: "correspondence",
      text: `# Letter to council
From Eleanor Vance, unit 106 (SL006)
Date: ${longDate(d.parkingComplaint)}
To: The strata council, care of ${MANAGEMENT.manager.name}

Dear council,

For most of the last month, a silver hatchback has been parked in visitor stall V2 every night and most weekends. I believe it belongs to the tenants in unit 302. My daughter visits on Sundays to help me with groceries and has not been able to find a visitor stall three weeks in a row, and the stalls are often all taken by residents' second cars.

Our bylaws say residents can't use visitor parking at all. Could council please enforce this? I'm happy to send photos with dates if that helps.

Thank you,
Eleanor Vance
`,
    },
    {
      key: "parking-warning",
      title: "Letter: bylaw contravention notice, visitor parking (SL014)",
      category: "correspondence",
      fileName: "Letter - bylaw contravention notice SL014.pdf",
      docType: "correspondence",
      text: `# Notice of bylaw contravention
From ${MANAGEMENT.manager.name}, ${MANAGEMENT.companyName}, on behalf of the strata council
Date: ${longDate(d.parkingWarning)}
To: ${sl014.name}, owner of strata lot 14 (unit 302), and the tenants of unit 302

Re: Bylaws 6.2 and 6.3, visitor parking

Council has received a complaint, with dated photographs, that a silver Honda Fit (licence plate ending 4KD) registered to the occupants of unit 302 has been parked in visitor stall V2 overnight on at least 14 nights in the past four weeks.

Bylaw 6.2 says residents, tenants and occupants must not park in a visitor stall at any time. Unit 302 has the use of parking stall P1-14.

At its meeting on ${longDate(d.meeting1)}, council directed that this letter be sent as a warning. No fine is being imposed at this time. If the contravention continues, council may consider fines of up to $200 under Bylaw 4.1, which may be imposed every 7 days for a continuing contravention (Bylaw 4.2), and may have the vehicle towed under Bylaw 6.4.

Owners are responsible for their tenants' compliance with the bylaws. Please share this letter with your tenants. If you or your tenants would like to respond, please write to me within 14 days.

Sincerely,
${MANAGEMENT.manager.name}, ${MANAGEMENT.manager.title}
`,
    },
    {
      key: "barking",
      title: "Letters: barking dog complaints (unit 104)",
      category: "correspondence",
      fileName: "Letters - barking dog complaints.pdf",
      docType: "correspondence",
      text: `# Complaints about a barking dog in unit 104

## Letter 1
From Fatima Haddad, unit 103 (SL003), ${longDate(d.barkingComplaint)}

To the council: The dog in unit 104 barks for long stretches on weekdays, usually from about 8:30 a.m. until early afternoon, when I assume the owner is at work. I work from home and it has become very difficult to take calls. I have spoken to the owner once and he was apologetic, but nothing has changed. I'm keeping a log of dates and times, which I can send.

## Letter 2
From Kwame Mensah, unit 204 (SL010), ${longDate(isoPlusDays(d.barkingComplaint, 3))}

Hello Dev, I'd like to add my voice to the complaint about the barking from 104. It carries up through the balcony. It's every weekday. I don't want anyone to get in trouble, but could the strata please ask the owner to do something about it?

## Strata manager's note
A courtesy letter was sent to the owner of unit 104 (SL004), Bryce Whitaker, citing Bylaws 1.3 and 5.3, on ${longDate(isoPlusDays(d.barkingComplaint, 6))}. The owner replied that he has hired a dog walker for weekdays starting next month and asked for patience. Council will review at its next meeting.
`,
    },
    {
      key: "leak-report",
      title: "Incident report: water leak from unit 304 into 204",
      category: "correspondence",
      fileName: "Incident report - water leak 304 to 204.pdf",
      docType: "other",
      text: `# Incident report: water leak
Prepared by ${MANAGEMENT.manager.name}, ${MANAGEMENT.companyName}

- Date of loss: ${longDate(d.leak)}, discovered at about 6:40 a.m.
- Source: failed braided supply line to the dishwasher in unit 304 (SL016, owner ${sl016.name}). The line was original to the building.
- Damage: kitchen and hallway flooring and lower cabinets in unit 304; ceiling drywall, insulation, kitchen cabinets and flooring in unit 204 (SL010, owner Kwame Mensah); corridor ceiling outside 204.
- Response: the emergency restoration contractor (Tri-City Restoration) attended within 90 minutes, shut off the water, extracted water and installed drying equipment for five days.

## Costs
- Emergency response and drying: $6,850
- Repairs to unit 204 (drywall, insulation, cabinets, flooring, paint): $18,900
- Repairs to unit 304 (original flooring and cabinets only): $4,250
- Corridor ceiling repair: $1,400
- Total: ${dollars(LEAK.repairs)}

## Insurance
A claim was opened under the strata corporation's policy. The water damage deductible is ${dollars(LEAK.deductible)}, so the insurer's share is $6,400. The strata corporation pays the deductible first, from the operating fund.

Under Bylaw 9.2 and 9.3, an owner whose strata lot is the source of a loss is responsible for repair costs up to the deductible, whether or not the owner was negligent. Council will decide whether to charge back the deductible to strata lot 16.
`,
    },
    {
      key: "statement",
      title: `Financial statement, ${monthYear(d.statementMonthStart)}`,
      category: "financial_accounting",
      fileName: `Financial statement - ${monthYear(d.statementMonthStart)}.pdf`,
      docType: "financial",
      text: `# Financial statement: ${monthYear(d.statementMonthStart)}
${legalName}. Prepared by ${MANAGEMENT.assistant.name}, ${MANAGEMENT.companyName}. Fiscal year ${fy}.

## Operating fund, year to date (unaudited), ${ytd.months} months
- Strata fees received: ${dollars(ytd.fees)} (budget to date ${dollars(ytd.fees)})
- Other income: ${dollars(ytd.otherIncome)} (budget ${dollars(ytd.otherBudget)})
- Total income: ${dollars(ytd.income)}
- Insurance: ${dollars(ytd.insurance)} (budget ${dollars(ytd.insurance)})
- Utilities (electricity, gas, water and sewer, garbage): ${dollars(ytd.utilities)} (budget ${dollars(ytd.utilitiesBudget)})
- Janitorial and landscaping: ${dollars(ytd.services)} (budget ${dollars(ytd.services)})
- Repairs and maintenance: ${dollars(ytd.repairs)} (budget ${dollars(ytd.repairsBudget)}). Over budget because of the roof flashing repairs ($3,480) and the leak response.
- Water leak, unit 304 to 204: ${dollars(LEAK.deductible)} deductible paid (not budgeted); recovery to be decided by council.
- Management, elevator, fire safety, professional and other contracts: ${dollars(ytd.admin)} (budget ${dollars(ytd.admin)})
- Total expenses: ${dollars(ytd.expenses)}
- Operating ${ytd.income >= ytd.expenses ? "surplus" : "deficit"} to date: ${dollars(Math.abs(ytd.income - ytd.expenses))}, mainly the leak deductible. If the deductible is charged back and paid, the operating fund returns to about budget.

## Contingency reserve fund
- Balance at the start of the year: $186,400
- Contributions to date: ${dollars(ytd.crfIn)}
- Interest: ${dollars(ytd.crfInterest)}
- Spent: roof specification and tender (${ROOF.engineer}): $10,290 including GST, approved ${longDate(d.meeting1)}
- Balance: ${dollars(186_400 + ytd.crfIn + ytd.crfInterest - 10_290)}

## Roof special levy
- Levy: ${dollars(ROOF.levy)}. First instalment (${dollars(ROOF.levy / 2)}) due ${longDate(d.levyDue1)}.
- Received: $183,617 of the first instalment. Outstanding: SL014 (${money(levyShare(85) / 2)}, payment plan agreed), SL009 (part payment).
- Held in a separate savings account at 3.1% interest.

## Receivables (strata fees over 30 days)
- SL014 (unit 302): ${money(ARREARS.SL014)}, two months' fees plus a $50 late fee. Demand letter sent under section 112 of the Strata Property Act, as directed on ${longDate(d.meeting2)}.
- SL009 (unit 203): ${money(ARREARS.SL009)}, one month's fees. Owner says payment is being sent.
`,
    },
    {
      key: "tender",
      title: "Roof tender comparison and engineer's recommendation",
      category: "building_construction",
      fileName: "Roof tender comparison and recommendation.pdf",
      docType: "other",
      text: `# Roof replacement: tender comparison and recommendation
From ${ROOF.engineer} to the council of ${legalName}. Tender closed ${longDate(d.tenderClose)}.

Three of the five invited contractors submitted stipulated price tenders on the CCDC 2 contract, with bid bonds.

${ROOF.bids
  .map(
    (b) => `## ${b.name}
- Tender price: ${dollars(b.price)} plus GST
- Warranty: ${b.warranty}
- Earliest start: ${b.start}; duration ${b.weeks} weeks
- ${b.notes}`
  )
  .join("\n\n")}

## Analysis
North Shore Membrane Co. is lowest on price but excludes the flashings, skylights and permit, which are essential to the specification. Adding them would bring its price to about $356,000 to $362,000, above Coastline's, with a shorter workmanship warranty.

Summit Peak Roofing's tender is complete but ${dollars(ROOF.bids[1].price - coastline.price)} higher than Coastline's, with a shorter workmanship warranty and a later start.

Coastline Roofing Ltd. submitted a complete, compliant tender. References for three comparable wood-frame projects in the Tri-Cities were satisfactory, and it holds a WorkSafeBC clearance letter and a performance bond from a surety.

## Budget check
- Coastline tender: ${dollars(coastline.price)}
- GST (5%): ${dollars(coastline.price * 0.05)}
- Engineering field review: ${dollars(ROOF.fieldReview)}
- Total: ${dollars(coastline.price * 1.05 + ROOF.fieldReview)}, within the ${dollars(ROOF.levy)} special levy, leaving about ${dollars(ROOF.levy - coastline.price * 1.05 - ROOF.fieldReview)} for unforeseen deck repairs.

## Recommendation
We recommend that council award the contract to Coastline Roofing Ltd. for ${dollars(coastline.price)} plus GST, with work to start in ${coastline.start} so the roof is closed in before the fall rains.
`,
    },
    {
      key: "coastline",
      title: "Coastline Roofing proposal summary",
      category: "building_construction",
      fileName: "Coastline Roofing - proposal summary.pdf",
      docType: "contract",
      text: `# Coastline Roofing Ltd.: proposal summary
Prepared for ${legalName}

- Price: ${dollars(coastline.price)} plus GST, stipulated price on CCDC 2 with the engineer's supplementary conditions.
- Scope: remove the existing 2-ply SBS roof and wet insulation; supply and install tapered insulation and a new 2-ply SBS membrane; new pre-finished metal flashings and parapet caps; replace five roof drains and two scuppers; replace the two corridor skylights; obtain the City of Port Moody building permit.
- Schedule: ${coastline.weeks} weeks from mobilization, weather permitting. Work Monday to Friday, 7:30 a.m. to 4:30 p.m. A crane will lift materials on two Saturdays, with notice to residents.
- Unit prices for unforeseen work: deck replacement $95 a square metre; additional wet insulation $42 a square metre.
- Warranty: 10-year workmanship warranty; 20-year manufacturer membrane warranty on completion and inspection.
- Bonds and insurance: 50% performance bond and 50% labour and material payment bond; $5,000,000 general liability; WorkSafeBC in good standing.
- Holdback: 10% under the Builders Lien Act, released 55 days after substantial completion.
- Residents: the contractor will post weekly notices, keep the fourth-floor corridor clear and provide temporary protection under the skylights.
`,
    },
    {
      key: "hearing-request",
      title: "Letter: hearing request, water damage chargeback (SL016)",
      category: "correspondence",
      fileName: "Letter - hearing request SL016.pdf",
      docType: "correspondence",
      text: `# Request for a hearing
From ${sl016.name}, owner of unit 304 (strata lot 16)
Date: ${longDate(d.hearingRequest)}
To: The strata council, care of ${MANAGEMENT.manager.name}

Dear council,

I received the strata's letter telling me that council intends to charge back the ${dollars(LEAK.deductible)} water damage deductible to my strata lot because of the leak from my dishwasher supply line on ${longDate(d.leak)}.

I am requesting a hearing before council makes a final decision. I would like council to consider that:
- the supply line was original to the building, installed by the developer in ${BUILDING.built}, and I had no reason to think it needed replacing;
- I was not home overnight and could not have known about the leak sooner;
- my own insurer has told me my policy covers only $10,000 of a strata deductible, and paying the rest at once would be a hardship while I am also paying my share of the roof levy.

If council decides I am responsible, I ask that I be allowed to pay the balance over 12 months.

Sincerely,
${sl016.name}
`,
    },
    {
      key: "parking-response",
      title: "Letter: response to visitor parking notice (SL014)",
      category: "correspondence",
      fileName: "Letter - response to parking notice SL014.pdf",
      docType: "correspondence",
      text: `# Response to bylaw notice
From ${sl014.name}, owner of strata lot 14 (unit 302)
Date: ${longDate(d.parkingResponse)}
To: ${MANAGEMENT.manager.name}

Hi Dev,

I received the notice about council considering fines for my tenants' use of visitor parking. I live in Calgary and rent unit 302 to a couple who both commute, and they have two cars but only one stall.

I've spoken to them again. They tell me they now park the second car on the street most nights, but that the street is full on weekends. Could the strata rent them one of the unused stalls? I understand stall P1-23 has been empty since the owner of 405 sold their car. I'm happy to pay a monthly fee for it.

I'd ask council to hold off on any fine while this is looked at. I also want to confirm I'm catching up on my strata fees; a payment is being sent this week.

Regards,
${sl014.name}
`,
    },
    {
      key: "ev-request",
      title: "Letter: EV charger installation request (SL021)",
      category: "correspondence",
      fileName: "Letter - EV charger request SL021.pdf",
      docType: "correspondence",
      text: `# Application to install an electric vehicle charger
From ${sl021.name}, owner of unit 403 (strata lot 21)
Date: ${longDate(d.evRequest)}
To: The strata council

Dear council,

Under Bylaw 7.1, I am applying for approval to install a Level 2 electric vehicle charger at my parking stall, P1-21. I attach a quote and single-line drawing from Brightline Electric Ltd.

## Summary of the quote
- Supply and install a 40-amp, 240-volt circuit from the parkade electrical room to stall P1-21, about 38 metres of conduit, with a dedicated sub-meter: $3,450 plus GST.
- Supply and install a 9.6 kW smart charger with load management: $1,180 plus GST.
- Permit and inspection by Technical Safety BC: included.
- The electrician has confirmed there is spare capacity at the main panel for one 40-amp circuit, but recommends an EV-ready load study before more owners install chargers.

I will pay all costs of installation, electricity (through the sub-meter) and future removal, and sign the strata's alteration and indemnity agreement. I'd also support the strata looking at an EV-ready plan for the whole parkade so this is done fairly for everyone.

Thank you,
${sl021.name}
`,
    },
  ];
}

function isoPlusDays(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
const isoMinusDays = (date: string, days: number) => isoPlusDays(date, -days);

/** The operating fund after some months of the fiscal year, from the budget. */
export function yearToDate(monthsIn: number) {
  const m = Math.min(12, Math.max(1, monthsIn));
  const share = (annual: number) => Math.round((annual * m) / 12);
  const fees = share(142_848);
  const otherBudget = share(2_500);
  const otherIncome = otherBudget + 157;
  const insurance = share(38_600);
  const utilitiesBudget = share(33_300);
  const utilities = Math.round(utilitiesBudget * 1.0275);
  const services = share(21_600);
  const repairsBudget = share(9_500);
  const repairs = repairsBudget + 3_480 + 1_120;
  // Management, legal, bank, elevator, fire safety, window cleaning, security, contingency.
  const admin = share(13_800 + 2_000 + 600 + 4_800 + 3_600 + 2_200 + 1_500 + 3_848);
  const expenses = insurance + utilities + services + repairs + admin + LEAK.deductible;
  const income = fees + otherIncome;
  return {
    months: m,
    fees,
    otherBudget,
    otherIncome,
    income,
    insurance,
    utilitiesBudget,
    utilities,
    services,
    repairsBudget,
    repairs,
    admin,
    expenses,
    crfIn: share(10_000),
    crfInterest: 340 * m,
  };
}
