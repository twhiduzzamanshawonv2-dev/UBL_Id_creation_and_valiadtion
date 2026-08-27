# User Account Creation Information Collection System

A centralized web-based system for structured user registration, automated data formatting, strict validation rules, Bangladesh location cascading dropdowns, live preview before submission, an Admin User Directory with server-side search/filtering/pagination, and Excel export.

**Database: Supabase PostgreSQL.** This app was migrated off Google Sheets (see [MIGRATION.md](MIGRATION.md) for the full migration story, schema, and setup steps) to fix slow submission, page reload, listing, filtering, and export performance at scale.

---

## 🌟 Key Features

### 1. Structured 5-Section User Registration Form
- **Personal Information**: Full Name, Father's Name, Mother's Name, Gender, Date of Birth, User Photo.
- **Contact Information**: Mobile Number, Email.
- **Location Information**: Cascading, searchable **multi-select** fields (**Division → District → Upazila → Thana**) covering all 8 Bangladesh divisions, backed by static local data (fast - no network round-trip per dropdown change).
- **Employment / Role Information**: Designation/Role (fixed to **BP**, **Supervisor**, **FC**), Report To (searchable, hierarchy-filtered: BP → Supervisor, Supervisor → FC, FC → none).
- **NID & Documents**: NID Number (numeric validation), NID Front Side Image, NID Back Side Image.

### 2. Standardized Auto Name Formatting (Title Case) & Special Character Restriction
- Restricts name fields to English letters and spaces only, strips digits/punctuation, and auto-Title-Cases on blur.

### 3. Strict Validation & Duplicate Prevention
- **Mobile Validation**: 11-digit Bangladesh mobile numbers (`013`-`019` prefixes), always stored/exported as **text** so a leading `0` is never dropped.
- **Email / NID Validation**: standard email format; NID must be 10, 13, or 17 digits.
- **Duplicate Check**: Mobile Number and NID Number are enforced unique at the database level (`UNIQUE` constraints), checked against Supabase in real time - not a client-side cache.
- **Image Validation**: JPG/JPEG/PNG up to 5MB, with live preview thumbnails.

### 4. Data Preview Step Before Submission
Review all entered fields and photo thumbnails before final submission; Edit to go back, or Confirm & Submit to save.

### 5. Admin Directory & Management Panel
- **Server-side pagination, search, and filtering** (Division/District/Upazila/Thana/Designation/Role/Status/date range/keyword) - Supabase is queried for exactly the matching page of results, never the full table.
- Debounced search (waits ~400ms after typing stops before querying).
- Status toggle (Active/Inactive), detail viewer, Quick Edit modal.

### 6. Excel (.xlsx) Export
Exports the currently filtered dataset (queried fresh from Supabase, not the on-screen page) as a `.xlsx` workbook with one sheet per role (BP/Supervisor/FC). Mobile Number is explicitly forced to a Text-formatted column so Excel never drops the leading `0`.

### 7. Multi-Tenant Login (every view requires sign-in)
There is no more public/no-login surface anywhere in this app - **Dashboard, Add User, Users, Agencies, Campaigns, Campaign Logins, Export, and Validation** all require a signed-in Supabase Auth account. Every account has a **role**:

- **Super Admin** - unrestricted access to everything: all Agencies, all Campaigns, every user record, all exports, plus the Agencies/Campaigns/Campaign Logins management screens. Any pre-existing admin account (created before this multi-tenant system existed) is automatically treated as Super Admin - no migration step needed.
- **Agency / Campaign Admin** - permanently scoped to exactly **one** Agency + Campaign, assigned when the account is linked (see "Campaign Logins" below). Can add/view/edit/export users **only** within that one Agency+Campaign. The Agencies/Campaigns/Campaign Logins nav tabs are hidden entirely for this role, and the Add User form shows its Agency/Campaign as a locked 🔒 read-only display instead of a picker - it can never select or change its own scope.

**This is enforced at the database, not just the UI.** Every RLS policy on `users` (and the Storage buckets holding NID/photo images) checks the caller's own scope from a new `account_profiles` table via `auth.uid()` - a forged `agency_id` in a direct API call, a tampered export parameter, or a hand-edited request payload all fail the same way a normal cross-campaign request would: zero rows, rejected write. See the RLS policies and the `is_super_admin()`/`my_agency_id()`/`my_campaign_id()` helper functions in [supabase/schema.sql](supabase/schema.sql) for the actual enforcement; `switchTab()`/`updateNavVisibility()` in [js/app.js](js/app.js) are only the matching UI convenience layer.

**Campaign Logins (creating accounts):** there is no in-app "create login" screen by design (this app never handles a service_role key client-side) - the flow is two steps:
1. Create the Supabase Auth account first, same as before: **Supabase Dashboard** → *Authentication → Users → Add user* (email + password, "Auto Confirm User" checked). Copy its **User UID** from that screen.
2. As a Super Admin, go to the **Campaign Logins** tab → *+ Link Account* → paste that UUID, pick a Role (Super Admin or Agency/Campaign Admin), and for Agency/Campaign Admin, pick the Agency + Campaign it's permanently scoped to, plus a Status (Active/Inactive/Suspended).

An **Inactive**/**Suspended** account is blocked from data access immediately - both at login (the app signs it back out and shows an error) and at the database (its scope resolves to nothing, so even a still-valid session token retrieves zero rows).

### 8. Multi-Agency + Multi-Campaign User Management
Every user registration is scoped to one **Agency → Campaign** (e.g. "Asiatic Experiential Marketing Ltd." → "Horlicks School Campaign"). For a Super Admin this is a dependent dropdown on the registration form; for an Agency/Campaign Admin it's automatically the account's own fixed scope (never a choice - see "Multi-Tenant Login" above). This scoping is enforced everywhere, not just in the UI:
- **Duplicate detection** (Mobile/NID) is scoped per Agency+Campaign, not global - the same person can be legitimately registered under a different Agency+Campaign, but not twice under the same one ("This user is already registered for this campaign.").
- **Report To** candidates are filtered to the same Agency+Campaign as the submitting user, in addition to the existing Designation/Role hierarchy rule (BP → Supervisor, Supervisor → FC, FC → none) - a BP in one campaign can never report to a Supervisor in a different campaign, even under the same Agency.
- **Agencies** and **Campaigns** are Super-Admin-manageable master data (add/edit, Active/Inactive toggle) via their own nav tabs - Campaigns are dependent on Agency (each belongs to exactly one).
- **Users, Dashboard, and Export** all filter by Agency + Campaign for a Super Admin (plus the existing Role/Designation/Location/Search filters); an Agency/Campaign Admin's data is always pre-scoped to its own campaign with no filter picker shown at all. The Dashboard's 5 KPI cards (Total Users/BP/Supervisor/FC, Active Campaigns) reflect exactly that scope.
- **Export** supports a filtered export (Agency/Campaign/Role → one workbook, sheet-per-role) and a dedicated "Export Campaign Data" option (one Campaign → one workbook with BP/Supervisor/FC sheets, Super-Admin-only), with meaningful sanitized filenames like `Asiatic_Horlicks_School_BP.xlsx` or `All_Agencies_All_Campaigns_BP.xlsx`.
- **Excel Validator** also understands Agency/Campaign as a mappable, fuzzy-matched column pair (same hierarchical matching as Division→District) - the one place this otherwise fully-offline module makes a network call, and only once per session (reusing the Agency/Campaign lists already loaded for the rest of the app, never per-row).

Existing rows from before this feature are automatically backfilled onto a seeded "Unassigned" Agency/Campaign when [supabase/schema.sql](supabase/schema.sql) is (re-)run - no data is lost, and that pair can be renamed or replaced like any other Agency/Campaign afterward.

---

## 📁 File Structure

- [index.html](index.html) - Application SPA HTML structure with semantic sections and modals.
- [styles.css](styles.css) - Vanilla CSS design system, cards, layouts, badges, pagination bar, KPI tiles.
- [js/bd-locations.js](js/bd-locations.js) - Static Bangladesh location hierarchy data.
- [js/validation.js](js/validation.js) - Title Case formatter, BD mobile validator, email validator, NID validator, image file checker.
- [js/multiselect.js](js/multiselect.js) - Generic reusable multi-select component used by the Location fields.
- [js/config.example.js](js/config.example.js) - Template for Supabase project URL/anon key. Copy to `js/config.js` (gitignored).
- [js/supabase-client.js](js/supabase-client.js) - Initializes the Supabase JS client from `js/config.js`.
- [js/db-service.js](js/db-service.js) - All Supabase queries/mutations (the app's actual data-access layer), including Agency/Campaign CRUD and Dashboard counts.
- [js/storage.js](js/storage.js) - Thin adapter between `js/db-service.js` and the UI (pagination state, fixed roles/designations, cached Agency/Campaign lists).
- [js/app.js](js/app.js) - Application logic, event listeners, cascading location/Agency-Campaign logic, admin filters/pagination, Agencies/Campaigns management, Dashboard KPIs, Excel export.
- [supabase/schema.sql](supabase/schema.sql) - Full Postgres schema (`users`, `agencies`, `campaigns`, `account_profiles`), indexes, tenant-scoped RLS policies, RPC functions, Storage buckets.
- [migration/](migration/) - One-time Google Sheets → Supabase migration script.
- [apps-script/](apps-script/) - **Legacy.** The old Google Apps Script backend - kept only as a historical/backup data source until the migration is verified. No longer used by the live app.

---

## 🚀 How to Run

1. Set up a Supabase project and run [supabase/schema.sql](supabase/schema.sql) against it (see [MIGRATION.md](MIGRATION.md)). Safe to re-run against a project that already has an older schema - it will tighten RLS policies to be tenant-scoped, add the new RPC functions and the `account_profiles` table, and add the Agency/Campaign tables (backfilling any existing users onto an "Unassigned" Agency/Campaign).
2. Copy `js/config.example.js` to `js/config.js` and fill in your Supabase Project URL and anon key.
3. In the Supabase Dashboard, go to **Authentication → Users → Add user** and create your first account (email + password, "Auto Confirm User" checked). Since it has no `account_profiles` row yet, it's automatically your Super Admin - sign in with it once the app is running.
4. Open `index.html` directly in a browser, or serve the folder with any static file server. No build step, no backend server process required.
5. As that Super Admin, go to the **Agencies** and **Campaigns** tabs to create your real Agencies/Campaigns - the seeded "Unassigned" pair is only a migration fallback.
6. Create one Supabase Auth account per campaign team (same Dashboard step as #3), then link each one to its Agency+Campaign via the **Campaign Logins** tab - see "Multi-Tenant Login" above.
7. To bring over existing Google Sheet data, run the migration script in [migration/](migration/) once (see [MIGRATION.md](MIGRATION.md) for step-by-step instructions).
