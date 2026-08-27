/**
 * LEGACY / DEPRECATED - kept only as a backup data source for the one-time
 * Supabase migration (see ../migration/migrate.js, which reads from this
 * Web App's GET endpoint). The live app no longer calls this script - see
 * ../MIGRATION.md and ../supabase/schema.sql for the current architecture.
 * Keep this deployment running (unchanged) until the migration is verified.
 * -----------------------------------------------------------------------
 * Google Apps Script Backend - User Account Creation System
 * -----------------------------------------------------------------------
 * This script turns a Google Sheet into the live database for the app.
 * Deploy it as a Web App bound to the target Spreadsheet (see DEPLOY.md
 * in this same folder for step-by-step setup instructions).
 *
 * Data is split across THREE sheet tabs, one per role - "BP", "Supervisor", "FC" -
 * instead of a single combined sheet. A user's row always lives in the tab matching
 * their current Designation/Role; editing a user's Designation moves their row to the
 * matching tab.
 *
 * Endpoints:
 *   GET  <webAppUrl>                         -> { status, users: [...] }  (all 3 tabs combined)
 *   POST <webAppUrl>  action=addUser         -> { status, user }
 *   POST <webAppUrl>  action=updateUser      -> { status, user }
 *   POST <webAppUrl>  action=toggleStatus    -> { status, newStatus }
 *   POST <webAppUrl>  action=resetToDefaults -> { status }
 */

const IMAGES_FOLDER_NAME = 'UBL_ID_Creation_Uploads';

// Column order in the Sheet - keep in sync with the app's user object shape.
const HEADERS = [
  'id', 'name', 'gender', 'fatherName', 'motherName', 'mobile', 'email', 'dob',
  'division', 'district', 'upazila', 'thana',
  'designation', 'role', 'reportTo', 'nid',
  'nidFront', 'nidBack', 'userPhoto',
  'status', 'createdBy', 'createdDate', 'updatedBy', 'updatedDate'
];

// Only these two values are ever accepted for Gender - enforced both on new-user creation
// (required) and on update (only if a value is present, so legacy pre-Gender records can
// still be edited without being forced to backfill it - see validateGender_).
const ALLOWED_GENDERS = ['Male', 'Female'];

// Location fields may hold multiple values from the app's multi-select - stored as a
// single comma-separated cell and split back into an array when read.
const MULTI_VALUE_FIELDS = ['division', 'district', 'upazila', 'thana'];

// Reporting hierarchy (also enforced client-side, but re-checked here since this endpoint
// could be called directly, bypassing the form): FC -> Supervisor -> BP.
// Designation and Role must always be identical; a Designation's Report To target is looked
// up by that same value. FC has no target - it is the top of the hierarchy.
const ALLOWED_DESIGNATIONS = ['BP', 'Supervisor', 'FC'];
const REPORT_TO_TARGET_DESIGNATION = { BP: 'Supervisor', Supervisor: 'FC' };

// Centralized Role -> Sheet Tab Name mapping - the ONLY place sheet selection is decided.
// To add a new role later (e.g. "MC"): add it to ALLOWED_DESIGNATIONS, add an entry here,
// and give it a REPORT_TO_TARGET_DESIGNATION entry if it should report to someone. No other
// function in this file needs to change - getSheetForRole_/getAllRoleSheets_/readAllUsers_/
// findUserRow_/getTotalUserCount_ all derive from these two maps.
const ROLE_TO_SHEET_NAME = { BP: 'BP', Supervisor: 'Supervisor', FC: 'FC' };

// Fields that must be non-empty on every new/updated user record, and the human-readable
// label to use in the error message. Report To is deliberately excluded - its required-ness
// depends on Designation and is fully handled by validateDesignationRoleReportTo_ instead.
const REQUIRED_TEXT_FIELDS = {
  name: 'Name', fatherName: "Father's Name", motherName: "Mother's Name",
  mobile: 'Mobile Number', email: 'Email', dob: 'Date of Birth',
  designation: 'Designation', role: 'Role', nid: 'NID Number'
};
const REQUIRED_LOCATION_FIELDS = { division: 'Division', district: 'District', upazila: 'Upazila', thana: 'Thana' };
const REQUIRED_IMAGE_FIELDS = { userPhoto: 'User Photo', nidFront: 'NID Front Image', nidBack: 'NID Back Image' };

const SEED_USERS = [
  {
    name: 'Nasir Uddin', gender: 'Male', fatherName: 'Abdul Karim', motherName: 'Rahima Khatun',
    mobile: '01611223344', email: 'nasir.uddin@example.com', dob: '1980-01-15',
    division: 'Dhaka', district: 'Dhaka', upazila: 'Dhaka City', thana: 'Gulshan Thana',
    designation: 'FC', role: 'FC', reportTo: '', nid: '19802692738192042',
    nidFront: '', nidBack: '', userPhoto: '', status: 'Active'
  },
  {
    name: 'Md Akram Hossain', gender: 'Male', fatherName: 'Md Nurul Islam', motherName: 'Begum Rokeya',
    mobile: '01711223344', email: 'akram.hossain@example.com', dob: '1988-05-12',
    division: 'Dhaka', district: 'Dhaka', upazila: 'Dhaka City', thana: 'Gulshan Thana',
    designation: 'Supervisor', role: 'Supervisor', reportTo: 'Nasir Uddin', nid: '19882692738192039',
    nidFront: '', nidBack: '', userPhoto: '', status: 'Active'
  },
  {
    name: 'Tanvir Ahmed', gender: 'Male', fatherName: 'Kabir Ahmed', motherName: 'Nasreen Sultana',
    mobile: '01899887766', email: 'tanvir.ahmed@example.com', dob: '1994-11-20',
    division: 'Dhaka', district: 'Dhaka', upazila: 'Savar', thana: 'Savar Model Thana',
    designation: 'BP', role: 'BP', reportTo: 'Md Akram Hossain', nid: '19942692738192040',
    nidFront: '', nidBack: '', userPhoto: '', status: 'Active'
  }
];

// Returns (creating if needed) the sheet tab for a given role, via the centralized
// ROLE_TO_SHEET_NAME mapping. Each tab gets its own header row the first time it's created.
// Returns null for an unrecognized role - callers must validate the role before relying on this.
function getSheetForRole_(role) {
  const sheetName = ROLE_TO_SHEET_NAME[role];
  if (!sheetName) return null;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  } else {
    ensureGenderColumn_(sheet);
  }
  ensureMobileColumnTextFormat_(sheet);
  return sheet;
}

// Google Sheets auto-detects a cell's type from its content at write time, regardless of the
// JS value's actual type - a General-format cell that receives "01712345678" stores it as the
// NUMBER 1712345678, silently dropping the leading 0. Pre-formatting the whole Mobile column
// (including not-yet-used rows) as Plain Text ("@") disables that auto-detection, so any string
// written there - now or by a future appendRow - is kept exactly as typed. Idempotent and cheap
// (setNumberFormat, no value changes), so it's safe to call on every request like
// ensureGenderColumn_. Does NOT touch already-written cells' values - a row where the leading 0
// was already lost stays as-is (see REQ. 5 - existing records are never silently rewritten).
function ensureMobileColumnTextFormat_(sheet) {
  const lastCol = sheet.getLastColumn();
  if (lastCol === 0) return;
  const currentHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const mobileIdx = currentHeaders.indexOf('mobile'); // 0-based
  if (mobileIdx === -1) return;

  const maxRows = sheet.getMaxRows();
  if (maxRows > 1) {
    sheet.getRange(2, mobileIdx + 1, maxRows - 1, 1).setNumberFormat('@');
  }
}

// One-time, idempotent migration for sheets that were created before Gender existed: inserts
// a new blank "Gender" column immediately after "Name" (a real column insert, so every existing
// row's other values shift right and stay intact - old rows simply get an empty Gender cell).
// No-ops immediately once the header already contains "gender" - cheap to call on every request.
function ensureGenderColumn_(sheet) {
  const lastCol = sheet.getLastColumn();
  if (lastCol === 0) return;
  const currentHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  if (currentHeaders.indexOf('gender') !== -1) return;

  const nameIdx = currentHeaders.indexOf('name'); // 0-based
  if (nameIdx === -1) return; // not a recognized header row - leave it alone

  const insertAtCol = nameIdx + 2; // 1-based sheet column right after "name"
  sheet.insertColumnBefore(insertAtCol);
  sheet.getRange(1, insertAtCol).setValue('gender');
}

// All 3 role tabs, in ALLOWED_DESIGNATIONS order, creating any that don't exist yet.
function getAllRoleSheets_() {
  return ALLOWED_DESIGNATIONS.map(role => getSheetForRole_(role));
}

function getImagesFolder_() {
  const folders = DriveApp.getFoldersByName(IMAGES_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(IMAGES_FOLDER_NAME);
}

// Converts a base64 data URI (e.g. "data:image/png;base64,....") into a Drive file and
// returns its shareable URL. A Sheet cell cannot hold a full base64 image (50,000 char
// limit), so images must live in Drive with only the link stored in the Sheet.
// If the value isn't a data URI (already a URL, or empty), it's returned unchanged.
function saveImageIfNeeded_(value, filenamePrefix) {
  if (!value || typeof value !== 'string' || value.indexOf('data:') !== 0) {
    return value || '';
  }
  const match = value.match(/^data:(image\/[a-zA-Z]+);base64,(.*)$/);
  if (!match) return value;

  const mimeType = match[1];
  const base64Data = match[2];
  const ext = mimeType.split('/')[1];
  const bytes = Utilities.base64Decode(base64Data);
  const blob = Utilities.newBlob(bytes, mimeType, `${filenamePrefix}_${new Date().getTime()}.${ext}`);
  const file = getImagesFolder_().createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

function rowToUser_(headers, row) {
  const user = {};
  headers.forEach((key, i) => {
    let val = row[i];
    if (MULTI_VALUE_FIELDS.indexOf(key) !== -1) {
      val = val ? String(val).split(',').map(s => s.trim()).filter(Boolean) : [];
    } else if (key === 'mobile' && val !== undefined && val !== null && val !== '') {
      // Guards against a legacy/General-format cell that Sheets already coerced into a
      // Number - always hand the app a string, never a JS number, for this field.
      val = String(val);
    }
    user[key] = (val === undefined || val === null) ? '' : val;
  });
  return user;
}

function userToRow_(headers, user) {
  return headers.map(key => {
    let val = user[key];
    if (MULTI_VALUE_FIELDS.indexOf(key) !== -1) {
      val = Array.isArray(val) ? val.join(', ') : (val || '');
    }
    return (val === undefined || val === null) ? '' : val;
  });
}

// Server-side minimum-age guard - mirrors the client-side rule so it can't be
// bypassed by calling this endpoint directly instead of going through the form.
function calculateAge_(dobStr) {
  const dob = new Date(dobStr);
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Reads every user row across ALL 3 role tabs as plain objects, combined into one list.
// Used both to answer GET requests and internally whenever a write needs to check the
// existing hierarchy (e.g. "is this Report To an existing, matching-designation/role Supervisor?").
function readAllUsers_() {
  const allUsers = [];
  getAllRoleSheets_().forEach(sheet => {
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    data.slice(1)
      .filter(row => row[0]) // skip fully blank rows
      .forEach(row => allUsers.push(rowToUser_(headers, row)));
  });
  return allUsers;
}

// Total user count across all 3 tabs - used to generate a globally-sequential ID
// (so IDs stay unique and ordered regardless of which tab a user ends up in).
function getTotalUserCount_() {
  return getAllRoleSheets_().reduce((sum, sheet) => sum + Math.max(sheet.getLastRow() - 1, 0), 0);
}

// Locates a user's row by id, searching across all 3 role tabs (a user can be in any one
// of them). Returns { sheet, headers, rowNumber (1-based, includes header), rowValues } or null.
function findUserRow_(id) {
  const sheets = getAllRoleSheets_();
  for (let s = 0; s < sheets.length; s++) {
    const sheet = sheets[s];
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const idCol = headers.indexOf('id');
    for (let r = 1; r < data.length; r++) {
      if (data[r][idCol] === id) {
        return { sheet: sheet, headers: headers, rowNumber: r + 1, rowValues: data[r] };
      }
    }
  }
  return null;
}

// Appends a user as a new row, explicitly forcing the Mobile cell to Plain Text right before
// the write. ensureMobileColumnTextFormat_ already pre-formats the column, but this is a
// second, row-specific guard in case that row falls outside the pre-formatted range (e.g. a
// sheet whose max-rows grew from an appendRow before this fix existed) - belt and suspenders
// against the leading 0 ever being dropped on write.
function appendUserRow_(sheet, headers, user) {
  const targetRow = sheet.getLastRow() + 1;
  const mobileIdx = headers.indexOf('mobile');
  if (mobileIdx !== -1) {
    sheet.getRange(targetRow, mobileIdx + 1).setNumberFormat('@');
  }
  sheet.getRange(targetRow, 1, 1, headers.length).setValues([userToRow_(headers, user)]);
}

// Verifies the Designation/Role/Report To rules against a (prospective) user object:
//   - Designation must be one of BP/Supervisor/FC, and Role must equal Designation.
//   - BP's Report To must be an existing, Active, matching-designation/role Supervisor.
//   - Supervisor's Report To must be an existing, Active, matching-designation/role FC.
//   - FC must have an empty Report To (top of the hierarchy).
// Rows where designation/role don't match are never treated as valid Report To targets,
// so legacy/mismatched Sheet data is silently ignored rather than fixed automatically.
function validateDesignationRoleReportTo_(user, excludeId) {
  if (ALLOWED_DESIGNATIONS.indexOf(user.designation) === -1) {
    return { valid: false, message: 'Invalid Designation.' };
  }
  if (user.designation !== user.role) {
    return { valid: false, message: 'Designation and Role must match.' };
  }

  const targetDesignation = REPORT_TO_TARGET_DESIGNATION[user.designation] || null;

  if (!targetDesignation) {
    // FC (top of the hierarchy) must not have a Report To.
    if (user.reportTo) {
      return { valid: false, message: 'FC users must not have a Report To.' };
    }
    return { valid: true };
  }

  if (!user.reportTo) {
    return { valid: false, message: 'Report To is required and must be a ' + targetDesignation + '.' };
  }

  const allUsers = readAllUsers_();
  const validTarget = allUsers.some(u =>
    u.id !== excludeId &&
    u.status === 'Active' &&
    u.designation === u.role &&
    u.designation === targetDesignation &&
    u.name === user.reportTo
  );
  if (!validTarget) {
    return { valid: false, message: 'Report To must be an existing, active ' + targetDesignation + '.' };
  }
  return { valid: true };
}

// Validates Gender against the fixed Male/Female enum. `required` distinguishes the two
// callers: handleAddUser_ passes true (every new user must have a Gender), handleUpdateUser_
// passes false (a value is checked against the enum if present, but a legacy record with no
// Gender yet is allowed to stay that way through an unrelated edit - see REQ. 5 in the task).
function validateGender_(gender, required) {
  if (!gender) {
    return required ? { valid: false, message: 'Missing required field: Gender.' } : { valid: true };
  }
  if (ALLOWED_GENDERS.indexOf(gender) === -1) {
    return { valid: false, message: 'Invalid Gender. Must be Male or Female.' };
  }
  return { valid: true };
}

// Confirms every mandatory field is present before a record is written - a server-side
// backstop for the frontend's own required-field checks, since this endpoint could be called
// directly. Checks presence only (format - email/mobile/NID patterns, age - is validated
// elsewhere); this just ensures nothing mandatory silently arrived blank/missing.
function validateRequiredFields_(user) {
  for (const key in REQUIRED_TEXT_FIELDS) {
    if (!user[key] || !String(user[key]).trim()) {
      return { valid: false, message: 'Missing required field: ' + REQUIRED_TEXT_FIELDS[key] + '.' };
    }
  }
  for (const key in REQUIRED_LOCATION_FIELDS) {
    const val = user[key];
    const isEmpty = Array.isArray(val) ? val.length === 0 : !val;
    if (isEmpty) {
      return { valid: false, message: 'Missing required field: ' + REQUIRED_LOCATION_FIELDS[key] + '.' };
    }
  }
  for (const key in REQUIRED_IMAGE_FIELDS) {
    if (!user[key]) {
      return { valid: false, message: 'Missing required field: ' + REQUIRED_IMAGE_FIELDS[key] + '.' };
    }
  }
  return { valid: true };
}

// Checks whether an ACTIVE OR INACTIVE user already exists with the same Mobile Number or
// NID Number, searched across all 3 role tabs (a mobile/NID must be globally unique regardless
// of role). `excludeId` lets an update check against everyone except the record being edited.
// This is the server-side backstop for duplicate prevention - the frontend already checks
// this against its cached list before submitting, but that cache can go stale between the
// user opening the form and clicking Confirm, so this is the actual authoritative gate.
function findDuplicateUser_(mobile, nid, excludeId) {
  const cleanMobile = mobile ? String(mobile).trim() : '';
  const cleanNid = nid ? String(nid).trim() : '';
  const allUsers = readAllUsers_();

  const dupMobile = allUsers.find(u => u.id !== excludeId && cleanMobile && u.mobile === cleanMobile);
  if (dupMobile) {
    return { message: 'This user already exists in the system (duplicate Mobile Number).' };
  }

  const dupNid = allUsers.find(u => u.id !== excludeId && cleanNid && u.nid === cleanNid);
  if (dupNid) {
    return { message: 'This user already exists in the system (duplicate NID Number).' };
  }

  return null;
}

function doGet(e) {
  try {
    const users = readAllUsers_();
    return jsonOutput_({ status: 'success', users: users });
  } catch (err) {
    return jsonOutput_({ status: 'error', message: err.message });
  }
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;

    if (action === 'addUser') {
      return handleAddUser_(payload.userData);
    }
    if (action === 'updateUser') {
      return handleUpdateUser_(payload.id, payload.updatedFields);
    }
    if (action === 'toggleStatus') {
      return handleToggleStatus_(payload.id);
    }
    if (action === 'resetToDefaults') {
      return handleResetToDefaults_();
    }

    return jsonOutput_({ status: 'error', message: 'Unknown action: ' + action });
  } catch (err) {
    return jsonOutput_({ status: 'error', message: err.message });
  }
}

function handleAddUser_(userData) {
  if (!userData) return jsonOutput_({ status: 'error', message: 'Missing userData' });

  // Cast (never Number()/parseInt()) so a leading 0 survives even if the client somehow sent
  // mobile as a JSON number instead of a string.
  if (userData.mobile !== undefined && userData.mobile !== null) {
    userData.mobile = String(userData.mobile).trim();
  }

  const requiredCheck = validateRequiredFields_(userData);
  if (!requiredCheck.valid) {
    return jsonOutput_({ status: 'error', message: requiredCheck.message });
  }

  const genderCheck = validateGender_(userData.gender, true);
  if (!genderCheck.valid) {
    return jsonOutput_({ status: 'error', message: genderCheck.message });
  }

  if (calculateAge_(userData.dob) < 18) {
    return jsonOutput_({ status: 'error', message: 'User must be at least 18 years old to create an account.' });
  }

  const hierarchyCheck = validateDesignationRoleReportTo_(userData, null);
  if (!hierarchyCheck.valid) {
    return jsonOutput_({ status: 'error', message: hierarchyCheck.message });
  }
  if (userData.designation === 'FC') {
    userData.reportTo = ''; // enforced server-side regardless of what the client sent
  }

  // Duplicate check runs BEFORE any Drive upload, so a rejected submission never wastes
  // Drive storage/quota uploading images that end up discarded.
  const duplicate = findDuplicateUser_(userData.mobile, userData.nid, null);
  if (duplicate) {
    return jsonOutput_({ status: 'error', message: duplicate.message });
  }

  const targetSheet = getSheetForRole_(userData.designation);
  if (!targetSheet) {
    return jsonOutput_({ status: 'error', message: 'Could not determine a Sheet tab for Designation "' + userData.designation + '".' });
  }

  try {
    userData.nidFront = saveImageIfNeeded_(userData.nidFront, (userData.nid || 'user') + '_nidFront');
    userData.nidBack = saveImageIfNeeded_(userData.nidBack, (userData.nid || 'user') + '_nidBack');
    userData.userPhoto = saveImageIfNeeded_(userData.userPhoto, (userData.nid || 'user') + '_photo');
  } catch (imgErr) {
    return jsonOutput_({ status: 'error', message: 'Failed to upload one or more images to Google Drive: ' + imgErr.message });
  }

  const nextNumber = getTotalUserCount_() + 1; // globally sequential across all 3 tabs
  const newId = 'USR-' + new Date().getFullYear() + '-' + String(nextNumber).padStart(4, '0');
  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');

  // System-managed fields are applied AFTER userData (so they always win) - this is the actual
  // moment the server processes the request, which is what Created Date should reflect. Never
  // trust a client-supplied id/status/createdDate/etc., whether from clock drift or otherwise.
  const fullUser = Object.assign({}, userData, {
    id: newId,
    status: 'Active',
    createdBy: 'Admin / Self',
    createdDate: now,
    updatedBy: 'Admin / Self',
    updatedDate: now
  });

  try {
    appendUserRow_(targetSheet, HEADERS, fullUser);
  } catch (sheetErr) {
    return jsonOutput_({ status: 'error', message: 'Failed to write to the Google Sheet: ' + sheetErr.message });
  }

  return jsonOutput_({ status: 'success', user: fullUser });
}

function handleUpdateUser_(id, updatedFields) {
  const found = findUserRow_(id);
  if (!found) return jsonOutput_({ status: 'error', message: 'User not found: ' + id });

  const existing = rowToUser_(found.headers, found.rowValues);
  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  const merged = Object.assign({}, existing, updatedFields, { updatedBy: 'Admin User', updatedDate: now });

  // Cast (never Number()/parseInt()) so a leading 0 survives even if updatedFields sent
  // mobile as a JSON number instead of a string.
  if (merged.mobile !== undefined && merged.mobile !== null) {
    merged.mobile = String(merged.mobile).trim();
  }

  // Validate the FINAL merged state, not just the changed fields - catches an invalid
  // combination even if only one of designation/role/reportTo was actually sent.
  const requiredCheck = validateRequiredFields_(merged);
  if (!requiredCheck.valid) {
    return jsonOutput_({ status: 'error', message: requiredCheck.message });
  }

  // Not required here (unlike handleAddUser_) - a legacy record with no Gender yet must stay
  // editable without being forced to backfill it; only rejects an actually-invalid value.
  const genderCheck = validateGender_(merged.gender, false);
  if (!genderCheck.valid) {
    return jsonOutput_({ status: 'error', message: genderCheck.message });
  }

  const hierarchyCheck = validateDesignationRoleReportTo_(merged, id);
  if (!hierarchyCheck.valid) {
    return jsonOutput_({ status: 'error', message: hierarchyCheck.message });
  }
  if (merged.designation === 'FC') {
    merged.reportTo = ''; // enforced server-side regardless of what the client sent
  }

  // Duplicate check excludes this user's own id, so keeping the same mobile/NID isn't
  // flagged as a conflict with itself.
  const duplicate = findDuplicateUser_(merged.mobile, merged.nid, id);
  if (duplicate) {
    return jsonOutput_({ status: 'error', message: duplicate.message });
  }

  try {
    if (merged.designation !== existing.designation) {
      // Designation changed - this user's row must move to the matching role's tab.
      const targetSheet = getSheetForRole_(merged.designation);
      if (!targetSheet) {
        return jsonOutput_({ status: 'error', message: 'Could not determine a Sheet tab for Designation "' + merged.designation + '".' });
      }
      found.sheet.deleteRow(found.rowNumber);
      appendUserRow_(targetSheet, HEADERS, merged);
    } else {
      const mobileIdx = found.headers.indexOf('mobile');
      if (mobileIdx !== -1) {
        found.sheet.getRange(found.rowNumber, mobileIdx + 1).setNumberFormat('@');
      }
      found.sheet.getRange(found.rowNumber, 1, 1, found.headers.length).setValues([userToRow_(found.headers, merged)]);
    }
  } catch (sheetErr) {
    return jsonOutput_({ status: 'error', message: 'Failed to update the Google Sheet: ' + sheetErr.message });
  }

  return jsonOutput_({ status: 'success', user: merged });
}

function handleToggleStatus_(id) {
  const found = findUserRow_(id);
  if (!found) return jsonOutput_({ status: 'error', message: 'User not found: ' + id });

  const statusCol = found.headers.indexOf('status');
  const updatedDateCol = found.headers.indexOf('updatedDate');
  const newStatus = found.rowValues[statusCol] === 'Active' ? 'Inactive' : 'Active';
  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');

  found.sheet.getRange(found.rowNumber, statusCol + 1).setValue(newStatus);
  found.sheet.getRange(found.rowNumber, updatedDateCol + 1).setValue(now);
  return jsonOutput_({ status: 'success', newStatus: newStatus });
}

function handleResetToDefaults_() {
  getAllRoleSheets_().forEach(sheet => {
    sheet.clearContents();
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    ensureMobileColumnTextFormat_(sheet);
  });

  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  SEED_USERS.forEach((seed, i) => {
    const fullUser = Object.assign({
      id: 'USR-2026-' + String(i + 1).padStart(4, '0'),
      createdBy: 'System Admin',
      createdDate: now,
      updatedBy: 'System Admin',
      updatedDate: now
    }, seed);
    const targetSheet = getSheetForRole_(fullUser.designation);
    appendUserRow_(targetSheet, HEADERS, fullUser);
  });

  return jsonOutput_({ status: 'success' });
}
