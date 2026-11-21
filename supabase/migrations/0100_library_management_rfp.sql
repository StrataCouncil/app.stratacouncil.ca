-- Library: a request for proposal for strata management services (2026-11-21).
--
-- Adds the RFP as a draft Form in the Library, for a Super Admin to review
-- and publish in the console (Super Admin > Library). Guidance boxes show on
-- the page only; the RFP itself downloads as Word, blank, with the strata's
-- name and plan number left as placeholders. Its legal points (Strata
-- Property Act ss. 27, 37, 39 and 97; Real Estate Services Rules ss. 30,
-- 43, 52, 56, 58 and 77) were checked against the current consolidations on
-- BC Laws. It goes with Council Ready Module 5 (0098).
--
-- Adds it only if the Library has no item with this title, so a re-run, or
-- an item already edited or published, is left alone. Nothing to grant: no
-- new tables or functions. Paste the whole file into an empty SQL editor tab.

insert into public.library_resources (kind, title, summary, tags, draft_markup, draft_sources, claims)
select 'form',
       'Request for proposal: strata management services',
       'A ready-to-fill RFP for choosing a strata management company: what to tell proponents about your strata, the services to price, what each proposal must include, fees, disclosures, a timeline, and how proposals will be scored.',
       array['strata manager', 'management company', 'RFP', 'procurement'],
       $rfp$:::summary How to use this template
A request for proposal (RFP) asks several licensed strata management companies to answer the same questions, so council can compare them fairly. The boxes on this page are guidance for council and don't appear in the Word download; the rest is the RFP itself.
1. Agree on what the strata needs before you write: its size, age, buildings, amenities, current problems, and the service level council expects.
2. Fill in every part in square brackets. Delete what doesn't apply and add anything the strata needs.
3. Send the same RFP, with the same deadline, to at least three licensed brokerages.
4. Answer every question in writing and share each answer with all the proponents.
5. Score the proposals the same way (section 8), check each company's and manager's licence with the BC Financial Services Authority (BCFSA), interview the strongest two or three, and call their references.
6. Council decides at a council meeting and records the decision, the approved terms, and who signs in the minutes.
:::

:::important Before you sign
- Hiring a management company is normally council's decision, but the owners can direct or restrict council by a majority vote at a general meeting (Strata Property Act section 27). Check that no such resolution applies.
- The fees must be authorized, normally in the operating fund budget the owners approve (section 97).
- The Real Estate Services Rules (section 43) require a written service agreement, signed by the strata and the brokerage before any services start, unless the strata waives it. Besides the services and fees, it must say which of the strata's money the brokerage will hold, when either side can end it, whether the brokerage can sign cheques, make payments, enter into contracts, or invest the strata's money, what financial statements and records the strata will get and how often, which records the brokerage keeps for the strata, and how personal information is used and disclosed. Any change must be in writing and signed by both.
- Whatever the agreement says, the strata can cancel on 2 months' notice once the owners approve by a 3/4 vote at a general meeting, and the company can cancel on 2 months' notice (section 39). No prior approval is needed to cancel under the agreement's own terms or to decline to renew it when it expires.
:::

:::fineprint
This template is general information for BC strata corporations, not legal advice. Check it against the current Strata Property Act, the Real Estate Services Act and Rules, and your own bylaws before you use it.
:::

## 1. Invitation

[Strata Corporation name], Strata Plan [Strata Plan number] (the "Strata Corporation"), invites strata management brokerages licensed by the BC Financial Services Authority to submit a proposal to provide strata management services.

Proposals are due by **[time] on [date]**. Send them by email to [council contact name and email address].

The Strata Corporation is not required to accept the lowest proposal, or any proposal. Council will choose the proposal it considers best for the Strata Corporation as a whole.

## 2. About the Strata Corporation

| Item | Details |
|---|---|
| Civic address | [address] |
| Number of strata lots | [number] |
| Buildings and type | [for example, one 6-storey residential building; 24 townhouses in 4 buildings] |
| Year built | [year] |
| Commercial or other sections | [none, or describe] |
| Common facilities and amenities | [for example, elevators, parkade, gym, guest suite, irrigation] |
| Current management | [self-managed, or the current company and when its agreement ends] |
| Contingency reserve fund balance | [amount, as of date] |
| Most recent depreciation report | [date, and who prepared it] |
| Major projects underway or expected | [for example, roof replacement planned for 2027] |
| Council meetings per year | [number], usually [in person / electronic / hybrid] |
| Other known issues | [for example, ongoing water ingress, an insurance claim, a dispute] |

## 3. Services requested

Please confirm which of these are included in your base fee, which cost extra (with the price), and which you don't offer.

### Financial
- Collecting strata fees, special levies, and other charges, and following up on arrears.
- Paying approved invoices within the authority the agreement sets.
- Keeping the operating fund, contingency reserve fund, and special levy money in separate trust accounts in the Strata Corporation's name.
- Monthly financial statements, bank statements, and reconciliations.
- Preparing the draft annual budget for council.
- Year-end statements, and working with the accountant or auditor where one is engaged.

### Meetings and administration
- Attending [number] council meetings a year and the annual general meeting; the cost of attending special general meetings and extra council meetings.
- Preparing notices, agendas, and minutes, and sending them on time.
- Responding to owners' and residents' inquiries.
- Information Certificates (Form B), records requests, and other documents owners and buyers ask for, and who keeps any fees charged for them.

### Building operations
- Coordinating routine maintenance, inspections, and service contracts.
- Getting quotes, issuing work orders within approved limits, and following work through to completion.
- Keeping maintenance records, warranties, and the service history.
- Insurance renewals and claims, working with the insurance broker.
- After-hours emergency response.

### Records
- Keeping the Strata Corporation's records as the Strata Property Act requires, with the strata able to reach them at any time.
- Returning the records within 4 weeks after the agreement ends.

### Optional services
- Project management for major repairs or replacements.
- Depreciation report coordination.
- Help with Civil Resolution Tribunal or other legal matters.
- [Anything else]

## 4. What your proposal must include

1. Your brokerage's name, licence number, and managing broker.
2. The manager who would be assigned, their licence, years of experience, and how many strata corporations they currently manage.
3. Who covers when the assigned manager is away, and your after-hours emergency arrangement.
4. Your experience with strata corporations like ours, with three references from comparable strata councils we may contact.
5. How you would handle the transition from our current arrangement, and how long it would take.
6. How council will communicate with you: the contact, response times for routine and urgent matters, and how you track open items.
7. Your financial reporting: what council receives, how often, and samples of a monthly statement and an action report.
8. How you protect owners' personal information, and where records are stored.
9. Your errors and omissions insurance and any other insurance you carry, with limits.
10. Your proposed service agreement, or the main terms you would propose.
11. The fees and disclosures in sections 5 and 6.

## 5. Fees

| Fee | Amount |
|---|---|
| Base management fee | [amount] a month, plus GST |
| Annual increases | [how they are set] |
| Extra council or general meetings | [amount each] |
| Project management | [rate or percentage] |
| Other charges | [list each, with its price] |
| Charges for documents to owners or buyers | [list, and who keeps the fee] |

State any cost to set up or end the agreement, and anything the Strata Corporation would pay that isn't listed above.

## 6. Disclosures

Please disclose in writing, separately from your proposal and your service agreement:
- Any remuneration your brokerage receives or expects to receive from anyone other than the Strata Corporation as a result of services to us, including referral fees for recommending contractors, insurance brokers, lenders, or other suppliers, with its source and amount or how it is calculated.
- Any benefit you or an associate expect to receive from money the Strata Corporation spends, such as a relationship with a contractor or supplier.
- Any conflict of interest, including if you manage rental units in our building for owners, or manage a neighbouring strata whose interests could compete with ours.

## 7. Timeline

| Step | Date |
|---|---|
| RFP sent | [date] |
| Questions due | [date] |
| Answers sent to all proponents | [date] |
| Proposals due | [date] |
| Interviews with shortlisted proponents | [dates] |
| Council decision | [date] |
| Services start | [date] |

## 8. How proposals will be evaluated

Council will score every proposal on the same criteria:

| Criterion | Weight |
|---|---|
| Relevant experience and expertise | [25]% |
| Scope of services and capacity | [25]% |
| Communication and responsiveness | [20]% |
| Financial systems and controls | [15]% |
| Fees and contract terms | [15]% |

Council may interview shortlisted proponents and will check references.

## 9. Questions

Send questions in writing to [council contact name and email address] by [date]. Answers will be sent to every proponent.

## 10. Conditions

- Proponents bear their own costs of preparing a proposal and attending interviews.
- The Strata Corporation may accept any proposal, reject any or all, or end this process at any time.
- Proposals will be shared only with council and anyone advising council, and personal information in them will be handled under BC's Personal Information Protection Act.
- The successful proponent will enter into a written service agreement with the Strata Corporation before providing any services.

**Issued by the council of [Strata Corporation name], Strata Plan [Strata Plan number], on [date].**$rfp$,
       '[]'::jsonb,
       '[]'::jsonb
where not exists (
  select 1 from public.library_resources where lower(title) = lower('Request for proposal: strata management services')
);
