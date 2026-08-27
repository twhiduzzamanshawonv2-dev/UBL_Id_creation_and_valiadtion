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

### 7. Admin Login (User Registration & Excel Validator stay public)
**User Registration** and **Excel Validator** require no login - anyone with the deployed URL can use them. **Admin Dashboard** and **System Settings** require signing in with an admin email/password (Supabase Auth). This is enforced in two layers:
- **UI**: clicking either admin tab without a session shows the Login screen instead (see `switchTab()` in [js/app.js](js/app.js)).
- **Database**: the `users` table itself is locked to `authenticated` only (see [supabase/schema.sql](supabase/schema.sql)) - the public Registration form, duplicate-check, and Report To picker go through narrow `SECURITY DEFINER` RPC functions instead of direct table access, so the public anon key can never read full user records, NID numbers, mobile numbers, or photos.

**Creating admin accounts:** there is no self-signup and no in-app "add admin" screen by design - create/remove admin accounts from the **Supabase Dashboard** → *Authentication → Users → Add user* (set "Auto Confirm User" so no email needs to be sent/clicked). Each admin then signs in at the app's Login screen with that email/password. To revoke access, delete or disable the user in the same Dashboard screen - no code changes needed.

---

## 📁 File Structure

- [index.html](index.html) - Application SPA HTML structure with semantic sections and modals.
- [styles.css](styles.css) - Vanilla CSS design system, cards, layouts, badges, pagination bar.
- [js/bd-locations.js](js/bd-locations.js) - Static Bangladesh location hierarchy data.
- [js/validation.js](js/validation.js) - Title Case formatter, BD mobile validator, email validator, NID validator, image file checker.
- [js/multiselect.js](js/multiselect.js) - Generic reusable multi-select component used by the Location fields.
- [js/config.example.js](js/config.example.js) - Template for Supabase project URL/anon key. Copy to `js/config.js` (gitignored).
- [js/supabase-client.js](js/supabase-client.js) - Initializes the Supabase JS client from `js/config.js`.
- [js/db-service.js](js/db-service.js) - All Supabase queries/mutations (the app's actual data-access layer).
- [js/storage.js](js/storage.js) - Thin adapter between `js/db-service.js` and the UI (pagination state, fixed roles/designations).
- [js/app.js](js/app.js) - Application logic, event listeners, cascading location logic, admin filters/pagination, Excel export.
- [supabase/schema.sql](supabase/schema.sql) - Full Postgres schema, indexes, RLS policies, Storage buckets.
- [migration/](migration/) - One-time Google Sheets → Supabase migration script.
- [apps-script/](apps-script/) - **Legacy.** The old Google Apps Script backend - kept only as a historical/backup data source until the migration is verified. No longer used by the live app.

---

## 🚀 How to Run

1. Set up a Supabase project and run [supabase/schema.sql](supabase/schema.sql) against it (see [MIGRATION.md](MIGRATION.md)). Safe to re-run against a project that already has the old (pre-login) schema - it will tighten the RLS policies and add the new RPC functions.
2. Copy `js/config.example.js` to `js/config.js` and fill in your Supabase Project URL and anon key.
3. In the Supabase Dashboard, go to **Authentication → Users → Add user** and create one account per admin (email + password, "Auto Confirm User" checked). This is how you create/manage every Admin Dashboard / System Settings login - see "Admin Login" above.
4. Open `index.html` directly in a browser, or serve the folder with any static file server. No build step, no backend server process required.
5. To bring over existing Google Sheet data, run the migration script in [migration/](migration/) once (see [MIGRATION.md](MIGRATION.md) for step-by-step instructions).
