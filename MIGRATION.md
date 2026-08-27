# Google Sheets → Supabase Migration

This document is the single reference for the database migration: what changed, how to set it up, how to bring over existing data, what was tested, and what's left.

---

## 1. Architecture Change

| | Before | After |
|---|---|---|
| Database | 3 Google Sheet tabs (BP/Supervisor/FC) | 1 Supabase Postgres table (`public.users`), discriminated by `designation` |
| Backend | Google Apps Script Web App (`apps-script/Code.gs`) | None - frontend talks to Supabase directly via the JS SDK, secured by Row Level Security |
| Images | Google Drive, public "anyone with link" | Supabase Storage - `user-photos` (public bucket) and `nid-documents` (private bucket, signed URLs) |
| Listing | Full dataset loaded into the browser on every load/write | Server-side paginated query (25/page) |
| Search/Filter | Client-side `Array.filter()` over the full in-memory list | Server-side Supabase query (indexed columns), debounced search input |
| Report To | Free-text name match against the full in-memory list | Foreign key (`report_to_id`) resolved via a small, indexed, targeted query |
| Auth | None | None (unchanged - see [Security](#7-security--rls) for why, and what to do if this changes) |

This was a **frontend-only** migration - the app is still a static site (no Node/Express server), same as before. See the architecture decisions recorded at the top of this migration for why (frontend-only + RLS was chosen over adding a backend).

---

## 2. Supabase Setup (one-time)

1. Create a Supabase project (free tier is fine).
2. Open **SQL Editor** in the Supabase dashboard, paste in the entire contents of [`supabase/schema.sql`](supabase/schema.sql), and run it. This creates:
   - The `users` table with proper types (mobile/NID/email as `text`, `dob` as `date`, location fields as `text[]`, timestamps as `timestamptz`).
   - Triggers: auto-generated `user_code` (e.g. `USR-2026-0001`), `updated_date` auto-touch, and a Report To hierarchy check (BP→Supervisor, Supervisor→FC, FC→none) enforced at the database level as a second gate behind the app's own validation.
   - Indexes on every field the app actually searches/filters/sorts by (see [Indexes](#4-indexes) below).
   - Row Level Security policies (see [Security](#7-security--rls)).
   - Storage buckets: `user-photos` (public) and `nid-documents` (private).
   - The `users_with_report_to` view (pre-joins the Report To person's name, so the app never needs a second round-trip to display it).
3. Go to **Project Settings → API** and copy the **Project URL** and **anon public key**.
4. In the app folder, copy `js/config.example.js` to `js/config.js` and paste in those two values.
5. Open `index.html` in a browser (or serve the folder statically) - the app is now live against Supabase.

No environment variables are used for the frontend in the traditional Node sense, because this is a static site with no build step - `js/config.js` (gitignored, never committed) plays that role instead. The **service_role key is never used by the frontend** - it only appears in `migration/.env`, used once by the migration script.

---

## 3. Database Schema

See [`supabase/schema.sql`](supabase/schema.sql) for the authoritative, fully-commented schema. Summary:

```
public.users
  id               uuid PK, default gen_random_uuid()
  user_code        text UNIQUE   -- "USR-2026-0001" - preserved from the old Sheet id
  name             text
  gender           text          -- CHECK IN ('Male','Female')
  father_name      text
  mother_name      text
  mobile           text UNIQUE   -- CHECK ~ '^01[3-9][0-9]{8}$' (TEXT - never numeric, preserves leading 0)
  email            text          -- CHECK ~* email pattern
  dob              date
  division         text[]        -- multi-select location fields
  district         text[]
  upazila          text[]
  thana            text[]
  designation      text          -- CHECK IN ('BP','Supervisor','FC')
  role             text          -- CHECK IN ('BP','Supervisor','FC'), CHECK designation = role
  report_to_id     uuid          -- FK -> users.id, NULL for FC
  nid              text UNIQUE   -- CHECK 10, 13, or 17 digits
  nid_front_url    text          -- Storage object path (private bucket)
  nid_back_url     text          -- Storage object path (private bucket)
  user_photo_url   text          -- Storage public URL
  status           text          -- CHECK IN ('Active','Inactive')
  created_by       text
  created_date     timestamptz
  updated_by       text
  updated_date     timestamptz
```

### Why a single table instead of 3 (mirroring the old 3 Sheet tabs)?

A normalized single table with a `designation` discriminator is the standard, query-efficient approach - it lets "get all users", "filter by role", and "look up Report To candidates" all be plain indexed `WHERE` clauses instead of unioning 3 separate tables/tabs on every read (which is what the old `readAllUsers_()` did on every single request). Role-wise queries (`getUsersByRole`) are just `WHERE designation = 'BP'`, backed by an index.

### Report To: name-match → foreign key

The old Sheet stored Report To as the target person's **name** (a fragile match - two people could theoretically share a name). Supabase stores it as `report_to_id uuid REFERENCES users(id)` - a real, indexed foreign key. The app still *displays* and *matches by name* in the UI (so the Quick Edit dropdown/search box behavior is unchanged), but internally resolves the name to the correct uuid before writing, and the `users_with_report_to` view resolves it back to a name for display without an extra round-trip.

### 4. Indexes

Only added where the app actually queries/filters/sorts:
- `user_code`, `mobile`, `nid` (unique constraints, auto-indexed)
- `name` - GIN trigram index (fast `ILIKE '%...%'` search)
- `email`, `designation`, `role`, `status`, `report_to_id`, `created_date` - plain B-tree
- `division`, `district`, `upazila`, `thana` - GIN (array containment, `@>`, for the location filters)
- `(designation, status)` composite - speeds up the very hot "Report To candidates" query (`WHERE designation = X AND status = 'Active'`)

---

## 5. Role-Based / Report To Logic

Unchanged business rules, now enforced in **three** places (defense in depth, same philosophy as the old client+server duplication):
1. Client-side (`js/app.js`) - UX-level, immediate feedback.
2. `js/db-service.js` - resolves the Report To name to a uuid and validates it exists/is Active/matches the target designation before insert/update.
3. **Database trigger** (`validate_report_to()` in `supabase/schema.sql`) - the true authoritative gate; even a direct Supabase API call bypassing the app cannot violate the hierarchy rule.

Rule (unchanged): BP → must report to an Active Supervisor. Supervisor → must report to an Active FC. FC → must have no Report To.

`js/db-service.js`'s `getReportToUsers(targetDesignation)` is a targeted, indexed query (`WHERE designation = X AND role = X AND status = 'Active'`) - it does not load the whole user table to build this list.

---

## 6. Location Data

**Unchanged.** Division → District → Upazila → Thana remains static data in `js/bd-locations.js`, per the original design - it was already fast and didn't need a database round-trip. The Admin table's location filters (Division/District/Upazila/Thana dropdowns) were extended to actually cascade (the old dashboard filters for District/Upazila/Thana were present in the HTML but never populated) using the same static data - no new Supabase query involved.

---

## 7. Security & RLS

**This app has no authentication, before or after this migration.** That was true of the old Google Apps Script Web App (deployed "Execute as: Me" / "Anyone" access - an open, unauthenticated write API), and per the migration's scope decision, the Supabase RLS policies **intentionally preserve that same open-access posture** rather than silently introducing a login requirement that would change the app's UX. Concretely:

- `anon`/`authenticated` roles can `SELECT`/`INSERT`/`UPDATE` the `users` table (see the policies in `supabase/schema.sql`). No `DELETE` policy exists anywhere - the app has never hard-deleted users (only status-toggled), so none is needed.
- The old **"Reset All Data" button was removed** (see `js/app.js`'s `initSettingsPanel`) - it required a full-table wipe, and granting an unauthenticated `DELETE` policy just to keep that one demo button is not a reasonable trade-off. This is the one feature intentionally dropped rather than ported as-is.
- `user-photos` Storage bucket is public (same effective visibility as the old "anyone with link" Drive files).
- `nid-documents` Storage bucket is private; the app generates 1-hour signed URLs on demand (only when actually viewing a user's details) instead of a permanent public link. **Caveat:** because there is still no per-user identity, the public anon key itself can request a signed URL for any object in that bucket if the exact path is known - this is an improvement over a permanent public Drive link (links expire, aren't indexable), but it is **not equivalent to real per-user access control**. If genuine authentication is added later, tighten this to a policy scoped to `auth.uid()` and restrict who can call `createSignedUrl`.
- The anon key is safe to embed in the frontend by design (Supabase's model) - it can only do what these RLS policies allow, unlike the old Apps Script deployment which had no equivalent access-scoping mechanism at all.

**If you add real authentication later:** tighten the four RLS policies in `supabase/schema.sql` (`users_select_anon`, `users_insert_anon`, `users_update_anon`, and the two storage policies) to check `auth.uid()`/`auth.role()` instead of blanket-allowing `anon`.

---

## 8. Data Migration (Google Sheets → Supabase)

**The Google Sheet is never modified or deleted.** The migration is strictly a read from the existing Apps Script GET endpoint and a write into Supabase.

### Steps

```bash
cd migration
npm install
cp .env.example .env
# Edit .env: fill in SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (Project Settings -> API)
# SHEET_API_URL is pre-filled with the existing deployed Apps Script URL
npm run migrate
```

### What it does

1. Fetches every user from the live Apps Script GET endpoint (all 3 tabs combined, exactly what the old frontend received).
2. Migrates in hierarchy order - **FC first, then Supervisor, then BP** - so each record's Report To target already exists in Supabase (with a resolvable id) by the time it's needed.
3. For each record: validates required fields/formats, checks for duplicates (against both the source batch and whatever is already in Supabase - safe to re-run), resolves Report To name → uuid, downloads NID Front/Back/User Photo from their Google Drive URLs and re-uploads them into the appropriate Supabase Storage bucket, then inserts the row - preserving the original `user_code` (the old Sheet `id`), `createdDate`, `createdBy`, etc.
4. Prints a running log and a final summary, and writes the full detail to `migration/migration-report.json`:
   ```
   Total records:          1250
   Successfully migrated:  1230
   Skipped duplicates:     15
   Failed validation:      5
   Image migration issues: 2 (record still migrated - see below)
   ```
5. **No record is silently dropped** - every skip/failure is named and reasoned in the log and the JSON report.

### Re-running

The script is idempotent: it checks existing Supabase rows by `user_code`/`mobile`/`nid` before inserting, so re-running after a partial failure (e.g. a network blip) safely picks up where it left off instead of creating duplicates.

---

## 9. Performance Changes

| Operation | Before | After |
|---|---|---|
| Page load | Full Sheet read (all 3 tabs, `getDataRange().getValues()`) on every load | No user data loaded until the Admin tab is opened; then one paginated (25-row) query |
| Submission | Insert + full Sheet re-read to refresh the UI | Single `INSERT ... RETURNING`, new row prepended to the UI directly - no re-read |
| Search/Filter | Client-side scan of the entire in-memory list | Indexed Supabase query, debounced (400ms) so typing doesn't trigger a request per keystroke |
| Report To dropdown | Filtered from the full in-memory list | Small indexed query (`designation = X AND status = 'Active'`), fetched once per Designation change |
| Duplicate check | Scanned the full in-memory list (client) + full Sheet scan (server) | Single indexed `WHERE mobile = ?` / `WHERE nid = ?` query, plus a `UNIQUE` constraint as a hard backstop |
| Excel export | Client-side filter over the in-memory list | Server-side filtered query (same filters as the on-screen table), batched in pages of 1000 |

---

## 10. Files Changed / Added

**Added:**
- `supabase/schema.sql` - full schema, triggers, indexes, RLS, Storage buckets
- `js/config.example.js` (+ local `js/config.js`, gitignored)
- `js/supabase-client.js`
- `js/db-service.js`
- `migration/package.json`, `migration/.env.example`, `migration/migrate.js`
- `.gitignore`
- `MIGRATION.md` (this file)

**Rewritten:**
- `js/storage.js` - now a thin adapter over `db-service.js` (pagination state) instead of an Apps Script HTTP client
- `js/app.js` - admin table now server-side paginated/filtered/debounced; Report To candidate fetching is async (cached per Designation change, not per keystroke); duplicate check and image upload now go through Supabase; the old "Reset All Data" button/handler removed
- `index.html` - added Supabase JS SDK CDN script tag, `config.js`/`supabase-client.js`/`db-service.js` script tags, pagination controls markup; removed the "Reset All Data" button
- `styles.css` - added pagination bar styles
- `ReadMe.md` - updated to describe the Supabase architecture
- `apps-script/Code.gs`, `apps-script/DEPLOY.md` - marked legacy/deprecated (kept only as the migration script's data source)

**Unchanged (by design):**
- `js/validation.js`, `js/multiselect.js`, `js/bd-locations.js` - no changes needed; validation rules and location data were already correct/fast

---

## 11. Testing Performed

Manual code-path verification (no live Supabase project was available during development to run against - see [Remaining Work](#12-remaining-work--limitations)):
- Traced the create/update/toggle/duplicate-check/report-to/export flows end-to-end against the new `db-service.js` to confirm field mappings (camelCase ↔ snake_case) are consistent both directions.
- Verified all modified JS files parse with `node --check` (syntax-valid).
- Cross-checked every RLS policy and trigger in `schema.sql` against the exact validation rules in the original `apps-script/Code.gs` (required fields, gender enum, age ≥18 - enforced client-side + `validation.js`, hierarchy rule, duplicate mobile/NID) to confirm no rule was silently dropped, except the intentionally-removed hard-reset feature (see [Security](#7-security--rls)).

**Still required before go-live** (needs your actual Supabase project - see below):
1. Run `supabase/schema.sql`, confirm it executes without error.
2. Create a BP, a Supervisor, and an FC through the registration form; confirm all three land correctly in the `users` table with the right `designation`/`role`.
3. Confirm Report To: BP's dropdown shows only Supervisors, Supervisor's shows only FCs, FC's is disabled/empty.
4. Enter mobile `01712345678`; confirm it's stored, displayed, and exported as `01712345678` (not `1712345678`).
5. Test search by Name/User ID/Mobile/Email; test each filter (Role/Designation/Division/District/Upazila/Thana/Status).
6. Export filtered and unfiltered datasets; open the `.xlsx` and confirm all columns and the Mobile Number text formatting.
7. Compare page load / submission / search timing against the old Google Sheets version.
8. Run `migration/migrate.js` against a copy of the real Sheet data (or the live one, once ready) and review `migration-report.json`.

---

## 12. Remaining Work / Limitations

- **No live Supabase project was available while building this migration** - the schema, RLS policies, service layer, and migration script are complete and internally consistent, but need to be run against a real project (see [Testing Performed](#11-testing-performed) above) before this is considered verified/production-ready.
- **No authentication** - unchanged from the original app, by explicit choice (see [Security](#7-security--rls)). The `nid-documents` private bucket's signed-URL access is a soft improvement over the old permanent public Drive links, not equivalent to real per-user access control.
- **"Reset All Data" was removed**, not migrated - it required an unauthenticated hard-delete capability that doesn't fit a public anon key model.
- The Excel export writes the **public URL** for User Photo (harmless, low-sensitivity) but only a **presence marker** (`[On file - view in app]`) for NID Front/Back, since those are private, signed, expiring URLs that shouldn't be baked into a spreadsheet that could be forwarded elsewhere.
- `report_to_id` uses `ON DELETE RESTRICT` - since the app never hard-deletes users, this should never trigger in practice, but is worth knowing if a manual `DELETE` is ever run directly in the Supabase SQL editor.
