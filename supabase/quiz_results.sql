-- Quiz results table for quality-system-quiz.html
-- Run this in the Supabase SQL editor of your project.
--
-- REMINDER: When creating the Supabase project, select the London (UK) region,
-- consistent with UK-HOSTING-REQUIREMENT.md (this table stores participant PII).

create table quiz_results (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  document_control integer not null,
  capa_ncrs integer not null,
  audit_readiness integer not null,
  training integer not null,
  change_management integer not null,
  reporting integer not null,
  user_adoption integer not null,
  created_at timestamptz not null default now()
);

alter table quiz_results enable row level security;

grant usage on schema public to anon, authenticated;
grant insert on table quiz_results to anon;
grant select on table quiz_results to authenticated;

-- Anonymous/public users: insert only (no select, update, or delete)
create policy "Allow anonymous inserts"
  on quiz_results for insert to anon with check (true);

-- Authenticated dashboard users: select only
create policy "Allow authenticated reads"
  on quiz_results for select to authenticated using (true);
