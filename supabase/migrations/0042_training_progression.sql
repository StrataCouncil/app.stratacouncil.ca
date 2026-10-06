-- Council Training: the curriculum in its teaching order, and track pictures (2026-10-06).
--
-- 1. Council Ready, Treasurer and Secretary follow a set progression of
--    knowledge: council's role and meetings, then the building (repairs,
--    changes, insurance), then managers and contracts, then people
--    (bylaws, communication, disputes); the treasurer's year from budget to
--    collections; the secretary's records, then certificates.
--    Modules are reordered, retitled and given new objectives (each with a
--    Bloom level). Only what an author hasn't changed is touched: a
--    module's title, summary and objectives are each changed only if they
--    are still as seeded, and a track is reordered only if its modules are
--    still in the seeded order.
-- 2. Secretary module 5: Using the Stratasphere.
-- 3. training_tracks.cover: the picture on the track's card, uploaded to
--    the track's own folder (training-media/<track id>/) or chosen from
--    Unsplash ({src, alt, credit, path}).
--
-- Safe to re-run. Paste the whole file into an empty SQL editor tab.

alter table public.training_tracks add column if not exists cover jsonb;

-- ── Order ──────────────────────────────────────────────────────────────
-- Council Ready: 1 role, 2 council meetings, 3 general meetings,
-- 4 repairs (was 5), 5 managers and contracts (was 6), 6 bylaws and disputes (was 4).
update public.training_modules m
set order_index = case m.curriculum_key when 'cr5' then 4 when 'cr6' then 5 when 'cr4' then 6 end
where m.curriculum_key in ('cr4', 'cr5', 'cr6')
  and (select array_agg(curriculum_key order by order_index) from public.training_modules
       where curriculum_key in ('cr1','cr2','cr3','cr4','cr5','cr6')) = array['cr1','cr2','cr3','cr4','cr5','cr6'];

-- Treasurer: 1 budget (was 2), 2 reserve fund (was 3), 3 statements (was 1), 4 collections.
update public.training_modules m
set order_index = case m.curriculum_key when 't2' then 1 when 't3' then 2 when 't1' then 3 end
where m.curriculum_key in ('t1', 't2', 't3')
  and (select array_agg(curriculum_key order by order_index) from public.training_modules
       where curriculum_key in ('t1','t2','t3','t4')) = array['t1','t2','t3','t4'];

-- ── Titles and summaries (only while still as seeded) ──────────────────
update public.training_modules set title = 'Repairs, changes and insurance'
where curriculum_key = 'cr5' and title = 'Repairs, maintenance and insurance';
update public.training_modules set summary = 'Who repairs what, changes to common property, insurance and deductibles, and emergencies.'
where curriculum_key = 'cr5' and summary = 'Who repairs what, planning with the depreciation report, insurance and deductibles, and emergencies.';

update public.training_modules set title = 'Strata managers and contracts'
where curriculum_key = 'cr6' and title = 'Records, privacy and getting help';
update public.training_modules set summary = 'What a licensed strata manager does, the management agreement, and getting quotes and awarding contracts.'
where curriculum_key = 'cr6' and summary = 'The records a strata keeps, owner requests, personal information, and working with a strata manager or self-managing.';

update public.training_modules set title = 'Bylaws, communication and disputes'
where curriculum_key = 'cr4' and title = 'Bylaws, rules and disputes';
update public.training_modules set summary = 'Enforcing bylaws fairly, communicating with owners, handling conflict, and when a dispute goes to the Civil Resolution Tribunal.'
where curriculum_key = 'cr4' and summary in (
  'Enforcing bylaws and rules fairly, the current limits on bylaws, and resolving disputes.',
  'The difference between bylaws and rules, enforcing them fairly, current limits, and resolving disputes.');

update public.training_modules set title = 'Financial statements and year-end'
where curriculum_key = 't1' and title = 'Reading the financial statements';
update public.training_modules set summary = 'Reading the monthly statements, the year-end financial statements, and when an audit is needed.'
where curriculum_key = 't1' and summary = 'What the monthly statements show, and the questions a treasurer should ask about them.';

update public.training_modules set title = 'Collections, investments and controls'
where curriculum_key = 't4' and title = 'Collections, arrears and controls';
update public.training_modules set summary = 'Collecting unpaid fees, liens, investing the strata''s money safely, and financial controls.'
where curriculum_key = 't4' and summary = 'Collecting unpaid fees, liens, and the financial controls that protect the strata''s money.';

update public.training_modules set summary = 'Keeping each record for the right length of time, and answering owners'' requests for records.'
where curriculum_key = 's3' and summary = 'Keeping records for the right length of time, and answering requests for records and information certificates.';

update public.training_modules set title = 'Certificates and privacy'
where curriculum_key = 's4' and title = 'Correspondence and privacy';
update public.training_modules set summary = 'Information certificates (Form B), certificates of payment (Form F), and sharing information without breaching privacy.'
where curriculum_key = 's4' and summary = 'Handling owners'' letters and complaints, and sharing information without breaching privacy.';

-- ── Objectives (only while still as 0039 left them) ────────────────────
create or replace function pg_temp.objective_texts(o jsonb) returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(x ->> 'text' order by n), '[]'::jsonb) from jsonb_array_elements(o) with ordinality t(x, n)
$$;

update public.training_modules set objectives = '[
  {"text": "Decide who is responsible for a repair: the strata or the owner", "bloom": "apply"},
  {"text": "Choose the right approval for a change to common property", "bloom": "apply"},
  {"text": "Explain how an insurance deductible can be charged back to an owner", "bloom": "understand"}]'::jsonb
where curriculum_key = 'cr5' and pg_temp.objective_texts(objectives) = '["Decide who is responsible for a repair: the strata or the owner", "Use the depreciation report to plan maintenance and repairs", "Explain how an insurance deductible can be charged back to an owner"]'::jsonb;

update public.training_modules set objectives = '[
  {"text": "Decide what to delegate to a strata manager, or what a self-managed council takes on", "bloom": "apply"},
  {"text": "Explain what a strata management agreement covers and how it can be ended", "bloom": "understand"},
  {"text": "Compare quotes fairly before council awards a contract", "bloom": "analyze"}]'::jsonb,
  further_reading = '[
  {"title": "Strata management services (Province of BC)", "url": "https://www2.gov.bc.ca/gov/content/housing-tenancy/strata-housing/operating-a-strata/roles-and-responsibilities/strata-property-managers/strata-management-services", "note": "What a strata manager can do for council."},
  {"title": "Strata manager licensing (Province of BC)", "url": "https://www2.gov.bc.ca/gov/content/housing-tenancy/strata-housing/operating-a-strata/roles-and-responsibilities/strata-property-managers/licensing", "note": "Why strata managers must be licensed."}]'::jsonb
where curriculum_key = 'cr6' and pg_temp.objective_texts(objectives) = '["Respond on time to an owner''s request for records", "Protect owners'' and tenants'' personal information", "Decide what to delegate to a strata manager, or what a self-managed council takes on"]'::jsonb;

update public.training_modules set objectives = '[
  {"text": "Follow the steps the Act requires before fining an owner or tenant", "bloom": "apply"},
  {"text": "Respond to an owner''s complaint in a way that calms the conflict", "bloom": "apply"},
  {"text": "Decide when a dispute can go to the Civil Resolution Tribunal", "bloom": "apply"}]'::jsonb
where curriculum_key = 'cr4' and pg_temp.objective_texts(objectives) = '["Follow the steps the Act requires before fining an owner or tenant", "Apply the current limits on rental and age restriction bylaws", "Decide when a dispute can go to the Civil Resolution Tribunal"]'::jsonb;

update public.training_modules set objectives = '[
  {"text": "Read the strata''s monthly financial statements", "bloom": "understand"},
  {"text": "Compare actual spending with the budget and explain the differences", "bloom": "analyze"},
  {"text": "Explain what the year-end financial statements must include, and when an audit is needed", "bloom": "understand"}]'::jsonb
where curriculum_key = 't1' and pg_temp.objective_texts(objectives) = '["Read the strata''s monthly financial statements", "Compare actual spending with the budget and explain the differences", "Recommend which issues to raise with council"]'::jsonb;

update public.training_modules set objectives = '[
  {"text": "Follow the steps for collecting unpaid strata fees", "bloom": "apply"},
  {"text": "Explain when the strata can register a lien", "bloom": "understand"},
  {"text": "Check that the strata''s money is invested as the Regulation allows, with controls such as signing authority in place", "bloom": "analyze"}]'::jsonb
where curriculum_key = 't4' and pg_temp.objective_texts(objectives) = '["Follow the steps for collecting unpaid strata fees", "Explain when the strata can register a lien", "Check that financial controls such as signing authority and separation of duties are in place"]'::jsonb;

update public.training_modules set objectives = '[
  {"text": "Organize records so each is kept for the required time", "bloom": "apply"},
  {"text": "Respond to an owner''s records request within the deadline", "bloom": "apply"},
  {"text": "Decide which records an owner or tenant is entitled to see", "bloom": "analyze"}]'::jsonb
where curriculum_key = 's3' and pg_temp.objective_texts(objectives) = '["Organize records so each is kept for the required time", "Respond to an owner''s records request within the deadline", "Explain what an information certificate (Form B) is and who asks for one"]'::jsonb;

update public.training_modules set objectives = '[
  {"text": "Prepare an information certificate (Form B) within the deadline", "bloom": "apply"},
  {"text": "Explain when a certificate of payment (Form F) is needed", "bloom": "understand"},
  {"text": "Share information with owners without disclosing personal information", "bloom": "apply"}]'::jsonb
where curriculum_key = 's4' and pg_temp.objective_texts(objectives) = '["Handle owners'' letters and complaints consistently, in writing", "Share information with owners without disclosing personal information", "Keep the owner and tenant contact list secure"]'::jsonb;

-- ── Secretary 5: Using the Stratasphere ────────────────────────────────
insert into public.training_modules (track_id, order_index, title, summary, estimated_minutes, curriculum_key, objectives)
select t.id, 5, 'Using the Stratasphere',
  'The secretary''s work in the Stratasphere: agendas and notices, Meeting Mode, minutes, and the strata''s records.', 12, 's5',
  '[{"text": "Prepare a meeting agenda and notice in the Stratasphere", "bloom": "apply"},
    {"text": "Record decisions in Meeting Mode and publish the minutes", "bloom": "apply"},
    {"text": "Organize the strata''s documents so owners'' requests are quick to answer", "bloom": "apply"}]'::jsonb
from public.training_tracks t
where t.code = 'secretary'
  and not exists (select 1 from public.training_modules where curriculum_key = 's5');
