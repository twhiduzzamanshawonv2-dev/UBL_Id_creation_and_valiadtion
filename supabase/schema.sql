-- ============================================================================
-- UBL ID Creation - Supabase PostgreSQL Schema
-- ----------------------------------------------------------------------------
-- Replaces the 3-tab Google Sheet (BP / Supervisor / FC) with a single
-- normalized `users` table, discriminated by `designation`/`role`.
--
-- Run this once in the Supabase SQL editor (Project -> SQL Editor -> New query)
-- against a fresh project. Safe to re-run: every statement is idempotent
-- (IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS ... CREATE POLICY).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Extensions
-- ----------------------------------------------------------------------------
create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists pg_trgm;    -- fast ILIKE / substring search

-- ----------------------------------------------------------------------------
-- Sequence backing the human-readable user_code (USR-<year>-<seq>), mirroring
-- the old Apps Script "global running total across all 3 tabs" id scheme, but
-- generated atomically by Postgres so concurrent inserts can never collide
-- (the old Sheets implementation could race under concurrent requests).
-- ----------------------------------------------------------------------------
create sequence if not exists public.user_code_seq start 1;

-- ----------------------------------------------------------------------------
-- users table
-- ----------------------------------------------------------------------------
create table if not exists public.users (
  id               uuid primary key default gen_random_uuid(),

  -- Human-readable ID shown throughout the UI/exports (e.g. "USR-2026-0001").
  -- Kept distinct from the uuid primary key: `id` is the stable internal key
  -- (used for report_to_id foreign keys, updates, deletes), `user_code` is the
  -- external/display identifier carried over from the Google Sheet.
  user_code        text not null unique,

  name             text not null,
  gender           text not null check (gender in ('Male', 'Female')),
  father_name      text not null,
  mother_name      text not null,

  -- TEXT, never numeric - preserves leading zeros (e.g. "01712345678").
  mobile           text not null unique check (mobile ~ '^01[3-9][0-9]{8}$'),
  email            text not null check (email ~* '^[^\s@]+@[A-Za-z]+(\.[A-Za-z]+)+$'),
  dob              date not null,

  -- Multi-select location fields - a user can have more than one of each.
  division         text[] not null default '{}',
  district         text[] not null default '{}',
  upazila          text[] not null default '{}',
  thana            text[] not null default '{}',

  designation      text not null check (designation in ('BP', 'Supervisor', 'FC')),
  role             text not null check (role in ('BP', 'Supervisor', 'FC')),

  -- Reporting hierarchy as a real foreign key instead of a fragile name-string
  -- match (the old Sheet stored the target's *name*). NULL for FC (top of the
  -- hierarchy). ON DELETE RESTRICT: a Supervisor/FC that is still someone's
  -- Report To target cannot be hard-deleted (the app never hard-deletes users
  -- anyway - only toggles status - but this protects the data either way).
  report_to_id     uuid references public.users(id) on delete restrict,

  nid              text not null unique check (nid ~ '^[0-9]{10}$|^[0-9]{13}$|^[0-9]{17}$'),
  nid_front_url    text,
  nid_back_url     text,
  user_photo_url   text,

  status           text not null default 'Active' check (status in ('Active', 'Inactive')),

  created_by       text,
  created_date     timestamptz not null default now(),
  updated_by       text,
  updated_date     timestamptz not null default now(),

  -- Designation and Role must always be identical (enforced app-side too, this
  -- is the authoritative backstop - mirrors validateDesignationRoleReportTo_
  -- in the old Code.gs).
  constraint designation_matches_role check (designation = role)
);

comment on table public.users is
  'Single normalized table for BP/Supervisor/FC users, replacing the old 3-tab Google Sheet.';
comment on column public.users.user_code is
  'Human-readable ID shown in the UI/Excel export (e.g. USR-2026-0001). Preserved from the Google Sheet id column during migration.';
comment on column public.users.report_to_id is
  'FK to users.id. BP -> a Supervisor, Supervisor -> an FC, FC -> NULL (top of hierarchy).';

-- Auto-generate user_code on insert if the caller didn't supply one (the
-- migration script DOES supply the original Sheet id, to preserve history).
create or replace function public.set_user_code()
returns trigger
language plpgsql
as $$
begin
  if new.user_code is null or new.user_code = '' then
    new.user_code := 'USR-' || extract(year from now())::text || '-' ||
                      lpad(nextval('public.user_code_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_user_code on public.users;
create trigger trg_set_user_code
  before insert on public.users
  for each row execute function public.set_user_code();

-- Keep updated_date current on every UPDATE (the app also sets updated_by).
create or replace function public.touch_updated_date()
returns trigger
language plpgsql
as $$
begin
  new.updated_date := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_updated_date on public.users;
create trigger trg_touch_updated_date
  before update on public.users
  for each row execute function public.touch_updated_date();

-- Backend/database-level backstop for email normalization (Smart Email
-- Validation Engine - see js/email-validator.js): register_user() already
-- inserts a lowercased/trimmed, typo-corrected email, but this trigger makes
-- lowercase+trim unconditional at the DATABASE level too, so a row can never
-- end up with an uppercase/untrimmed email regardless of write path (a direct
-- `sb.from('users').insert()`/`.update()` call, a future bulk-import RPC,
-- etc.) - "do not trust the frontend" applied to email casing specifically,
-- matching the same normalize-before-save posture as the RLS/RPC scoping
-- everywhere else in this file. Does NOT reimplement typo/domain correction
-- in SQL - that logic stays client-side in the one shared JS engine (see the
-- file header there) precisely so it's never duplicated.
create or replace function public.normalize_user_email()
returns trigger
language plpgsql
as $$
begin
  if new.email is not null then
    new.email := lower(trim(new.email));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_normalize_user_email on public.users;
create trigger trg_normalize_user_email
  before insert or update on public.users
  for each row execute function public.normalize_user_email();

-- Tightened to match the Smart Email Validation Engine's structural rules
-- (js/email-validator.js) - the original check only rejected a missing "@"/
-- missing extension; it did NOT reject a local part with a leading/trailing/
-- consecutive dot (e.g. "rahim..ahmed@gmail.com"), which the JS engine does
-- reject. ALTER (not part of the original inline `create table` check) so
-- this stays idempotent on an already-existing table. Added NOT VALID so
-- re-running this script on a live database can never fail/abort because of
-- some already-existing row that predates this stricter rule - it only
-- applies to every NEW insert/update from here on; run `alter table
-- public.users validate constraint users_email_check` manually later, once
-- any legacy rows have been cleaned up, if full retroactive enforcement is wanted.
alter table public.users drop constraint if exists users_email_check;
alter table public.users add constraint users_email_check
  check (email ~* '^[a-z0-9]+([._%+-][a-z0-9]+)*@[a-z]+(\.[a-z]+)+$') not valid;

-- Report To hierarchy check, enforced at the database level as a second gate
-- behind the app's own validation (mirrors validateDesignationRoleReportTo_):
--   - FC must have report_to_id = NULL.
--   - BP's report_to_id must point to an Active Supervisor.
--   - Supervisor's report_to_id must point to an Active FC.
create or replace function public.validate_report_to()
returns trigger
language plpgsql
as $$
declare
  target_designation text;
  target_row public.users%rowtype;
begin
  if new.designation = 'FC' then
    if new.report_to_id is not null then
      raise exception 'FC users must not have a Report To.';
    end if;
    return new;
  end if;

  target_designation := case new.designation when 'BP' then 'Supervisor' when 'Supervisor' then 'FC' end;

  if new.report_to_id is null then
    raise exception 'Report To is required and must be an active %.', target_designation;
  end if;

  select * into target_row from public.users where id = new.report_to_id;
  if not found
     or target_row.status <> 'Active'
     or target_row.designation <> target_designation
     or target_row.role <> target_designation
     or target_row.agency_id <> new.agency_id
     or target_row.campaign_id <> new.campaign_id then
    raise exception 'Report To must be an existing, active % within the same Agency and Campaign.', target_designation;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_report_to on public.users;
create trigger trg_validate_report_to
  before insert or update on public.users
  for each row execute function public.validate_report_to();

-- ----------------------------------------------------------------------------
-- Agencies & Campaigns (master data) - a user submission is now scoped to one
-- Agency + one Campaign. A Campaign belongs to exactly one Agency (dependent
-- dropdown in the UI). Both are admin-manageable (add/edit only - no hard
-- delete, same "toggle status" pattern as users).
-- ----------------------------------------------------------------------------
create table if not exists public.agencies (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  status       text not null default 'Active' check (status in ('Active', 'Inactive')),
  created_by   text,
  created_date timestamptz not null default now(),
  updated_by   text,
  updated_date timestamptz not null default now()
);

comment on table public.agencies is
  'Reusable Agency master data (e.g. "Asiatic Experiential Marketing Ltd."). Admin-managed via the Agencies screen.';

drop trigger if exists trg_agencies_touch_updated_date on public.agencies;
create trigger trg_agencies_touch_updated_date
  before update on public.agencies
  for each row execute function public.touch_updated_date();

create table if not exists public.campaigns (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references public.agencies(id) on delete restrict,
  name         text not null,
  status       text not null default 'Active' check (status in ('Active', 'Inactive')),
  created_by   text,
  created_date timestamptz not null default now(),
  updated_by   text,
  updated_date timestamptz not null default now(),

  -- A Campaign name only needs to be unique WITHIN its Agency (two different
  -- agencies can both run a campaign called "Corporate Drive").
  constraint campaigns_agency_name_unique unique (agency_id, name)
);

comment on table public.campaigns is
  'Reusable Campaign master data, each belonging to exactly one Agency (dependent dropdown in the UI).';

drop trigger if exists trg_campaigns_touch_updated_date on public.campaigns;
create trigger trg_campaigns_touch_updated_date
  before update on public.campaigns
  for each row execute function public.touch_updated_date();

create index if not exists idx_campaigns_agency_id on public.campaigns (agency_id);
create index if not exists idx_agencies_status      on public.agencies (status);
create index if not exists idx_campaigns_status     on public.campaigns (status);

-- Seed the "Unassigned" fallback pair BEFORE users.agency_id/campaign_id go
-- NOT NULL below - every pre-existing users row is backfilled onto this pair.
-- Safe to re-run (ON CONFLICT DO NOTHING keeps the same row/id every time).
insert into public.agencies (name, status, created_by, updated_by)
values ('Unassigned', 'Active', 'System (Migration)', 'System (Migration)')
on conflict (name) do nothing;

insert into public.campaigns (agency_id, name, status, created_by, updated_by)
select id, 'Unassigned', 'Active', 'System (Migration)', 'System (Migration)'
from public.agencies where name = 'Unassigned'
on conflict (agency_id, name) do nothing;

-- ----------------------------------------------------------------------------
-- users table alterations - scope every user submission to an Agency+Campaign,
-- and drop the old GLOBAL mobile/nid uniqueness in favor of composite
-- UNIQUE(agency_id, campaign_id, mobile/nid) - the same person CAN now be
-- resubmitted under a different Agency+Campaign, but not twice under the SAME one.
-- ----------------------------------------------------------------------------
alter table public.users add column if not exists agency_id   uuid references public.agencies(id) on delete restrict;
alter table public.users add column if not exists campaign_id uuid references public.campaigns(id) on delete restrict;

-- Backfill existing rows onto "Unassigned"/"Unassigned" before NOT NULL below.
-- trg_validate_report_to is disabled for this single UPDATE only: it now checks
-- report_to_id's target row against the same agency_id/campaign_id, and during
-- a bulk backfill the target row's own agency_id/campaign_id may not have been
-- written yet in the same statement (row processing order isn't guaranteed) -
-- re-enabled immediately after, before any real insert/update can occur.
alter table public.users disable trigger trg_validate_report_to;

update public.users
set agency_id = (select id from public.agencies where name = 'Unassigned'),
    campaign_id = (select c.id from public.campaigns c
                    join public.agencies a on a.id = c.agency_id
                    where a.name = 'Unassigned' and c.name = 'Unassigned')
where agency_id is null or campaign_id is null;

alter table public.users enable trigger trg_validate_report_to;

alter table public.users alter column agency_id set not null;
alter table public.users alter column campaign_id set not null;

-- Defense-in-depth: the selected Campaign must actually belong to the selected
-- Agency (mirrors the same check already done in register_user()).
create or replace function public.validate_user_campaign_agency()
returns trigger
language plpgsql
as $$
declare
  campaign_agency_id uuid;
begin
  select agency_id into campaign_agency_id from public.campaigns where id = new.campaign_id;
  if campaign_agency_id is null or campaign_agency_id <> new.agency_id then
    raise exception 'Selected Campaign does not belong to the selected Agency.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_user_campaign_agency on public.users;
create trigger trg_validate_user_campaign_agency
  before insert or update on public.users
  for each row execute function public.validate_user_campaign_agency();

alter table public.users drop constraint if exists users_mobile_key;
alter table public.users drop constraint if exists users_nid_key;

drop index if exists idx_users_mobile_agency_campaign;
drop index if exists idx_users_nid_agency_campaign;
create unique index idx_users_mobile_agency_campaign on public.users (agency_id, campaign_id, mobile);
create unique index idx_users_nid_agency_campaign     on public.users (agency_id, campaign_id, nid);
-- (the existing regex CHECK constraints on mobile/nid format are untouched -
-- only the uniqueness SCOPE changed, not format validity.)

-- Same composite-uniqueness rule as mobile/nid above, now for email too - the same
-- email CAN legitimately be reused under a different Agency+Campaign, but not twice
-- within the same one. Safe to compare the raw `email` column directly (no lower()
-- needed): trg_normalize_user_email already lowercases/trims every email before it's
-- ever written, so two rows can only collide here if they're truly the same address.
drop index if exists idx_users_email_agency_campaign;
create unique index idx_users_email_agency_campaign on public.users (agency_id, campaign_id, email);

create index if not exists idx_users_agency_id   on public.users (agency_id);
create index if not exists idx_users_campaign_id on public.users (campaign_id);
-- Speeds up the very common "Report To candidates" lookup, now scoped to
-- Agency+Campaign+Designation+Active in addition to the plain designation_status index below.
create index if not exists idx_users_agency_campaign_designation_status
  on public.users (agency_id, campaign_id, designation, status);

-- ----------------------------------------------------------------------------
-- account_profiles - multi-tenant login accounts. Extends Supabase Auth
-- (auth.users) rather than duplicating it: this table only maps an existing
-- auth.users.id to a role + Agency/Campaign scope. Password storage/hashing
-- stays entirely inside Supabase Auth - never touched or duplicated here.
--
-- A row with role='super_admin' has NULL agency_id/campaign_id (unrestricted
-- access). A row with role='agency_admin' is permanently scoped to exactly
-- one Agency+Campaign. An auth.users account with NO row here at all is
-- treated as Super Admin (see is_super_admin() below) - this is the deliberate
-- bootstrap rule so pre-existing admin accounts (created before this table
-- existed) keep working with zero manual migration.
-- ----------------------------------------------------------------------------
create table if not exists public.account_profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  username     text,                -- friendly label, e.g. "asiatic_horlicks_school"
  email        text,                -- denormalized/informational only - `id` is the real binding
  role         text not null default 'agency_admin' check (role in ('super_admin', 'agency_admin')),
  agency_id    uuid references public.agencies(id) on delete restrict,
  campaign_id  uuid references public.campaigns(id) on delete restrict,
  status       text not null default 'Active' check (status in ('Active', 'Inactive', 'Suspended')),
  created_by   text,
  created_date timestamptz not null default now(),
  updated_by   text,
  updated_date timestamptz not null default now(),

  constraint account_profiles_scope_check check (
    (role = 'super_admin' and agency_id is null and campaign_id is null)
    or (role = 'agency_admin' and agency_id is not null and campaign_id is not null)
  )
);

comment on table public.account_profiles is
  'Maps a Supabase Auth user to a role (super_admin/agency_admin) and, for agency_admin, a permanent Agency+Campaign scope. No row = legacy Super Admin (see is_super_admin()).';

drop trigger if exists trg_account_profiles_touch_updated_date on public.account_profiles;
create trigger trg_account_profiles_touch_updated_date
  before update on public.account_profiles
  for each row execute function public.touch_updated_date();

-- Reuses the same "Campaign must belong to the selected Agency" check already
-- enforced on `users` - the function only ever reads NEW.agency_id/campaign_id,
-- so it applies unchanged to this table. Only fires when both are non-null
-- (super_admin rows have NULL/NULL, which the CHECK constraint above already
-- permits - skip the trigger's lookup entirely in that case rather than
-- querying campaigns with a NULL id).
drop trigger if exists trg_validate_account_campaign_agency on public.account_profiles;
create trigger trg_validate_account_campaign_agency
  before insert or update on public.account_profiles
  for each row
  when (new.campaign_id is not null)
  execute function public.validate_user_campaign_agency();

create index if not exists idx_account_profiles_agency_campaign on public.account_profiles (agency_id, campaign_id);
create index if not exists idx_account_profiles_status on public.account_profiles (status);

-- ----------------------------------------------------------------------------
-- Tenant-scoping helper functions - SECURITY DEFINER so they bypass RLS
-- internally (reading account_profiles directly), which is what lets them be
-- called safely from inside RLS policies on OTHER tables without recursion.
-- ----------------------------------------------------------------------------

-- No profile row = legacy pre-existing admin account = Super Admin (the
-- deliberate bootstrap rule - see table comment above). An explicit
-- agency_admin row NEVER becomes Super Admin regardless of status.
create or replace function public.is_super_admin()
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_role text;
  v_status text;
begin
  select role, status into v_role, v_status from public.account_profiles where id = auth.uid();
  if v_role is null then
    return true;
  end if;
  return v_role = 'super_admin' and v_status = 'Active';
end;
$$;

-- NULL for Super Admins AND for inactive/suspended agency_admin accounts -
-- fail-closed: if an inactive account's session token is somehow still used,
-- it matches nothing (agency_id = NULL is never true) rather than its old scope.
create or replace function public.my_agency_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select agency_id from public.account_profiles where id = auth.uid() and status = 'Active';
$$;

create or replace function public.my_campaign_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select campaign_id from public.account_profiles where id = auth.uid() and status = 'Active';
$$;

grant execute on function public.is_super_admin() to authenticated;
grant execute on function public.my_agency_id() to authenticated;
grant execute on function public.my_campaign_id() to authenticated;

-- ----------------------------------------------------------------------------
-- RLS for account_profiles - a session may always read its OWN profile row
-- (needed on login to discover its own scope); only Super Admin may read
-- every row, or insert/update any row (the Campaign Logins admin screen).
-- ----------------------------------------------------------------------------
alter table public.account_profiles enable row level security;

drop policy if exists account_profiles_select on public.account_profiles;
create policy account_profiles_select on public.account_profiles
  for select to authenticated
  using (id = auth.uid() or public.is_super_admin());

drop policy if exists account_profiles_insert_super_admin on public.account_profiles;
create policy account_profiles_insert_super_admin on public.account_profiles
  for insert to authenticated
  with check (public.is_super_admin());

drop policy if exists account_profiles_update_super_admin on public.account_profiles;
create policy account_profiles_update_super_admin on public.account_profiles
  for update to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- ----------------------------------------------------------------------------
-- RLS for agencies/campaigns - low-sensitivity master data (names only), not
-- PII like `users`. There is no more public (anon) registration to serve, so
-- anon access is removed entirely. Any authenticated account may still SELECT
-- (needed for header/display names even for a scoped account), but only
-- Super Admin may INSERT/UPDATE (Agencies/Campaigns admin screens are now
-- Super-Admin-only per the multi-tenant login system).
-- ----------------------------------------------------------------------------
alter table public.agencies enable row level security;
alter table public.campaigns enable row level security;

drop policy if exists agencies_select_all on public.agencies;
drop policy if exists agencies_select_authenticated on public.agencies;
create policy agencies_select_authenticated on public.agencies
  for select to authenticated using (true);

drop policy if exists agencies_insert_authenticated on public.agencies;
drop policy if exists agencies_insert_super_admin on public.agencies;
create policy agencies_insert_super_admin on public.agencies
  for insert to authenticated with check (public.is_super_admin());

drop policy if exists agencies_update_authenticated on public.agencies;
drop policy if exists agencies_update_super_admin on public.agencies;
create policy agencies_update_super_admin on public.agencies
  for update to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists campaigns_select_all on public.campaigns;
drop policy if exists campaigns_select_authenticated on public.campaigns;
create policy campaigns_select_authenticated on public.campaigns
  for select to authenticated using (true);

drop policy if exists campaigns_insert_authenticated on public.campaigns;
drop policy if exists campaigns_insert_super_admin on public.campaigns;
create policy campaigns_insert_super_admin on public.campaigns
  for insert to authenticated with check (public.is_super_admin());

drop policy if exists campaigns_update_authenticated on public.campaigns;
drop policy if exists campaigns_update_super_admin on public.campaigns;
create policy campaigns_update_super_admin on public.campaigns
  for update to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

-- Hard delete is Super-Admin-only. The existing ON DELETE RESTRICT foreign
-- keys (campaigns.agency_id -> agencies, users.agency_id/campaign_id ->
-- agencies/campaigns, account_profiles.agency_id/campaign_id) are the actual
-- backstop: an Agency still owning Campaigns, or a Campaign still owning
-- Users/login accounts, cannot be deleted regardless of this policy - the
-- app surfaces that FK violation as a friendly "still in use" message
-- (see db-service.js mapDbError) instead of letting the delete silently cascade.
drop policy if exists agencies_delete_super_admin on public.agencies;
create policy agencies_delete_super_admin on public.agencies
  for delete to authenticated using (public.is_super_admin());

drop policy if exists campaigns_delete_super_admin on public.campaigns;
create policy campaigns_delete_super_admin on public.campaigns
  for delete to authenticated using (public.is_super_admin());

-- ----------------------------------------------------------------------------
-- Indexes - only for fields that are actually searched/filtered/sorted on.
-- Unique constraints above already create indexes for user_code/mobile/nid.
-- ----------------------------------------------------------------------------
create index if not exists idx_users_name_trgm      on public.users using gin (name gin_trgm_ops);
create index if not exists idx_users_email           on public.users (email);
create index if not exists idx_users_designation     on public.users (designation);
create index if not exists idx_users_role            on public.users (role);
create index if not exists idx_users_status          on public.users (status);
create index if not exists idx_users_report_to_id    on public.users (report_to_id);
create index if not exists idx_users_created_date    on public.users (created_date);
-- Array containment lookups (division @> ARRAY['Dhaka'], used by location filters).
create index if not exists idx_users_division_gin    on public.users using gin (division);
create index if not exists idx_users_district_gin    on public.users using gin (district);
create index if not exists idx_users_upazila_gin     on public.users using gin (upazila);
create index if not exists idx_users_thana_gin       on public.users using gin (thana);
-- Speeds up the very common "Report To" lookup: WHERE designation = X AND status = 'Active'.
create index if not exists idx_users_designation_status on public.users (designation, status);

-- ----------------------------------------------------------------------------
-- Row Level Security - multi-tenant scoped.
-- ----------------------------------------------------------------------------
-- There is no more public (anon, no-login) surface at all - Add User,
-- Users, Export, and Validation all require a logged-in account (see
-- account_profiles above). Direct table access is locked to `authenticated`,
-- and further scoped PER ACCOUNT: a Super Admin sees/writes everything, an
-- agency_admin account sees/writes ONLY rows matching its own permanent
-- agency_id/campaign_id (from account_profiles, resolved server-side via
-- my_agency_id()/my_campaign_id() - never trusted from the client). This is
-- the actual enforcement layer: even a hand-crafted `sb.from('users').insert()`
-- call with a forged agency_id from browser devtools is rejected here, not
-- just hidden by the UI. register_user/check_duplicate_public/
-- get_report_to_candidates (below) add a second, redundant layer of the same
-- check inside the RPCs themselves.
alter table public.users enable row level security;

drop policy if exists users_select_anon on public.users;
drop policy if exists users_insert_anon on public.users;
drop policy if exists users_update_anon on public.users;
drop policy if exists users_select_authenticated on public.users;
drop policy if exists users_insert_authenticated on public.users;
drop policy if exists users_update_authenticated on public.users;

drop policy if exists users_select_scoped on public.users;
create policy users_select_scoped on public.users
  for select
  to authenticated
  using (
    public.is_super_admin()
    or (agency_id = public.my_agency_id() and campaign_id = public.my_campaign_id())
  );

drop policy if exists users_insert_scoped on public.users;
create policy users_insert_scoped on public.users
  for insert
  to authenticated
  with check (
    public.is_super_admin()
    or (agency_id = public.my_agency_id() and campaign_id = public.my_campaign_id())
  );

drop policy if exists users_update_scoped on public.users;
create policy users_update_scoped on public.users
  for update
  to authenticated
  using (
    public.is_super_admin()
    or (agency_id = public.my_agency_id() and campaign_id = public.my_campaign_id())
  )
  with check (
    public.is_super_admin()
    or (agency_id = public.my_agency_id() and campaign_id = public.my_campaign_id())
  );

-- ----------------------------------------------------------------------------
-- Storage buckets for NID Front/Back and User Photo (replacing Google Drive).
-- ----------------------------------------------------------------------------
-- Both buckets are PRIVATE. There is no more public (anon) upload path -
-- registration now requires a logged-in account, so uploads are
-- authenticated-only. Reading a file back (admin table avatars, User Details
-- modal, signed download links) is scoped to the SAME Agency+Campaign as the
-- `users` row that owns the object path (or Super Admin) - closes the gap
-- where any logged-in session could otherwise sign a URL for ANY object by
-- path, regardless of which campaign it belonged to. The app resolves
-- short-lived signed URLs on demand (see js/db-service.js getSignedDocUrls()),
-- never a permanent public link.
update storage.buckets set public = false where id = 'user-photos';
insert into storage.buckets (id, name, public)
values ('user-photos', 'user-photos', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('nid-documents', 'nid-documents', false)
on conflict (id) do nothing;

-- Indexes backing the ownership-lookup subqueries in the scoped SELECT
-- policies below - each policy check does an `exists (select 1 from users
-- where <url column> = storage.objects.name and ...)`, so these keep that
-- lookup fast instead of a sequential scan per signed-URL request.
create index if not exists idx_users_user_photo_url on public.users (user_photo_url);
create index if not exists idx_users_nid_front_url  on public.users (nid_front_url);
create index if not exists idx_users_nid_back_url   on public.users (nid_back_url);

drop policy if exists user_photos_public_read on storage.objects;
drop policy if exists user_photos_anon_upload on storage.objects;
drop policy if exists nid_documents_anon_select on storage.objects;
drop policy if exists nid_documents_anon_upload on storage.objects;
drop policy if exists user_photos_authenticated_select on storage.objects;
drop policy if exists nid_documents_authenticated_select on storage.objects;

drop policy if exists user_photos_scoped_select on storage.objects;
create policy user_photos_scoped_select on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'user-photos'
    and (
      public.is_super_admin()
      or exists (
        select 1 from public.users u
        where u.user_photo_url = storage.objects.name
          and u.agency_id = public.my_agency_id()
          and u.campaign_id = public.my_campaign_id()
      )
    )
  );

drop policy if exists user_photos_upload on storage.objects;
create policy user_photos_upload on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'user-photos');

drop policy if exists nid_documents_scoped_select on storage.objects;
create policy nid_documents_scoped_select on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'nid-documents'
    and (
      public.is_super_admin()
      or exists (
        select 1 from public.users u
        where (u.nid_front_url = storage.objects.name or u.nid_back_url = storage.objects.name)
          and u.agency_id = public.my_agency_id()
          and u.campaign_id = public.my_campaign_id()
      )
    )
  );

drop policy if exists nid_documents_upload on storage.objects;
create policy nid_documents_upload on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'nid-documents');

-- ----------------------------------------------------------------------------
-- Tenant-scoped RPC functions
-- ----------------------------------------------------------------------------
-- Authenticated-only (there is no more public/anon surface anywhere in this
-- app). Registration, duplicate-checking, and Report To candidate lookup all
-- go through these three SECURITY DEFINER functions rather than direct table
-- access so that, for a non-Super-Admin account, the caller's Agency+Campaign
-- scope can be resolved server-side from account_profiles and NEVER trusted
-- from client-supplied parameters - see the comment on each function below.
-- This is defense in depth on top of the `users`/Storage RLS policies above,
-- which enforce the same scoping as the ultimate backstop either way.

-- Returns whether a Mobile/NID/Email is already in use WITHIN THE SAME AGENCY+CAMPAIGN,
-- without exposing any other row data. The same person (or address) CAN legitimately be
-- registered under a different Agency+Campaign - only an exact Agency+Campaign+
-- Mobile/NID/Email repeat is a duplicate. `p_exclude_code` lets the admin Edit modal
-- reuse this same check while editing an existing user.
--
-- Now authenticated-only (anon revoked - there is no more public registration).
-- For a non-Super-Admin caller, the Agency+Campaign scope is ALWAYS resolved
-- server-side from account_profiles via auth.uid() - the p_agency_id/
-- p_campaign_id arguments are silently ignored for that caller, never
-- trusted, even though they're still accepted as parameters (Super Admin
-- callers, who have no fixed scope of their own, use them as explicit
-- filters). This is defense in depth on top of the RLS policies on `users`
-- itself, which would reject a mismatched insert/select regardless.
drop function if exists public.check_duplicate_public(text, text, text);
drop function if exists public.check_duplicate_public(text, text, uuid, uuid, text);

create or replace function public.check_duplicate_public(
  p_mobile text,
  p_nid text,
  p_agency_id uuid,
  p_campaign_id uuid,
  p_exclude_code text default null,
  p_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_mobile text := nullif(trim(p_mobile), '');
  clean_nid text := nullif(trim(p_nid), '');
  clean_email text := nullif(lower(trim(p_email)), '');
  hit_code text;
  v_caller_role text;
  v_caller_status text;
  v_agency_id uuid;
  v_campaign_id uuid;
begin
  select role, status, agency_id, campaign_id into v_caller_role, v_caller_status, v_agency_id, v_campaign_id
    from public.account_profiles where id = auth.uid();

  if v_caller_role is null then
    v_caller_role := 'super_admin'; -- no profile row = legacy Super Admin bootstrap rule
  elsif v_caller_status <> 'Active' then
    raise exception 'Your account is not active. Contact your administrator.';
  end if;

  if v_caller_role = 'super_admin' then
    v_agency_id := p_agency_id;
    v_campaign_id := p_campaign_id;
  end if;
  -- else: v_agency_id/v_campaign_id already hold the caller's own scope from the lookup above.

  if clean_mobile is not null then
    select user_code into hit_code from public.users
      where mobile = clean_mobile
        and agency_id = v_agency_id and campaign_id = v_campaign_id
        and (p_exclude_code is null or user_code <> p_exclude_code)
      limit 1;
    if hit_code is not null then
      return jsonb_build_object(
        'duplicate', true, 'field', 'Mobile Number',
        'message', format('This user (Mobile Number ''%s'') is already registered for this campaign.', clean_mobile)
      );
    end if;
  end if;

  if clean_nid is not null then
    select user_code into hit_code from public.users
      where nid = clean_nid
        and agency_id = v_agency_id and campaign_id = v_campaign_id
        and (p_exclude_code is null or user_code <> p_exclude_code)
      limit 1;
    if hit_code is not null then
      return jsonb_build_object(
        'duplicate', true, 'field', 'NID Number',
        'message', format('This user (NID Number ''%s'') is already registered for this campaign.', clean_nid)
      );
    end if;
  end if;

  if clean_email is not null then
    select user_code into hit_code from public.users
      where email = clean_email
        and agency_id = v_agency_id and campaign_id = v_campaign_id
        and (p_exclude_code is null or user_code <> p_exclude_code)
      limit 1;
    if hit_code is not null then
      return jsonb_build_object(
        'duplicate', true, 'field', 'Email',
        'message', format('This user (Email ''%s'') is already registered for this campaign.', clean_email)
      );
    end if;
  end if;

  return jsonb_build_object('duplicate', false);
end;
$$;

grant execute on function public.check_duplicate_public(text, text, uuid, uuid, text, text) to authenticated;
revoke execute on function public.check_duplicate_public(text, text, uuid, uuid, text, text) from anon;

-- Report To candidates for a given target designation, scoped to a specific
-- Agency+Campaign (Active, matching designation/role, same Agency+Campaign
-- as the submitting user only) - just enough (id/user_code/name) to power
-- the searchable picker on both the Create form and the admin Edit modal.
-- A BP in Campaign A must never see a Supervisor from Campaign B, even under
-- the same Agency.
--
-- Now authenticated-only (anon revoked). Uses `language plpgsql` (not the
-- original `sql`) so it can resolve the caller's own scope from
-- account_profiles first - same non-super-admin-never-trusts-the-arguments
-- rule as check_duplicate_public() above.
drop function if exists public.get_report_to_candidates(text);

create or replace function public.get_report_to_candidates(
  p_designation text,
  p_agency_id uuid,
  p_campaign_id uuid
)
returns table (user_id uuid, user_code text, name text)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_caller_role text;
  v_caller_status text;
  v_agency_id uuid;
  v_campaign_id uuid;
begin
  select role, status, agency_id, campaign_id into v_caller_role, v_caller_status, v_agency_id, v_campaign_id
    from public.account_profiles where id = auth.uid();

  if v_caller_role is null then
    v_caller_role := 'super_admin';
  elsif v_caller_status <> 'Active' then
    raise exception 'Your account is not active. Contact your administrator.';
  end if;

  if v_caller_role = 'super_admin' then
    v_agency_id := p_agency_id;
    v_campaign_id := p_campaign_id;
  end if;

  return query
    select u.id, u.user_code, u.name
    from public.users u
    where u.status = 'Active'
      and u.designation = p_designation
      and u.role = p_designation
      and u.agency_id = v_agency_id
      and u.campaign_id = v_campaign_id
    order by u.name asc;
end;
$$;

grant execute on function public.get_report_to_candidates(text, uuid, uuid) to authenticated;
revoke execute on function public.get_report_to_candidates(text, uuid, uuid) from anon;

-- Active Campaigns count for the Dashboard KPI tile - deliberately
-- AGENCY-level, not Campaign-level, unlike every other dashboard/list/export
-- metric in this system. A non-Super-Admin caller's own agency_id is ALWAYS
-- resolved server-side from account_profiles via auth.uid() (p_agency_id is
-- silently ignored for that caller - only a Super Admin's argument is
-- honored, e.g. the Dashboard's own Agency filter dropdown). This closes the
-- gap where the KPI used to run a bare `select count(*) from campaigns`
-- client-side - the `campaigns` table's SELECT RLS policy is intentionally
-- open to any authenticated account (it's just names, not PII), so without
-- this RPC a scoped account's dashboard would silently show the GLOBAL
-- active-campaign count across every Agency instead of just its own.
--
-- The caller's own campaign_id is INTENTIONALLY IGNORED here (p_campaign_id
-- is accepted only for a Super Admin's benefit, never applied to a scoped
-- caller's own scope) - this one KPI answers "how many active Campaigns does
-- my Agency run", not "am I looking at my own Campaign". Every other
-- Agency+Campaign-scoped surface (Users, Dashboard user counts, Recent
-- Users, Search, Export, Report To, ...) is completely unaffected - those
-- still go through users_select_scoped RLS, which stays Agency+Campaign.
create or replace function public.get_active_campaigns_count(
  p_agency_id uuid default null,
  p_campaign_id uuid default null
)
returns bigint
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_caller_role text;
  v_caller_status text;
  v_agency_id uuid;
  v_campaign_id uuid;
  v_count bigint;
begin
  select role, status, agency_id, campaign_id into v_caller_role, v_caller_status, v_agency_id, v_campaign_id
    from public.account_profiles where id = auth.uid();

  if v_caller_role is null then
    v_caller_role := 'super_admin'; -- no profile row = legacy Super Admin bootstrap rule
  elsif v_caller_status <> 'Active' then
    raise exception 'Your account is not active. Contact your administrator.';
  end if;

  if v_caller_role = 'super_admin' then
    v_agency_id := p_agency_id;
    v_campaign_id := p_campaign_id;
  else
    v_campaign_id := null; -- ignore the caller's own campaign_id - this count is Agency-wide, not Campaign-specific
  end if;
  -- else (non-super-admin): v_agency_id already holds the caller's own permanent Agency scope from the lookup above.

  select count(*) into v_count
  from public.campaigns c
  where c.status = 'Active'
    and (v_agency_id is null or c.agency_id = v_agency_id)
    and (v_campaign_id is null or c.id = v_campaign_id);

  return v_count;
end;
$$;

grant execute on function public.get_active_campaigns_count(uuid, uuid) to authenticated;
revoke execute on function public.get_active_campaigns_count(uuid, uuid) from anon;

-- Shared row-insertion core used by BOTH register_user() (manual, single-row)
-- and import_users_batch() (Super-Admin-only Excel import, many rows) - the
-- duplicate check + Report To resolution + insert must never diverge between
-- the two entry points (spec: "Do not create a separate user creation
-- mechanism with different rules"). Not granted directly to `authenticated` -
-- only callable from within another SECURITY DEFINER function in this file.
create or replace function public._insert_registered_user(v_agency_id uuid, v_campaign_id uuid, p jsonb, v_actor text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mobile text := trim(p->>'mobile');
  v_nid text := trim(p->>'nid');
  v_email text := trim(p->>'email');
  v_designation text := p->>'designation';
  v_role text := p->>'role';
  v_report_to_name text := nullif(trim(p->>'reportTo'), '');
  v_target_designation text;
  v_report_to_id uuid;
  v_row public.users%rowtype;
  v_dup jsonb;
  v_campaign_agency_id uuid;
begin
  if v_agency_id is null or v_campaign_id is null then
    raise exception 'Agency and Campaign are required.';
  end if;

  select agency_id into v_campaign_agency_id from public.campaigns where id = v_campaign_id;
  if v_campaign_agency_id is null or v_campaign_agency_id <> v_agency_id then
    raise exception 'Selected Campaign does not belong to the selected Agency.';
  end if;

  v_dup := public.check_duplicate_public(v_mobile, v_nid, v_agency_id, v_campaign_id, null, v_email);
  if (v_dup->>'duplicate')::boolean then
    raise exception '%', v_dup->>'message';
  end if;

  v_target_designation := case v_designation
    when 'BP' then 'Supervisor'
    when 'Supervisor' then 'FC'
    else null
  end;

  if v_target_designation is not null then
    if v_report_to_name is null then
      raise exception 'Report To is required and must be a %.', v_target_designation;
    end if;
    select id into v_report_to_id from public.users
      where name = v_report_to_name
        and designation = v_target_designation
        and role = v_target_designation
        and status = 'Active'
        and agency_id = v_agency_id
        and campaign_id = v_campaign_id
      limit 1;
    if v_report_to_id is null then
      raise exception 'Report To must be an existing, active % within the same Agency and Campaign.', v_target_designation;
    end if;
  elsif v_report_to_name is not null then
    raise exception 'FC users must not have a Report To.';
  end if;

  insert into public.users (
    name, gender, father_name, mother_name, mobile, email, dob,
    division, district, upazila, thana, designation, role, report_to_id,
    nid, nid_front_url, nid_back_url, user_photo_url, status,
    agency_id, campaign_id, created_by, updated_by
  ) values (
    p->>'name', p->>'gender', p->>'fatherName', p->>'motherName', v_mobile, p->>'email',
    (p->>'dob')::date,
    coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'division', '[]'::jsonb)) x), '{}'),
    coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'district', '[]'::jsonb)) x), '{}'),
    coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'upazila', '[]'::jsonb)) x), '{}'),
    coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'thana', '[]'::jsonb)) x), '{}'),
    v_designation, v_role, v_report_to_id,
    v_nid, p->>'nidFrontUrl', p->>'nidBackUrl', p->>'userPhotoUrl',
    'Active', v_agency_id, v_campaign_id, v_actor, v_actor
  )
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id, 'user_code', v_row.user_code, 'name', v_row.name, 'gender', v_row.gender,
    'father_name', v_row.father_name, 'mother_name', v_row.mother_name, 'mobile', v_row.mobile,
    'email', v_row.email, 'dob', v_row.dob, 'division', v_row.division, 'district', v_row.district,
    'upazila', v_row.upazila, 'thana', v_row.thana, 'designation', v_row.designation, 'role', v_row.role,
    'report_to_id', v_row.report_to_id, 'report_to_name', v_report_to_name,
    'nid', v_row.nid, 'nid_front_url', v_row.nid_front_url, 'nid_back_url', v_row.nid_back_url,
    'user_photo_url', v_row.user_photo_url, 'status', v_row.status,
    'agency_id', v_row.agency_id, 'campaign_id', v_row.campaign_id,
    'created_by', v_row.created_by, 'created_date', v_row.created_date,
    'updated_by', v_row.updated_by, 'updated_date', v_row.updated_date
  );
end;
$$;

-- Not granted to `authenticated`/`anon` directly - only register_user() and
-- import_users_batch() (both SECURITY DEFINER) call it.
revoke all on function public._insert_registered_user(uuid, uuid, jsonb, text) from public, authenticated, anon;

-- Performs the full user-registration write (duplicate check + Report To
-- resolution + insert) atomically and returns the created row shaped like
-- `users_with_report_to`. Authenticated-only (anon revoked - there is no more
-- public registration). For a non-Super-Admin caller, agency_id/campaign_id
-- are ALWAYS resolved server-side from account_profiles via auth.uid() -
-- `p->>'agencyId'`/`p->>'campaignId'` are silently ignored for that caller,
-- never trusted, even though the app still sends them for a Super Admin
-- caller's benefit (who has no fixed scope of their own). This mirrors
-- check_duplicate_public()/get_report_to_candidates() above, and is defense
-- in depth on top of the `users` INSERT RLS policy, which would reject a
-- mismatched agency_id/campaign_id regardless.
create or replace function public.register_user(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency_id uuid;
  v_campaign_id uuid;
  v_caller_role text;
  v_caller_status text;
  v_caller_agency_id uuid;
  v_caller_campaign_id uuid;
  v_actor text;
begin
  select role, status, agency_id, campaign_id into v_caller_role, v_caller_status, v_caller_agency_id, v_caller_campaign_id
    from public.account_profiles where id = auth.uid();

  if v_caller_role is null then
    v_caller_role := 'super_admin'; -- no profile row = legacy Super Admin bootstrap rule
  elsif v_caller_status <> 'Active' then
    raise exception 'Your account is not active. Contact your administrator.';
  end if;

  if v_caller_role = 'super_admin' then
    v_agency_id := (p->>'agencyId')::uuid;
    v_campaign_id := (p->>'campaignId')::uuid;
  else
    v_agency_id := v_caller_agency_id;
    v_campaign_id := v_caller_campaign_id;
  end if;

  v_actor := coalesce(auth.jwt()->>'email', 'Unknown Account');

  return public._insert_registered_user(v_agency_id, v_campaign_id, p, v_actor);
end;
$$;

grant execute on function public.register_user(jsonb) to authenticated;
revoke execute on function public.register_user(jsonb) from anon;

-- ----------------------------------------------------------------------------
-- Excel -> User Registration Import (SUPER ADMIN ONLY)
-- ----------------------------------------------------------------------------
-- Audit trail: one row per import batch. Written ONLY by import_users_batch()
-- below (no direct insert/update policy - RLS only grants SELECT), so
-- `uploaded_by`/counts can never be forged by a client-supplied value.
create table if not exists public.import_batches (
  id             uuid primary key default gen_random_uuid(),
  file_name      text,
  uploaded_by    text not null,
  uploader_role  text not null default 'super_admin',
  agency_id      uuid references public.agencies(id),
  campaign_id    uuid references public.campaigns(id),
  created_date   timestamptz not null default now(),
  total_rows     int not null default 0,
  valid_rows     int not null default 0,
  invalid_rows   int not null default 0,
  corrected_rows int not null default 0,
  imported_rows  int not null default 0,
  failed_rows    int not null default 0
);

comment on table public.import_batches is
  'Audit trail for the Super-Admin-only Excel -> User Registration Import feature. Rows are written exclusively by import_users_batch().';

alter table public.import_batches enable row level security;

drop policy if exists import_batches_select_super_admin on public.import_batches;
create policy import_batches_select_super_admin on public.import_batches
  for select
  to authenticated
  using (public.is_super_admin());

-- Per-row detail for each import batch (spec: "details import history for every
-- import file") - one row per attempted Excel row, so Import History can show
-- exactly which rows succeeded (with the user_code created) or failed (with why),
-- not just the aggregate counts on import_batches. Written ONLY by
-- import_users_batch() alongside its parent import_batches row - cascades on
-- delete so a removed batch never leaves orphaned detail rows.
create table if not exists public.import_batch_rows (
  id            uuid primary key default gen_random_uuid(),
  batch_id      uuid not null references public.import_batches(id) on delete cascade,
  row_index     int not null,
  row_name      text,
  success       boolean not null,
  user_code     text,
  error_message text
);

comment on table public.import_batch_rows is
  'Per-row outcome (success/failure, user_code or error) for one import_batches batch. Written exclusively by import_users_batch().';

create index if not exists idx_import_batch_rows_batch_id on public.import_batch_rows (batch_id, row_index);

alter table public.import_batch_rows enable row level security;

drop policy if exists import_batch_rows_select_super_admin on public.import_batch_rows;
create policy import_batch_rows_select_super_admin on public.import_batch_rows
  for select
  to authenticated
  using (public.is_super_admin());

-- The actual backend enforcement point for the Import feature: this RPC is
-- the ONLY way rows land in import_batches / get inserted via the import UI,
-- and the very first check rejects any caller that isn't Super Admin -
-- independent of anything the frontend hides or shows, and independent of
-- register_user()'s own scoping rules (an Agency Admin is allowed to call
-- register_user() for their OWN single-user manual registration, so that RPC
-- alone can't be the import gate - see supabase/schema.sql plan notes).
-- `p_rows` is a jsonb array, each element shaped exactly like register_user()'s
-- `p` argument (camelCase fields), minus agencyId/campaignId (fixed for the
-- whole batch via p_agency_id/p_campaign_id). Rows are processed FC ->
-- Supervisor -> BP so a Report To target created earlier in the same batch
-- is already visible to a later row that reports to them. One failing row
-- (duplicate, bad Report To, etc.) does not abort the batch - it is recorded
-- as a per-row failure and processing continues.
create or replace function public.import_users_batch(
  p_agency_id uuid, p_campaign_id uuid, p_file_name text, p_rows jsonb,
  p_total_rows int default null, p_valid_rows int default null,
  p_invalid_rows int default null, p_corrected_rows int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text;
  v_campaign_agency_id uuid;
  v_row jsonb;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_row_index int;
  v_total int := 0;
  v_imported int := 0;
  v_failed int := 0;
  v_batch_id uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Access denied: only Super Admin can import users from Excel.';
  end if;

  if p_agency_id is null or p_campaign_id is null then
    raise exception 'Agency and Campaign are required.';
  end if;

  select agency_id into v_campaign_agency_id from public.campaigns where id = p_campaign_id;
  if v_campaign_agency_id is null or v_campaign_agency_id <> p_agency_id then
    raise exception 'Selected Campaign does not belong to the selected Agency.';
  end if;

  v_actor := coalesce(auth.jwt()->>'email', 'Unknown Account');

  -- Sort rows FC(0) -> Supervisor(1) -> BP(2) -> anything unrecognized(3) last,
  -- preserving original relative (upload) order within each designation via
  -- ordinality, so Report To targets exist before their reports are inserted.
  for v_row_index, v_row in
    select (r.idx - 1), r.value
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) with ordinality as r(value, idx)
    order by
      case r.value->>'designation'
        when 'FC' then 0
        when 'Supervisor' then 1
        when 'BP' then 2
        else 3
      end,
      r.idx
  loop
    v_total := v_total + 1;
    begin
      v_result := public._insert_registered_user(p_agency_id, p_campaign_id, v_row, v_actor);
      v_imported := v_imported + 1;
      v_results := v_results || jsonb_build_object(
        'rowIndex', v_row_index, 'success', true,
        'user_code', v_result->>'user_code', 'name', v_row->>'name'
      );
    exception when others then
      v_failed := v_failed + 1;
      v_results := v_results || jsonb_build_object(
        'rowIndex', v_row_index, 'success', false,
        'error', sqlerrm, 'name', v_row->>'name'
      );
    end;
  end loop;

  insert into public.import_batches (
    file_name, uploaded_by, uploader_role, agency_id, campaign_id,
    total_rows, valid_rows, invalid_rows, corrected_rows, imported_rows, failed_rows
  ) values (
    p_file_name, v_actor, 'super_admin', p_agency_id, p_campaign_id,
    coalesce(p_total_rows, v_total), coalesce(p_valid_rows, v_total),
    coalesce(p_invalid_rows, 0), coalesce(p_corrected_rows, 0), v_imported, v_failed
  )
  returning id into v_batch_id;

  -- Persist the per-row detail (spec: "details import history for every import
  -- file") - v_results already carries exactly this shape, one element per
  -- attempted row, so this is a straight fan-out insert rather than recomputing
  -- anything.
  insert into public.import_batch_rows (batch_id, row_index, row_name, success, user_code, error_message)
  select
    v_batch_id,
    (r->>'rowIndex')::int,
    r->>'name',
    (r->>'success')::boolean,
    r->>'user_code',
    r->>'error'
  from jsonb_array_elements(v_results) r;

  return jsonb_build_object(
    'batchId', v_batch_id,
    'totalRows', v_total,
    'importedRows', v_imported,
    'failedRows', v_failed,
    'results', v_results
  );
end;
$$;

grant execute on function public.import_users_batch(uuid, uuid, text, jsonb, int, int, int, int) to authenticated;
revoke execute on function public.import_users_batch(uuid, uuid, text, jsonb, int, int, int, int) from anon;

-- ----------------------------------------------------------------------------
-- Convenience view: users with their Report To person's name pre-joined, so
-- the frontend can display "Report To" as a name without a second round-trip
-- or a client-side join against the full user list.
-- ----------------------------------------------------------------------------
-- DROP + CREATE rather than CREATE OR REPLACE: `u.*` now includes the new
-- agency_id/campaign_id columns (appended to `users` earlier in this script),
-- which shifts report_to_name/report_to_code's output position - Postgres
-- refuses a CREATE OR REPLACE VIEW that reorders/renames existing output
-- columns, so the view must be dropped and recreated fresh instead.
drop view if exists public.users_with_report_to;

create view public.users_with_report_to
  with (security_invoker = true) as
select
  u.*,
  r.name       as report_to_name,
  r.user_code  as report_to_code,
  ag.name      as agency_name,
  ca.name      as campaign_name
from public.users u
left join public.users r on r.id = u.report_to_id
left join public.agencies ag on ag.id = u.agency_id
left join public.campaigns ca on ca.id = u.campaign_id;
