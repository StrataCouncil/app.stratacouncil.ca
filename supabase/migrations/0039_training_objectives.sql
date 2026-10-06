-- Council Training: objectives at the right depth (2026-10-06).
--
-- Every curriculum module gets one to three objectives, each starting with
-- a verb at its track's Bloom levels (Strata Basics: remember and
-- understand; Council Ready: understand and apply; Treasurer and
-- Secretary: apply and analyze). Strata Basics 2 becomes "The rules a
-- strata lives by" (the documents that govern a strata, who makes each,
-- and other laws that apply); who-decides-what and voting move to
-- Council Ready 3, bylaws versus rules to Strata Basics 2.
--
-- Only modules still as 0036 seeded them are changed: anything an author
-- has edited (title, scope or objectives) is left alone. Safe to re-run.

update public.training_module_drafts d set content = jsonb_set(d.content, '{objectives}', '["Describe how a strata is created and what a strata corporation is", "Distinguish a strata lot, common property and limited common property", "Identify the main types of strata in BC"]'::jsonb)
from public.training_modules m
where m.id = d.module_id and m.curriculum_key = 'sb1'
  and d.content -> 'objectives' = '["Explain the difference between a strata lot, common property and limited common property", "Describe what unit entitlement decides for each owner", "Name the documents that govern a strata and which one wins when they disagree", "Explain that the strata corporation is all the owners together, acting as one legal body"]'::jsonb;

update public.training_modules set summary = 'How a strata is created, what you own and what you share, and the kinds of strata in BC.'
where curriculum_key = 'sb1' and summary = 'Strata lots, common property and unit entitlement, and the documents that govern a strata.';

update public.training_module_drafts d set content = jsonb_set(jsonb_set(d.content, '{objectives}', '["Name the documents that govern a strata, in order of authority", "Explain who makes bylaws and who makes rules", "Recognize other laws a strata must follow, such as tenancy, privacy and human rights laws"]'::jsonb), '{furtherReading}', '[{"id": "fr_sb2_1", "title": "Amending bylaws and rules (Province of BC)", "url": "https://www2.gov.bc.ca/gov/content/housing-tenancy/strata-housing/operating-a-strata/bylaws-and-rules/amending-bylaws-and-rules", "note": "How owners change bylaws and how council makes rules."}, {"id": "fr_sb2_2", "title": "Enforcing bylaws and rules (Province of BC)", "url": "https://www2.gov.bc.ca/gov/content/housing-tenancy/strata-housing/operating-a-strata/bylaws-and-rules/enforcing-bylaws-and-rules", "note": "The steps council must follow before a fine."}, {"id": "fr_sb2_3", "title": "Strata Property Act", "url": "https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/98043_00", "note": "The law itself, with the Standard Bylaws in its Schedule."}]'::jsonb)
from public.training_modules m
where m.id = d.module_id and m.curriculum_key = 'sb2'
  and d.content -> 'objectives' = '["Explain which decisions council can make and which need a vote of the owners", "Describe what a strata manager does and who they answer to", "Tell a majority vote, a 3/4 vote and a unanimous vote apart, with an example of each", "Describe the rights and duties of tenants in a strata"]'::jsonb;

update public.training_modules set summary = 'The Act, the Regulation, bylaws and rules: what each does, who makes it and which one wins, plus other laws a strata must follow.'
where curriculum_key = 'sb2' and summary = 'Owners, council, the strata manager and tenants, and which decisions need an owner vote.';

update public.training_module_drafts d set content = jsonb_set(d.content, '{objectives}', '["Explain the difference between the operating fund and the contingency reserve fund", "Describe how strata fees are shared out using unit entitlement", "Recognize when a special levy is used"]'::jsonb)
from public.training_modules m
where m.id = d.module_id and m.curriculum_key = 'sb3'
  and d.content -> 'objectives' = '["Explain the difference between the operating fund and the contingency reserve fund", "Describe how strata fees are shared out between owners", "Explain when a special levy is used and how it''s approved", "Describe how the annual budget is approved"]'::jsonb;

update public.training_modules set summary = 'The operating fund, the contingency reserve fund, how strata fees are shared out, and special levies.'
where curriculum_key = 'sb3' and summary = 'The operating fund, the contingency reserve fund, strata fees, special levies and the annual budget.';

update public.training_module_drafts d set content = jsonb_set(d.content, '{objectives}', '["Explain how council members are elected and how long they serve", "Apply the standard of care to everyday council decisions", "Recognize a conflict of interest and what to do about it"]'::jsonb)
from public.training_modules m
where m.id = d.module_id and m.curriculum_key = 'cr1'
  and d.content -> 'objectives' = '["Explain how council members are elected and how long they serve", "Describe the standard of care every council member must meet", "Recognise a conflict of interest and say what to do about it", "Explain what council business must stay confidential"]'::jsonb;

update public.training_module_drafts d set content = jsonb_set(d.content, '{objectives}', '["Explain how a council meeting is called and what makes a quorum", "Run an orderly meeting that ends in clear, recorded decisions", "Respond correctly when an owner asks for a hearing"]'::jsonb)
from public.training_modules m
where m.id = d.module_id and m.curriculum_key = 'cr2'
  and d.content -> 'objectives' = '["Explain how a council meeting is called and what makes a quorum", "Run an orderly meeting that reaches clear decisions", "Respond correctly when an owner asks for a hearing", "Describe what council meeting minutes must record"]'::jsonb;

update public.training_module_drafts d set content = jsonb_set(d.content, '{objectives}', '["Explain the notice, quorum and proxy rules for general meetings", "Choose the right kind of vote for a decision: majority, 3/4 or unanimous", "Describe what happens when owners requisition a special general meeting"]'::jsonb)
from public.training_modules m
where m.id = d.module_id and m.curriculum_key = 'cr3'
  and d.content -> 'objectives' = '["Describe the notice owners must get before a general meeting", "Explain how quorum and proxies work", "Explain how the budget and 3/4 vote resolutions are approved", "Describe what happens when owners requisition a special general meeting"]'::jsonb;

update public.training_modules set summary = 'Annual and special general meetings: notice, quorum, proxies, and choosing the right kind of vote.'
where curriculum_key = 'cr3' and summary = 'Annual and special general meetings: notice, quorum, proxies, the budget and resolutions.';

update public.training_module_drafts d set content = jsonb_set(d.content, '{objectives}', '["Follow the steps the Act requires before fining an owner or tenant", "Apply the current limits on rental and age restriction bylaws", "Decide when a dispute can go to the Civil Resolution Tribunal"]'::jsonb)
from public.training_modules m
where m.id = d.module_id and m.curriculum_key = 'cr4'
  and d.content -> 'objectives' = '["Explain the difference between a bylaw and a rule", "Follow the steps the Act requires before fining an owner or tenant", "Describe the current limits on rental and age restriction bylaws", "Explain when a dispute can go to the Civil Resolution Tribunal"]'::jsonb;

update public.training_modules set summary = 'Enforcing bylaws and rules fairly, the current limits on bylaws, and resolving disputes.'
where curriculum_key = 'cr4' and summary = 'The difference between bylaws and rules, enforcing them fairly, current limits, and resolving disputes.';

update public.training_module_drafts d set content = jsonb_set(d.content, '{objectives}', '["Decide who is responsible for a repair: the strata or the owner", "Use the depreciation report to plan maintenance and repairs", "Explain how an insurance deductible can be charged back to an owner"]'::jsonb)
from public.training_modules m
where m.id = d.module_id and m.curriculum_key = 'cr5'
  and d.content -> 'objectives' = '["Explain who is responsible for repairing common property, limited common property and strata lots", "Use the depreciation report to plan maintenance and repairs", "Describe the strata''s insurance and how deductibles can be charged back", "Explain what council can do in an emergency without a vote"]'::jsonb;

update public.training_module_drafts d set content = jsonb_set(d.content, '{objectives}', '["Respond on time to an owner''s request for records", "Protect owners'' and tenants'' personal information", "Decide what to delegate to a strata manager, or what a self-managed council takes on"]'::jsonb)
from public.training_modules m
where m.id = d.module_id and m.curriculum_key = 'cr6'
  and d.content -> 'objectives' = '["List the records a strata must keep", "Respond to an owner''s request for records on time", "Protect owners'' and tenants'' personal information", "Decide what to delegate to a strata manager, or what a self-managed council takes on"]'::jsonb;

update public.training_module_drafts d set content = jsonb_set(d.content, '{objectives}', '["Read the strata''s monthly financial statements", "Compare actual spending with the budget and explain the differences", "Recommend which issues to raise with council"]'::jsonb)
from public.training_modules m
where m.id = d.module_id and m.curriculum_key = 't1'
  and d.content -> 'objectives' = '["Read a strata''s monthly financial statements", "Compare actual spending to the budget and explain the differences", "Spot the warning signs worth raising with council"]'::jsonb;

update public.training_module_drafts d set content = jsonb_set(d.content, '{objectives}', '["Prepare a draft annual budget from past spending and known costs", "Calculate strata fees from the budget using unit entitlement", "Present the budget to owners for approval"]'::jsonb)
from public.training_modules m
where m.id = d.module_id and m.curriculum_key = 't2'
  and d.content -> 'objectives' = '["Build a draft annual budget from past spending and known costs", "Explain how strata fees are calculated from the budget", "Present the budget to owners for approval at the AGM"]'::jsonb;

update public.training_module_drafts d set content = jsonb_set(d.content, '{objectives}', '["Apply the rules for contributions to the contingency reserve fund", "Use the depreciation report''s funding models to plan contributions", "Assess when a special levy is the right choice"]'::jsonb)
from public.training_modules m
where m.id = d.module_id and m.curriculum_key = 't3'
  and d.content -> 'objectives' = '["Explain the rules for contributions to the contingency reserve fund", "Use the depreciation report''s funding models to plan contributions", "Explain when and how money can be spent from the reserve fund", "Decide when a special levy is the right choice"]'::jsonb;

update public.training_module_drafts d set content = jsonb_set(d.content, '{objectives}', '["Follow the steps for collecting unpaid strata fees", "Explain when the strata can register a lien", "Check that financial controls such as signing authority and separation of duties are in place"]'::jsonb)
from public.training_modules m
where m.id = d.module_id and m.curriculum_key = 't4'
  and d.content -> 'objectives' = '["Follow the steps for collecting unpaid strata fees", "Explain when the strata can register a lien", "Put in place financial controls such as signing authority and separation of duties"]'::jsonb;

update public.training_module_drafts d set content = jsonb_set(d.content, '{objectives}', '["Prepare the right notice for council and general meetings", "Draft a clear agenda that separates decisions from information", "Send notices the way the Act and bylaws allow"]'::jsonb)
from public.training_modules m
where m.id = d.module_id and m.curriculum_key = 's1'
  and d.content -> 'objectives' = '["Give the right notice for council and general meetings", "Build a clear agenda that separates decisions from information", "Send notices the way the Act and bylaws allow"]'::jsonb;

update public.training_module_drafts d set content = jsonb_set(d.content, '{objectives}', '["Record decisions and votes clearly in minutes", "Decide what to leave out of minutes, including personal information", "Distribute minutes to owners on time"]'::jsonb)
from public.training_modules m
where m.id = d.module_id and m.curriculum_key = 's2'
  and d.content -> 'objectives' = '["Record decisions and votes clearly in council and general meeting minutes", "Decide what to leave out of minutes, including personal information", "Distribute minutes to owners within the required time"]'::jsonb;

update public.training_module_drafts d set content = jsonb_set(d.content, '{objectives}', '["Organize records so each is kept for the required time", "Respond to an owner''s records request within the deadline", "Explain what an information certificate (Form B) is and who asks for one"]'::jsonb)
from public.training_modules m
where m.id = d.module_id and m.curriculum_key = 's3'
  and d.content -> 'objectives' = '["Keep each kind of record for the required time", "Answer an owner''s request for records within the deadline", "Explain what an information certificate (Form B) is and who asks for one"]'::jsonb;

update public.training_module_drafts d set content = jsonb_set(d.content, '{objectives}', '["Handle owners'' letters and complaints consistently, in writing", "Share information with owners without disclosing personal information", "Keep the owner and tenant contact list secure"]'::jsonb)
from public.training_modules m
where m.id = d.module_id and m.curriculum_key = 's4'
  and d.content -> 'objectives' = '["Handle owners'' correspondence and complaints in writing, consistently", "Share information with owners without disclosing personal information", "Keep the owner and tenant contact list secure"]'::jsonb;

update public.training_modules set title = 'The rules a strata lives by'
where curriculum_key = 'sb2' and title = 'Who decides what';
