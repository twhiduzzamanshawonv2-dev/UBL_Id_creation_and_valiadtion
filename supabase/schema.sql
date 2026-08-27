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
-- The app has two public surfaces (User Registration, Excel Validator) that
-- must keep working with no login, and two admin surfaces (Admin Dashboard,
-- System Settings) that now require a logged-in Supabase Auth session.
--
-- Direct table access is therefore locked to `authenticated` only - the
-- public registration form, duplicate-check, and Report To picker no longer
-- read/write this table directly; they go through the SECURITY DEFINER
-- functions below (register_user / check_duplicate_public /
-- get_report_to_candidates), which expose only the narrow slice of data each
-- of those public actions actually needs (no NID numbers, mobile numbers,
-- photos, or full record listings are ever readable by the anon key).
alter table public.users enable row level security;

drop policy if exists users_select_anon on public.users;
drop policy if exists users_insert_anon on public.users;
drop policy if exists users_update_anon on public.users;

drop policy if exists users_select_authenticated on public.users;
create policy users_select_authenticated on public.users
  for select
  to authenticated
  using (true);

drop policy if exists users_insert_authenticated on public.users;
create policy users_insert_authenticated on public.users
  for insert
  to authenticated
  with check (true);

drop policy if exists users_update_authenticated on public.users;
create policy users_update_authenticated on public.users
  for update
  to authenticated
  using (true)
  with check (true);

-- ----------------------------------------------------------------------------
-- Storage buckets for NID Front/Back and User Photo (replacing Google Drive).
-- ----------------------------------------------------------------------------
-- Both buckets are PRIVATE. Registration (public, no login) still needs to be
-- able to UPLOAD into them - that stays open to `anon`. Reading the files
-- back (admin table avatars, User Details modal, signed download links) now
-- requires a logged-in admin session - the app resolves short-lived signed
-- URLs on demand (see js/db-service.js getSignedDocUrls()), never a
-- permanent public link.
update storage.buckets set public = false where id = 'user-photos';
insert into storage.buckets (id, name, public)
values ('user-photos', 'user-photos', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('nid-documents', 'nid-documents', false)
on conflict (id) do nothing;

drop policy if exists user_photos_public_read on storage.objects;
drop policy if exists user_photos_anon_upload on storage.objects;
drop policy if exists nid_documents_anon_select on storage.objects;
drop policy if exists nid_documents_anon_upload on storage.objects;

drop policy if exists user_photos_authenticated_select on storage.objects;
create policy user_photos_authenticated_select on storage.objects
  for select
  to authenticated
  using (bucket_id = 'user-photos');

drop policy if exists user_photos_upload on storage.objects;
create policy user_photos_upload on storage.objects
  for insert
  to anon, authenticated
  with check (bucket_id = 'user-photos');

drop policy if exists nid_documents_authenticated_select on storage.objects;
create policy nid_documents_authenticated_select on storage.objects
  for select
  to authenticated
  using (bucket_id = 'nid-documents');

drop policy if exists nid_documents_upload on storage.objects;
create policy nid_documents_upload on storage.objects
  for insert
  to anon, authenticated
  with check (bucket_id = 'nid-documents');

-- ----------------------------------------------------------------------------
-- Public-safe RPC functions
-- ----------------------------------------------------------------------------
-- The `users` table itself is now locked to `authenticated` (see RLS above),
-- but three actions must still work with NO login: submitting the
-- registration form, checking for a duplicate Mobile/NID before submitting,
-- and populating the "Report To" picker. Each function below is SECURITY
-- DEFINER (runs as the table owner, bypassing RLS) but returns/accepts only
-- the minimum needed for that one action - never full records, NID numbers,
-- mobile numbers, or photos.

-- Returns whether a Mobile/NID is already in use, without exposing any other
-- row data. `p_exclude_code` lets the (authenticated-only) admin Edit modal
-- reuse this same check while editing an existing user.
create or replace function public.check_duplicate_public(
  p_mobile text,
  p_nid text,
  p_exclude_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_mobile text := nullif(trim(p_mobile), '');
  clean_nid text := nullif(trim(p_nid), '');
  hit_code text;
begin
  if clean_mobile is not null then
    select user_code into hit_code from public.users
      where mobile = clean_mobile and (p_exclude_code is null or user_code <> p_exclude_code)
      limit 1;
    if hit_code is not null then
      return jsonb_build_object(
        'duplicate', true, 'field', 'Mobile Number',
        'message', format('A user with Mobile Number ''%s'' already exists.', clean_mobile)
      );
    end if;
  end if;

  if clean_nid is not null then
    select user_code into hit_code from public.users
      where nid = clean_nid and (p_exclude_code is null or user_code <> p_exclude_code)
      limit 1;
    if hit_code is not null then
      return jsonb_build_object(
        'duplicate', true, 'field', 'NID Number',
        'message', format('A user with NID Number ''%s'' already exists.', clean_nid)
      );
    end if;
  end if;

  return jsonb_build_object('duplicate', false);
end;
$$;

grant execute on function public.check_duplicate_public(text, text, text) to anon, authenticated;

-- Report To candidates for a given target designation (Active, matching
-- designation/role only) - just enough (id/user_code/name) to power the
-- searchable picker on both the public Create form and the admin Edit modal.
create or replace function public.get_report_to_candidates(p_designation text)
returns table (user_id uuid, user_code text, name text)
language sql
security definer
set search_path = public
stable
as $$
  select id, user_code, name
  from public.users
  where status = 'Active'
    and designation = p_designation
    and role = p_designation
  order by name asc;
$$;

grant execute on function public.get_report_to_candidates(text) to anon, authenticated;

-- Performs the full public registration write (duplicate check + Report To
-- resolution + insert) atomically and returns the created row shaped like
-- `users_with_report_to`, so the anon key never needs direct table access to
-- register a user or read back the row it just created. Storage uploads
-- (User Photo/NID images) still happen client-side beforehand (see
-- db-service.js createUser()) - only their resulting paths are passed in.
create or replace function public.register_user(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mobile text := trim(p->>'mobile');
  v_nid text := trim(p->>'nid');
  v_designation text := p->>'designation';
  v_role text := p->>'role';
  v_report_to_name text := nullif(trim(p->>'reportTo'), '');
  v_target_designation text;
  v_report_to_id uuid;
  v_row public.users%rowtype;
  v_dup jsonb;
begin
  v_dup := public.check_duplicate_public(v_mobile, v_nid, null);
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
      limit 1;
    if v_report_to_id is null then
      raise exception 'Report To must be an existing, active %.', v_target_designation;
    end if;
  elsif v_report_to_name is not null then
    raise exception 'FC users must not have a Report To.';
  end if;

  insert into public.users (
    name, gender, father_name, mother_name, mobile, email, dob,
    division, district, upazila, thana, designation, role, report_to_id,
    nid, nid_front_url, nid_back_url, user_photo_url, status, created_by, updated_by
  ) values (
    p->>'name', p->>'gender', p->>'fatherName', p->>'motherName', v_mobile, p->>'email',
    (p->>'dob')::date,
    coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'division', '[]'::jsonb)) x), '{}'),
    coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'district', '[]'::jsonb)) x), '{}'),
    coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'upazila', '[]'::jsonb)) x), '{}'),
    coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'thana', '[]'::jsonb)) x), '{}'),
    v_designation, v_role, v_report_to_id,
    v_nid, p->>'nidFrontUrl', p->>'nidBackUrl', p->>'userPhotoUrl',
    'Active', 'Self (Public Registration)', 'Self (Public Registration)'
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
    'created_by', v_row.created_by, 'created_date', v_row.created_date,
    'updated_by', v_row.updated_by, 'updated_date', v_row.updated_date
  );
end;
$$;

grant execute on function public.register_user(jsonb) to anon, authenticated;

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
