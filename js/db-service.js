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
    if (msg.includes('mobile') || detail.includes('mobile')) {
      return 'This user already exists in the system (duplicate Mobile Number).';
    }
    if (msg.includes('nid') || detail.includes('nid')) {
      return 'This user already exists in the system (duplicate NID Number).';
    }
    if (msg.includes('user_code')) {
      return 'A duplicate User ID was generated - please try again.';
    }
    return 'This user already exists in the system (duplicate record).';
  }
  if (error.code === '23514') { // check_violation
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
    query = query.order('created_date', { ascending: false }).range(from, to);

    const { data, error, count } = await run(query, 'Failed to load users.');
    const rows = await Promise.all((data || []).map(dbRowToUser).map(resolveUserPhoto));
    return { rows, total: count || 0 };
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
      query = query.order('created_date', { ascending: false }).range(from, from + batchSize - 1);
      const { data, error } = await run(query, 'Failed to load users for export.');
      rows.push(...data.map(dbRowToUser));
      if (data.length < batchSize) break;
      from += batchSize;
    }
    return rows;
  },

  async getUserByCode(userCode) {
    const sb = requireClient();
    const { data, error } = await run(
      sb.from(USERS_VIEW).select('*').eq('user_code', userCode).maybeSingle(),
      'Failed to load user.'
    );
    return resolveUserPhoto(dbRowToUser(data));
  },

  /**
   * Report To candidates for a target designation (e.g. "Supervisor" when the
   * form's Designation is "BP"). Only Active, designation===role rows -
   * mirrors the old validateDesignationRoleReportTo_ hierarchy rule.
   * `excludeUserCode` lets the Edit modal avoid offering a user as their own
   * Report To. Goes through the get_report_to_candidates() SECURITY DEFINER
   * RPC (see supabase/schema.sql) instead of a direct table select, so this
   * still works with no login (used by the public Create form) even though
   * the `users` table itself is locked to authenticated-only.
   */
  async getReportToUsers(targetDesignation, excludeUserCode = null) {
    if (!targetDesignation) return [];
    const sb = requireClient();
    const { data } = await run(
      sb.rpc('get_report_to_candidates', { p_designation: targetDesignation }),
      'Failed to load Report To options.'
    );
    return (data || [])
      .filter(r => r.user_code !== excludeUserCode)
      .map(r => ({ id: r.user_code, name: r.name, _pk: r.user_id }));
  },

  /**
   * Authoritative duplicate check (mobile/NID), run against the database -
   * not a possibly-stale in-memory cache - right before insert/update, same
   * as the old findDuplicateUser_ safeguard in Code.gs. Goes through the
   * check_duplicate_public() SECURITY DEFINER RPC so it works with no login
   * (the public Create form uses this) without exposing table SELECT.
   */
  async checkDuplicate(mobile, nid, excludeUserCode = null) {
    const sb = requireClient();
    const { data } = await run(
      sb.rpc('check_duplicate_public', {
        p_mobile: mobile || null,
        p_nid: nid || null,
        p_exclude_code: excludeUserCode || null
      }),
      'Failed to check for duplicates.'
    );
    return data || { duplicate: false };
  },

  /**
   * Uploads a File to Supabase Storage. Both `user-photos` and
   * `nid-documents` are PRIVATE buckets - anon may still INSERT (registration
   * is public), but reading them back requires an authenticated session, so
   * this always returns the object PATH (not a URL); callers resolve a path
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

  /** Resolves a user's private NID document paths (and photo) to short-lived signed URLs (detail view only - requires an authenticated session). */
  async getSignedDocUrls(user) {
    const sb = requireClient();
    const resolve = async (bucket, path) => {
      if (!path) return '';
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
   * RPC - see supabase/schema.sql), since the `users` table itself is locked
   * to authenticated-only and this form is public/no-login.
   */
  async createUser(userData, files) {
    const sb = requireClient();
    const mobile = String(userData.mobile || '').trim();
    const nid = String(userData.nid || '').trim();

    const dup = await this.checkDuplicate(mobile, nid);
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
          userPhotoUrl
        }
      }),
      'Failed to create user.'
    );
    return resolveUserPhoto(dbRowToUser(data));
  },

  /**
   * Updates a user (Quick Edit modal: name, mobile, designation, role,
   * reportTo). `updatedFields` uses the same camelCase keys as the app's
   * user object. Looked up and updated by user_code (the app-facing id),
   * not the internal uuid, so callers never need to know about `_pk`.
   */
  async updateUser(userCode, updatedFields) {
    const sb = requireClient();
    const patch = {};

    if (updatedFields.name !== undefined) patch.name = updatedFields.name;
    if (updatedFields.mobile !== undefined) patch.mobile = String(updatedFields.mobile).trim();
    if (updatedFields.designation !== undefined) patch.designation = updatedFields.designation;
    if (updatedFields.role !== undefined) patch.role = updatedFields.role;

    if (patch.mobile !== undefined) {
      const dup = await this.checkDuplicate(patch.mobile, null, userCode);
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
          sb.rpc('get_report_to_candidates', { p_designation: targetDesignation }),
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

  async toggleUserStatus(userCode) {
    const sb = requireClient();
    const { data: current } = await run(
      sb.from('users').select('status').eq('user_code', userCode).single(),
      'User not found.'
    );
    const newStatus = current.status === 'Active' ? 'Inactive' : 'Active';
    await run(
      sb.from('users').update({ status: newStatus, updated_by: await getCurrentAdminIdentity() }).eq('user_code', userCode),
      'Failed to update status.'
    );
    return newStatus;
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
  if (opts.designation) query = query.eq('designation', opts.designation);
  if (opts.role) query = query.eq('role', opts.role);
  if (opts.status) query = query.eq('status', opts.status);
  if (opts.fromDate) query = query.gte('created_date', `${opts.fromDate}T00:00:00`);
  if (opts.toDate) query = query.lte('created_date', `${opts.toDate}T23:59:59`);
  return query;
}

if (typeof window !== 'undefined') {
  window.dbService = dbService;
}
