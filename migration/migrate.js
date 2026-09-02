/**
 * Google Sheets -> Supabase Migration Script
 * -----------------------------------------------------------------------
 * One-time, re-runnable data migration. Reads every user from the already-
 * deployed Google Apps Script Web App (same GET endpoint the old frontend
 * used), transforms each record into the new Supabase schema, downloads and
 * re-uploads NID/photo images from Google Drive into Supabase Storage, and
 * inserts everything into the `users` table.
 *
 * This DOES NOT touch or delete the Google Sheet - it is a pure read from
 * the Sheet's API and a write into Supabase. Safe to re-run: any user_code
 * already present in Supabase is skipped (reported as a duplicate), so a
 * partial/interrupted run can simply be restarted.
 *
 * Setup:
 *   cd migration
 *   npm install
 *   cp .env.example .env   (then fill in SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)
 *   npm run migrate
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SHEET_API_URL = process.env.SHEET_API_URL;

if (!SUPABASE_URL || !SERVICE_KEY || !SHEET_API_URL) {
  console.error('Missing required environment variables. Copy migration/.env.example to migration/.env and fill in the values.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false }
});

// Hierarchy is migrated top-down (FC, then Supervisor, then BP) so a BP/Supervisor's
// Report To target already exists in Supabase (with a resolvable uuid) by the time
// it's needed - mirrors the app's own BP -> Supervisor -> FC reporting direction.
const MIGRATION_ORDER = ['FC', 'Supervisor', 'BP'];
const REPORT_TO_TARGET_DESIGNATION = { BP: 'Supervisor', Supervisor: 'FC' };

const MOBILE_REGEX = /^01[3-9][0-9]{8}$/;
const NID_REGEX = /^[0-9]{10}$|^[0-9]{13}$|^[0-9]{17}$/;

function toArray(val) {
  if (Array.isArray(val)) return val.filter(Boolean);
  if (val === undefined || val === null || val === '') return [];
  return String(val).split(',').map(s => s.trim()).filter(Boolean);
}

async function fetchSourceUsers() {
  console.log(`Fetching existing users from ${SHEET_API_URL} ...`);
  const res = await fetch(SHEET_API_URL, { method: 'GET' });
  const json = await res.json();
  if (json.status !== 'success') {
    throw new Error('Failed to read from the Google Sheet backend: ' + (json.message || 'unknown error'));
  }
  return json.users || [];
}

// Presence/format validation mirroring the app's own rules (validation.js / Code.gs) -
// records failing this are reported as "Failed validation", never silently dropped.
function validateSourceUser(u) {
  const errors = [];
  if (!u.name) errors.push('missing name');
  if (!u.gender || !['Male', 'Female'].includes(u.gender)) errors.push('missing/invalid gender');
  if (!u.fatherName) errors.push('missing fatherName');
  if (!u.motherName) errors.push('missing motherName');
  if (!MOBILE_REGEX.test(String(u.mobile || '').trim())) errors.push('invalid mobile format');
  if (!u.email || !/^[^\s@]+@[A-Za-z]+(\.[A-Za-z]+)+$/.test(u.email)) errors.push('invalid email format');
  if (!u.dob) errors.push('missing dob');
  if (!['BP', 'Supervisor', 'FC'].includes(u.designation)) errors.push('invalid designation');
  if (u.designation !== u.role) errors.push('designation/role mismatch');
  if (!NID_REGEX.test(String(u.nid || '').trim())) errors.push('invalid NID format');
  if (toArray(u.division).length === 0) errors.push('missing division');
  if (toArray(u.district).length === 0) errors.push('missing district');
  if (toArray(u.upazila).length === 0) errors.push('missing upazila');
  if (toArray(u.thana).length === 0) errors.push('missing thana');
  return errors;
}

// Downloads an image (Google Drive "anyone with link" URL) and re-uploads it into
// Supabase Storage. Returns the public URL (user-photos bucket) or the object path
// (nid-documents bucket, private - resolved to a signed URL on demand by the app).
// Returns '' (not a hard failure) if the source has no image or the download fails -
// a missing/broken old Drive link shouldn't block migrating the rest of the record.
async function migrateImage(url, bucket, userCode, fieldName, failures) {
  if (!url || typeof url !== 'string') return '';
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await res.arrayBuffer());
    const ext = contentType.includes('png') ? 'png' : 'jpg';
    const path = `${userCode}/${fieldName}.${ext}`;

    const { error } = await supabase.storage.from(bucket).upload(path, buffer, {
      contentType,
      upsert: true
    });
    if (error) throw error;

    if (bucket === 'user-photos') {
      return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
    }
    return path;
  } catch (err) {
    failures.push(`${userCode}: failed to migrate ${fieldName} image (${err.message})`);
    return '';
  }
}

async function main() {
  const sourceUsers = await fetchSourceUsers();
  console.log(`Found ${sourceUsers.length} record(s) in the Google Sheet.\n`);

  const { data: existingRows, error: existingErr } = await supabase.from('users').select('user_code, mobile, nid, name, id, designation, role, status');
  if (existingErr) throw existingErr;

  const existingByCode = new Map(existingRows.map(r => [r.user_code, r]));
  const existingByMobile = new Map(existingRows.map(r => [r.mobile, r]));
  const existingByNid = new Map(existingRows.map(r => [r.nid, r]));
  // name -> uuid, scoped by designation, used to resolve Report To targets as we go.
  const uuidByNameAndDesignation = new Map(
    existingRows.map(r => [`${r.designation}::${r.name}`, r.id])
  );

  const summary = { total: sourceUsers.length, migrated: 0, skippedDuplicates: 0, failedValidation: [], imageFailures: [] };
  const seenMobile = new Set();
  const seenNid = new Set();
  const seenCode = new Set();

  for (const targetDesignation of MIGRATION_ORDER) {
    const batch = sourceUsers.filter(u => u.designation === targetDesignation);
    console.log(`--- Migrating ${batch.length} ${targetDesignation} record(s) ---`);

    for (const u of batch) {
      const userCode = u.id;
      const mobile = String(u.mobile || '').trim();
      const nid = String(u.nid || '').trim();

      // Duplicate detection: within this source export, and against whatever is
      // already in Supabase (so re-running the script after a partial run, or
      // after some records were fixed and re-exported, doesn't double-insert).
      if (existingByCode.has(userCode) || seenCode.has(userCode) ||
          existingByMobile.has(mobile) || seenMobile.has(mobile) ||
          existingByNid.has(nid) || seenNid.has(nid)) {
        summary.skippedDuplicates++;
        console.log(`  SKIP (duplicate): ${userCode} - ${u.name}`);
        continue;
      }

      const validationErrors = validateSourceUser(u);
      if (validationErrors.length > 0) {
        summary.failedValidation.push({ userCode, name: u.name, errors: validationErrors });
        console.log(`  FAIL (validation): ${userCode} - ${u.name} - ${validationErrors.join(', ')}`);
        continue;
      }

      // Resolve Report To name -> uuid. FC has none; BP/Supervisor must resolve to an
      // already-migrated (this run or a prior one), Active target - if it doesn't
      // resolve, the record is reported as a validation failure rather than inserted
      // with a broken/empty Report To.
      let reportToId = null;
      const target = REPORT_TO_TARGET_DESIGNATION[targetDesignation];
      if (target) {
        reportToId = uuidByNameAndDesignation.get(`${target}::${u.reportTo}`) || null;
        if (!reportToId) {
          summary.failedValidation.push({ userCode, name: u.name, errors: [`Report To "${u.reportTo}" (${target}) not found/not migrated yet`] });
          console.log(`  FAIL (report-to): ${userCode} - ${u.name} - Report To "${u.reportTo}" not resolvable`);
          continue;
        }
      }

      const [userPhotoUrl, nidFrontPath, nidBackPath] = await Promise.all([
        migrateImage(u.userPhoto, 'user-photos', userCode, 'photo', summary.imageFailures),
        migrateImage(u.nidFront, 'nid-documents', userCode, 'nidFront', summary.imageFailures),
        migrateImage(u.nidBack, 'nid-documents', userCode, 'nidBack', summary.imageFailures)
      ]);

      const row = {
        user_code: userCode, // preserves the original Sheet id
        name: u.name,
        gender: u.gender,
        father_name: u.fatherName,
        mother_name: u.motherName,
        mobile,
        email: u.email,
        dob: u.dob,
        division: toArray(u.division),
        district: toArray(u.district),
        upazila: toArray(u.upazila),
        thana: toArray(u.thana),
        designation: u.designation,
        role: u.role,
        report_to_id: reportToId,
        nid,
        nid_front_url: nidFrontPath,
        nid_back_url: nidBackPath,
        user_photo_url: userPhotoUrl,
        status: u.status === 'Inactive' ? 'Inactive' : 'Submitted',
        created_by: u.createdBy || 'Migration',
        created_date: u.createdDate || undefined,
        updated_by: u.updatedBy || 'Migration',
        updated_date: u.updatedDate || undefined
      };

      const { data: inserted, error } = await supabase.from('users').insert(row).select('id, user_code, name, designation').single();
      if (error) {
        summary.failedValidation.push({ userCode, name: u.name, errors: [error.message] });
        console.log(`  FAIL (insert): ${userCode} - ${u.name} - ${error.message}`);
        continue;
      }

      seenMobile.add(mobile);
      seenNid.add(nid);
      seenCode.add(userCode);
      uuidByNameAndDesignation.set(`${inserted.designation}::${inserted.name}`, inserted.id);
      summary.migrated++;
      console.log(`  OK: ${userCode} - ${u.name}`);
    }
  }

  console.log('\n============================================');
  console.log(' Migration Summary');
  console.log('============================================');
  console.log(`Total records:          ${summary.total}`);
  console.log(`Successfully migrated:  ${summary.migrated}`);
  console.log(`Skipped duplicates:     ${summary.skippedDuplicates}`);
  console.log(`Failed validation:      ${summary.failedValidation.length}`);
  console.log(`Image migration issues: ${summary.imageFailures.length} (record still migrated - see below)`);

  if (summary.failedValidation.length > 0) {
    console.log('\n--- Failed Validation Detail ---');
    summary.failedValidation.forEach(f => console.log(`  ${f.userCode} (${f.name}): ${f.errors.join(', ')}`));
  }
  if (summary.imageFailures.length > 0) {
    console.log('\n--- Image Migration Issues ---');
    summary.imageFailures.forEach(m => console.log(`  ${m}`));
  }

  require('fs').writeFileSync(
    require('path').join(__dirname, 'migration-report.json'),
    JSON.stringify(summary, null, 2)
  );
  console.log('\nFull report written to migration/migration-report.json');
}

main().catch(err => {
  console.error('\nMigration aborted due to an unexpected error:', err);
  process.exit(1);
});
