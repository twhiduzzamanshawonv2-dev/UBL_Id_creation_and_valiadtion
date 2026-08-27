/**
 * Main Application Logic - User Account Creation Information Collection System
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Application State
  let currentFormData = null;
  let activeImageFiles = {
    userPhoto: null,
    nidFront: null,
    nidBack: null
  };
  let activeImageBase64 = {
    userPhoto: null,
    nidFront: null,
    nidBack: null
  };
  let editingUserId = null;
  // Agency/Campaign of the user currently open in the Quick Edit modal - Agency/Campaign
  // are NOT editable there (see db-service.js updateUser doc comment), but the Report To
  // candidate lookup and duplicate check still need to stay scoped to them.
  let editingUserAgencyId = null;
  let editingUserCampaignId = null;

  // Auth state (see initAuth() in Section 0 below). Admin Dashboard / System Settings
  // require a logged-in Supabase Auth session; User Registration / Excel Validator stay
  // public. `pendingViewAfterLogin` remembers which admin tab the visitor actually asked
  // for, so a successful sign-in lands them there instead of always on Admin Dashboard.
  let currentSession = null;
  let pendingViewAfterLogin = null;

  // Multi-Select instances for the cascading Location fields (assigned in initLocationDropdowns)
  let divisionMS, districtMS, upazilaMS, thanaMS;

  // Location values may be a plain string (legacy single-location records) or an array
  // (new multi-location records) - normalize to an array everywhere they're read.
  function toLocationArray(val) {
    if (Array.isArray(val)) return val;
    if (val === undefined || val === null || val === '') return [];
    return [val];
  }

  // Human-readable, comma-separated form for display/export - safe for legacy string values too.
  function toLocationDisplay(val) {
    return toLocationArray(val).join(', ');
  }

  // Required Field Messages (shared between inline "as you go" checks and full submit-time validation)
  const REQUIRED_FIELD_MESSAGES = {
    agency: 'Please select Agency.',
    campaign: 'Please select Campaign.',
    name: 'Please enter Name.',
    gender: 'Please select Gender.',
    fatherName: "Please enter Father's Name.",
    motherName: "Please enter Mother's Name.",
    mobile: 'Please enter Mobile Number.',
    email: 'Please enter Email.',
    dob: 'Please select Date of Birth.',
    division: 'Please select at least one Division.',
    district: 'Please select at least one District.',
    upazila: 'Please select at least one Upazila.',
    thana: 'Please select at least one Thana.',
    designation: 'Please select Designation.',
    role: 'Please select Role.',
    reportTo: 'Please select Report To person.',
    nid: 'Please enter NID Number.'
  };

  // Minimum age rule for account creation (evaluated against the real, live "today" - never hardcoded)
  const MINIMUM_AGE_YEARS = 18;
  const DOB_MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Reporting hierarchy: BP reports to a Supervisor, Supervisor reports to an FC, FC reports
  // to nobody. Designation and Role are always kept identical, so this maps by Designation.
  const REPORT_TO_TARGET_DESIGNATION = { BP: 'Supervisor', Supervisor: 'FC' };

  // Some required fields are backed by a hidden input (dob, reportTo, and the multi-select
  // location fields) - the visual (border/icon color) feedback needs to land on the control
  // the user actually sees, not the hidden value holder. Declared up-front (not inline in
  // Section 6 below) so it's already initialized by the time switchTab('create-user) at the
  // bottom of this file synchronously calls into validateFieldInline on first load - a plain
  // `const` declared later in this same closure would still be in its temporal dead zone at
  // that point and throw a ReferenceError.
  const MULTISELECT_CONTROL_IDS = {
    division: 'divisionMSControl',
    district: 'districtMSControl',
    upazila: 'upazilaMSControl',
    thana: 'thanaMSControl'
  };

  // Report To candidates for the CREATE form's currently-selected Designation,
  // fetched from Supabase once per Designation change (not per keystroke/per
  // validation) and cached here so validateFieldInline/populateReportToSelect
  // can consult it synchronously without a network round-trip each time. Declared
  // up-front for the same reason as MULTISELECT_CONTROL_IDS above - referenced
  // synchronously by the very first switchTab('create-user') call at the bottom
  // of this file.
  let currentCreateReportToCandidates = [];
  // Same idea, for the Quick Edit modal.
  let currentEditReportToCandidates = [];

  // Nav tabs / scoped-filter elements that only make sense for Super Admin - declared
  // up-front (not inline in Section 0 below) for the SAME temporal-dead-zone reason as
  // MULTISELECT_CONTROL_IDS above: updateNavVisibility() (called from updateAuthUI(),
  // called from initAuth()) runs synchronously via `await initAuth()` just below, which
  // executes before the JS engine's top-to-bottom pass would otherwise reach a `const`
  // placed later in this file - a plain `const` declared inside Section 0 was in its TDZ
  // at that point and threw "Cannot access before initialization".
  const SUPER_ADMIN_ONLY_NAV_IDS = ['navAgencies', 'navCampaigns', 'navCampaignLogins'];
  const SUPER_ADMIN_ONLY_ELEMENT_IDS = [
    'usersAgencyCampaignFilterGroup',
    'dashboardFilterBar',
    'exportAgencyCampaignFilterGroup',
    'exportCampaignDataCard'
  ];

  // Same TDZ reason - switchTab() is called (as `switchTab('dashboard')`) at the bottom
  // of the top-level setup below, before a `const` positioned inside switchTab()'s own
  // section further down the file would otherwise have executed.
  const ADMIN_ONLY_VIEWS = ['dashboard', 'create-user', 'admin-management', 'agencies', 'campaigns', 'campaign-logins', 'export', 'excel-validator'];
  const SUPER_ADMIN_ONLY_VIEWS = ['agencies', 'campaigns', 'campaign-logins'];

  // Resolves any existing Supabase Auth session (and, if one exists, the account's
  // role/Agency/Campaign scope + the Agencies/Campaigns master lists - see
  // establishAccountOrSignOut() in Section 0 below) BEFORE navigation is wired up, so
  // the very first tab click (if any) is gated correctly.
  await initAuth();

  // Initialize UI components (event wiring only - no server data needed yet)
  initNavigation();
  initFormControls();
  initLocationDropdowns();
  initReportToSearchableSelect();
  initImageUploads();
  initFormSubmissionAndPreview();
  initAdminDashboard();
  initDashboardFilterListeners();
  initAgenciesPanel();
  initCampaignsPanel();
  initCampaignLoginsPanel();
  initExportView();
  initModals();
  initConfirmModal();

  // Dashboard is the default landing tab now that every view requires login (see
  // ADMIN_ONLY_VIEWS in switchTab()) - a visitor with no session is transparently
  // redirected to the Login view, and a logged-in account lands on its own
  // Agency/Campaign-scoped summary immediately, matching the spec's "after login,
  // show a campaign-specific dashboard" requirement.
  switchTab('dashboard');

  // Fetches one page of users from Supabase (server-side filtered/paginated -
  // see storage.fetchUsers/db-service.getUsers) and surfaces a clear banner
  // if the backend isn't reachable (e.g. js/config.js not filled in yet)
  // instead of failing silently.
  async function refreshUsersFromSheet(filters = getAdminFilterValues(), page = storage.page) {
    try {
      await storage.fetchUsers(filters, page);
      setBackendError('');
      return true;
    } catch (err) {
      setBackendError(err.message || 'Failed to load data from Supabase.');
      return false;
    }
  }

  function setBackendError(message) {
    const banner = document.getElementById('backendErrorBanner');
    if (!banner) return;
    if (message) {
      banner.textContent = `⚠️ ${message}`;
      banner.classList.add('show');
    } else {
      banner.textContent = '';
      banner.classList.remove('show');
    }
  }

  /* ==========================================================================
     0. Authentication & Multi-Tenant Account Resolution (Supabase Auth - email/password)
     Gates every view except the Login screen itself - there is no more public/
     no-login surface anywhere in this app. On top of "is there a session", every
     logged-in account also has a RESOLVED SCOPE (Super Admin, or a permanent
     Agency+Campaign for an agency_admin - see storage.loadCurrentAccount() /
     account_profiles in supabase/schema.sql) that drives which nav tabs are
     visible and whether the Add User form's Agency/Campaign fields are editable
     or locked. This client-side resolution is a UX convenience only - the actual
     enforcement is the database's RLS policies, which apply regardless of what
     the UI shows or hides.
     ========================================================================== */
  function isAuthenticated() {
    return !!(currentSession && currentSession.user);
  }

  // SUPER_ADMIN_ONLY_NAV_IDS / SUPER_ADMIN_ONLY_ELEMENT_IDS are declared up-front near
  // the top of this file (see the comment there) - not here - to avoid a temporal-dead-
  // zone ReferenceError.
  function updateNavVisibility() {
    const showSuperAdminUI = isAuthenticated() && storage.isSuperAdmin();
    SUPER_ADMIN_ONLY_NAV_IDS.forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.style.display = showSuperAdminUI ? '' : 'none';
    });
    SUPER_ADMIN_ONLY_ELEMENT_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = showSuperAdminUI ? '' : 'none';
    });
  }

  function updateAuthUI() {
    const box = document.getElementById('authStatusBox');
    const emailElem = document.getElementById('authUserEmail');
    const scopeElem = document.getElementById('authAccountScope');
    if (box) {
      if (isAuthenticated()) {
        box.style.display = 'flex';
        if (emailElem) emailElem.textContent = currentSession.user.email;
        if (scopeElem) {
          if (storage.isSuperAdmin()) {
            scopeElem.textContent = 'Super Admin';
          } else if (storage.currentAccount) {
            scopeElem.textContent = `${storage.getMyAgencyName()} · ${storage.getMyCampaignName()}`;
          } else {
            scopeElem.textContent = '';
          }
        }
      } else {
        box.style.display = 'none';
        if (emailElem) emailElem.textContent = '';
        if (scopeElem) scopeElem.textContent = '';
      }
    }
    updateNavVisibility();
  }

  // Loads the just-authenticated session's account scope (storage.loadCurrentAccount())
  // and the Agencies/Campaigns master lists. If the account's profile row exists but is
  // Inactive/Suspended, loadCurrentAccount() throws - that's the app-layer half of
  // "disabled account -> login blocked" (see storage.js's doc comment on that function
  // for the DB-layer half, which is the real backstop): the session is signed back out
  // immediately and the caller is told login failed, never allowed into the app.
  async function establishAccountOrSignOut() {
    try {
      await storage.loadCurrentAccount();
    } catch (err) {
      if (window.sb) await window.sb.auth.signOut();
      currentSession = null;
      storage.clearCurrentAccount();
      updateAuthUI();
      return false;
    }

    try {
      await storage.loadAgenciesAndCampaigns();
    } catch (err) {
      console.error('Failed to load Agencies/Campaigns:', err);
    }

    updateNavVisibility();
    return true;
  }

  async function handleLoginSubmit() {
    const btn = document.getElementById('btnLoginSubmit');
    const emailInput = document.getElementById('loginEmail');
    const passwordInput = document.getElementById('loginPassword');
    const errElem = document.getElementById('loginError');
    if (!btn || !emailInput || !passwordInput || !errElem) return;

    const email = emailInput.value.trim();
    const password = passwordInput.value;
    errElem.textContent = '';

    if (!email || !password) {
      errElem.textContent = 'Please enter both email and password.';
      return;
    }
    if (!window.sb) {
      errElem.textContent = 'Supabase is not configured yet. Copy js/config.example.js to js/config.js and fill in your project URL/anon key.';
      return;
    }

    btn.disabled = true;
    btn.classList.add('is-loading');
    const { data, error } = await window.sb.auth.signInWithPassword({ email, password });
    btn.disabled = false;
    btn.classList.remove('is-loading');

    if (error) {
      errElem.textContent = 'Invalid email or password.';
      return;
    }

    currentSession = data.session;

    // Resolve the account's role/Agency+Campaign scope BEFORE showing any logged-in UI -
    // a disabled (Inactive/Suspended) account is signed back out immediately here and
    // never gets to see a "you're in" flash, even briefly.
    const accountOk = await establishAccountOrSignOut();
    if (!accountOk) {
      errElem.textContent = 'Your account has been disabled. Contact your administrator.';
      return;
    }
    updateAuthUI();

    // Explicitly offer to save this email/password via the Credential Management API
    // (Chrome/Edge) - this is what makes the browser show its native "Save password?"
    // prompt for a JS-driven login (a plain form submit alone isn't always enough for
    // an SPA that never navigates). Best-effort only: unsupported browsers (Firefox/
    // Safari) silently skip this and fall back to their own submit-based heuristics,
    // which the real <form>+type="submit" wiring in initAuth() already supports.
    if (window.PasswordCredential) {
      try {
        await navigator.credentials.store(new PasswordCredential({ id: email, password, name: email }));
      } catch (credErr) {
        console.error('Credential save prompt failed (non-fatal):', credErr);
      }
    }
    passwordInput.value = '';

    const target = pendingViewAfterLogin || 'dashboard';
    pendingViewAfterLogin = null;
    await switchTab(target);
  }

  async function handleLogout() {
    if (window.sb) {
      await window.sb.auth.signOut();
    }
    currentSession = null;
    storage.clearCurrentAccount();
    updateAuthUI();
    await switchTab('login');
    showToast('Signed out.', 'success');
  }

  async function initAuth() {
    const loginForm = document.getElementById('loginForm');
    const btnLogout = document.getElementById('btnLogout');

    // A real form `submit` event (button is type="submit", so both a click and pressing
    // Enter in either field trigger this naturally) - this, plus the autocomplete
    // attributes on the email/password inputs, is what lets the browser recognize this
    // as a login and offer to autofill/save the credentials (see handleLoginSubmit()'s
    // explicit Credential Management API call for the Chrome/Edge save prompt).
    if (loginForm) {
      loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        handleLoginSubmit();
      });
    }
    if (btnLogout) btnLogout.addEventListener('click', handleLogout);

    if (window.sb) {
      const { data } = await window.sb.auth.getSession();
      currentSession = data.session;
      if (isAuthenticated()) {
        await establishAccountOrSignOut();
      }
      window.sb.auth.onAuthStateChange((_event, session) => {
        currentSession = session;
        updateAuthUI();
      });
    }
    updateAuthUI();
  }

  /* ==========================================================================
     1. Navigation & Tab Control
     ========================================================================== */
  function initNavigation() {
    const navButtons = document.querySelectorAll('.nav-tab');
    navButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetView = btn.getAttribute('data-view');
        switchTab(targetView);
      });
    });
  }

  // `options.skipRefetch`: skip the Supabase re-fetch below - used right after a write
  // (create/update/toggle/reset) that already refreshed the cache, to avoid a redundant
  // network round-trip immediately after the user just triggered one.
  // ADMIN_ONLY_VIEWS / SUPER_ADMIN_ONLY_VIEWS are declared up-front near the top of this
  // file (see the comment there) - not here - to avoid a temporal-dead-zone
  // ReferenceError: the initial `switchTab('dashboard')` call at the bottom of the
  // top-level setup runs before the JS engine's top-to-bottom pass would otherwise reach
  // a `const` placed this far down.
  async function switchTab(viewId, options = {}) {
    // Admin-only views require a logged-in session - anyone not signed in gets routed
    // to the Login view instead, and the tab they actually asked for is remembered
    // (see handleLoginSubmit) so a successful sign-in lands them there.
    if (ADMIN_ONLY_VIEWS.includes(viewId) && !isAuthenticated()) {
      pendingViewAfterLogin = viewId;
      viewId = 'login';
    }

    // A Super-Admin-only view requested by an authenticated-but-not-Super-Admin
    // account (stale bookmark, manual switchTab() call) - they ARE logged in, just
    // not authorized for this specific view, so redirect into their own Dashboard
    // rather than back to the Login screen.
    if (SUPER_ADMIN_ONLY_VIEWS.includes(viewId) && isAuthenticated() && !storage.isSuperAdmin()) {
      viewId = 'dashboard';
    }

    // Update nav active buttons
    document.querySelectorAll('.nav-tab').forEach(btn => {
      if (btn.getAttribute('data-view') === viewId) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Update views visibility
    document.querySelectorAll('.view-section').forEach(sec => {
      sec.classList.remove('active');
    });

    const activeSec = document.getElementById(`view-${viewId}`);
    if (activeSec) {
      activeSec.classList.add('active');
    }

    // Refresh dynamic dropdowns or table when switching views. Only the Admin
    // table needs a Supabase round-trip (paginated/filtered - see
    // refreshUsersFromSheet) - the Create form only needs the Report To
    // candidate list for whatever Designation is currently selected, which
    // is a much smaller, targeted query (see refreshReportToForDesignation).
    if (viewId === 'create-user') {
      populateAgencyDropdown();
      populateRoleDropdown();
      populateDesignationDropdown();
      syncRoleWithDesignation();
      await refreshReportToForDesignation();
    } else if (viewId === 'dashboard') {
      populateDashboardFilters();
      await refreshDashboardCounts();
    } else if (viewId === 'admin-management') {
      if (!options.skipRefetch) {
        const tbody = document.getElementById('adminUserTableBody');
        if (tbody) {
          tbody.innerHTML = `<tr><td colspan="12" class="text-center py-4 text-muted">Loading users...</td></tr>`;
        }
        populateAdminFilters();
        await refreshUsersFromSheet(getAdminFilterValues(), 1);
      }
      renderUserTable();
    } else if (viewId === 'agencies') {
      renderAgenciesList();
    } else if (viewId === 'campaigns') {
      populateCampaignsFilterAgency();
      renderCampaignsList();
    } else if (viewId === 'campaign-logins') {
      renderCampaignLoginsList();
    } else if (viewId === 'export') {
      populateExportFilters();
      refreshExportUserCount();
    }
  }

  /* ==========================================================================
     2. Form Controls & Dropdown Population
     ========================================================================== */
  function initFormControls() {
    // Name Formatting - Title Case & Strip Special Characters/Numbers on Input/Blur
    ['name', 'fatherName', 'motherName', 'editName'].forEach(fieldId => {
      const input = document.getElementById(fieldId);
      if (input) {
        input.addEventListener('input', (e) => {
          if (/[^A-Za-z\s]/.test(e.target.value)) {
            e.target.value = e.target.value.replace(/[^A-Za-z\s]/g, '');
          }
          validateFieldInline(fieldId);
        });
        input.addEventListener('blur', (e) => {
          e.target.value = formatTitleCase(e.target.value);
          validateFieldInline(fieldId);
        });
      }
    });

    // Populate DOB dropdowns (Day, Month, Year)
    populateDOBDropdowns();
    // Update hidden ISO date value when any part changes
    const updateDOB = () => {
      // Re-cap Month/Day options first so the user physically cannot pick a combination
      // younger than the minimum age, then read back the (possibly adjusted) values.
      restrictDOBOptionsForMinimumAge();

      const day = document.getElementById('dobDay').value;
      const month = document.getElementById('dobMonth').value;
      const year = document.getElementById('dobYear').value;
      if (day && month && year) {
        const iso = `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        document.getElementById('dob').value = iso;
      } else {
        document.getElementById('dob').value = '';
      }
      validateFieldInline('dob');
    };
    ['dobDay', 'dobMonth', 'dobYear'].forEach(id => {
      const sel = document.getElementById(id);
      if (sel) {
        sel.addEventListener('change', updateDOB);
      }
    });

    // Mobile Number Input Clean-up (Numeric only) - digits only, never parsed as a number,
    // so a leading 0 is never at risk of being dropped by this listener itself.
    const mobileInput = document.getElementById('mobile');
    if (mobileInput) {
      mobileInput.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/\D/g, '').slice(0, 11);
        validateFieldInline('mobile');
      });
    }
    const editMobileInput = document.getElementById('editMobile');
    if (editMobileInput) {
      editMobileInput.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/\D/g, '').slice(0, 11);
      });
    }

    // NID Input Clean-up (Numeric only)
    const nidInput = document.getElementById('nid');
    if (nidInput) {
      nidInput.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/\D/g, '').slice(0, 17);
        validateFieldInline('nid');
      });
    }

    // Email Inline Validation
    const emailInput = document.getElementById('email');
    if (emailInput) {
      emailInput.addEventListener('input', () => validateFieldInline('email'));
      emailInput.addEventListener('blur', () => validateFieldInline('email'));
    }

    // Gender Inline Validation
    const genderSelect = document.getElementById('gender');
    if (genderSelect) {
      genderSelect.addEventListener('change', () => validateFieldInline('gender'));
    }

    // Designation drives Role (auto-synced, read-only) and the Report To candidate list.
    const designationSelect = document.getElementById('designation');
    if (designationSelect) {
      designationSelect.addEventListener('change', () => {
        syncRoleWithDesignation();
        refreshReportToForDesignation();
        validateFieldInline('designation');
      });
    }

    // Agency drives the Campaign dropdown (dependent) and the Report To candidate
    // list (Report To is scoped to the same Agency+Campaign as this submission).
    const agencySelect = document.getElementById('agency');
    if (agencySelect) {
      agencySelect.addEventListener('change', () => {
        populateCampaignDropdown(agencySelect.value);
        document.getElementById('campaign').value = '';
        validateFieldInline('agency');
        validateFieldInline('campaign');
        refreshReportToForDesignation();
      });
    }
    const campaignSelect = document.getElementById('campaign');
    if (campaignSelect) {
      campaignSelect.addEventListener('change', () => {
        validateFieldInline('campaign');
        refreshReportToForDesignation();
      });
    }
  }

  // Shows/hides the real <select>s vs. the read-only locked display for Agency/Campaign
  // on the Add User form - a Super Admin gets the normal selectable dropdowns; an
  // agency_admin account NEVER gets to pick/change its own Agency/Campaign (per the
  // multi-tenant login system's core requirement), so it only ever sees a locked 🔒
  // display of its own permanent scope. The underlying <select>s are still populated
  // and hold the correct value either way (see populateAgencyDropdown()/
  // populateCampaignDropdown() below) - only the VISUAL presentation differs - so every
  // other function that reads #agency/#campaign's .value (validation, submission,
  // Report To scoping) keeps working completely unchanged for both roles.
  function updateAddUserAgencyCampaignFieldMode() {
    const superAdmin = storage.isSuperAdmin();
    const agencySelect = document.getElementById('agency');
    const campaignSelect = document.getElementById('campaign');
    const agencyLocked = document.getElementById('agencyLockedDisplay');
    const campaignLocked = document.getElementById('campaignLockedDisplay');

    if (agencySelect) agencySelect.style.display = superAdmin ? '' : 'none';
    if (campaignSelect) campaignSelect.style.display = superAdmin ? '' : 'none';
    if (agencyLocked) agencyLocked.style.display = superAdmin ? 'none' : 'flex';
    if (campaignLocked) campaignLocked.style.display = superAdmin ? 'none' : 'flex';

    if (!superAdmin) {
      const agencyLockedText = document.getElementById('agencyLockedText');
      const campaignLockedText = document.getElementById('campaignLockedText');
      if (agencyLockedText) agencyLockedText.textContent = storage.getMyAgencyName() || 'Not assigned';
      if (campaignLockedText) campaignLockedText.textContent = storage.getMyCampaignName() || 'Not assigned';
    }
  }

  // Fills #agency from the cached Active Agencies list (mirrors populateDesignationDropdown())
  // for a Super Admin. For an agency_admin account, the select is instead pinned to that
  // account's own permanent Agency (single option, pre-selected, disabled) - see
  // updateAddUserAgencyCampaignFieldMode() for the visual lock-down on top of this.
  function populateAgencyDropdown() {
    const agencySelect = document.getElementById('agency');
    if (!agencySelect) return;

    if (!storage.isSuperAdmin()) {
      const myAgencyId = storage.getMyAgencyId();
      const myAgency = storage.getAgencyById(myAgencyId);
      agencySelect.innerHTML = myAgency
        ? `<option value="${myAgency.id}">${myAgency.name}</option>`
        : '<option value="">-- Agency Unavailable --</option>';
      agencySelect.value = myAgencyId || '';
      agencySelect.disabled = true;
      populateCampaignDropdown(myAgencyId, { locked: true });
      updateAddUserAgencyCampaignFieldMode();
      return;
    }

    agencySelect.disabled = false;
    const currentVal = agencySelect.value;
    const agencies = storage.getAgencies({ activeOnly: true });

    agencySelect.innerHTML = '<option value="">-- Select Agency --</option>';
    agencies.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = a.name;
      agencySelect.appendChild(opt);
    });

    if (agencies.some(a => a.id === currentVal)) {
      agencySelect.value = currentVal;
    } else {
      // Previously-selected Agency no longer exists/active - Campaign must reset too.
      populateCampaignDropdown('');
    }
    updateAddUserAgencyCampaignFieldMode();
  }

  // Fills #campaign scoped to the given Agency id - disabled with a placeholder
  // until an Agency is chosen (same dependent-dropdown shape as Location filters).
  // `opts.locked`: pin to the caller's own single Campaign instead (agency_admin path -
  // see populateAgencyDropdown() above).
  function populateCampaignDropdown(agencyId, opts = {}) {
    const campaignSelect = document.getElementById('campaign');
    if (!campaignSelect) return;

    if (opts.locked) {
      const myCampaignId = storage.getMyCampaignId();
      const myCampaign = storage.getCampaignById(myCampaignId);
      campaignSelect.innerHTML = myCampaign
        ? `<option value="${myCampaign.id}">${myCampaign.name}</option>`
        : '<option value="">-- Campaign Unavailable --</option>';
      campaignSelect.value = myCampaignId || '';
      campaignSelect.disabled = true;
      return;
    }

    if (!agencyId) {
      campaignSelect.innerHTML = '<option value="">-- Select Agency First --</option>';
      campaignSelect.disabled = true;
      return;
    }

    const currentVal = campaignSelect.value;
    const campaigns = storage.getCampaigns({ agencyId, activeOnly: true });

    campaignSelect.disabled = false;
    campaignSelect.innerHTML = '<option value="">-- Select Campaign --</option>';
    campaigns.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      campaignSelect.appendChild(opt);
    });

    if (campaigns.some(c => c.id === currentVal)) {
      campaignSelect.value = currentVal;
    }
  }

  // Role always mirrors Designation - the select is disabled so a user can never pick a
  // different value; this keeps them in sync no matter how Designation was set (user
  // interaction or a repopulated dropdown after a tab switch).
  function syncRoleWithDesignation() {
    const designationSelect = document.getElementById('designation');
    const roleSelect = document.getElementById('role');
    if (!designationSelect || !roleSelect) return;
    roleSelect.value = designationSelect.value;
    validateFieldInline('role');
  }

  // Synchronous lookup against whichever candidate cache is relevant - used by
  // inline validation, which must stay synchronous to run on every keystroke/blur.
  function getCachedReportToUsers(forEdit) {
    return forEdit ? currentEditReportToCandidates : currentCreateReportToCandidates;
  }

  // Refreshes the create-form Report To field's enabled state, hint text, candidate list,
  // and clears any previously-picked value that's no longer valid for the new Designation.
  async function refreshReportToForDesignation() {
    const agencyId = document.getElementById('agency')?.value || '';
    const campaignId = document.getElementById('campaign')?.value || '';
    const designation = document.getElementById('designation').value;
    const targetDesignation = REPORT_TO_TARGET_DESIGNATION[designation] || null;
    const searchInput = document.getElementById('reportToSearch');
    const hiddenInput = document.getElementById('reportTo');
    const dropdownList = document.getElementById('reportToDropdown');
    const hint = document.getElementById('reportToHint');
    if (!searchInput || !hiddenInput) return;

    if (!agencyId || !campaignId) {
      searchInput.disabled = true;
      searchInput.placeholder = 'Select Agency and Campaign first';
      if (hint) hint.textContent = 'Select Agency and Campaign to see valid Report To options';
      hiddenInput.value = '';
      searchInput.value = '';
      if (dropdownList) dropdownList.innerHTML = '';
      currentCreateReportToCandidates = [];
    } else if (!designation) {
      searchInput.disabled = true;
      searchInput.placeholder = 'Select Designation first';
      if (hint) hint.textContent = 'Select a Designation to see valid Report To options';
      hiddenInput.value = '';
      searchInput.value = '';
      if (dropdownList) dropdownList.innerHTML = '';
      currentCreateReportToCandidates = [];
    } else if (designation === 'FC') {
      // FC is the top of the hierarchy - no Report To.
      searchInput.disabled = true;
      searchInput.placeholder = 'Not applicable for FC';
      if (hint) hint.textContent = 'FC users do not report to anyone';
      hiddenInput.value = '';
      searchInput.value = '';
      if (dropdownList) dropdownList.innerHTML = '';
      currentCreateReportToCandidates = [];
    } else {
      searchInput.disabled = false;
      searchInput.placeholder = 'Search reporting user by name...';
      if (hint) hint.textContent = `Select the ${targetDesignation} this ${designation} reports to`;

      currentCreateReportToCandidates = await storage.getReportToUsers(targetDesignation, agencyId, campaignId);
      const candidateNames = currentCreateReportToCandidates.map(u => u.name);
      if (hiddenInput.value && !candidateNames.includes(hiddenInput.value)) {
        hiddenInput.value = '';
        searchInput.value = '';
      }
    }

    populateReportToSelect();
    validateFieldInline('reportTo');
  }

  // The latest possible Date of Birth that still keeps the person at (or above) the minimum
  // age TODAY - i.e. exactly `MINIMUM_AGE_YEARS` years before the real account-creation date.
  // Always derived from `new Date()`, never hardcoded, so it moves forward with the calendar.
  function getMaxAllowedDOB() {
    const today = new Date();
    return new Date(today.getFullYear() - MINIMUM_AGE_YEARS, today.getMonth(), today.getDate());
  }

  // Helper to populate DOB dropdowns
  function populateDOBDropdowns() {
    const daySel = document.getElementById('dobDay');
    const monthSel = document.getElementById('dobMonth');
    const yearSel = document.getElementById('dobYear');
    if (!daySel || !monthSel || !yearSel) return;
    // Days 1-31 (further capped by restrictDOBOptionsForMinimumAge when needed)
    daySel.innerHTML = '<option value="">Day</option>';
    for (let d = 1; d <= 31; d++) {
      daySel.innerHTML += `<option value="${d}">${d}</option>`;
    }
    // Months 1-12 with names (further capped by restrictDOBOptionsForMinimumAge when needed)
    monthSel.innerHTML = '<option value="">Month</option>';
    DOB_MONTH_NAMES.forEach((name, i) => {
      const val = i + 1;
      monthSel.innerHTML += `<option value="${val}">${name}</option>`;
    });
    // Year range: 1900 up through the latest year that keeps someone at least
    // MINIMUM_AGE_YEARS old as of today - later years can never produce a valid age.
    const maxYear = getMaxAllowedDOB().getFullYear();
    yearSel.innerHTML = '<option value="">Year</option>';
    for (let y = maxYear; y >= 1900; y--) {
      yearSel.innerHTML += `<option value="${y}">${y}</option>`;
    }
  }

  // Rebuilds the Month/Day option lists so the user cannot even select a Date of Birth
  // younger than MINIMUM_AGE_YEARS. Only the cutoff year's month gets capped, and only that
  // month's day gets capped - every other year/month combination keeps the full 1-31 range,
  // matching the app's existing (pre-existing) simplified day-count behavior.
  function restrictDOBOptionsForMinimumAge() {
    const daySel = document.getElementById('dobDay');
    const monthSel = document.getElementById('dobMonth');
    const yearSel = document.getElementById('dobYear');
    if (!daySel || !monthSel || !yearSel) return;

    const maxDOB = getMaxAllowedDOB();
    const maxYear = maxDOB.getFullYear();
    const maxMonth = maxDOB.getMonth() + 1;
    const maxDay = maxDOB.getDate();

    const selectedYear = parseInt(yearSel.value, 10) || null;

    const monthLimit = (selectedYear === maxYear) ? maxMonth : 12;
    const prevMonthVal = monthSel.value;
    monthSel.innerHTML = '<option value="">Month</option>';
    for (let m = 1; m <= monthLimit; m++) {
      monthSel.innerHTML += `<option value="${m}">${DOB_MONTH_NAMES[m - 1]}</option>`;
    }
    if (prevMonthVal && parseInt(prevMonthVal, 10) <= monthLimit) {
      monthSel.value = prevMonthVal;
    }

    const selectedMonth = parseInt(monthSel.value, 10) || null;
    const dayLimit = (selectedYear === maxYear && selectedMonth === maxMonth) ? maxDay : 31;
    const prevDayVal = daySel.value;
    daySel.innerHTML = '<option value="">Day</option>';
    for (let d = 1; d <= dayLimit; d++) {
      daySel.innerHTML += `<option value="${d}">${d}</option>`;
    }
    if (prevDayVal && parseInt(prevDayVal, 10) <= dayLimit) {
      daySel.value = prevDayVal;
    }
  }

  function populateRoleDropdown() {
    const roleSelect = document.getElementById('role');
    if (!roleSelect) return;

    const currentVal = roleSelect.value;
    const roles = storage.getRoles();
    
    roleSelect.innerHTML = '<option value="">-- Select Role --</option>';
    roles.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r;
      opt.textContent = r;
      roleSelect.appendChild(opt);
    });

    if (roles.includes(currentVal)) {
      roleSelect.value = currentVal;
    }
  }

  function populateDesignationDropdown() {
    const desSelect = document.getElementById('designation');
    if (!desSelect) return;

    const currentVal = desSelect.value;
    const designations = storage.getDesignations();

    desSelect.innerHTML = '<option value="">-- Select Designation --</option>';
    designations.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = d;
      desSelect.appendChild(opt);
    });

    if (designations.includes(currentVal)) {
      desSelect.value = currentVal;
    }
  }

  /* ==========================================================================
     3. Cascading Multi-Select Location Fields (Division -> District -> Upazila -> Thana)
     Each level allows selecting MULTIPLE locations. A lower level's available options are
     the union of children across every selected parent at the level above; deselecting a
     parent silently prunes any now-invalid child selections (handled by MultiSelect.setOptions).
     ========================================================================== */
  function initLocationDropdowns() {
    const divisionContainer = document.getElementById('divisionMultiSelectContainer');
    const districtContainer = document.getElementById('districtMultiSelectContainer');
    const upazilaContainer = document.getElementById('upazilaMultiSelectContainer');
    const thanaContainer = document.getElementById('thanaMultiSelectContainer');
    if (!divisionContainer || !districtContainer || !upazilaContainer || !thanaContainer) return;

    divisionMS = createMultiSelect({
      container: divisionContainer,
      controlId: 'divisionMSControl',
      fieldLabel: 'Division',
      placeholder: '-- Select Division(s) --',
      searchPlaceholder: 'Search division...',
      icon: 'icon-map-pin',
      options: Object.keys(BD_LOCATIONS).sort()
    });

    districtMS = createMultiSelect({
      container: districtContainer,
      controlId: 'districtMSControl',
      fieldLabel: 'District',
      placeholder: '-- Select District(s) --',
      searchPlaceholder: 'Search district...',
      icon: 'icon-map-pin',
      options: [],
      disabled: true
    });

    upazilaMS = createMultiSelect({
      container: upazilaContainer,
      controlId: 'upazilaMSControl',
      fieldLabel: 'Upazila',
      placeholder: '-- Select Upazila(s) --',
      searchPlaceholder: 'Search upazila...',
      icon: 'icon-map-pin',
      options: [],
      disabled: true
    });

    thanaMS = createMultiSelect({
      container: thanaContainer,
      controlId: 'thanaMSControl',
      fieldLabel: 'Thana',
      placeholder: '-- Select Thana(s) --',
      searchPlaceholder: 'Search thana...',
      icon: 'icon-map-pin',
      options: [],
      disabled: true
    });

    // Keeps the hidden #division/#district/#upazila/#thana inputs (used by the shared
    // required-field validation machinery) in sync with each MultiSelect's real selection.
    function syncHidden(fieldId, ms) {
      document.getElementById(fieldId).value = ms.getSelected().join(', ');
      validateFieldInline(fieldId);
    }

    function computeDistrictOptions() {
      const set = new Set();
      divisionMS.getSelected().forEach(div => {
        if (BD_LOCATIONS[div]) Object.keys(BD_LOCATIONS[div]).forEach(d => set.add(d));
      });
      return Array.from(set).sort();
    }

    function computeUpazilaOptions() {
      const set = new Set();
      divisionMS.getSelected().forEach(div => {
        const distMap = BD_LOCATIONS[div];
        if (!distMap) return;
        districtMS.getSelected().forEach(dt => {
          if (distMap[dt]) Object.keys(distMap[dt]).forEach(u => set.add(u));
        });
      });
      return Array.from(set).sort();
    }

    function computeThanaOptions() {
      const set = new Set();
      divisionMS.getSelected().forEach(div => {
        const distMap = BD_LOCATIONS[div];
        if (!distMap) return;
        districtMS.getSelected().forEach(dt => {
          const upzMap = distMap[dt];
          if (!upzMap) return;
          upazilaMS.getSelected().forEach(u => {
            if (upzMap[u]) upzMap[u].forEach(t => set.add(t));
          });
        });
      });
      return Array.from(set).sort();
    }

    function refreshDistrictLevel() {
      districtMS.setOptions(computeDistrictOptions());
      districtMS.setDisabled(divisionMS.getSelected().length === 0);
      syncHidden('district', districtMS);
    }

    function refreshUpazilaLevel() {
      upazilaMS.setOptions(computeUpazilaOptions());
      upazilaMS.setDisabled(districtMS.getSelected().length === 0);
      syncHidden('upazila', upazilaMS);
    }

    function refreshThanaLevel() {
      thanaMS.setOptions(computeThanaOptions());
      thanaMS.setDisabled(upazilaMS.getSelected().length === 0);
      syncHidden('thana', thanaMS);
    }

    divisionMS.onChange(() => {
      syncHidden('division', divisionMS);
      refreshDistrictLevel();
      refreshUpazilaLevel();
      refreshThanaLevel();
    });

    districtMS.onChange(() => {
      syncHidden('district', districtMS);
      refreshUpazilaLevel();
      refreshThanaLevel();
    });

    upazilaMS.onChange(() => {
      syncHidden('upazila', upazilaMS);
      refreshThanaLevel();
    });

    thanaMS.onChange(() => {
      syncHidden('thana', thanaMS);
    });
  }

  /* ==========================================================================
     4. Searchable Select for "Report To"
     ========================================================================== */
  function initReportToSearchableSelect() {
    const searchInput = document.getElementById('reportToSearch');
    const dropdownList = document.getElementById('reportToDropdown');
    const hiddenValInput = document.getElementById('reportTo');

    if (!searchInput || !dropdownList) return;

    searchInput.addEventListener('focus', () => {
      populateReportToSelect();
      dropdownList.classList.add('show');
    });

    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase();
      const items = dropdownList.querySelectorAll('.searchable-item');
      items.forEach(item => {
        const text = item.textContent.toLowerCase();
        if (text.includes(query)) {
          item.style.display = 'block';
        } else {
          item.style.display = 'none';
        }
      });
      dropdownList.classList.add('show');
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.searchable-select-container')) {
        dropdownList.classList.remove('show');
      }
    });

    // Validate Report To once the user leaves the search box (allow time for a dropdown item click to register)
    searchInput.addEventListener('blur', () => {
      setTimeout(() => validateFieldInline('reportTo'), 150);
    });
  }

  // Builds the Report To candidate list for the CURRENT Designation - BP sees only
  // Supervisors, Supervisor sees only FCs, FC sees nobody (field is disabled in that case).
  function populateReportToSelect() {
    const dropdownList = document.getElementById('reportToDropdown');
    const searchInput = document.getElementById('reportToSearch');
    const hiddenValInput = document.getElementById('reportTo');
    if (!dropdownList) return;

    const designation = document.getElementById('designation').value;
    const targetDesignation = REPORT_TO_TARGET_DESIGNATION[designation] || null;

    dropdownList.innerHTML = '';
    if (!targetDesignation) return; // no Designation chosen yet, or FC - nothing to list

    const candidates = getCachedReportToUsers(false);

    if (candidates.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'searchable-item';
      empty.style.cursor = 'default';
      empty.style.color = 'var(--text-muted)';
      empty.textContent = `No ${targetDesignation} users available yet.`;
      dropdownList.appendChild(empty);
      return;
    }

    candidates.forEach(u => {
      const item = document.createElement('div');
      item.className = 'searchable-item';
      item.textContent = u.name;
      item.addEventListener('click', () => {
        hiddenValInput.value = u.name;
        searchInput.value = u.name;
        dropdownList.classList.remove('show');
        validateFieldInline('reportTo');
      });
      dropdownList.appendChild(item);
    });
  }

  /* ==========================================================================
     5. Image Uploads with Live Preview
     ========================================================================== */
  function initImageUploads() {
    setupImageField('userPhoto', 'userPhotoPreview', 'userPhotoError');
    setupImageField('nidFront', 'nidFrontPreview', 'nidFrontError');
    setupImageField('nidBack', 'nidBackPreview', 'nidBackError');
  }

  function setupImageField(inputId, previewId, errorId) {
    const fileInput = document.getElementById(inputId);
    const previewContainer = document.getElementById(previewId);
    const errorElem = document.getElementById(errorId);

    if (!fileInput || !previewContainer) return;

    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      errorElem.textContent = '';

      if (!file) {
        activeImageFiles[inputId] = null;
        activeImageBase64[inputId] = null;
        previewContainer.innerHTML = '';
        return;
      }

      const validation = validateImageFile(file, 5);
      if (!validation.valid) {
        errorElem.textContent = validation.message;
        fileInput.value = '';
        activeImageFiles[inputId] = null;
        activeImageBase64[inputId] = null;
        previewContainer.innerHTML = '';
        return;
      }

      activeImageFiles[inputId] = file;

      const reader = new FileReader();
      reader.onload = function(event) {
        const base64Str = event.target.result;
        activeImageBase64[inputId] = base64Str;

        previewContainer.innerHTML = `
          <div class="image-preview-card">
            <img src="${base64Str}" alt="Preview" />
            <div class="preview-info">
              <span class="file-name">${file.name}</span>
              <span class="file-size">${(file.size / 1024).toFixed(1)} KB</span>
            </div>
            <button type="button" class="btn-remove-img" data-field="${inputId}">&times; Remove</button>
          </div>
        `;

        previewContainer.querySelector('.btn-remove-img').addEventListener('click', () => {
          fileInput.value = '';
          activeImageFiles[inputId] = null;
          activeImageBase64[inputId] = null;
          previewContainer.innerHTML = '';
        });
      };
      reader.readAsDataURL(file);
    });
  }

  /* ==========================================================================
     6. Inline & Comprehensive Form Validation
     ========================================================================== */
  function markFieldValidity(target, isValid) {
    const elements = Array.isArray(target) ? target : [target];
    elements.forEach(el => {
      if (!el) return;
      if (isValid) {
        el.classList.remove('is-invalid');
        el.classList.add('is-valid');
        el.setAttribute('aria-invalid', 'false');
      } else {
        el.classList.remove('is-valid');
        el.classList.add('is-invalid');
        el.setAttribute('aria-invalid', 'true');
      }
    });
  }

  function getVisualTarget(fieldId, input) {
    if (fieldId === 'reportTo') return document.getElementById('reportToSearch');
    if (fieldId === 'dob') {
      return ['dobDay', 'dobMonth', 'dobYear'].map(id => document.getElementById(id));
    }
    if (MULTISELECT_CONTROL_IDS[fieldId]) return document.getElementById(MULTISELECT_CONTROL_IDS[fieldId]);
    return input;
  }

  function validateFieldInline(fieldId) {
    const input = document.getElementById(fieldId);
    const errorElem = document.getElementById(`${fieldId}Error`);
    if (!input || !errorElem) return true;

    const visualTarget = getVisualTarget(fieldId, input);
    errorElem.textContent = '';

    // Report To's required-ness depends on Designation: required for BP/Supervisor, but an
    // FC must have it EMPTY (FC is the top of the hierarchy - reports to nobody).
    if (fieldId === 'reportTo') {
      const designation = document.getElementById('designation').value;
      if (designation === 'FC') {
        if (input.value) {
          errorElem.textContent = 'FC users must not have a Report To.';
          markFieldValidity(visualTarget, false);
          return false;
        }
        markFieldValidity(visualTarget, true);
        return true;
      }
      if (designation) {
        const targetDesignation = REPORT_TO_TARGET_DESIGNATION[designation];
        const validNames = getCachedReportToUsers(false).map(u => u.name);
        if (input.value && !validNames.includes(input.value)) {
          errorElem.textContent = `Report To must be an existing, active ${targetDesignation}.`;
          markFieldValidity(visualTarget, false);
          return false;
        }
      }
      // Falls through to the standard required-empty check below for BP/Supervisor.
    }

    // Required-empty check (fires as soon as the user leaves a required field blank)
    const requiredMsg = REQUIRED_FIELD_MESSAGES[fieldId];
    if (requiredMsg && !input.value.trim()) {
      errorElem.textContent = requiredMsg;
      markFieldValidity(visualTarget, false);
      return false;
    }

    if (['name', 'fatherName', 'motherName'].includes(fieldId) && input.value) {
      const labels = { name: 'Name', fatherName: "Father's Name", motherName: "Mother's Name" };
      const v = validateName(input.value, labels[fieldId] || 'Name');
      if (!v.valid) {
        errorElem.textContent = v.message;
        markFieldValidity(visualTarget, false);
        return false;
      }
    }

    if (fieldId === 'mobile' && input.value) {
      const v = validateMobile(input.value);
      if (!v.valid) {
        errorElem.textContent = v.message;
        markFieldValidity(visualTarget, false);
        return false;
      }
    }

    if (fieldId === 'email' && input.value) {
      const v = validateEmail(input.value);
      if (!v.valid) {
        errorElem.textContent = v.message;
        markFieldValidity(visualTarget, false);
        return false;
      }
    }

    if (fieldId === 'dob' && input.value) {
      const v = validateMinimumAge(input.value, MINIMUM_AGE_YEARS);
      if (!v.valid) {
        errorElem.textContent = v.message;
        markFieldValidity(visualTarget, false);
        return false;
      }
    }

    if (fieldId === 'nid' && input.value) {
      const v = validateNID(input.value);
      if (!v.valid) {
        errorElem.textContent = v.message;
        markFieldValidity(visualTarget, false);
        return false;
      }
    }

    markFieldValidity(visualTarget, true);
    return true;
  }

  async function validateForm() {
    let isValid = true;

    const clearErrors = () => {
      document.querySelectorAll('.error-message').forEach(el => el.textContent = '');
      const warningBanner = document.getElementById('duplicateWarningBanner');
      if (warningBanner) warningBanner.style.display = 'none';
    };

    clearErrors();

    // Required fields check (shared message map also powers inline "as you go" validation).
    // Report To is excluded here - its required-ness depends on Designation (not required,
    // and must be empty, for FC) so it's validated separately via validateFieldInline below.
    Object.keys(REQUIRED_FIELD_MESSAGES).forEach(id => {
      if (id === 'reportTo') return;
      const elem = document.getElementById(id);
      const errElem = document.getElementById(`${id}Error`);
      if (!elem || !elem.value.trim()) {
        if (errElem) errElem.textContent = REQUIRED_FIELD_MESSAGES[id];
        markFieldValidity(getVisualTarget(id, elem), false);
        isValid = false;
      }
    });

    // Designation and Role must always match (Role is auto-synced and disabled, but this is
    // a defense-in-depth check in case that invariant is ever bypassed).
    const designationVal = document.getElementById('designation').value;
    const roleVal = document.getElementById('role').value;
    if (designationVal && roleVal && designationVal !== roleVal) {
      document.getElementById('roleError').textContent = 'Role must match Designation.';
      markFieldValidity(document.getElementById('role'), false);
      isValid = false;
    }

    // Report To - required for BP/Supervisor (and must reference a valid matching-hierarchy
    // user), must be empty for FC. validateFieldInline('reportTo') already knows this rule.
    if (!validateFieldInline('reportTo')) {
      isValid = false;
    }

    // Auto Format & Sanitize Names (Auto remove dots & Title Case) before submission check
    ['name', 'fatherName', 'motherName'].forEach(id => {
      const input = document.getElementById(id);
      if (input && input.value) {
        input.value = formatTitleCase(input.value);
      }
    });

    // Format-specific validation (Mobile, Email, Date of Birth minimum age, NID) - only when a value is present
    const mobileVal = document.getElementById('mobile').value;
    if (mobileVal && !validateFieldInline('mobile')) {
      isValid = false;
    }

    const emailVal = document.getElementById('email').value;
    if (emailVal && !validateFieldInline('email')) {
      isValid = false;
    }

    const dobVal = document.getElementById('dob').value;
    if (dobVal && !validateFieldInline('dob')) {
      isValid = false;
    }

    const nidVal = document.getElementById('nid').value;
    if (nidVal && !validateFieldInline('nid')) {
      isValid = false;
    }

    // Required Images Check
    if (!activeImageBase64.userPhoto) {
      document.getElementById('userPhotoError').textContent = 'Please upload User Photo.';
      isValid = false;
    }
    if (!activeImageBase64.nidFront) {
      document.getElementById('nidFrontError').textContent = 'Please upload NID Front Side Image.';
      isValid = false;
    }
    if (!activeImageBase64.nidBack) {
      document.getElementById('nidBackError').textContent = 'Please upload NID Back Side Image.';
      isValid = false;
    }

    if (!isValid) return false;

    // Check Duplicate Mobile & NID - authoritative check against Supabase (not a local
    // cache), since a full user list is no longer held in memory. Scoped to the
    // currently-selected Agency+Campaign - the same person CAN be registered again
    // under a different Agency+Campaign (see check_duplicate_public in schema.sql).
    const agencyVal = document.getElementById('agency').value;
    const campaignVal = document.getElementById('campaign').value;
    const dupCheck = await storage.checkDuplicate(mobileVal, nidVal, agencyVal, campaignVal);
    if (dupCheck.duplicate) {
      const warningBanner = document.getElementById('duplicateWarningBanner');
      if (warningBanner) {
        warningBanner.textContent = `⚠️ Warning: ${dupCheck.message}`;
        warningBanner.style.display = 'block';
      }
      return false;
    }

    return true;
  }

  /* ==========================================================================
     7. Form Submission & Live Data Preview Modal
     ========================================================================== */
  function initFormSubmissionAndPreview() {
    const form = document.getElementById('userRegistrationForm');
    const previewBtn = document.getElementById('btnPreviewForm');
    const resetBtn = document.getElementById('btnResetForm');

    if (previewBtn) {
      previewBtn.addEventListener('click', async () => {
        if (previewBtn.disabled) return;

        previewBtn.disabled = true;
        previewBtn.classList.add('is-loading');
        // Duplicate-mobile/NID checking now queries Supabase directly (see
        // storage.checkDuplicate/validateForm), so there is no local cache to
        // refresh first - this is itself part of what makes submission fast.
        const formIsValid = await validateForm();
        previewBtn.disabled = false;
        previewBtn.classList.remove('is-loading');

        if (!formIsValid) {
          // Scroll to top or first error
          const firstError = document.querySelector('.error-message:not(:empty)');
          if (firstError) {
            firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
          return;
        }

        // Collect Form Data
        const agencySelect = document.getElementById('agency');
        const campaignSelect = document.getElementById('campaign');
        currentFormData = {
          agencyId: agencySelect.value,
          agencyName: agencySelect.options[agencySelect.selectedIndex]?.text || '',
          campaignId: campaignSelect.value,
          campaignName: campaignSelect.options[campaignSelect.selectedIndex]?.text || '',
          name: document.getElementById('name').value,
          gender: document.getElementById('gender').value,
          fatherName: document.getElementById('fatherName').value,
          motherName: document.getElementById('motherName').value,
          mobile: document.getElementById('mobile').value,
          email: document.getElementById('email').value,
          dob: document.getElementById('dob').value,
          division: divisionMS.getSelected(),
          district: districtMS.getSelected(),
          upazila: upazilaMS.getSelected(),
          thana: thanaMS.getSelected(),
          designation: document.getElementById('designation').value,
          role: document.getElementById('role').value,
          reportTo: document.getElementById('reportTo').value,
          nid: document.getElementById('nid').value,
          userPhoto: activeImageBase64.userPhoto,
          nidFront: activeImageBase64.nidFront,
          nidBack: activeImageBase64.nidBack
          // status/createdBy/createdDate/updatedBy/updatedDate are intentionally NOT set here -
          // the database (see supabase/schema.sql triggers + db-service.js createUser) always
          // stamps these itself at the moment the row is actually written, so Created Date
          // reflects the true submission time even if there's a gap between clicking "Preview"
          // and "Confirm & Submit".
        };
        // Raw File objects for the actual Storage upload (kept separate from the base64
        // strings above, which are only used for the Preview modal's <img> thumbnails).
        currentFormData._files = {
          userPhoto: activeImageFiles.userPhoto,
          nidFront: activeImageFiles.nidFront,
          nidBack: activeImageFiles.nidBack
        };

        showPreviewModal(currentFormData);
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        resetRegistrationForm();
      });
    }
  }

  function showPreviewModal(data) {
    const modal = document.getElementById('previewModal');
    const contentContainer = document.getElementById('previewModalContent');

    contentContainer.innerHTML = `
      <div class="preview-section">
        <h4 class="preview-heading">Agency &amp; Campaign</h4>
        <div class="preview-grid">
          <div><strong>Agency:</strong> ${data.agencyName}</div>
          <div><strong>Campaign:</strong> ${data.campaignName}</div>
        </div>
      </div>

      <div class="preview-section">
        <h4 class="preview-heading">Personal Information</h4>
        <div class="preview-grid">
          <div><strong>Full Name:</strong> ${data.name}</div>
          <div><strong>Gender:</strong> ${data.gender}</div>
          <div><strong>Father's Name:</strong> ${data.fatherName}</div>
          <div><strong>Mother's Name:</strong> ${data.motherName}</div>
          <div><strong>Date of Birth:</strong> ${formatDisplayDate(data.dob)}</div>
        </div>
      </div>

      <div class="preview-section">
        <h4 class="preview-heading">Contact Information</h4>
        <div class="preview-grid">
          <div><strong>Mobile Number:</strong> ${data.mobile}</div>
          <div><strong>Email:</strong> ${data.email}</div>
        </div>
      </div>

      <div class="preview-section">
        <h4 class="preview-heading">Location Information</h4>
        <div class="preview-grid">
          <div><strong>Division:</strong> ${toLocationDisplay(data.division)}</div>
          <div><strong>District:</strong> ${toLocationDisplay(data.district)}</div>
          <div><strong>Upazila:</strong> ${toLocationDisplay(data.upazila)}</div>
          <div><strong>Thana:</strong> ${toLocationDisplay(data.thana)}</div>
        </div>
      </div>

      <div class="preview-section">
        <h4 class="preview-heading">Employment / Role Information</h4>
        <div class="preview-grid">
          <div><strong>Designation:</strong> ${data.designation}</div>
          <div><strong>Role:</strong> ${data.role}</div>
          <div><strong>Report To:</strong> ${data.reportTo || 'N/A (top of hierarchy)'}</div>
        </div>
      </div>

      <div class="preview-section">
        <h4 class="preview-heading">NID Information</h4>
        <div class="preview-grid">
          <div><strong>NID Number:</strong> ${data.nid}</div>
        </div>
      </div>

      <div class="preview-section">
        <h4 class="preview-heading">Uploaded Photos & Documents</h4>
        <div class="preview-images-grid">
          <div class="preview-img-box">
            <span class="preview-img-label">User Photo</span>
            <img src="${data.userPhoto}" alt="User Photo" />
          </div>
          <div class="preview-img-box">
            <span class="preview-img-label">NID Front Side</span>
            <img src="${data.nidFront}" alt="NID Front" />
          </div>
          <div class="preview-img-box">
            <span class="preview-img-label">NID Back Side</span>
            <img src="${data.nidBack}" alt="NID Back" />
          </div>
        </div>
      </div>
    `;

    modal.classList.add('open');
  }

  function resetRegistrationForm() {
    const form = document.getElementById('userRegistrationForm');
    if (form) form.reset();

    // Reset the cascading Location multi-selects. Clearing Division cascades down
    // (via its onChange handler) to empty & disable District/Upazila/Thana automatically.
    if (divisionMS) divisionMS.clear();

    // form.reset() reverts Agency's <select> back to its empty (or, for a scoped
    // agency_admin account, browser-default) value, but it does NOT undo the
    // disabled/locked state we set via JS - resync both Agency and Campaign explicitly
    // (populateAgencyDropdown() re-locks or re-cascades Campaign as appropriate).
    populateAgencyDropdown();

    // form.reset() reverts Designation's <select> back to its empty default, but it does NOT
    // undo the `disabled`/placeholder state we set on Role/Report To via JS - resync explicitly.
    syncRoleWithDesignation();
    refreshReportToForDesignation();

    // Reset images
    activeImageFiles = { userPhoto: null, nidFront: null, nidBack: null };
    activeImageBase64 = { userPhoto: null, nidFront: null, nidBack: null };
    ['userPhotoPreview', 'nidFrontPreview', 'nidBackPreview'].forEach(id => {
      const container = document.getElementById(id);
      if (container) container.innerHTML = '';
    });

    // Clear error messages & field validity states
    document.querySelectorAll('.error-message').forEach(el => el.textContent = '');
    document.querySelectorAll('#userRegistrationForm .form-control').forEach(el => {
      el.classList.remove('is-valid', 'is-invalid');
      el.removeAttribute('aria-invalid');
    });
    const warningBanner = document.getElementById('duplicateWarningBanner');
    if (warningBanner) warningBanner.style.display = 'none';

    currentFormData = null;
  }

  /* ==========================================================================
     8. Admin Management Dashboard (Table, Search, Filter, Export)
     ========================================================================== */
  // Debounces a function so it only runs `wait` ms after the last call - used on the
  // search input so Supabase isn't queried on every keystroke (per the performance
  // requirement: wait ~300-500ms after the user stops typing before searching).
  function debounce(fn, wait) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }

  // Reads every filter/search control into the shape db-service.getUsers() expects.
  // Single source of truth for "what is currently filtered" - used by the table
  // render, the pagination reload, and the Excel export (so export always matches
  // what's on screen).
  function getAdminFilterValues() {
    return {
      search: document.getElementById('adminSearchInput')?.value.trim() || '',
      agencyId: document.getElementById('filterAgency')?.value || '',
      campaignId: document.getElementById('filterCampaign')?.value || '',
      division: document.getElementById('filterDivision')?.value || '',
      district: document.getElementById('filterDistrict')?.value || '',
      upazila: document.getElementById('filterUpazila')?.value || '',
      thana: document.getElementById('filterThana')?.value || '',
      designation: document.getElementById('filterDesignation')?.value || '',
      role: document.getElementById('filterRole')?.value || '',
      status: document.getElementById('filterStatus')?.value || '',
      fromDate: document.getElementById('filterFromDate')?.value || '',
      toDate: document.getElementById('filterToDate')?.value || ''
    };
  }

  // Re-queries Supabase (page 1, current filters) and re-renders - the single entry
  // point every filter control/search input/pagination click funnels through.
  async function reloadUserTable(page = 1) {
    const tbody = document.getElementById('adminUserTableBody');
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="12" class="text-center py-4 text-muted">Loading...</td></tr>`;
    }
    await refreshUsersFromSheet(getAdminFilterValues(), page);
    renderUserTable();
  }

  function initAdminDashboard() {
    const searchInput = document.getElementById('adminSearchInput');
    const btnExportExcel = document.getElementById('btnExportExcel');
    const btnResetFilters = document.getElementById('btnResetFilters');
    const debouncedReload = debounce(() => reloadUserTable(1), 400);

    if (searchInput) {
      searchInput.addEventListener('input', debouncedReload);
    }

    if (btnResetFilters) {
      btnResetFilters.addEventListener('click', () => {
        searchInput.value = '';
        ['filterAgency', 'filterCampaign', 'filterDivision', 'filterDistrict', 'filterUpazila', 'filterThana',
         'filterDesignation', 'filterRole', 'filterStatus',
         'filterFromDate', 'filterToDate'].forEach(id => {
          const select = document.getElementById(id);
          if (select) select.value = '';
        });
        populateLocationFilterCascade();
        refreshAdminCampaignFilterOptions();
        reloadUserTable(1);
      });
    }

    initLocationFilterCascade();
    initAdminAgencyCampaignFilterCascade();

    ['filterDesignation', 'filterRole', 'filterStatus', 'filterFromDate', 'filterToDate'].forEach(id => {
      const select = document.getElementById(id);
      if (select) {
        select.addEventListener('change', () => reloadUserTable(1));
      }
    });

    if (btnExportExcel) {
      btnExportExcel.addEventListener('click', () => switchTab('export'));
    }

    const btnPrevPage = document.getElementById('btnPrevPage');
    const btnNextPage = document.getElementById('btnNextPage');
    if (btnPrevPage) btnPrevPage.addEventListener('click', () => reloadUserTable(storage.page - 1));
    if (btnNextPage) btnNextPage.addEventListener('click', () => reloadUserTable(storage.page + 1));

    const btnRefreshUsers = document.getElementById('btnRefreshUsers');
    if (btnRefreshUsers) {
      btnRefreshUsers.addEventListener('click', async () => {
        if (btnRefreshUsers.disabled) return;
        btnRefreshUsers.disabled = true;
        btnRefreshUsers.classList.add('is-loading');

        const refreshed = await refreshUsersFromSheet(getAdminFilterValues(), storage.page);
        renderUserTable();
        if (refreshed) {
          showToast('User list refreshed.', 'success');
        } else {
          showToast('Failed to refresh - showing last loaded data.', 'danger');
        }

        btnRefreshUsers.disabled = false;
        btnRefreshUsers.classList.remove('is-loading');
      });
    }
  }

  // Division -> District -> Upazila -> Thana filter cascade, driven entirely by the
  // static BD_LOCATIONS data (same source as the registration form) - no Supabase
  // query involved, so changing a filter dropdown stays instant. Single-select
  // (unlike the form's multi-select), since these are narrowing filters.
  function initLocationFilterCascade() {
    const divSelect = document.getElementById('filterDivision');
    const distSelect = document.getElementById('filterDistrict');
    const upzSelect = document.getElementById('filterUpazila');
    const thanaSelect = document.getElementById('filterThana');
    if (!divSelect || !distSelect || !upzSelect || !thanaSelect) return;

    function fillSelect(select, options, placeholder) {
      const cur = select.value;
      select.innerHTML = `<option value="">${placeholder}</option>`;
      options.forEach(o => select.innerHTML += `<option value="${o}">${o}</option>`);
      select.value = options.includes(cur) ? cur : '';
    }

    divSelect.addEventListener('change', () => {
      const distMap = BD_LOCATIONS[divSelect.value] || {};
      fillSelect(distSelect, Object.keys(distMap).sort(), 'All Districts');
      fillSelect(upzSelect, [], 'All Upazilas');
      fillSelect(thanaSelect, [], 'All Thanas');
      reloadUserTable(1);
    });

    distSelect.addEventListener('change', () => {
      const upzMap = (BD_LOCATIONS[divSelect.value] || {})[distSelect.value] || {};
      fillSelect(upzSelect, Object.keys(upzMap).sort(), 'All Upazilas');
      fillSelect(thanaSelect, [], 'All Thanas');
      reloadUserTable(1);
    });

    upzSelect.addEventListener('change', () => {
      const thanas = ((BD_LOCATIONS[divSelect.value] || {})[distSelect.value] || {})[upzSelect.value] || [];
      fillSelect(thanaSelect, thanas.slice().sort(), 'All Thanas');
      reloadUserTable(1);
    });

    thanaSelect.addEventListener('change', () => reloadUserTable(1));
  }

  // Resets the District/Upazila/Thana filter dropdowns back to their "All ..." empty
  // state (used by "Clear Filters") without needing initLocationFilterCascade's
  // change-event machinery.
  function populateLocationFilterCascade() {
    ['filterDistrict', 'filterUpazila', 'filterThana'].forEach(id => {
      const select = document.getElementById(id);
      if (select) select.innerHTML = `<option value="">All ${id.replace('filter', '')}s</option>`;
    });
  }

  // Agency -> Campaign filter cascade for the Users table (same shape as the
  // Division -> District location cascade above, but 2 levels). Wired once;
  // the actual option lists are (re)populated by populateAdminAgencyCampaignFilters().
  function initAdminAgencyCampaignFilterCascade() {
    const agencySelect = document.getElementById('filterAgency');
    const campaignSelect = document.getElementById('filterCampaign');
    if (!agencySelect || !campaignSelect) return;

    agencySelect.addEventListener('change', () => {
      refreshAdminCampaignFilterOptions();
      reloadUserTable(1);
    });
    campaignSelect.addEventListener('change', () => reloadUserTable(1));
  }

  // Repopulates #filterCampaign scoped to whatever Agency is currently selected in
  // #filterAgency (or ALL campaigns if no Agency is selected) - preserves the
  // current selection if it's still valid, clears it otherwise.
  function refreshAdminCampaignFilterOptions() {
    const agencySelect = document.getElementById('filterAgency');
    const campaignSelect = document.getElementById('filterCampaign');
    if (!agencySelect || !campaignSelect) return;

    const cur = campaignSelect.value;
    const campaigns = storage.getCampaigns({ agencyId: agencySelect.value || null });
    campaignSelect.innerHTML = '<option value="">All Campaigns</option>';
    campaigns.forEach(c => campaignSelect.innerHTML += `<option value="${c.id}">${c.name}</option>`);
    campaignSelect.value = campaigns.some(c => c.id === cur) ? cur : '';
  }

  // Repopulates #filterAgency from the full cached Agency list (Active + Inactive -
  // admins should be able to filter to Inactive Agencies/Campaigns too, unlike the
  // public Create form which only ever offers Active ones).
  function populateAdminAgencyCampaignFilters() {
    const agencySelect = document.getElementById('filterAgency');
    if (!agencySelect) return;

    const cur = agencySelect.value;
    const agencies = storage.getAgencies();
    agencySelect.innerHTML = '<option value="">All Agencies</option>';
    agencies.forEach(a => agencySelect.innerHTML += `<option value="${a.id}">${a.name}</option>`);
    agencySelect.value = agencies.some(a => a.id === cur) ? cur : '';

    refreshAdminCampaignFilterOptions();
  }

  function populateAdminFilters() {
    const roles = storage.getRoles();
    const designations = storage.getDesignations();

    populateAdminAgencyCampaignFilters();

    // Roles filter
    const roleSelect = document.getElementById('filterRole');
    if (roleSelect) {
      const cur = roleSelect.value;
      roleSelect.innerHTML = '<option value="">All Roles</option>';
      roles.forEach(r => roleSelect.innerHTML += `<option value="${r}">${r}</option>`);
      roleSelect.value = cur;
    }

    // Designations filter
    const desSelect = document.getElementById('filterDesignation');
    if (desSelect) {
      const cur = desSelect.value;
      desSelect.innerHTML = '<option value="">All Designations</option>';
      designations.forEach(d => desSelect.innerHTML += `<option value="${d}">${d}</option>`);
      desSelect.value = cur;
    }

    // Division filter (static - same source as the registration form's dropdowns)
    const divSelect = document.getElementById('filterDivision');
    if (divSelect) {
      const cur = divSelect.value;
      divSelect.innerHTML = '<option value="">All Divisions</option>';
      Object.keys(BD_LOCATIONS).sort().forEach(d => divSelect.innerHTML += `<option value="${d}">${d}</option>`);
      divSelect.value = cur;
    }
  }

  // Renders whatever page of results is currently cached in storage.users (already
  // filtered/paginated server-side by the last reloadUserTable() call) plus the
  // pagination bar. Does NOT itself query Supabase - see reloadUserTable() for that.
  // A scoped (non-Super-Admin) account that sees zero rows almost always means
  // its Campaign Login account_profiles row is linked to the wrong Agency/
  // Campaign (or a currently-empty one) - not a filter mistake, since Agency/
  // Campaign filters are hidden/locked for that account entirely (see
  // SUPER_ADMIN_ONLY_ELEMENT_IDS). Naming the account's own locked scope in
  // the empty-state message turns an opaque "no records" into something the
  // account holder (or whoever manages Campaign Logins) can actually act on.
  function emptyUserListMessage() {
    if (storage.isSuperAdmin()) return 'No matching user records found.';
    const scope = `${storage.getMyAgencyName() || 'your Agency'} → ${storage.getMyCampaignName() || 'your Campaign'}`;
    return `No matching user records found for ${scope}. If you expect users here, ask a Super Admin to verify this login's Campaign Logins entry points to the correct Agency/Campaign.`;
  }

  function renderUserTable() {
    const tbody = document.getElementById('adminUserTableBody');
    const counterElem = document.getElementById('userCountBadge');
    if (!tbody) return;

    const users = storage.getUsers();

    if (counterElem) {
      counterElem.textContent = `${storage.total} User(s) Found`;
    }

    if (users.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="12" class="text-center py-4 text-muted">
            ${emptyUserListMessage()}
          </td>
        </tr>
      `;
      renderPaginationBar();
      return;
    }

    tbody.innerHTML = users.map(u => {
      const statusBadge = u.status === 'Active'
        ? `<span class="badge badge-active">Active</span>`
        : `<span class="badge badge-inactive">Inactive</span>`;

      return `
        <tr>
          <td><strong>${u.id}</strong></td>
          <td><small>${u.agencyName || '—'}</small></td>
          <td><small>${u.campaignName || '—'}</small></td>
          <td>
            <div class="user-cell">
              <img src="${u.userPhoto}" class="user-avatar" alt="Avatar" loading="lazy" />
              <div>
                <div class="font-bold">${u.name}</div>
                <small class="text-muted">NID: ${u.nid}</small>
              </div>
            </div>
          </td>
          <td>${u.mobile}</td>
          <td>${u.designation}</td>
          <td><span class="badge badge-role">${u.role}</span></td>
          <td><small class="location-cell" title="${toLocationDisplay(u.thana)}, ${toLocationDisplay(u.district)}, ${toLocationDisplay(u.division)}">${toLocationDisplay(u.thana)}, ${toLocationDisplay(u.district)}, ${toLocationDisplay(u.division)}</small></td>
          <td><small>${u.reportTo || '—'}</small></td>
          <td>${statusBadge}</td>
          <td><small>${u.createdDate ? u.createdDate.substring(0, 10) : 'N/A'}</small></td>
          <td>
            <div class="action-buttons">
              <button type="button" class="btn-action btn-view" data-id="${u.id}" title="View Details">👁️ View</button>
              <button type="button" class="btn-action btn-edit" data-id="${u.id}" title="Edit User">✏️ Edit</button>
              <button type="button" class="btn-action btn-status" data-id="${u.id}" title="Toggle Status">
                ${u.status === 'Active' ? '⏸️ Deactivate' : '▶️ Activate'}
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // Attach Action Listeners
    tbody.querySelectorAll('.btn-view').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        await openUserDetailsModal(id);
      });
    });

    tbody.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        await openUserEditModal(id);
      });
    });

    tbody.querySelectorAll('.btn-status').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (btn.disabled) return;
        const id = btn.getAttribute('data-id');
        btn.disabled = true;
        try {
          await storage.toggleUserStatus(id);
          renderUserTable();
          showToast('User status updated successfully.', 'success');
        } catch (err) {
          showToast(err.message || 'Failed to update status.', 'danger');
          btn.disabled = false;
        }
      });
    });

    renderPaginationBar();
  }

  // Renders "« Previous | 1 2 3 ... N | Next »", capping the number of page buttons
  // shown at once (a window around the current page) so this stays cheap and legible
  // even with a large total page count.
  function renderPaginationBar() {
    const pagesContainer = document.getElementById('paginationPages');
    const btnPrevPage = document.getElementById('btnPrevPage');
    const btnNextPage = document.getElementById('btnNextPage');
    if (!pagesContainer) return;

    const current = storage.page;
    const totalPages = storage.totalPages;

    if (btnPrevPage) btnPrevPage.disabled = current <= 1;
    if (btnNextPage) btnNextPage.disabled = current >= totalPages;

    const windowSize = 2;
    const pages = [];
    for (let p = 1; p <= totalPages; p++) {
      if (p === 1 || p === totalPages || (p >= current - windowSize && p <= current + windowSize)) {
        pages.push(p);
      } else if (pages[pages.length - 1] !== '…') {
        pages.push('…');
      }
    }

    pagesContainer.innerHTML = pages.map(p =>
      p === '…'
        ? `<span class="ellipsis">…</span>`
        : `<button type="button" class="${p === current ? 'active' : ''}" data-page="${p}">${p}</button>`
    ).join('');

    pagesContainer.querySelectorAll('button[data-page]').forEach(btn => {
      btn.addEventListener('click', () => reloadUserTable(parseInt(btn.getAttribute('data-page'), 10)));
    });
  }

  /* ==========================================================================
     9. Detail Modal & Edit Modal
     ========================================================================== */
  async function openUserDetailsModal(id) {
    const modal = document.getElementById('userDetailModal');
    const container = document.getElementById('userDetailModalContent');
    if (!modal || !container) return;

    container.innerHTML = `<p class="text-center py-4 text-muted">Loading details...</p>`;
    modal.classList.add('open');

    // NID Front/Back are private Storage objects - resolve them to short-lived signed
    // URLs only when actually viewing a user's details (not on every table row).
    const u = await storage.getUserDetailWithImages(id);
    if (!u) {
      container.innerHTML = `<p class="text-center py-4 text-danger">User not found.</p>`;
      return;
    }

    container.innerHTML = `
      <div class="user-detail-header">
        <img src="${u.userPhoto}" class="user-detail-avatar" alt="Photo" />
        <div>
          <h3>${u.name}</h3>
          <p class="text-muted">User ID: <strong>${u.id}</strong> | Status: <span class="badge ${u.status === 'Active' ? 'badge-active' : 'badge-inactive'}">${u.status}</span></p>
          <p><strong>Agency:</strong> ${u.agencyName || 'N/A'} | <strong>Campaign:</strong> ${u.campaignName || 'N/A'}</p>
          <p><strong>Designation:</strong> ${u.designation} | <strong>Role:</strong> ${u.role}</p>
        </div>
      </div>

      <div class="details-section">
        <h4>Personal Details</h4>
        <div class="preview-grid">
          <div><strong>Gender:</strong> ${u.gender || 'N/A'}</div>
          <div><strong>Father's Name:</strong> ${u.fatherName}</div>
          <div><strong>Mother's Name:</strong> ${u.motherName}</div>
          <div><strong>Mobile Number:</strong> ${u.mobile}</div>
          <div><strong>Date of Birth:</strong> ${formatDisplayDate(u.dob)}</div>
        </div>
      </div>

      <div class="details-section">
        <h4>Location Details</h4>
        <div class="preview-grid">
          <div><strong>Division:</strong> ${toLocationDisplay(u.division)}</div>
          <div><strong>District:</strong> ${toLocationDisplay(u.district)}</div>
          <div><strong>Upazila:</strong> ${toLocationDisplay(u.upazila)}</div>
          <div><strong>Thana:</strong> ${toLocationDisplay(u.thana)}</div>
        </div>
      </div>

      <div class="details-section">
        <h4>Employment &amp; System Metadata</h4>
        <div class="preview-grid">
          <div><strong>Report To:</strong> ${u.reportTo || 'N/A (top of hierarchy)'}</div>
          <div><strong>Created By:</strong> ${u.createdBy} (${u.createdDate})</div>
          <div><strong>Updated By:</strong> ${u.updatedBy} (${u.updatedDate})</div>
        </div>
      </div>

      <div class="details-section">
        <h4>NID Information &amp; Documents</h4>
        <p><strong>NID Number:</strong> ${u.nid}</p>
        <div class="preview-images-grid mt-2">
          <div class="preview-img-box">
            <span class="preview-img-label">NID Front Side</span>
            <img src="${u.nidFront}" alt="NID Front" />
          </div>
          <div class="preview-img-box">
            <span class="preview-img-label">NID Back Side</span>
            <img src="${u.nidBack}" alt="NID Back" />
          </div>
        </div>
      </div>
    `;
  }

  // Rebuilds the Quick Edit modal's Role (auto-synced) and Report To (filtered by the
  // currently-selected editDesignation) - same BP->Supervisor->FC rule as the create form.
  // Excludes the user being edited from their own Report To candidate list.
  async function refreshEditReportToOptions() {
    const editDesSelect = document.getElementById('editDesignation');
    const editRoleSelect = document.getElementById('editRole');
    const editReportToSelect = document.getElementById('editReportTo');
    if (!editDesSelect || !editRoleSelect || !editReportToSelect) return;

    editRoleSelect.value = editDesSelect.value;

    const targetDesignation = REPORT_TO_TARGET_DESIGNATION[editDesSelect.value] || null;
    const prevVal = editReportToSelect.value;
    editReportToSelect.innerHTML = '';

    if (!targetDesignation) {
      editReportToSelect.innerHTML = '<option value="">-- Not Applicable (FC) --</option>';
      editReportToSelect.disabled = true;
      currentEditReportToCandidates = [];
      return;
    }

    editReportToSelect.disabled = false;
    editReportToSelect.innerHTML = '<option value="">-- Select Report To --</option>';
    currentEditReportToCandidates = await storage.getReportToUsers(
      targetDesignation, editingUserAgencyId, editingUserCampaignId, editingUserId
    );
    currentEditReportToCandidates.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.name;
      opt.textContent = u.name;
      editReportToSelect.appendChild(opt);
    });

    if (Array.from(editReportToSelect.options).some(o => o.value === prevVal)) {
      editReportToSelect.value = prevVal;
    }
  }

  async function openUserEditModal(id) {
    const u = storage.getUserById(id);
    if (!u) return;

    editingUserId = id;
    editingUserAgencyId = u.agencyId;
    editingUserCampaignId = u.campaignId;
    const modal = document.getElementById('userEditModal');

    document.getElementById('editUserId').value = u.id;
    document.getElementById('editName').value = u.name;
    document.getElementById('editMobile').value = u.mobile;

    // Designations
    const editDesSelect = document.getElementById('editDesignation');
    editDesSelect.innerHTML = '';
    storage.getDesignations().forEach(d => {
      editDesSelect.innerHTML += `<option value="${d}" ${d === u.designation ? 'selected' : ''}>${d}</option>`;
    });

    // Role always mirrors Designation, and Report To options are rebuilt for it (editingUserId
    // is already set above, so this user is excluded from their own Report To candidates).
    await refreshEditReportToOptions();

    const editReportToSelect = document.getElementById('editReportTo');
    if (u.reportTo && Array.from(editReportToSelect.options).some(o => o.value === u.reportTo)) {
      editReportToSelect.value = u.reportTo;
    }

    modal.classList.add('open');
  }

  // Helper to format ISO date to DD-MMM-YY format (e.g., 13-Dec-99)
  function formatDisplayDate(iso) {
    if (!iso) return '';
    const dt = new Date(iso);
    const day = String(dt.getDate()).padStart(2, '0');
    const monthIdx = dt.getMonth();
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const month = monthNames[monthIdx];
    const year = String(dt.getFullYear()).slice(-2);
    return `${day}-${month}-${year}`;
  }

  /* ==========================================================================
     10a. Dashboard (Summary KPI Cards, Agency/Campaign scoped)
     ========================================================================== */
  function populateDashboardFilters() {
    const agencySelect = document.getElementById('dashFilterAgency');
    const campaignSelect = document.getElementById('dashFilterCampaign');
    if (!agencySelect || !campaignSelect) return;

    const curAgency = agencySelect.value;
    const agencies = storage.getAgencies();
    agencySelect.innerHTML = '<option value="">All Agencies</option>';
    agencies.forEach(a => agencySelect.innerHTML += `<option value="${a.id}">${a.name}</option>`);
    agencySelect.value = agencies.some(a => a.id === curAgency) ? curAgency : '';

    refreshDashboardCampaignOptions();
  }

  function refreshDashboardCampaignOptions() {
    const agencySelect = document.getElementById('dashFilterAgency');
    const campaignSelect = document.getElementById('dashFilterCampaign');
    if (!agencySelect || !campaignSelect) return;

    const cur = campaignSelect.value;
    const campaigns = storage.getCampaigns({ agencyId: agencySelect.value || null });
    campaignSelect.innerHTML = '<option value="">All Campaigns</option>';
    campaigns.forEach(c => campaignSelect.innerHTML += `<option value="${c.id}">${c.name}</option>`);
    campaignSelect.value = campaigns.some(c => c.id === cur) ? cur : '';
  }

  function initDashboardFilterListeners() {
    const agencySelect = document.getElementById('dashFilterAgency');
    const campaignSelect = document.getElementById('dashFilterCampaign');
    if (!agencySelect || !campaignSelect) return;

    agencySelect.addEventListener('change', () => {
      refreshDashboardCampaignOptions();
      refreshDashboardCounts();
    });
    campaignSelect.addEventListener('change', () => refreshDashboardCounts());
  }

  async function refreshDashboardCounts() {
    const agencyId = document.getElementById('dashFilterAgency')?.value || '';
    const campaignId = document.getElementById('dashFilterCampaign')?.value || '';

    let counts;
    try {
      counts = await storage.fetchDashboardCounts({ agencyId, campaignId });
    } catch (err) {
      showToast(err.message || 'Failed to load dashboard counts.', 'danger');
      return;
    }

    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    setVal('kpiTotalUsers', counts.totalUsers);
    setVal('kpiTotalBP', counts.totalBP);
    setVal('kpiTotalSupervisor', counts.totalSupervisor);
    setVal('kpiTotalFC', counts.totalFC);
    setVal('kpiActiveCampaigns', counts.activeCampaigns);

    await refreshRecentUsers({ agencyId, campaignId });
  }

  async function refreshRecentUsers(filters) {
    const tbody = document.getElementById('dashboardRecentUsersBody');
    if (!tbody) return;

    let recent;
    try {
      recent = await storage.fetchRecentUsers(filters, 5);
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-muted">Failed to load Recent Users.</td></tr>`;
      return;
    }

    if (recent.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-muted">No Users yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = recent.map(u => `
      <tr>
        <td><strong>${u.id}</strong></td>
        <td>${u.name}</td>
        <td>${u.designation}</td>
        <td>${u.status === 'Active' ? '<span class="badge badge-active">Active</span>' : '<span class="badge badge-inactive">Inactive</span>'}</td>
        <td><small>${u.createdDate ? String(u.createdDate).substring(0, 10) : 'N/A'}</small></td>
      </tr>
    `).join('');
  }

  /* ==========================================================================
     10b. Agencies Management (Add/Edit)
     ========================================================================== */
  let editingAgencyId = null;

  function renderAgenciesList() {
    const tbody = document.getElementById('agenciesTableBody');
    if (!tbody) return;

    const agencies = storage.getAgencies();
    if (agencies.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-muted">No Agencies yet - click "+ Add Agency" to create one.</td></tr>`;
      return;
    }

    tbody.innerHTML = agencies.map(a => `
      <tr>
        <td><strong>${a.name}</strong></td>
        <td>${a.status === 'Active' ? '<span class="badge badge-active">Active</span>' : '<span class="badge badge-inactive">Inactive</span>'}</td>
        <td><small>${a.created_date ? a.created_date.substring(0, 10) : 'N/A'}</small></td>
        <td>
          <div class="action-buttons">
            <button type="button" class="btn-action btn-edit" data-id="${a.id}" title="Edit Agency">✏️ Edit</button>
            <button type="button" class="btn-action btn-delete" data-id="${a.id}" title="Delete Agency">🗑️ Delete</button>
          </div>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', () => openAgencyModal(storage.getAgencyById(btn.getAttribute('data-id'))));
    });
    tbody.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', () => confirmDeleteAgency(btn.getAttribute('data-id')));
    });
  }

  function confirmDeleteAgency(id) {
    const agency = storage.getAgencyById(id);
    if (!agency) return;
    showConfirmModal({
      title: 'Delete Agency',
      message: `Delete "${agency.name}"? This cannot be undone. Agencies that still have Campaigns, Users, or Campaign Logins cannot be deleted.`,
      onConfirm: async () => {
        await storage.deleteAgency(id);
        renderAgenciesList();
        showToast('Agency deleted.', 'success');
      }
    });
  }

  function openAgencyModal(agency = null) {
    const modal = document.getElementById('agencyModal');
    if (!modal) return;
    editingAgencyId = agency ? agency.id : null;

    document.getElementById('agencyModalTitle').textContent = agency ? 'Edit Agency' : 'Add Agency';
    document.getElementById('agencyId').value = agency ? agency.id : '';
    document.getElementById('agencyName').value = agency ? agency.name : '';
    document.getElementById('agencyNameError').textContent = '';
    document.getElementById('agencyStatus').value = agency ? agency.status : 'Active';
    document.getElementById('agencyStatusGroup').style.display = agency ? 'block' : 'none';

    modal.classList.add('open');
  }

  async function saveAgency() {
    const nameInput = document.getElementById('agencyName');
    const errElem = document.getElementById('agencyNameError');
    const btn = document.getElementById('btnSaveAgency');
    const name = nameInput.value.trim();
    errElem.textContent = '';

    if (!name) {
      errElem.textContent = 'Please enter an Agency name.';
      return;
    }

    btn.disabled = true;
    btn.classList.add('is-loading');
    try {
      if (editingAgencyId) {
        const status = document.getElementById('agencyStatus').value;
        await storage.updateAgency(editingAgencyId, { name, status });
      } else {
        await storage.addAgency(name);
      }
      document.getElementById('agencyModal').classList.remove('open');
      renderAgenciesList();
      showToast('Agency saved successfully.', 'success');
    } catch (err) {
      errElem.textContent = err.message || 'Failed to save Agency.';
    }
    btn.disabled = false;
    btn.classList.remove('is-loading');
  }

  function initAgenciesPanel() {
    const btnAdd = document.getElementById('btnAddAgency');
    if (btnAdd) btnAdd.addEventListener('click', () => openAgencyModal(null));

    const btnClose = document.getElementById('btnCloseAgencyModal');
    const btnCancel = document.getElementById('btnCancelAgency');
    [btnClose, btnCancel].forEach(btn => {
      if (btn) btn.addEventListener('click', () => document.getElementById('agencyModal').classList.remove('open'));
    });

    const btnSave = document.getElementById('btnSaveAgency');
    if (btnSave) btnSave.addEventListener('click', saveAgency);
  }

  /* ==========================================================================
     10c. Campaigns Management (Add/Edit, dependent on Agency)
     ========================================================================== */
  let editingCampaignId = null;

  function populateCampaignsFilterAgency() {
    const select = document.getElementById('campaignsFilterAgency');
    if (!select) return;
    const cur = select.value;
    select.innerHTML = '<option value="">All Agencies</option>';
    storage.getAgencies().forEach(a => select.innerHTML += `<option value="${a.id}">${a.name}</option>`);
    select.value = storage.getAgencies().some(a => a.id === cur) ? cur : '';
  }

  function renderCampaignsList() {
    const tbody = document.getElementById('campaignsTableBody');
    if (!tbody) return;

    const agencyFilter = document.getElementById('campaignsFilterAgency')?.value || null;
    const campaigns = storage.getCampaigns({ agencyId: agencyFilter || null });

    if (campaigns.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-muted">No Campaigns yet - click "+ Add Campaign" to create one.</td></tr>`;
      return;
    }

    tbody.innerHTML = campaigns.map(c => {
      const agency = storage.getAgencyById(c.agency_id);
      return `
        <tr>
          <td><strong>${c.name}</strong></td>
          <td>${agency ? agency.name : '—'}</td>
          <td>${c.status === 'Active' ? '<span class="badge badge-active">Active</span>' : '<span class="badge badge-inactive">Inactive</span>'}</td>
          <td><small>${c.created_date ? c.created_date.substring(0, 10) : 'N/A'}</small></td>
          <td>
            <div class="action-buttons">
              <button type="button" class="btn-action btn-edit" data-id="${c.id}" title="Edit Campaign">✏️ Edit</button>
              <button type="button" class="btn-action btn-export-campaign" data-id="${c.id}" title="Export this Campaign's data">📦 Export</button>
              <button type="button" class="btn-action btn-delete" data-id="${c.id}" title="Delete Campaign">🗑️ Delete</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', () => openCampaignModal(storage.getCampaignById(btn.getAttribute('data-id'))));
    });
    tbody.querySelectorAll('.btn-export-campaign').forEach(btn => {
      btn.addEventListener('click', () => exportCampaignData(btn.getAttribute('data-id')));
    });
    tbody.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', () => confirmDeleteCampaign(btn.getAttribute('data-id')));
    });
  }

  function confirmDeleteCampaign(id) {
    const campaign = storage.getCampaignById(id);
    if (!campaign) return;
    showConfirmModal({
      title: 'Delete Campaign',
      message: `Delete "${campaign.name}"? This cannot be undone. Campaigns that still have Users or Campaign Logins cannot be deleted.`,
      onConfirm: async () => {
        await storage.deleteCampaign(id);
        renderCampaignsList();
        showToast('Campaign deleted.', 'success');
      }
    });
  }

  function populateCampaignModalAgencySelect(selectedAgencyId) {
    const select = document.getElementById('campaignAgency');
    if (!select) return;
    select.innerHTML = '<option value="">-- Select Agency --</option>';
    storage.getAgencies().forEach(a => select.innerHTML += `<option value="${a.id}">${a.name}</option>`);
    if (selectedAgencyId) select.value = selectedAgencyId;
  }

  function openCampaignModal(campaign = null) {
    const modal = document.getElementById('campaignModal');
    if (!modal) return;
    editingCampaignId = campaign ? campaign.id : null;

    document.getElementById('campaignModalTitle').textContent = campaign ? 'Edit Campaign' : 'Add Campaign';
    document.getElementById('campaignIdField').value = campaign ? campaign.id : '';
    populateCampaignModalAgencySelect(campaign ? campaign.agency_id : (document.getElementById('campaignsFilterAgency')?.value || ''));
    document.getElementById('campaignName').value = campaign ? campaign.name : '';
    document.getElementById('campaignNameError').textContent = '';
    document.getElementById('campaignAgencyError').textContent = '';
    document.getElementById('campaignStatus').value = campaign ? campaign.status : 'Active';
    document.getElementById('campaignStatusGroup').style.display = campaign ? 'block' : 'none';

    modal.classList.add('open');
  }

  async function saveCampaign() {
    const agencySelect = document.getElementById('campaignAgency');
    const nameInput = document.getElementById('campaignName');
    const agencyErrElem = document.getElementById('campaignAgencyError');
    const nameErrElem = document.getElementById('campaignNameError');
    const btn = document.getElementById('btnSaveCampaign');
    const agencyId = agencySelect.value;
    const name = nameInput.value.trim();
    agencyErrElem.textContent = '';
    nameErrElem.textContent = '';

    if (!agencyId) {
      agencyErrElem.textContent = 'Please select an Agency.';
      return;
    }
    if (!name) {
      nameErrElem.textContent = 'Please enter a Campaign name.';
      return;
    }

    btn.disabled = true;
    btn.classList.add('is-loading');
    try {
      if (editingCampaignId) {
        const status = document.getElementById('campaignStatus').value;
        await storage.updateCampaign(editingCampaignId, { name, agencyId, status });
      } else {
        await storage.addCampaign(agencyId, name);
      }
      document.getElementById('campaignModal').classList.remove('open');
      renderCampaignsList();
      showToast('Campaign saved successfully.', 'success');
    } catch (err) {
      nameErrElem.textContent = err.message || 'Failed to save Campaign.';
    }
    btn.disabled = false;
    btn.classList.remove('is-loading');
  }

  function initCampaignsPanel() {
    const btnAdd = document.getElementById('btnAddCampaign');
    if (btnAdd) btnAdd.addEventListener('click', () => openCampaignModal(null));

    const filterAgency = document.getElementById('campaignsFilterAgency');
    if (filterAgency) filterAgency.addEventListener('change', () => renderCampaignsList());

    const btnClose = document.getElementById('btnCloseCampaignModal');
    const btnCancel = document.getElementById('btnCancelCampaign');
    [btnClose, btnCancel].forEach(btn => {
      if (btn) btn.addEventListener('click', () => document.getElementById('campaignModal').classList.remove('open'));
    });

    const btnSave = document.getElementById('btnSaveCampaign');
    if (btnSave) btnSave.addEventListener('click', saveCampaign);
  }

  /* ==========================================================================
     10d. Campaign Logins Management (Super Admin only)
     Links an EXISTING Supabase Auth account (created first in the Supabase
     Dashboard) to a role + permanent Agency+Campaign scope - see
     db-service.js linkAccountProfile() and the "Campaign Logins" section of
     ReadMe.md. This screen never creates the auth account itself.
     ========================================================================== */
  let editingCampaignLoginId = null;

  function renderCampaignLoginsList() {
    const tbody = document.getElementById('campaignLoginsTableBody');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted">Loading...</td></tr>`;

    storage.getAllAccountProfiles().then(profiles => {
      if (profiles.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted">No linked login accounts yet - click "+ Link Account" to create one.</td></tr>`;
        return;
      }

      tbody.innerHTML = profiles.map(p => {
        const agency = p.agency_id ? storage.getAgencyById(p.agency_id) : null;
        const campaign = p.campaign_id ? storage.getCampaignById(p.campaign_id) : null;
        const roleLabel = p.role === 'super_admin' ? 'Super Admin' : 'Agency / Campaign Admin';
        const statusBadge = p.status === 'Active'
          ? '<span class="badge badge-active">Active</span>'
          : `<span class="badge badge-inactive">${p.status}</span>`;
        return `
          <tr>
            <td>
              <div class="font-bold">${p.username || '—'}</div>
              <small class="text-muted">${p.email || ''}</small>
            </td>
            <td><span class="badge badge-role">${roleLabel}</span></td>
            <td>${agency ? agency.name : '—'}</td>
            <td>${campaign ? campaign.name : '—'}</td>
            <td>${statusBadge}</td>
            <td>
              <div class="action-buttons">
                <button type="button" class="btn-action btn-edit" data-id="${p.id}" title="Edit Account">✏️ Edit</button>
              </div>
            </td>
          </tr>
        `;
      }).join('');

      tbody.querySelectorAll('.btn-edit').forEach(btn => {
        btn.addEventListener('click', () => {
          const profile = profiles.find(p => p.id === btn.getAttribute('data-id'));
          if (profile) openCampaignLoginModal(profile);
        });
      });
    }).catch(err => {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted">${err.message || 'Failed to load login accounts.'}</td></tr>`;
    });
  }

  function populateCampaignLoginAgencySelect(selectedAgencyId) {
    const select = document.getElementById('campaignLoginAgency');
    if (!select) return;
    select.innerHTML = '<option value="">-- Select Agency --</option>';
    storage.getAgencies().forEach(a => select.innerHTML += `<option value="${a.id}">${a.name}</option>`);
    if (selectedAgencyId) select.value = selectedAgencyId;
  }

  function populateCampaignLoginCampaignSelect(agencyId, selectedCampaignId) {
    const select = document.getElementById('campaignLoginCampaign');
    if (!select) return;
    if (!agencyId) {
      select.innerHTML = '<option value="">-- Select Agency First --</option>';
      select.disabled = true;
      return;
    }
    select.disabled = false;
    select.innerHTML = '<option value="">-- Select Campaign --</option>';
    storage.getCampaigns({ agencyId }).forEach(c => select.innerHTML += `<option value="${c.id}">${c.name}</option>`);
    if (selectedCampaignId) select.value = selectedCampaignId;
  }

  // Agency/Campaign only apply to an agency_admin account - Super Admin has neither
  // (mirrors the account_profiles_scope_check DB constraint), so those two fields are
  // hidden whenever Role=Super Admin is selected in the modal.
  function updateCampaignLoginRoleFieldVisibility() {
    const role = document.getElementById('campaignLoginRole').value;
    const isSuperAdminRole = role === 'super_admin';
    const agencyGroup = document.getElementById('campaignLoginAgencyGroup');
    const campaignGroup = document.getElementById('campaignLoginCampaignGroup');
    if (agencyGroup) agencyGroup.style.display = isSuperAdminRole ? 'none' : 'block';
    if (campaignGroup) campaignGroup.style.display = isSuperAdminRole ? 'none' : 'block';
  }

  function openCampaignLoginModal(profile = null) {
    const modal = document.getElementById('campaignLoginModal');
    if (!modal) return;
    editingCampaignLoginId = profile ? profile.id : null;

    document.getElementById('campaignLoginModalTitle').textContent = profile ? 'Edit Account' : 'Link Account';
    document.getElementById('campaignLoginUserId').value = profile ? profile.id : '';
    // The User ID is the permanent binding to the Supabase Auth account - editable only
    // when linking a NEW profile, locked once linked (changing it would silently rebind
    // the login to a different auth account, which should never happen by accident).
    document.getElementById('campaignLoginUserId').disabled = !!profile;
    document.getElementById('campaignLoginUserIdError').textContent = '';
    document.getElementById('campaignLoginUsername').value = profile ? (profile.username || '') : '';
    document.getElementById('campaignLoginEmail').value = profile ? (profile.email || '') : '';
    document.getElementById('campaignLoginRole').value = profile ? profile.role : 'agency_admin';
    populateCampaignLoginAgencySelect(profile ? profile.agency_id : '');
    populateCampaignLoginCampaignSelect(profile ? profile.agency_id : '', profile ? profile.campaign_id : '');
    document.getElementById('campaignLoginAgencyError').textContent = '';
    document.getElementById('campaignLoginCampaignError').textContent = '';
    document.getElementById('campaignLoginStatus').value = profile ? profile.status : 'Active';
    updateCampaignLoginRoleFieldVisibility();

    modal.classList.add('open');
  }

  async function saveCampaignLogin() {
    const userId = document.getElementById('campaignLoginUserId').value.trim();
    const username = document.getElementById('campaignLoginUsername').value.trim();
    const email = document.getElementById('campaignLoginEmail').value.trim();
    const role = document.getElementById('campaignLoginRole').value;
    const agencyId = document.getElementById('campaignLoginAgency').value;
    const campaignId = document.getElementById('campaignLoginCampaign').value;
    const status = document.getElementById('campaignLoginStatus').value;
    const btn = document.getElementById('btnSaveCampaignLogin');
    const userIdErrElem = document.getElementById('campaignLoginUserIdError');
    const agencyErrElem = document.getElementById('campaignLoginAgencyError');
    const campaignErrElem = document.getElementById('campaignLoginCampaignError');
    userIdErrElem.textContent = '';
    agencyErrElem.textContent = '';
    campaignErrElem.textContent = '';

    if (!editingCampaignLoginId) {
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!userId || !uuidPattern.test(userId)) {
        userIdErrElem.textContent = 'Please enter a valid User ID (UUID) - copy it from Supabase Dashboard.';
        return;
      }
    }
    if (role === 'agency_admin') {
      if (!agencyId) {
        agencyErrElem.textContent = 'Please select an Agency.';
        return;
      }
      if (!campaignId) {
        campaignErrElem.textContent = 'Please select a Campaign.';
        return;
      }
    }

    btn.disabled = true;
    btn.classList.add('is-loading');
    try {
      if (editingCampaignLoginId) {
        await storage.updateAccountProfile(editingCampaignLoginId, { username, email, role, agencyId, campaignId, status });
      } else {
        await storage.linkAccountProfile({ userId, username, email, role, agencyId, campaignId, status });
      }
      document.getElementById('campaignLoginModal').classList.remove('open');
      renderCampaignLoginsList();
      showToast('Login account saved successfully.', 'success');
    } catch (err) {
      userIdErrElem.textContent = err.message || 'Failed to save login account.';
    }
    btn.disabled = false;
    btn.classList.remove('is-loading');
  }

  function initCampaignLoginsPanel() {
    const btnAdd = document.getElementById('btnAddCampaignLogin');
    if (btnAdd) btnAdd.addEventListener('click', () => openCampaignLoginModal(null));

    const roleSelect = document.getElementById('campaignLoginRole');
    if (roleSelect) roleSelect.addEventListener('change', updateCampaignLoginRoleFieldVisibility);

    const agencySelect = document.getElementById('campaignLoginAgency');
    if (agencySelect) {
      agencySelect.addEventListener('change', () => {
        document.getElementById('campaignLoginCampaign').value = '';
        populateCampaignLoginCampaignSelect(agencySelect.value, '');
      });
    }

    const btnClose = document.getElementById('btnCloseCampaignLoginModal');
    const btnCancel = document.getElementById('btnCancelCampaignLogin');
    [btnClose, btnCancel].forEach(btn => {
      if (btn) btn.addEventListener('click', () => document.getElementById('campaignLoginModal').classList.remove('open'));
    });

    const btnSave = document.getElementById('btnSaveCampaignLogin');
    if (btnSave) btnSave.addEventListener('click', saveCampaignLogin);
  }

  /* ==========================================================================
     11. Excel Export Functionality
     ========================================================================== */
  // Role-based Excel export: one sheet/tab per role (BP, Supervisor, FC), matching the
  // grouping the app has always used.
  const EXPORT_ROLE_ORDER = ['BP', 'Supervisor', 'FC'];

  // Required columns in order:
  // Agency | Campaign | Division | District | Upazila | Thana | Name | Gender | Father's Name | Mother's Name | Mobile Number | Email | Date of Birth | Designation | Role | Report To | NID Number | NID Front Side Image | NID Back Side Image | User Photo | Status | Created Date
  const EXCEL_HEADERS = [
    "Agency", "Campaign", "Division", "District", "Upazila", "Thana", "Name", "Gender", "Father's Name",
    "Mother's Name", "Mobile Number", "Email", "Date of Birth", "Designation", "Role",
    "Report To", "NID Number", "NID Front Side Image", "NID Back Side Image",
    "User Photo", "Status", "Created Date"
  ];

  function buildExcelRow(u) {
    return [
      u.agencyName || '',
      u.campaignName || '',
      toLocationDisplay(u.division),
      toLocationDisplay(u.district),
      toLocationDisplay(u.upazila),
      toLocationDisplay(u.thana),
      u.name || '',
      u.gender || '',
      u.fatherName || '',
      u.motherName || '',
      u.mobile || '',
      u.email || '',
      u.dob ? formatDisplayDate(u.dob) : '',
      u.designation || '',
      u.role || '',
      u.reportTo || '',
      u.nid || '',
      // User Photo and NID Front/Back all live in PRIVATE Storage buckets (login required) -
      // exporting a signed URL into a spreadsheet would bake in a link that expires and
      // could be forwarded outside the app, so only presence is noted here; view the actual
      // image in the app's User Details modal instead.
      u.nidFront ? '[On file - view in app]' : 'N/A',
      u.nidBack ? '[On file - view in app]' : 'N/A',
      u.userPhoto ? '[On file - view in app]' : 'N/A',
      u.status || 'Active',
      u.createdDate || ''
    ];
  }

  function computeExcelColWidths(rows) {
    return EXCEL_HEADERS.map((hdr, i) => {
      let maxLen = hdr.length;
      rows.forEach(row => {
        const val = String(row[i] || '');
        if (val.length > maxLen) maxLen = val.length;
      });
      return { wch: Math.min(maxLen + 3, 40) };
    });
  }

  // Strips characters that would break a filename (path separators, reserved Windows
  // chars) and collapses whitespace to underscores - used by buildExportFilename().
  function sanitizeForFilename(str) {
    return String(str || '')
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\s+/g, '_')
      .trim();
  }

  // Meaningful, sanitized export filenames per the Agency/Campaign/Role in scope, e.g.
  // "Asiatic_Horlicks_School_BP.xlsx", "All_Agencies_All_Campaigns_BP.xlsx".
  function buildExportFilename({ agencyName, campaignName, role }) {
    const agencyPart = sanitizeForFilename(agencyName) || 'All_Agencies';
    const campaignPart = sanitizeForFilename(campaignName) || 'All_Campaigns';
    const rolePart = role || 'All_Users';
    return `${agencyPart}_${campaignPart}_${rolePart}.xlsx`;
  }

  // Core export builder - filters is { agencyId, agencyName, campaignId, campaignName,
  // role, fromDate, toDate }. Queries Supabase directly with the combined filter set (never
  // downloads the whole table into the browser just to filter it client-side), groups the
  // result by Role into one workbook with one sheet per role (or just the picked role), and
  // downloads it under a meaningful, Agency/Campaign/Role-based filename.
  async function exportUsersToExcel(filters = {}) {
    const { agencyId = '', agencyName = '', campaignId = '', campaignName = '', role = '', fromDate = '', toDate = '' } = filters;

    let users;
    try {
      users = await dbService.getAllUsersForExport({ agencyId, campaignId, role, fromDate, toDate });
    } catch (err) {
      showToast(err.message || 'Failed to load data for export.', 'danger');
      return;
    }

    if (users.length === 0) {
      showToast(
        storage.isSuperAdmin()
          ? 'No user records match the selected export options.'
          : `No user records match the selected export options for ${storage.getMyAgencyName() || 'your Agency'} → ${storage.getMyCampaignName() || 'your Campaign'}. If you expect users here, ask a Super Admin to verify this login's Campaign Logins entry.`,
        'warning'
      );
      return;
    }

    // Which role sheets/files to produce: all 3 by default, or just the one picked.
    const rolesToExport = role ? [role] : EXPORT_ROLE_ORDER;

    // Group by Role. A record whose role isn't one of the 3 recognized values
    // (legacy/mismatched data) is skipped from the role-based sheets rather than
    // silently miscategorized.
    const usersByRole = {};
    rolesToExport.forEach(r => { usersByRole[r] = []; });
    let unmatchedCount = 0;
    users.forEach(u => {
      if (usersByRole[u.role]) {
        usersByRole[u.role].push(u);
      } else {
        unmatchedCount++;
      }
    });

    const filename = buildExportFilename({ agencyName, campaignName, role });

    // Check if SheetJS XLSX library is available
    if (typeof XLSX !== 'undefined') {
      const mobileColLetter = XLSX.utils.encode_col(EXCEL_HEADERS.indexOf('Mobile Number'));
      const workbook = XLSX.utils.book_new();
      rolesToExport.forEach(r => {
        const rows = usersByRole[r].map(buildExcelRow);
        const worksheet = XLSX.utils.aoa_to_sheet([EXCEL_HEADERS, ...rows]);
        worksheet['!cols'] = computeExcelColWidths(rows);
        // Force the Mobile Number column to a Text cell type + "@" number format, so Excel
        // never reinterprets the digit string as a number and drops the leading 0.
        rows.forEach((_, i) => {
          const cell = worksheet[mobileColLetter + (i + 2)]; // +2: row 1 is the header
          if (cell) {
            cell.t = 's';
            cell.z = '@';
          }
        });
        XLSX.utils.book_append_sheet(workbook, worksheet, r);
      });

      XLSX.writeFile(workbook, filename);
      showToast(
        unmatchedCount > 0
          ? `Exported (${unmatchedCount} record(s) with an unrecognized role were skipped).`
          : role
            ? `Exported successfully - ${role} sheet included.`
            : 'Exported successfully - BP, Supervisor, and FC sheets included.',
        'success'
      );
    } else {
      // High-compatibility CSV fallback with UTF-8 BOM. A single .csv can't hold multiple
      // tabs, so this downloads one file per role (skipping roles with no matching records).
      const baseName = filename.replace(/\.xlsx$/, '');
      let filesDownloaded = 0;
      rolesToExport.forEach(r => {
        const rows = usersByRole[r].map(buildExcelRow);
        if (rows.length === 0) return;

        let csvContent = "\uFEFF"; // UTF-8 BOM
        csvContent += EXCEL_HEADERS.map(h => `"${h.replace(/"/g, '""')}"`).join(",") + "\n";
        rows.forEach(row => {
          csvContent += row.map(val => `"${String(val).replace(/"/g, '""')}"`).join(",") + "\n";
        });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `${baseName}${role ? '' : '_' + r}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        filesDownloaded++;
      });

      showToast(
        filesDownloaded > 0
          ? `Exported ${filesDownloaded} CSV file(s)${role ? '' : ', one per role (BP/Supervisor/FC)'}.`
          : 'No user records available to export.',
        filesDownloaded > 0 ? 'success' : 'warning'
      );
    }
  }

  /* ==========================================================================
     11a. Export View (Agency/Campaign/Role filtered export + Campaign Data)
     ========================================================================== */
  function populateExportFilters() {
    const agencySelect = document.getElementById('exportAgency');
    const campaignSelect = document.getElementById('exportCampaign');
    const campaignOnlySelect = document.getElementById('exportCampaignOnly');
    if (!agencySelect || !campaignSelect) return;

    const curAgency = agencySelect.value;
    const agencies = storage.getAgencies();
    agencySelect.innerHTML = '<option value="">All Agencies</option>';
    agencies.forEach(a => agencySelect.innerHTML += `<option value="${a.id}">${a.name}</option>`);
    agencySelect.value = agencies.some(a => a.id === curAgency) ? curAgency : '';

    refreshExportCampaignOptions();

    // "Export Campaign Data" always lists every Campaign (across all Agencies) - it's a
    // standalone one-Campaign picker, independent of the Filtered Export's own Agency/Campaign.
    if (campaignOnlySelect) {
      const cur = campaignOnlySelect.value;
      campaignOnlySelect.innerHTML = '<option value="">-- Select Campaign --</option>';
      storage.getCampaigns().forEach(c => {
        const agency = storage.getAgencyById(c.agency_id);
        campaignOnlySelect.innerHTML += `<option value="${c.id}">${agency ? agency.name + ' - ' : ''}${c.name}</option>`;
      });
      campaignOnlySelect.value = storage.getCampaigns().some(c => c.id === cur) ? cur : '';
    }
  }

  function refreshExportCampaignOptions() {
    const agencySelect = document.getElementById('exportAgency');
    const campaignSelect = document.getElementById('exportCampaign');
    if (!agencySelect || !campaignSelect) return;

    const cur = campaignSelect.value;
    const campaigns = storage.getCampaigns({ agencyId: agencySelect.value || null });
    campaignSelect.innerHTML = '<option value="">All Campaigns</option>';
    campaigns.forEach(c => campaignSelect.innerHTML += `<option value="${c.id}">${c.name}</option>`);
    campaignSelect.value = campaigns.some(c => c.id === cur) ? cur : '';
  }

  // Exports one whole Campaign's data as a single workbook with separate BP/Supervisor/FC
  // sheets (no Role filter) - reuses exportUsersToExcel() unchanged, just pre-filled with
  // one Campaign and no other filters. Reachable both from the Export view's "Export Campaign
  // Data" card and from a one-click "Export" button per row on the Campaigns list.
  async function exportCampaignData(campaignId) {
    const campaign = storage.getCampaignById(campaignId);
    if (!campaign) {
      showToast('Please select a Campaign to export.', 'danger');
      return;
    }
    const agency = storage.getAgencyById(campaign.agency_id);
    await exportUsersToExcel({
      agencyId: campaign.agency_id,
      agencyName: agency ? agency.name : '',
      campaignId: campaign.id,
      campaignName: campaign.name,
      role: ''
    });
  }

  // Reads the Filtered Export card's current field values in the same shape
  // exportUsersToExcel()/getUserCount() both expect - shared by the live
  // "Users Found" preview and the actual Export click so they can never see
  // a different filter set than what gets exported.
  function getExportFilterValues() {
    const agencySelectEl = document.getElementById('exportAgency');
    const campaignSelectEl = document.getElementById('exportCampaign');
    return {
      agencyId: agencySelectEl?.value || '',
      agencyName: agencySelectEl?.value ? agencySelectEl.options[agencySelectEl.selectedIndex]?.text : '',
      campaignId: campaignSelectEl?.value || '',
      campaignName: campaignSelectEl?.value ? campaignSelectEl.options[campaignSelectEl.selectedIndex]?.text : '',
      role: document.getElementById('exportRole')?.value || '',
      fromDate: document.getElementById('exportFromDate')?.value || '',
      toDate: document.getElementById('exportToDate')?.value || ''
    };
  }

  // Defense-in-depth even though the Campaign <select> is already scoped to the
  // chosen Agency by refreshExportCampaignOptions() - guards against a stale
  // selection (e.g. this exact combination was valid, then the Campaign got
  // moved/deleted) ever silently exporting/counting the wrong data instead of
  // surfacing a clear error.
  function validateExportAgencyCampaign(agencyId, campaignId) {
    if (!agencyId || !campaignId) return true;
    const campaign = storage.getCampaignById(campaignId);
    return !!campaign && campaign.agency_id === agencyId;
  }

  async function refreshExportUserCount() {
    const preview = document.getElementById('exportUserCountPreview');
    if (!preview) return;

    const filters = getExportFilterValues();
    if (!validateExportAgencyCampaign(filters.agencyId, filters.campaignId)) {
      preview.textContent = 'Users Found: — (selected Campaign does not belong to the selected Agency)';
      return;
    }

    preview.textContent = 'Users Found: …';
    try {
      const count = await storage.fetchUserCount(filters);
      preview.textContent = `Users Found: ${count}`;
    } catch (err) {
      preview.textContent = 'Users Found: —';
    }
  }

  function initExportView() {
    const agencySelect = document.getElementById('exportAgency');
    const btnConfirmExport = document.getElementById('btnConfirmExport');
    const btnExportCampaignData = document.getElementById('btnExportCampaignData');

    if (agencySelect) {
      agencySelect.addEventListener('change', () => {
        refreshExportCampaignOptions();
        refreshExportUserCount();
      });
    }

    ['exportCampaign', 'exportRole', 'exportFromDate', 'exportToDate'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', refreshExportUserCount);
    });

    if (btnConfirmExport) {
      btnConfirmExport.addEventListener('click', async () => {
        if (btnConfirmExport.disabled) return;

        const filters = getExportFilterValues();

        if (filters.fromDate && filters.toDate && filters.fromDate > filters.toDate) {
          showToast('From Date must be on or before To Date.', 'danger');
          return;
        }

        if (!validateExportAgencyCampaign(filters.agencyId, filters.campaignId)) {
          showToast('The selected Campaign does not belong to the selected Agency.', 'danger');
          return;
        }

        btnConfirmExport.disabled = true;
        btnConfirmExport.classList.add('is-loading');
        await exportUsersToExcel(filters);
        btnConfirmExport.disabled = false;
        btnConfirmExport.classList.remove('is-loading');
      });
    }

    if (btnExportCampaignData) {
      btnExportCampaignData.addEventListener('click', async () => {
        if (btnExportCampaignData.disabled) return;
        const campaignId = document.getElementById('exportCampaignOnly').value;
        btnExportCampaignData.disabled = true;
        btnExportCampaignData.classList.add('is-loading');
        await exportCampaignData(campaignId);
        btnExportCampaignData.disabled = false;
        btnExportCampaignData.classList.remove('is-loading');
      });
    }
  }

  /* ==========================================================================
     11a. Generic Delete Confirmation Modal (reused by Agencies/Campaigns/etc.)
     ========================================================================== */
  let confirmModalAction = null;

  /**
   * Opens the shared confirm modal. `onConfirm` is an async function that
   * performs the actual delete - errors it throws are shown as a toast and
   * the modal stays open so the user can cancel; on success the modal closes.
   */
  function showConfirmModal({ title = 'Confirm Delete', message, confirmLabel = '🗑️ Delete', onConfirm }) {
    const modal = document.getElementById('confirmModal');
    if (!modal) return;
    document.getElementById('confirmModalTitle').textContent = title;
    document.getElementById('confirmModalMessage').textContent = message;
    document.getElementById('btnConfirmAction').querySelector('.btn-label').textContent = confirmLabel;
    confirmModalAction = onConfirm;
    modal.classList.add('open');
  }

  function initConfirmModal() {
    const modal = document.getElementById('confirmModal');
    if (!modal) return;
    const close = () => modal.classList.remove('open');

    const btnClose = document.getElementById('btnCloseConfirmModal');
    const btnCancel = document.getElementById('btnCancelConfirm');
    [btnClose, btnCancel].forEach(btn => {
      if (btn) btn.addEventListener('click', close);
    });

    const btnConfirm = document.getElementById('btnConfirmAction');
    if (btnConfirm) {
      btnConfirm.addEventListener('click', async () => {
        if (!confirmModalAction || btnConfirm.disabled) return;
        btnConfirm.disabled = true;
        btnConfirm.classList.add('is-loading');
        try {
          await confirmModalAction();
          close();
        } catch (err) {
          showToast(err.message || 'Failed to delete.', 'danger');
        }
        btnConfirm.disabled = false;
        btnConfirm.classList.remove('is-loading');
      });
    }
  }

  /* ==========================================================================
     12. Modal Controllers & Toast Notifications
     ========================================================================== */
  function initModals() {
    // Preview Modal Buttons
    const previewModal = document.getElementById('previewModal');
    const btnConfirmSubmit = document.getElementById('btnConfirmSubmit');
    const btnEditBack = document.getElementById('btnEditBack');
    const btnClosePreview = document.getElementById('btnClosePreviewModal');

    if (btnConfirmSubmit) {
      btnConfirmSubmit.addEventListener('click', async () => {
        if (!currentFormData || btnConfirmSubmit.disabled) return;

        // Lock the button immediately to prevent accidental duplicate submissions
        btnConfirmSubmit.disabled = true;
        btnConfirmSubmit.classList.add('is-loading');

        try {
          // Inserts directly into Supabase and gets the new row straight back - no full
          // list reload. storage.addUser() already prepends the new record into the
          // current page's in-memory cache, so switchTab below just re-renders from it.
          const savedUser = await storage.addUser(currentFormData, currentFormData._files);
          previewModal.classList.remove('open');
          resetRegistrationForm();
          switchTab('admin-management', { skipRefetch: true });
          showToast(`User ${savedUser.id} created successfully!`, 'success');
        } catch (err) {
          showToast(err.message || 'Failed to create user.', 'danger');
        }

        btnConfirmSubmit.disabled = false;
        btnConfirmSubmit.classList.remove('is-loading');
      });
    }

    if (btnEditBack) {
      btnEditBack.addEventListener('click', () => {
        previewModal.classList.remove('open');
      });
    }

    if (btnClosePreview) {
      btnClosePreview.addEventListener('click', () => {
        previewModal.classList.remove('open');
      });
    }

    // Detail Modal Close
    const userDetailModal = document.getElementById('userDetailModal');
    const btnCloseDetail = document.getElementById('btnCloseDetailModal');
    if (btnCloseDetail) {
      btnCloseDetail.addEventListener('click', () => {
        userDetailModal.classList.remove('open');
      });
    }

    // Edit Modal Buttons
    const editModal = document.getElementById('userEditModal');
    const btnCloseEdit = document.getElementById('btnCloseEditModal');
    const btnSaveEdit = document.getElementById('btnSaveUserEdit');

    if (btnCloseEdit) {
      btnCloseEdit.addEventListener('click', () => {
        editModal.classList.remove('open');
      });
    }

    if (btnSaveEdit) {
      btnSaveEdit.addEventListener('click', async () => {
        if (!editingUserId || btnSaveEdit.disabled) return;

        const rawEditName = document.getElementById('editName').value;
        const updatedName = formatTitleCase(rawEditName);
        if (!updatedName) {
          alert('Please enter Name.');
          return;
        }
        document.getElementById('editName').value = updatedName;
        const updatedMobile = document.getElementById('editMobile').value.trim();
        const updatedDesignation = document.getElementById('editDesignation').value;
        const updatedRole = document.getElementById('editRole').value;
        let updatedReportTo = document.getElementById('editReportTo').value;

        // Mobile check
        const mCheck = validateMobile(updatedMobile);
        if (!mCheck.valid) {
          alert(mCheck.message);
          return;
        }

        // Duplicate mobile check excluding current user - authoritative query against
        // Supabase, not a local cache. Scoped to this user's (unchangeable) Agency+Campaign.
        const dupCheck = await storage.checkDuplicate(
          updatedMobile, null, editingUserAgencyId, editingUserCampaignId, editingUserId
        );
        if (dupCheck.duplicate && dupCheck.field === 'Mobile Number') {
          alert(dupCheck.message);
          return;
        }

        // Designation/Role must always match (Role select is disabled/auto-synced, but this
        // guards against the invariant ever being bypassed).
        if (updatedDesignation !== updatedRole) {
          alert('Role must match Designation.');
          return;
        }

        // Report To hierarchy rule: FC must have none; BP/Supervisor must pick a valid,
        // matching-hierarchy active user (the Report To <select> only offers valid ones -
        // refreshEditReportToOptions() populated currentEditReportToCandidates for the
        // currently-selected Designation - this re-checks in case the dropdown went stale).
        const targetDesignation = REPORT_TO_TARGET_DESIGNATION[updatedDesignation] || null;
        if (!targetDesignation) {
          updatedReportTo = ''; // FC - enforce empty regardless of the select's current state
        } else {
          const validNames = getCachedReportToUsers(true).map(u => u.name);
          if (!updatedReportTo || !validNames.includes(updatedReportTo)) {
            alert(`Please select a valid ${targetDesignation} to report to.`);
            return;
          }
        }

        btnSaveEdit.disabled = true;
        try {
          await storage.updateUser(editingUserId, {
            name: updatedName,
            mobile: updatedMobile,
            designation: updatedDesignation,
            role: updatedRole,
            reportTo: updatedReportTo
          }, editingUserAgencyId, editingUserCampaignId);

          editModal.classList.remove('open');
          renderUserTable();
          showToast('User details updated successfully.', 'success');
        } catch (err) {
          alert(err.message || 'Failed to update user.');
        }
        btnSaveEdit.disabled = false;
      });
    }

    // Designation change inside the Quick Edit modal -> keep Role/Report To in sync too.
    const editDesignationSelect = document.getElementById('editDesignation');
    if (editDesignationSelect) {
      editDesignationSelect.addEventListener('change', async () => {
        await refreshEditReportToOptions();
      });
    }

    // Close Modals on Overlay Backdrop Click
    window.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-backdrop')) {
        e.target.classList.remove('open');
      }
    });
  }

  function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('show');
    }, 10);

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }
});
