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
     or target_row.role <> target_designation then
    raise exception 'Report To must be an existing, active %.', target_designation;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_report_to on public.users;
create trigger trg_validate_report_to
  before insert or update on public.users
  for each row execute function public.validate_report_to();

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
-- Row Level Security
-- ----------------------------------------------------------------------------
-- The existing app has NO authentication at all (see analysis notes) - anyone
-- with the deployed URL can read/write via the Google Apps Script Web App
-- today. To avoid changing the application's behavior/UX as part of this
-- migration (per the "keep open access like today" decision), these policies
-- allow the `anon` role (i.e. the public anon key used by the frontend) to
-- perform the same operations it could before: read, insert, and update -
-- there is still no hard-delete anywhere in the app (status is toggled
-- instead), so no DELETE policy is granted.
--
-- IMPORTANT: this intentionally keeps the SAME security posture as the old
-- Google Sheets app (open access), not a stronger one. If real authentication
-- is added later, tighten these policies to check auth.uid()/auth.role().
alter table public.users enable row level security;

drop policy if exists users_select_anon on public.users;
create policy users_select_anon on public.users
  for select
  to anon, authenticated
  using (true);

drop policy if exists users_insert_anon on public.users;
create policy users_insert_anon on public.users
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists users_update_anon on public.users;
create policy users_update_anon on public.users
  for update
  to anon, authenticated
  using (true)
  with check (true);

-- ----------------------------------------------------------------------------
-- Storage buckets for NID Front/Back and User Photo (replacing Google Drive).
-- ----------------------------------------------------------------------------
-- User Photo is low-sensitivity (shown as an avatar throughout the admin
-- table) - kept in a PUBLIC bucket, same effective visibility as the old
-- Drive "anyone with link" file, but scoped to just this bucket.
insert into storage.buckets (id, name, public)
values ('user-photos', 'user-photos', true)
on conflict (id) do nothing;

-- NID Front/Back are sensitive documents - kept in a PRIVATE bucket. The app
-- generates short-lived signed URLs to display them (see js/db-service.js),
-- instead of a permanent public link.
--
-- NOTE / LIMITATION: because this app still has no authentication, the anon
-- key itself (public, embedded in the frontend) is what's allowed to request
-- a signed URL for any object in this bucket - there is no per-user identity
-- to restrict it further. This is still an improvement over the old
-- permanent "anyone with link" Drive URLs (links expire, and files aren't
-- indexable/discoverable via Drive search), but it is NOT equivalent to true
-- per-user access control. Add Supabase Auth + a stricter policy (e.g.
-- restrict to authenticated staff accounts) if that's required later.
insert into storage.buckets (id, name, public)
values ('nid-documents', 'nid-documents', false)
on conflict (id) do nothing;

drop policy if exists user_photos_public_read on storage.objects;
create policy user_photos_public_read on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'user-photos');

drop policy if exists user_photos_anon_upload on storage.objects;
create policy user_photos_anon_upload on storage.objects
  for insert
  to anon, authenticated
  with check (bucket_id = 'user-photos');

drop policy if exists nid_documents_anon_select on storage.objects;
create policy nid_documents_anon_select on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'nid-documents');

drop policy if exists nid_documents_anon_upload on storage.objects;
create policy nid_documents_anon_upload on storage.objects
  for insert
  to anon, authenticated
  with check (bucket_id = 'nid-documents');

-- ----------------------------------------------------------------------------
-- Convenience view: users with their Report To person's name pre-joined, so
-- the frontend can display "Report To" as a name without a second round-trip
-- or a client-side join against the full user list.
-- ----------------------------------------------------------------------------
create or replace view public.users_with_report_to
  with (security_invoker = true) as
select
  u.*,
  r.name       as report_to_name,
  r.user_code  as report_to_code
from public.users u
left join public.users r on r.id = u.report_to_id;
