-- Council Training blueprints (2026-10-06).
--
-- training_modules.blueprint: what a module teaches, step by step, in
-- order ([{topic, teach, activity}]). It's the progression of knowledge
-- from established director training, adapted to BC law and terms. AI
-- drafting turns each step into a slide or two and teaches nothing
-- outside it; authors edit it in Module settings.
--
-- Blueprints say what to teach, not the facts: numbers, deadlines and
-- thresholds come from the Legislation Library when slides are written.
-- Only empty blueprints are filled in. Safe to re-run. Paste the whole
-- file into an empty SQL editor tab.

alter table public.training_modules add column if not exists blueprint jsonb not null default '[]'::jsonb;

with seed (curriculum_key, blueprint) as (values
-- ── Strata Basics ──────────────────────────────────────────────────────
('sb1', '[
 {"topic": "What a strata is", "activity": "none", "teach": "\"Strata\" is a type of real estate: land and buildings divided into strata lots that people own, plus property they share. The word is also used as a short name for the strata corporation that runs it."},
 {"topic": "How a strata is created", "activity": "none", "teach": "A strata is created under the Strata Property Act. The strata corporation comes into existence when the owner developer deposits a strata plan at the Land Title Office. From then on, owners and council are bound by the Act, the Strata Property Regulation and the strata''s bylaws."},
 {"topic": "How a strata is created", "activity": "accordion", "teach": "What is filed: the strata plan, a set of drawings showing each strata lot and its boundaries, the common property and any limited common property; and the schedule of unit entitlement that comes with it. A strata may be purpose-built, or created by converting an existing building."},
 {"topic": "How a strata is created", "activity": "knowledge_check", "teach": "Check: when does a strata corporation come into existence? (When the strata plan is deposited at the Land Title Office; not when the first lot sells or when building plans are approved.)"},
 {"topic": "Strata lots and common property", "activity": "flip_cards", "teach": "Strata lots are the parts that can be bought and sold: usually homes, sometimes commercial units, and in some stratas parking or storage. Common property is everything that isn''t part of a strata lot, such as hallways, elevators, driveways and amenity rooms. Limited common property is common property set aside for one or more lots, such as a balcony or a parking stall."},
 {"topic": "Strata lots and common property", "activity": "knowledge_check", "teach": "Check: tell a strata lot, common property and limited common property apart in an everyday example."},
 {"topic": "Who owns what", "activity": "none", "teach": "Each owner owns their own strata lot. Common property is owned by all the owners together, in shares based on unit entitlement. Strata fees for running and maintaining the strata are shared out by unit entitlement too. Common assets, such as money in the strata''s accounts and equipment, belong to the strata corporation."},
 {"topic": "Who owns what", "activity": "none", "teach": "Right of entry: the strata may need to enter a strata lot to inspect, repair or maintain common property, or what it''s responsible for inside the lot, and in an emergency such as a leak or fire. The bylaws set the notice owners get; in an emergency no notice is needed."},
 {"topic": "Who owns what", "activity": "knowledge_check", "teach": "Check: does the strata always have to give notice before entering a strata lot? (No: notice is required for routine entry, but not in an emergency.)"},
 {"topic": "Types of strata in BC", "activity": "accordion", "teach": "The main kinds: building stratas (apartments and townhouses, the most common); bare land stratas (the lots are land, and owners usually look after their own homes); phased stratas (built and added in stages); stratas with sections (for example, residential and commercial parts); and leasehold stratas (the land is leased, not owned). The Act applies to all of them, with special parts for some."},
 {"topic": "Types of strata in BC", "activity": "knowledge_check", "teach": "Check: does the Strata Property Act apply to every type of strata in BC? (Yes, with special parts for some types.)"}
]'),
('sb2', '[
 {"topic": "Why rules matter", "activity": "none", "teach": "A strata is a community of owners sharing property. Its rules come from several places, and council needs to know which is which."},
 {"topic": "The rules, layer by layer", "activity": "accordion", "teach": "The layers, from the top: the Strata Property Act; the Strata Property Regulation; the strata''s bylaws; the strata''s rules. A lower layer can''t conflict with a higher one; if it does, the higher one wins."},
 {"topic": "The rules, layer by layer", "activity": "none", "teach": "The Act and the Regulation are provincial law: they apply to every strata and set out how a strata is run, how decisions are made and what owners and council must do."},
 {"topic": "Bylaws and rules", "activity": "none", "teach": "Bylaws govern how the strata is run and how owners, tenants and occupants use their lots and common property. Every strata starts with the Standard Bylaws in the Act''s Schedule unless it has filed its own. Owners change bylaws by a vote at a general meeting, and the change is filed at the Land Title Office."},
 {"topic": "Bylaws and rules", "activity": "none", "teach": "Rules are made by council about the use, safety and condition of common property and common assets. A new rule must be approved by the owners at the next annual general meeting to stay in force."},
 {"topic": "Bylaws and rules", "activity": "knowledge_check", "teach": "Check: who makes bylaws, and who makes rules? (Owners make bylaws; council makes rules, which owners then approve.)"},
 {"topic": "Other laws a strata follows", "activity": "flip_cards", "teach": "Other laws also apply to a strata, for example human rights law, privacy law for personal information (PIPA), residential tenancy law for rented lots, workplace safety law, and local government bylaws. Name each and what it covers in a sentence; their detail belongs to later modules."},
 {"topic": "Other laws a strata follows", "activity": "none", "teach": "Where to get help: the Province''s strata housing guides, and the Civil Resolution Tribunal for most strata disputes. Name them only."},
 {"topic": "Other laws a strata follows", "activity": "knowledge_check", "teach": "Check: when a bylaw conflicts with the Strata Property Act, which applies? (The Act.)"}
]'),
('sb3', '[
 {"topic": "Where strata fees go", "activity": "none", "teach": "Owners pay strata fees to cover the costs of running and maintaining the strata: insurance, utilities for common property, repairs, management and so on."},
 {"topic": "Two funds", "activity": "flip_cards", "teach": "The operating fund pays for costs that come up at least once a year. The contingency reserve fund saves for costs that come up less often than once a year, or don''t usually come up, such as a new roof."},
 {"topic": "Two funds", "activity": "knowledge_check", "teach": "Check: which fund pays for a yearly cost, and which for a roof replacement?"},
 {"topic": "The budget and fees", "activity": "none", "teach": "Each year council prepares a budget, and the owners approve it at the annual general meeting. Strata fees come from the approved budget."},
 {"topic": "The budget and fees", "activity": "none", "teach": "How fees are shared: each strata lot pays its share based on unit entitlement, the figure set out in the schedule filed with the strata plan."},
 {"topic": "Special levies", "activity": "none", "teach": "When the strata needs money the funds don''t cover, owners can approve a special levy, usually shared by unit entitlement. Name the kind of vote it needs; the detail belongs to the Treasurer track."},
 {"topic": "Special levies", "activity": "knowledge_check", "teach": "Check: how is each owner''s share of strata fees worked out? (By unit entitlement.)"}
]'),
-- ── Council Ready ──────────────────────────────────────────────────────
('cr1', '[
 {"topic": "What council does", "activity": "none", "teach": "Council is elected by the owners to exercise the strata corporation''s powers and perform its duties. Owners keep the big decisions for general meetings."},
 {"topic": "What council does", "activity": "flip_cards", "teach": "Governance versus operations: council sets direction and makes decisions; a strata manager, staff or contractors carry out the day-to-day work."},
 {"topic": "Joining council", "activity": "none", "teach": "Who can be on council, how members are elected at the annual general meeting, how long they serve, and the officer roles (president, vice president, secretary, treasurer)."},
 {"topic": "Joining council", "activity": "knowledge_check", "teach": "Check: what is council''s job, and what stays with the owners?"},
 {"topic": "Your duties", "activity": "accordion", "teach": "The standard of care: act honestly and in good faith, with a view to the best interests of the strata corporation, and with the care, diligence and skill of a reasonably prudent person."},
 {"topic": "Your duties", "activity": "none", "teach": "Conflicts of interest: what one looks like on council, disclosing it, and not voting on the matter."},
 {"topic": "Your duties", "activity": "none", "teach": "Council acts together: decisions are made as a council, not by individual members. Keep council business confidential where the bylaws or privacy law require."},
 {"topic": "Your duties", "activity": "knowledge_check", "teach": "Check: a council member''s relative bids on a strata contract. What should the member do?"}
]'),
('cr2', '[
 {"topic": "Calling a council meeting", "activity": "none", "teach": "How a council meeting is called and the notice council members get, as the bylaws set out."},
 {"topic": "Calling a council meeting", "activity": "none", "teach": "Quorum: how many council members must be present for decisions to count."},
 {"topic": "Running the meeting", "activity": "accordion", "teach": "An effective meeting: an agenda sent ahead, starting on time, one item at a time, discussion then a clear decision, and who does what next."},
 {"topic": "Running the meeting", "activity": "none", "teach": "How council decides: by majority vote of the members present, and the chair''s role."},
 {"topic": "Running the meeting", "activity": "knowledge_check", "teach": "Check: can council make a binding decision without a quorum?"},
 {"topic": "Hearings", "activity": "none", "teach": "An owner or tenant can ask for a hearing at a council meeting; what council must do and how quickly, and giving its decision in writing."},
 {"topic": "Minutes", "activity": "none", "teach": "What council minutes must record, especially the results of votes, and getting them to owners."},
 {"topic": "Minutes", "activity": "knowledge_check", "teach": "Check: an owner asks for a hearing. What does council do?"}
]'),
('cr3', '[
 {"topic": "General meetings", "activity": "flip_cards", "teach": "The annual general meeting happens every year; a special general meeting is called when a decision can''t wait. What usually happens at an AGM: the budget, council elections, the insurance report."},
 {"topic": "Before the meeting", "activity": "none", "teach": "Notice to owners: how much notice, what it must include (the agenda and the wording of any resolution), and how it can be given."},
 {"topic": "Before the meeting", "activity": "knowledge_check", "teach": "Check: what must the notice of a general meeting include?"},
 {"topic": "At the meeting", "activity": "none", "teach": "Quorum, and what happens if there isn''t one at the start."},
 {"topic": "At the meeting", "activity": "none", "teach": "Proxies: who can be a proxy and how they vote."},
 {"topic": "At the meeting", "activity": "accordion", "teach": "Kinds of vote: majority, 3/4, 80% and unanimous, with one example of a decision that needs each."},
 {"topic": "At the meeting", "activity": "knowledge_check", "teach": "Check: choose the right kind of vote for a decision."},
 {"topic": "Requisitioned meetings", "activity": "none", "teach": "Owners can requisition a special general meeting: how many must ask, and what council must then do."},
 {"topic": "Requisitioned meetings", "activity": "knowledge_check", "teach": "Check: owners hand council a requisition. What happens next?"}
]'),
('cr5', '[
 {"topic": "Who repairs what", "activity": "flip_cards", "teach": "The strata repairs and maintains common property and common assets; owners look after their strata lots; limited common property depends on the bylaws. Check the strata''s own bylaws."},
 {"topic": "Who repairs what", "activity": "none", "teach": "Planning ahead: the depreciation report shows what will need repair or replacement and when. Name it; its detail belongs to the Treasurer track."},
 {"topic": "Who repairs what", "activity": "knowledge_check", "teach": "Check: who repairs a leaking hallway pipe, and who repairs a strata lot''s kitchen cabinets?"},
 {"topic": "Changes to common property", "activity": "none", "teach": "An owner who wants to alter common property or their strata lot needs the strata''s approval as the bylaws set out, and may have to take responsibility for the alteration."},
 {"topic": "Changes to common property", "activity": "none", "teach": "A significant change to the use or appearance of common property needs the owners'' approval by the vote the Act requires."},
 {"topic": "Changes to common property", "activity": "knowledge_check", "teach": "Check: choose the right approval for a change to common property."},
 {"topic": "Insurance", "activity": "none", "teach": "What the strata must insure, and to what value; telling owners about the insurance."},
 {"topic": "Insurance", "activity": "none", "teach": "Deductibles: when the strata can charge an insurance deductible back to an owner, under the bylaws."},
 {"topic": "Emergencies", "activity": "none", "teach": "In an emergency, council can spend money to ensure safety or prevent significant loss or damage without an owners'' vote, and must tell owners afterwards."},
 {"topic": "Emergencies", "activity": "knowledge_check", "teach": "Check: a pipe bursts overnight. What can council do without a vote?"}
]'),
('cr6', '[
 {"topic": "Managing the strata", "activity": "flip_cards", "teach": "Self-managed or professionally managed: what council takes on in each case. Council still makes the decisions either way."},
 {"topic": "Strata managers", "activity": "none", "teach": "Strata managers must be licensed under the Real Estate Services Act. What a manager can do for council."},
 {"topic": "Strata managers", "activity": "accordion", "teach": "The strata management agreement: what it covers (services, fees, authority to spend, handling money and records), and how it can be ended."},
 {"topic": "Strata managers", "activity": "knowledge_check", "teach": "Check: what stays with council when the strata hires a manager?"},
 {"topic": "Contracts and quotes", "activity": "accordion", "teach": "Buying well: define the need, set a budget, get comparable quotes, check references and insurance, compare fairly, decide as council and record the decision."},
 {"topic": "Contracts and quotes", "activity": "none", "teach": "Avoiding risk: conflicts of interest, spending within the budget, and contracts that run past what council can approve."},
 {"topic": "Contracts and quotes", "activity": "knowledge_check", "teach": "Check: compare two quotes and choose the better value."}
]'),
('cr4', '[
 {"topic": "Communicating with owners", "activity": "none", "teach": "Clear, regular communication prevents most conflict: say what council decided, why, and what happens next."},
 {"topic": "Communicating with owners", "activity": "none", "teach": "Handling an unpopular decision or an upset owner: listen, stay calm, reply in writing, stick to the facts and the bylaws."},
 {"topic": "Enforcing bylaws fairly", "activity": "accordion", "teach": "Before a fine: a complaint, written particulars to the owner or tenant, a reasonable chance to answer (including a hearing if requested), then council''s decision in writing."},
 {"topic": "Enforcing bylaws fairly", "activity": "none", "teach": "Treat everyone the same way, follow the same steps every time, and keep records."},
 {"topic": "Enforcing bylaws fairly", "activity": "knowledge_check", "teach": "Check: council wants to fine an owner. What must happen first?"},
 {"topic": "Resolving disputes", "activity": "none", "teach": "Try to resolve disputes early: talk, a hearing, mediation."},
 {"topic": "Resolving disputes", "activity": "none", "teach": "The Civil Resolution Tribunal hears most strata disputes online; who can bring a claim, and what it can decide."},
 {"topic": "Resolving disputes", "activity": "knowledge_check", "teach": "Check: can this dispute go to the Civil Resolution Tribunal?"}
]'),
-- ── Treasurer ──────────────────────────────────────────────────────────
('t2', '[
 {"topic": "The annual budget", "activity": "none", "teach": "What the budget is for and what it contains: expected operating expenses, contributions to the contingency reserve fund, and expected income."},
 {"topic": "The annual budget", "activity": "accordion", "teach": "Building a draft: start from last year''s actual spending, add known changes (insurance, contracts, the depreciation report), and set the reserve fund contribution."},
 {"topic": "Strata fees", "activity": "none", "teach": "Turning the budget into strata fees: each lot''s share by unit entitlement."},
 {"topic": "Strata fees", "activity": "knowledge_check", "teach": "Check: work out one lot''s share of the budget from its unit entitlement."},
 {"topic": "Approval", "activity": "none", "teach": "The budget goes to the owners at the annual general meeting with the notice; what happens when it''s approved, and what happens if it isn''t."},
 {"topic": "Approval", "activity": "knowledge_check", "teach": "Check: what happens to strata fees if owners don''t approve the budget?"}
]'),
('t3', '[
 {"topic": "The contingency reserve fund", "activity": "none", "teach": "What the fund is for, and the rules for how much goes into it each year."},
 {"topic": "The depreciation report", "activity": "accordion", "teach": "What a depreciation report contains (the common property and assets, their condition and life, and funding models), who can prepare one, and how often."},
 {"topic": "The depreciation report", "activity": "none", "teach": "Using the report''s funding models to plan contributions, rather than letting the fund fall behind."},
 {"topic": "The depreciation report", "activity": "knowledge_check", "teach": "Check: which funding model keeps the fund ahead of upcoming repairs?"},
 {"topic": "Spending from the fund", "activity": "none", "teach": "When money can be spent from the fund and what approval it needs, including the exceptions."},
 {"topic": "Special levies", "activity": "none", "teach": "When a special levy is the right choice instead of the reserve fund, how it''s approved and shared."},
 {"topic": "Special levies", "activity": "knowledge_check", "teach": "Check: the roof needs replacing and the fund is short. What are council''s options?"}
]'),
('t1', '[
 {"topic": "Monthly statements", "activity": "accordion", "teach": "The parts of the monthly financial statements: income, expenses, the funds'' balances, and budget compared with actual."},
 {"topic": "Monthly statements", "activity": "none", "teach": "Reading budget against actual: spotting variances and asking why."},
 {"topic": "Monthly statements", "activity": "knowledge_check", "teach": "Check: a line is well over budget halfway through the year. What does the treasurer do?"},
 {"topic": "Year-end", "activity": "none", "teach": "The year-end financial statements: what they must include and when owners get them."},
 {"topic": "Year-end", "activity": "none", "teach": "Audits: when one is required and when owners can decide to have one."},
 {"topic": "Year-end", "activity": "knowledge_check", "teach": "Check: what goes to owners at year-end?"}
]'),
('t4', '[
 {"topic": "Collecting strata fees", "activity": "accordion", "teach": "When an owner falls behind: reminders, interest and penalties allowed by the bylaws, and the steps before stronger action."},
 {"topic": "Collecting strata fees", "activity": "none", "teach": "Liens: when the strata can register a lien against a strata lot, the notice it must give first, and what the lien does."},
 {"topic": "Collecting strata fees", "activity": "knowledge_check", "teach": "Check: what must the strata do before registering a lien?"},
 {"topic": "Investing the strata''s money", "activity": "none", "teach": "Where the strata may invest its funds under the Regulation, and keeping the funds in the strata''s own accounts."},
 {"topic": "Financial controls", "activity": "accordion", "teach": "Controls that protect the money: signing authority, two signatures, separating who approves from who pays, and regular review."},
 {"topic": "Financial controls", "activity": "knowledge_check", "teach": "Check: spot the weak control in an example."}
]'),
-- ── Secretary ──────────────────────────────────────────────────────────
('s1', '[
 {"topic": "Notice of meetings", "activity": "flip_cards", "teach": "Notice for council meetings (as the bylaws set out) and for general meetings (as the Act requires): who gets it and how much notice."},
 {"topic": "Notice of meetings", "activity": "none", "teach": "How notice can be given: the methods the Act allows, and owners'' addresses for notice."},
 {"topic": "Notice of meetings", "activity": "knowledge_check", "teach": "Check: is this notice valid?"},
 {"topic": "Agendas", "activity": "accordion", "teach": "A clear agenda: call to order, approving minutes, reports, decisions (each with what''s being decided), information items, and adjournment."},
 {"topic": "Agendas", "activity": "knowledge_check", "teach": "Check: what''s wrong with this agenda?"}
]'),
('s2', '[
 {"topic": "What minutes record", "activity": "none", "teach": "Minutes record decisions and the results of votes, not everything that was said."},
 {"topic": "What minutes record", "activity": "accordion", "teach": "The parts of good minutes: who attended, quorum, each decision as a motion and its result, and actions with who will do them."},
 {"topic": "What to leave out", "activity": "none", "teach": "Leave out personal information and hearing details that don''t need to be there; record that a matter was dealt with, not private particulars."},
 {"topic": "What to leave out", "activity": "knowledge_check", "teach": "Check: what should come out of these draft minutes?"},
 {"topic": "Getting minutes out", "activity": "none", "teach": "Approving minutes and getting them to owners on time, as the bylaws require."}
]'),
('s3', '[
 {"topic": "The strata''s records", "activity": "accordion", "teach": "The records a strata must keep: minutes, bylaws and rules, financial records, contracts, correspondence and more."},
 {"topic": "The strata''s records", "activity": "none", "teach": "How long each kind of record must be kept."},
 {"topic": "Owner requests", "activity": "none", "teach": "Who can ask to see records (owners, tenants with permission, and others the Act allows), and the deadline to provide them."},
 {"topic": "Owner requests", "activity": "none", "teach": "Fees the strata may charge for copies, and what it must not charge for."},
 {"topic": "Owner requests", "activity": "knowledge_check", "teach": "Check: an owner asks for last year''s council minutes. What must the strata do, and by when?"}
]'),
('s4', '[
 {"topic": "Information certificates", "activity": "none", "teach": "The information certificate (Form B): what it is, who asks for one (usually for a sale), what it contains, the deadline and the fee."},
 {"topic": "Information certificates", "activity": "none", "teach": "The certificate of payment (Form F): what it confirms and when it''s needed."},
 {"topic": "Information certificates", "activity": "knowledge_check", "teach": "Check: a buyer''s agent asks for a Form B. What does the strata do?"},
 {"topic": "Privacy", "activity": "accordion", "teach": "Personal information and PIPA: collect only what''s needed, say why, keep it secure, use it only for that purpose, and let people see their own information."},
 {"topic": "Privacy", "activity": "none", "teach": "Sharing with owners without disclosing personal information: what can go in minutes and notices, and what can''t."},
 {"topic": "Privacy", "activity": "knowledge_check", "teach": "Check: an owner asks for another owner''s phone number. What does council say?"}
]'),
('s5', '[
 {"topic": "Meetings in the Stratasphere", "activity": "none", "teach": "Preparing a meeting: building the agenda, attaching documents, and sending notice."},
 {"topic": "Meetings in the Stratasphere", "activity": "none", "teach": "Meeting Mode: running the meeting on screen and recording each decision as it''s made."},
 {"topic": "Minutes and records", "activity": "none", "teach": "From the meeting to minutes: reviewing, approving and publishing them, and exporting a copy."},
 {"topic": "Minutes and records", "activity": "none", "teach": "Organizing the strata''s documents so requests for records are quick to answer."},
 {"topic": "Minutes and records", "activity": "knowledge_check", "teach": "Check: where do you record a decision during a meeting?"}
]')
)
update public.training_modules m
set blueprint = s.blueprint::jsonb
from seed s
where m.curriculum_key = s.curriculum_key
  and m.blueprint = '[]'::jsonb;
