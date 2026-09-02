/**
 * Supabase Data-Access / Service Layer
 * -----------------------------------------------------------------------
 * Replaces the old Google Apps Script Web App (apps-script/Code.gs) as the
 * app's backend. Every Supabase query used by the app lives here - app.js
 * and storage.js never talk to `window.sb` (the Supabase client) directly.
 *
 * Table: public.users (see supabase/schema.sql for the full schema, RLS
 * policies, and Storage bucket setup).
 *
 * Row <-> app-object mapping: the DB uses snake_case columns and a uuid
 * primary key (`id`); the app's user objects use camelCase and are keyed by
 * the human-readable `user_code` (e.g. "USR-2026-0001", exposed to the app
 * as `.id` to match the old Google Sheet shape). This keeps app.js's
 * existing `u.id` / `u.name` / `u.createdDate` usage unchanged.
 */

// Query the `users_with_report_to` view everywhere reads happen - it already
// joins in report_to_name/report_to_code so the app never needs a second
// round-trip (or a client-side join) just to display who a user reports to.
const USERS_VIEW = 'users_with_report_to';

const NID_SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour - short-lived link to a private document

// Must mirror the `status` CHECK constraint on public.users in supabase/schema.sql.
const USER_STATUSES = ['Created', 'Submitted', 'Processing', 'Inactive'];

function dbRowToUser(row) {
  if (!row) return null;
  return {
    id: row.user_code,
    _pk: row.id,
    name: row.name,
    gender: row.gender,
    fatherName: row.father_name,
    motherName: row.mother_name,
    mobile: row.mobile,
    email: row.email,
    dob: row.dob,
    division: row.division || [],
    district: row.district || [],
    upazila: row.upazila || [],
    thana: row.thana || [],
    designation: row.designation,
    role: row.role,
    reportTo: row.report_to_name || '',
    reportToCode: row.report_to_code || '',
    reportToId: row.report_to_id || null,
    agencyId: row.agency_id || null,
    campaignId: row.campaign_id || null,
    agencyName: row.agency_name || '',
    campaignName: row.campaign_name || '',
    nid: row.nid,
    nidFront: row.nid_front_url || '', // storage PATH (private bucket) - resolve via getSignedDocUrls()
    nidBack: row.nid_back_url || '',   // storage PATH (private bucket)
    userPhoto: row.user_photo_url || '', // storage PATH (private bucket) - resolve via getSignedDocUrls()
    status: row.status,
    createdBy: row.created_by,
    createdDate: row.created_date,
    updatedBy: row.updated_by,
    updatedDate: row.updated_date
  };
}

/** Resolves just a user's photo path to a short-lived signed URL (used for admin table avatar thumbnails - requires an authenticated session). */
async function resolveUserPhoto(user) {
  if (!user || !user.userPhoto) return user;
  const sb = requireClient();
  const { data, error } = await sb.storage
    .from('user-photos')
    .createSignedUrl(user.userPhoto, NID_SIGNED_URL_TTL_SECONDS);
  if (error) {
    console.error('Failed to create signed URL for user photo:', error);
    return { ...user, userPhoto: '' };
  }
  return { ...user, userPhoto: data.signedUrl };
}

/** The logged-in admin's email for audit trail fields (updated_by), falling back to a generic label if unavailable for any reason. */
async function getCurrentAdminIdentity() {
  try {
    const sb = requireClient();
    const { data } = await sb.auth.getUser();
    return (data && data.user && data.user.email) || 'Admin User';
  } catch (err) {
    return 'Admin User';
  }
}

function requireClient() {
  if (!window.sb) {
    throw new Error('Supabase is not configured yet. Copy js/config.example.js to js/config.js and fill in your project URL/anon key.');
  }
  return window.sb;
}

// Wraps a Supabase call and turns network/DB errors into friendly, non-leaking
// messages (never surface raw Postgres error text - e.g. constraint names -
// to end users; log it for developers instead).
async function run(promise, friendlyMessage) {
  let result;
  try {
    result = await promise;
  } catch (networkErr) {
    console.error('Supabase request failed:', networkErr);
    throw new Error('Could not reach the Supabase backend. Check your internet connection.');
  }
  if (result.error) {
    console.error('Supabase error:', result.error);
    throw new Error(mapDbError(result.error) || friendlyMessage || 'The database reported an error.');
  }
  return result;
}

// Translates a handful of known Postgres/constraint errors into the same
// user-facing messages the old Apps Script backend used, so the UI's error
// banners/toasts read the same as before. Anything unrecognized falls back
// to a generic message - raw DB errors are never shown to the user.
function mapDbError(error) {
  const msg = (error.message || '').toLowerCase();
  const detail = (error.details || '').toLowerCase();
  if (error.code === '23505') { // unique_violation
    if (msg.includes('mobile_agency_campaign') || msg.includes('mobile')) {
      return 'This user (Mobile Number) is already registered for this campaign.';
    }
    if (msg.includes('nid_agency_campaign') || msg.includes('nid')) {
      return 'This user (NID Number) is already registered for this campaign.';
    }
    if (msg.includes('user_code')) {
      return 'A duplicate User ID was generated - please try again.';
    }
    if (msg.includes('campaigns_agency_name_unique')) {
      return 'A Campaign with this name already exists for this Agency.';
    }
    if (msg.includes('agencies_name_key') || (msg.includes('agencies') && msg.includes('name'))) {
      return 'An Agency with this name already exists.';
    }
    if (msg.includes('account_profiles_pkey') || (msg.includes('account_profiles') && msg.includes('pkey'))) {
      return 'This account is already linked to a login profile.';
    }
    return 'This record already exists in the system (duplicate).';
  }
  if (error.code === '23503') { // foreign_key_violation
    if (msg.includes('account_profiles')) {
      return 'That User ID was not found. Copy it from Supabase Dashboard -> Authentication -> Users first.';
    }
    if (msg.includes('campaigns_agency_id_fkey')) {
      return 'This Agency still has Campaigns under it - delete or reassign those Campaigns first.';
    }
    if (msg.includes('users_agency_id_fkey') || msg.includes('users_campaign_id_fkey')) {
      return 'This still has Users registered under it - it cannot be deleted while those Users exist.';
    }
    if (msg.includes('account_profiles_agency_id_fkey') || msg.includes('account_profiles_campaign_id_fkey')) {
      return 'This still has Campaign Login accounts scoped to it - unlink or delete those accounts first.';
    }
    return 'This action references a record that no longer exists.';
  }
  if (error.code === '23514') { // check_violation
    if (msg.includes('account_profiles_scope_check')) {
      return 'Super Admin accounts must not have an Agency/Campaign; Agency Admin accounts must have both.';
    }
    return 'One or more fields failed validation (invalid format).';
  }
  if (error.code === 'P0001') {
    return error.message; // a `raise exception` from one of our own functions/triggers - already user-friendly
  }
  return null;
}

const dbService = {
  /**
   * Paginated, server-side filtered/searched user list for the Admin table.
   * opts: { page (1-based), pageSize, search, division, district, upazila,
   *         thana, designation, role, status, fromDate, toDate }
   * Returns { rows: [user,...], total: number }.
   */
  async getUsers(opts = {}) {
    const sb = requireClient();
    const page = Math.max(1, opts.page || 1);
    const pageSize = opts.pageSize || 25;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = sb.from(USERS_VIEW).select('*', { count: 'exact' });
    query = applyFilters(query, opts);
    // `id` as a tie-breaker: created_date alone is NOT unique - every row inserted by
    // one import_users_batch() call (Excel import) shares the exact same created_date
    // (Postgres now() is fixed for the whole transaction, not per-statement), and
    // Postgres gives no stable order for ties across separate paginated queries. Without
    // this, a tied row could appear on two different pages (duplicate) or on neither
    // (silently skipped) - exactly the "user missing" / "user shown twice" bug reports.
    query = query.order('created_date', { ascending: false }).order('id', { ascending: false }).range(from, to);

    const { data, error, count } = await run(query, 'Failed to load users.');
    const rows = await Promise.all((data || []).map(dbRowToUser).map(resolveUserPhoto));
    return { rows, total: count || 0 };
  },

  /**
   * Count-only (head:true - never fetches rows) of users matching the given
   * filters - powers the Export view's "Users Found" live preview, which
   * MUST use the exact same filter set (agencyId/campaignId/role/fromDate/
   * toDate via applyFilters()) as getAllUsersForExport() below, so the
   * preview number always matches what the export will actually contain.
   */
  async getUserCount(opts = {}) {
    const sb = requireClient();
    let query = sb.from(USERS_VIEW).select('*', { count: 'exact', head: true });
    query = applyFilters(query, opts);
    const { count } = await run(query, 'Failed to load user count.');
    return count || 0;
  },

  /** Fetches every row matching the given filters (no pagination) - used for Excel export. */
  async getAllUsersForExport(opts = {}) {
    const sb = requireClient();
    const rows = [];
    const batchSize = 1000;
    let from = 0;
    // Loop in batches instead of one unbounded query - keeps a single request
    // from ever trying to pull an unbounded result set into memory at once.
    while (true) {
      let query = sb.from(USERS_VIEW).select('*');
      query = applyFilters(query, opts);
      // Same tie-breaker as getUsers() above - without it, a batch of rows sharing an
      // identical created_date (e.g. one Excel import) could be duplicated or dropped
      // across these paginated batches.
      query = query.order('created_date', { ascending: false }).order('id', { ascending: false }).range(from, from + batchSize - 1);
      const { data, error } = await run(query, 'Failed to load users for export.');
      rows.push(...data.map(dbRowToUser));
      if (data.length < batchSize) break;
      from += batchSize;
    }
    return rows;
  },

  // Deliberately does NOT resolve userPhoto to a signed URL here - its only
  // caller (storage.getUserDetailWithImages()) always immediately pipes the
  // result into getSignedDocUrls(), which is the single place that resolves
  // ALL three private-storage fields (photo + both NID sides) together. Doing
  // it here too used to double-resolve: this returned an already-signed URL,
  // then getSignedDocUrls() signed THAT URL string again as if it were a raw
  // object path, producing a nonsensical nested URL that 404'd in the browser.
  async getUserByCode(userCode) {
    const sb = requireClient();
    const { data, error } = await run(
      sb.from(USERS_VIEW).select('*').eq('user_code', userCode).maybeSingle(),
      'Failed to load user.'
    );
    return dbRowToUser(data);
  },

  /**
   * Report To candidates for a target designation (e.g. "Supervisor" when the
   * form's Designation is "BP"), scoped to a specific Agency+Campaign - a BP
   * in Campaign A must never see a Supervisor from Campaign B, even under the
   * same Agency. Only Active, designation===role rows within that Agency+
   * Campaign - mirrors the old validateDesignationRoleReportTo_ hierarchy rule.
   * `excludeUserCode` lets the Edit modal avoid offering a user as their own
   * Report To. Goes through the get_report_to_candidates() SECURITY DEFINER
   * RPC (see supabase/schema.sql), which for a non-Super-Admin account
   * silently ignores `agencyId`/`campaignId` here and resolves the caller's
   * own scope server-side instead - these are only honored for Super Admin.
   */
  async getReportToUsers(targetDesignation, agencyId, campaignId, excludeUserCode = null) {
    if (!targetDesignation || !agencyId || !campaignId) return [];
    const sb = requireClient();
    const { data } = await run(
      sb.rpc('get_report_to_candidates', {
        p_designation: targetDesignation,
        p_agency_id: agencyId,
        p_campaign_id: campaignId
      }),
      'Failed to load Report To options.'
    );
    return (data || [])
      .filter(r => r.user_code !== excludeUserCode)
      .map(r => ({ id: r.user_code, name: r.name, _pk: r.user_id }));
  },

  /**
   * Authoritative duplicate check (mobile/NID/email), run against the database -
   * not a possibly-stale in-memory cache - right before insert/update, same
   * as the old findDuplicateUser_ safeguard in Code.gs. Scoped to a specific
   * Agency+Campaign: the same person/address CAN legitimately be registered under
   * a different Agency+Campaign - only an exact Agency+Campaign+Mobile/NID/Email
   * repeat is a duplicate. Goes through the check_duplicate_public()
   * SECURITY DEFINER RPC, which for a non-Super-Admin account silently
   * ignores `agencyId`/`campaignId` here and resolves the caller's own scope
   * server-side instead - never trusts the frontend for that role.
   */
  async checkDuplicate(mobile, nid, agencyId, campaignId, excludeUserCode = null, email = null) {
    const sb = requireClient();
    const { data } = await run(
      sb.rpc('check_duplicate_public', {
        p_mobile: mobile || null,
        p_nid: nid || null,
        p_agency_id: agencyId || null,
        p_campaign_id: campaignId || null,
        p_exclude_code: excludeUserCode || null,
        p_email: email || null
      }),
      'Failed to check for duplicates.'
    );
    return data || { duplicate: false };
  },

  /**
   * Uploads a File to Supabase Storage. Both `user-photos` and
   * `nid-documents` are PRIVATE buckets, authenticated-only for both upload
   * and read; reading requires the caller's own Agency+Campaign to match the
   * owning user's (see the Storage RLS policies in supabase/schema.sql), so
   * this always returns the object PATH (not a URL) - callers resolve a path
   * to a signed URL via getSignedDocUrls()/resolveUserPhoto() on demand.
   */
  async uploadImage(bucket, userCode, fieldName, file) {
    if (!file) return '';
    const sb = requireClient();
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${userCode}/${fieldName}_${Date.now()}.${ext}`;

    const { error } = await sb.storage.from(bucket).upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type
    });
    if (error) {
      console.error('Storage upload failed:', error);
      throw new Error(`Failed to upload ${fieldName} - please try again.`);
    }

    return path;
  },

  /**
   * Resolves a user's private NID document paths (and photo) to short-lived
   * signed URLs (detail view only - requires an authenticated session).
   * `user.userPhoto` may already be a signed URL here (e.g. when called on a
   * row taken from the already-resolved admin-table cache - see
   * storage.getUserDetailWithImages()) - re-signing an already-signed URL
   * string as if it were a raw object path produces a nonsensical nested URL
   * that 404s, so any already-resolved http(s) value is passed through as-is.
   */
  async getSignedDocUrls(user) {
    const sb = requireClient();
    const resolve = async (bucket, path) => {
      if (!path) return '';
      if (/^https?:\/\//i.test(path)) return path;
      const { data, error } = await sb.storage
        .from(bucket)
        .createSignedUrl(path, NID_SIGNED_URL_TTL_SECONDS);
      if (error) {
        console.error('Failed to create signed URL:', error);
        return '';
      }
      return data.signedUrl;
    };
    const [nidFront, nidBack, userPhoto] = await Promise.all([
      resolve('nid-documents', user.nidFront),
      resolve('nid-documents', user.nidBack),
      resolve('user-photos', user.userPhoto)
    ]);
    return { ...user, nidFront, nidBack, userPhoto };
  },

  /**
   * Creates a user. `userData` matches the app's camelCase shape (same as
   * the old currentFormData object); `files` is { userPhoto, nidFront,
   * nidBack } File objects (already validated client-side by validation.js).
   * Mirrors handleAddUser_'s order of operations: duplicate check BEFORE any
   * image upload, so a rejected submission never wastes Storage on images
   * that end up discarded. The actual duplicate check + Report To resolution
   * + insert happens atomically inside register_user() (a SECURITY DEFINER
   * RPC - see supabase/schema.sql), which for a non-Super-Admin account
   * silently ignores `userData.agencyId`/`campaignId` and resolves the
   * caller's own permanent scope server-side instead - the frontend never
   * gets to choose it for that role (see js/app.js's Add User form, which
   * doesn't even offer an Agency/Campaign picker to that role).
   */
  async createUser(userData, files) {
    const sb = requireClient();
    const mobile = String(userData.mobile || '').trim();
    const nid = String(userData.nid || '').trim();
    const email = String(userData.email || '').trim();

    const dup = await this.checkDuplicate(mobile, nid, userData.agencyId, userData.campaignId, null, email);
    if (dup.duplicate) throw new Error(dup.message);

    // A temporary code for the image path prefix - the final user_code is
    // assigned by the DB trigger at insert time, but Storage needs a path
    // up front. Using the mobile number keeps paths human-traceable without
    // waiting on the DB round-trip.
    const pathPrefix = mobile || `tmp-${Date.now()}`;
    const [userPhotoUrl, nidFrontPath, nidBackPath] = await Promise.all([
      this.uploadImage('user-photos', pathPrefix, 'photo', files && files.userPhoto),
      this.uploadImage('nid-documents', pathPrefix, 'nidFront', files && files.nidFront),
      this.uploadImage('nid-documents', pathPrefix, 'nidBack', files && files.nidBack)
    ]);

    const { data } = await run(
      sb.rpc('register_user', {
        p: {
          name: userData.name,
          gender: userData.gender,
          fatherName: userData.fatherName,
          motherName: userData.motherName,
          mobile,
          email: userData.email,
          dob: userData.dob,
          division: userData.division || [],
          district: userData.district || [],
          upazila: userData.upazila || [],
          thana: userData.thana || [],
          designation: userData.designation,
          role: userData.role,
          reportTo: userData.reportTo || null,
          nid,
          nidFrontUrl: nidFrontPath,
          nidBackUrl: nidBackPath,
          userPhotoUrl,
          agencyId: userData.agencyId,
          campaignId: userData.campaignId
        }
      }),
      'Failed to create user.'
    );
    return resolveUserPhoto(dbRowToUser(data));
  },

  /**
   * Updates a user (Quick Edit modal: name, mobile, designation, role,
   * reportTo, plus - Super Admin only, see js/app.js openUserEditModal -
   * email/gender/father's & mother's name/DOB/NID). `updatedFields` uses the
   * same camelCase keys as the app's user object. Looked up and updated by
   * user_code (the app-facing id), not the internal uuid, so callers never
   * need to know about `_pk`.
   *
   * Agency/Campaign are NOT editable here (reassigning a person to a
   * different campaign would silently change headcount/reporting elsewhere -
   * that should be a deliberate separate action if ever needed, not a side
   * effect of a Quick Edit). `agencyId`/`campaignId` are the user's EXISTING,
   * unchanged values (passed in by the caller from the already-loaded row),
   * used only to keep the duplicate-check and Report To candidate lookup
   * correctly scoped.
   */
  async updateUser(userCode, updatedFields, agencyId, campaignId) {
    const sb = requireClient();
    const patch = {};

    if (updatedFields.name !== undefined) patch.name = updatedFields.name;
    if (updatedFields.mobile !== undefined) patch.mobile = String(updatedFields.mobile).trim();
    if (updatedFields.designation !== undefined) patch.designation = updatedFields.designation;
    if (updatedFields.role !== undefined) patch.role = updatedFields.role;
    if (updatedFields.email !== undefined) patch.email = updatedFields.email;
    if (updatedFields.gender !== undefined) patch.gender = updatedFields.gender;
    if (updatedFields.fatherName !== undefined) patch.father_name = updatedFields.fatherName;
    if (updatedFields.motherName !== undefined) patch.mother_name = updatedFields.motherName;
    if (updatedFields.dob !== undefined) patch.dob = updatedFields.dob;
    if (updatedFields.nid !== undefined) patch.nid = String(updatedFields.nid).trim();

    // Single authoritative duplicate check covering whichever of Mobile/NID/Email are
    // actually being changed here - same check_duplicate_public() RPC used everywhere else,
    // scoped to this user's own (unchangeable) Agency+Campaign and excluding this user's own row.
    if (patch.mobile !== undefined || patch.nid !== undefined || patch.email !== undefined) {
      const dup = await this.checkDuplicate(
        patch.mobile !== undefined ? patch.mobile : null,
        patch.nid !== undefined ? patch.nid : null,
        agencyId, campaignId, userCode,
        patch.email !== undefined ? patch.email : null
      );
      if (dup.duplicate) throw new Error(dup.message);
    }

    if (updatedFields.reportTo !== undefined) {
      const designation = updatedFields.designation;
      const targetDesignation = { BP: 'Supervisor', Supervisor: 'FC' }[designation] || null;
      if (!targetDesignation) {
        patch.report_to_id = null;
      } else if (!updatedFields.reportTo) {
        throw new Error(`Please select a valid ${targetDesignation} to report to.`);
      } else {
        const { data: candidates } = await run(
          sb.rpc('get_report_to_candidates', {
            p_designation: targetDesignation,
            p_agency_id: agencyId,
            p_campaign_id: campaignId
          }),
          'Failed to validate Report To.'
        );
        const target = (candidates || []).find(c => c.name === updatedFields.reportTo);
        if (!target) throw new Error(`Please select a valid ${targetDesignation} to report to.`);
        patch.report_to_id = target.user_id;
      }
    }

    patch.updated_by = await getCurrentAdminIdentity();

    const { data } = await run(
      sb.from('users').update(patch).eq('user_code', userCode).select().single(),
      'Failed to update user.'
    );
    return resolveUserPhoto(dbRowToUser({ ...data, report_to_name: updatedFields.reportTo || null }));
  },

  /**
   * Sets a user's status to any of the 4 workflow stages. Super-Admin-only -
   * enforced both here (fail fast, friendlier error) and, as the real
   * backstop, by trg_enforce_user_status_change in supabase/schema.sql (so a
   * hand-crafted table update from a non-Super-Admin session is rejected
   * regardless of what this client-side check does).
   */
  async setUserStatus(userCode, newStatus) {
    if (!USER_STATUSES.includes(newStatus)) {
      throw new Error(`Invalid status: ${newStatus}`);
    }
    const sb = requireClient();
    await run(
      sb.from('users').update({ status: newStatus, updated_by: await getCurrentAdminIdentity() }).eq('user_code', userCode),
      'Failed to update status.'
    );
    return newStatus;
  },

  /**
   * Sets status on an explicit list of users (checkbox-picked rows) in one round
   * trip. Same Super-Admin enforcement as setUserStatus() above (client-side fail
   * fast + trg_enforce_user_status_change as the real backstop). All-or-nothing:
   * PostgREST runs the `.in()` update as a single statement, so a failure (e.g. a
   * stale Report To check) rolls back the whole batch rather than partially
   * applying - the right behavior for "just flip a status field", unlike
   * import_users_batch()'s per-row reporting for a very different (multi-field
   * insert) operation.
   */
  async bulkSetUserStatus(userCodes, newStatus) {
    if (!USER_STATUSES.includes(newStatus)) {
      throw new Error(`Invalid status: ${newStatus}`);
    }
    if (!Array.isArray(userCodes) || userCodes.length === 0) {
      throw new Error('No users selected.');
    }
    const sb = requireClient();
    await run(
      sb.from('users').update({ status: newStatus, updated_by: await getCurrentAdminIdentity() }).in('user_code', userCodes),
      'Failed to update status.'
    );
    return newStatus;
  },

  /**
   * Sets status on EVERY user matching the current Users-screen filters (Agency/
   * Campaign/Division/.../From-To Date/Search/Status) - not just the rows loaded
   * on the current page. Reuses the exact same applyFilters() WHERE-clause builder
   * as getUsers()/getAllUsersForExport() (further below in this file), so "Select
   * All N Matching Filters" always affects precisely the N the count badge showed,
   * regardless of how many pages that spans. This is what makes a date-range bulk
   * change (e.g. "everyone created Aug 1-15") practical - checkbox selection alone
   * only reaches whatever page is currently rendered.
   */
  async bulkSetUserStatusByFilter(opts, newStatus) {
    if (!USER_STATUSES.includes(newStatus)) {
      throw new Error(`Invalid status: ${newStatus}`);
    }
    const sb = requireClient();
    let query = sb.from('users').update({ status: newStatus, updated_by: await getCurrentAdminIdentity() });
    query = applyFilters(query, opts);
    // PostgREST refuses an UPDATE with no WHERE clause at all ("UPDATE requires a
    // WHERE clause", code 21000) as a safety guard against an accidental full-table
    // write - applyFilters() adds zero clauses when every filter is left at "All"
    // (e.g. "Select All Matching Filters" clicked with no filters actually set), so
    // this always-true condition (id is the PK, never null) satisfies that
    // requirement without narrowing the result - RLS (users_update_scoped) still
    // does the real scoping regardless of whether any filter was picked.
    query = query.not('id', 'is', null);
    await run(query, 'Failed to update status.');
    return newStatus;
  },

  /** All Agencies (Active only unless includeInactive) - low-sensitivity master data, readable by any logged-in account. */
  async getAgencies(includeInactive = false) {
    const sb = requireClient();
    let query = sb.from('agencies').select('*').order('name', { ascending: true });
    if (!includeInactive) query = query.eq('status', 'Active');
    const { data } = await run(query, 'Failed to load Agencies.');
    return data || [];
  },

  /** Campaigns, optionally scoped to one Agency (Active only unless includeInactive). */
  async getCampaigns(agencyId = null, includeInactive = false) {
    const sb = requireClient();
    let query = sb.from('campaigns').select('*').order('name', { ascending: true });
    if (agencyId) query = query.eq('agency_id', agencyId);
    if (!includeInactive) query = query.eq('status', 'Active');
    const { data } = await run(query, 'Failed to load Campaigns.');
    return data || [];
  },

  /**
   * Super-Admin-only Excel -> User Registration Import. `rows` is an array of
   * objects shaped exactly like createUser()'s userData (camelCase), minus
   * agencyId/campaignId (fixed for the whole batch) and image fields (Excel
   * rows never have files). `counts` is the frontend's own validation-summary
   * tally ({ total, valid, invalid, corrected }) recorded verbatim into the
   * import_batches audit row alongside the server-computed imported/failed
   * counts. All real authorization happens server-side inside
   * import_users_batch() (SECURITY DEFINER, rejects non-Super-Admin callers) -
   * this is just the RPC wrapper, exactly like createUser()/register_user().
   */
  async importUsersBatch(agencyId, campaignId, fileName, rows, counts = {}) {
    const sb = requireClient();
    const { data } = await run(
      sb.rpc('import_users_batch', {
        p_agency_id: agencyId,
        p_campaign_id: campaignId,
        p_file_name: fileName,
        p_rows: rows,
        p_total_rows: counts.total ?? null,
        p_valid_rows: counts.valid ?? null,
        p_invalid_rows: counts.invalid ?? null,
        p_corrected_rows: counts.corrected ?? null
      }),
      'Failed to import users.'
    );
    return data;
  },

  /** Import History (Super Admin only - RLS enforces this regardless of caller). */
  async getImportBatches() {
    const sb = requireClient();
    const { data } = await run(
      sb.from('import_batches')
        .select('*, agencies(name), campaigns(name)')
        .order('created_date', { ascending: false }),
      'Failed to load Import History.'
    );
    return data || [];
  },

  /** Per-row detail (success/user_code or error) for one import batch - fetched on demand when the Import History row is expanded. */
  async getImportBatchRows(batchId) {
    const sb = requireClient();
    const { data } = await run(
      sb.from('import_batch_rows')
        .select('*')
        .eq('batch_id', batchId)
        .order('row_index', { ascending: true }),
      'Failed to load import batch details.'
    );
    return data || [];
  },

  async createAgency(name) {
    const sb = requireClient();
    const identity = await getCurrentAdminIdentity();
    const { data } = await run(
      sb.from('agencies').insert({ name: name.trim(), created_by: identity, updated_by: identity }).select().single(),
      'Failed to create Agency.'
    );
    return data;
  },

  async updateAgency(id, fields) {
    const sb = requireClient();
    const patch = { updated_by: await getCurrentAdminIdentity() };
    if (fields.name !== undefined) patch.name = fields.name.trim();
    if (fields.status !== undefined) patch.status = fields.status;
    const { data } = await run(
      sb.from('agencies').update(patch).eq('id', id).select().single(),
      'Failed to update Agency.'
    );
    return data;
  },

  /** Hard delete - blocked at the DB (ON DELETE RESTRICT) while Campaigns/Users/Campaign Logins still reference this Agency; see mapDbError. */
  async deleteAgency(id) {
    const sb = requireClient();
    await run(sb.from('agencies').delete().eq('id', id), 'Failed to delete Agency.');
  },

  async createCampaign(agencyId, name) {
    const sb = requireClient();
    const identity = await getCurrentAdminIdentity();
    const { data } = await run(
      sb.from('campaigns').insert({ agency_id: agencyId, name: name.trim(), created_by: identity, updated_by: identity }).select().single(),
      'Failed to create Campaign.'
    );
    return data;
  },

  async updateCampaign(id, fields) {
    const sb = requireClient();
    const patch = { updated_by: await getCurrentAdminIdentity() };
    if (fields.name !== undefined) patch.name = fields.name.trim();
    if (fields.agencyId !== undefined) patch.agency_id = fields.agencyId;
    if (fields.status !== undefined) patch.status = fields.status;
    const { data } = await run(
      sb.from('campaigns').update(patch).eq('id', id).select().single(),
      'Failed to update Campaign.'
    );
    return data;
  },

  /** Hard delete - blocked at the DB (ON DELETE RESTRICT) while Users/Campaign Logins still reference this Campaign; see mapDbError. */
  async deleteCampaign(id) {
    const sb = requireClient();
    await run(sb.from('campaigns').delete().eq('id', id), 'Failed to delete Campaign.');
  },

  /**
   * Backs the 5 Dashboard KPI cards (Total Users/BP/Supervisor/FC, Active
   * Campaigns) - small `count`-only queries (head:true - never fetches rows),
   * scoped by whatever Agency/Campaign filter is currently selected, same as
   * every other admin view per the "Agency+Campaign is a first-class filter
   * everywhere" rule.
   */
  async getDashboardCounts(opts = {}) {
    const sb = requireClient();
    const countQuery = (extra = {}) => {
      let query = sb.from(USERS_VIEW).select('*', { count: 'exact', head: true });
      query = applyFilters(query, { ...opts, ...extra });
      return query;
    };

    const [totalRes, bpRes, supRes, fcRes] = await Promise.all([
      run(countQuery(), 'Failed to load Total Users count.'),
      run(countQuery({ role: 'BP' }), 'Failed to load Total BP count.'),
      run(countQuery({ role: 'Supervisor' }), 'Failed to load Total Supervisor count.'),
      run(countQuery({ role: 'FC' }), 'Failed to load Total FC count.')
    ]);

    // Goes through the get_active_campaigns_count() SECURITY DEFINER RPC (see
    // supabase/schema.sql) rather than a bare `count(*) from campaigns` -
    // `campaigns` SELECT is open to any authenticated account (low-sensitivity
    // master data), so a direct client-side count would leak the GLOBAL
    // active-campaign total to a scoped account instead of just its own
    // Agency. For a non-Super-Admin caller the RPC ignores opts.agencyId/
    // opts.campaignId and resolves the caller's own Agency server-side
    // instead (this KPI is deliberately Agency-WIDE, counting every active
    // Campaign under that Agency, not just the caller's own single Campaign -
    // every other count/list/export in this system stays Agency+Campaign
    // scoped, only this one tile is Agency-only). Client args are only
    // honored for Super Admin.
    const campaignsRes = await run(
      sb.rpc('get_active_campaigns_count', { p_agency_id: opts.agencyId || null, p_campaign_id: opts.campaignId || null }),
      'Failed to load Active Campaigns count.'
    );

    return {
      totalUsers: totalRes.count || 0,
      totalBP: bpRes.count || 0,
      totalSupervisor: supRes.count || 0,
      totalFC: fcRes.count || 0,
      activeCampaigns: Number(campaignsRes.data) || 0
    };
  },

  /**
   * Most recently created users, scoped by the same Agency/Campaign filters
   * (and, for a non-Super-Admin caller, the same RLS-enforced tenant scope)
   * as every other dashboard/list query - see applyFilters()/USERS_VIEW.
   */
  async getRecentUsers(opts = {}, limit = 5) {
    const sb = requireClient();
    let query = sb.from(USERS_VIEW).select('*');
    query = applyFilters(query, opts);
    query = query.order('created_date', { ascending: false }).order('id', { ascending: false }).limit(limit);
    const { data } = await run(query, 'Failed to load Recent Users.');
    return (data || []).map(dbRowToUser);
  },

  /**
   * The CURRENT session's own account_profiles row, or `null` if none exists.
   * No row is not an error - it means "legacy Super Admin" (see is_super_admin()
   * in supabase/schema.sql) - the caller (js/storage.js loadCurrentAccount())
   * is what actually applies that bootstrap rule client-side; this function
   * just reports what's in the database.
   */
  async getMyAccountProfile() {
    const sb = requireClient();
    const { data: userData, error: userErr } = await sb.auth.getUser();
    if (userErr || !userData || !userData.user) return null;
    const { data } = await run(
      sb.from('account_profiles').select('*').eq('id', userData.user.id).maybeSingle(),
      'Failed to load your account profile.'
    );
    return data || null;
  },

  /** Every login account - Super-Admin-only (RLS enforces this; a non-Super-Admin caller gets an empty list, not an error). Backs the Campaign Logins management screen. */
  async getAllAccountProfiles() {
    const sb = requireClient();
    const { data } = await run(
      sb.from('account_profiles').select('*').order('created_date', { ascending: false }),
      'Failed to load login accounts.'
    );
    return data || [];
  },

  /**
   * Links an EXISTING Supabase Auth user (identified by its UUID, copied from
   * Supabase Dashboard -> Authentication -> Users) to a role + Agency+Campaign
   * scope. Does NOT create the auth account itself - this app never handles a
   * service_role key client-side, so account creation stays a manual Supabase
   * Dashboard step (see ReadMe.md "Campaign Logins").
   */
  async linkAccountProfile({ userId, username, email, agencyId, campaignId, role, status }) {
    const sb = requireClient();
    const identity = await getCurrentAdminIdentity();
    const row = {
      id: userId,
      username: username || null,
      email: email || null,
      role,
      agency_id: role === 'super_admin' ? null : agencyId,
      campaign_id: role === 'super_admin' ? null : campaignId,
      status,
      created_by: identity,
      updated_by: identity
    };
    const { data } = await run(
      sb.from('account_profiles').insert(row).select().single(),
      'Failed to link account.'
    );
    return data;
  },

  async updateAccountProfile(id, fields) {
    const sb = requireClient();
    const patch = { updated_by: await getCurrentAdminIdentity() };
    if (fields.username !== undefined) patch.username = fields.username;
    if (fields.email !== undefined) patch.email = fields.email;
    if (fields.role !== undefined) patch.role = fields.role;
    if (fields.agencyId !== undefined) patch.agency_id = fields.role === 'super_admin' ? null : fields.agencyId;
    if (fields.campaignId !== undefined) patch.campaign_id = fields.role === 'super_admin' ? null : fields.campaignId;
    if (fields.status !== undefined) patch.status = fields.status;
    const { data } = await run(
      sb.from('account_profiles').update(patch).eq('id', id).select().single(),
      'Failed to update account.'
    );
    return data;
  }
};

// Builds the shared WHERE clauses for both getUsers() and getAllUsersForExport().
function applyFilters(query, opts) {
  if (opts.search) {
    // Strip characters that have special meaning in a PostgREST filter string
    // (comma/parens separate `.or()` conditions) so a search term can never
    // be mistaken for extra filter clauses.
    const q = opts.search.replace(/[,()]/g, '').trim();
    if (q) {
      query = query.or(
        `name.ilike.%${q}%,mobile.ilike.%${q}%,email.ilike.%${q}%,user_code.ilike.%${q}%,nid.ilike.%${q}%`
      );
    }
  }
  if (opts.division) query = query.contains('division', [opts.division]);
  if (opts.district) query = query.contains('district', [opts.district]);
  if (opts.upazila) query = query.contains('upazila', [opts.upazila]);
  if (opts.thana) query = query.contains('thana', [opts.thana]);
  if (opts.agencyId) query = query.eq('agency_id', opts.agencyId);
  if (opts.campaignId) query = query.eq('campaign_id', opts.campaignId);
  if (opts.designation) query = query.eq('designation', opts.designation);
  if (opts.role) query = query.eq('role', opts.role);
  if (opts.status) query = query.eq('status', opts.status);
  if (opts.fromDate) query = query.gte('created_date', `${opts.fromDate}T00:00:00`);
  if (opts.toDate) query = query.lte('created_date', `${opts.toDate}T23:59:59`);
  return query;
}

if (typeof window !== 'undefined') {
  window.dbService = dbService;
  window.USER_STATUSES = USER_STATUSES;
}
