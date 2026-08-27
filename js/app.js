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

  // Initialize UI components (event wiring only - no server data needed yet)
  initNavigation();
  initFormControls();
  initLocationDropdowns();
  initReportToSearchableSelect();
  initImageUploads();
  initFormSubmissionAndPreview();
  initAdminDashboard();
  initSettingsPanel();
  initModals();

  // Highlight default navigation tab first - the Admin table's own data load
  // is triggered by switchTab('admin-management') when that tab is opened,
  // and the Create form only needs the (static, cheap) Report To candidate
  // fetch, not the full user list - so there is no upfront full-list load.
  switchTab('create-user');

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
  async function switchTab(viewId, options = {}) {
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
      populateRoleDropdown();
      populateDesignationDropdown();
      syncRoleWithDesignation();
      await refreshReportToForDesignation();
    } else if (viewId === 'admin-management') {
      if (!options.skipRefetch) {
        const tbody = document.getElementById('adminUserTableBody');
        if (tbody) {
          tbody.innerHTML = `<tr><td colspan="10" class="text-center py-4 text-muted">Loading users...</td></tr>`;
        }
        populateAdminFilters();
        await refreshUsersFromSheet(getAdminFilterValues(), 1);
      }
      renderUserTable();
    } else if (viewId === 'admin-settings') {
      renderSettingsLists();
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
    const designation = document.getElementById('designation').value;
    const targetDesignation = REPORT_TO_TARGET_DESIGNATION[designation] || null;
    const searchInput = document.getElementById('reportToSearch');
    const hiddenInput = document.getElementById('reportTo');
    const dropdownList = document.getElementById('reportToDropdown');
    const hint = document.getElementById('reportToHint');
    if (!searchInput || !hiddenInput) return;

    if (!designation) {
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

      currentCreateReportToCandidates = await storage.getReportToUsers(targetDesignation);
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
    // cache), since a full user list is no longer held in memory.
    const dupCheck = await storage.checkDuplicate(mobileVal, nidVal);
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
        currentFormData = {
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
      tbody.innerHTML = `<tr><td colspan="10" class="text-center py-4 text-muted">Loading...</td></tr>`;
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
        ['filterDivision', 'filterDistrict', 'filterUpazila', 'filterThana',
         'filterDesignation', 'filterRole', 'filterStatus',
         'filterFromDate', 'filterToDate'].forEach(id => {
          const select = document.getElementById(id);
          if (select) select.value = '';
        });
        populateLocationFilterCascade();
        reloadUserTable(1);
      });
    }

    initLocationFilterCascade();

    ['filterDesignation', 'filterRole', 'filterStatus', 'filterFromDate', 'filterToDate'].forEach(id => {
      const select = document.getElementById(id);
      if (select) {
        select.addEventListener('change', () => reloadUserTable(1));
      }
    });

    if (btnExportExcel) {
      btnExportExcel.addEventListener('click', () => openExportOptionsModal());
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

  function populateAdminFilters() {
    const roles = storage.getRoles();
    const designations = storage.getDesignations();

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
          <td colspan="10" class="text-center py-4 text-muted">
            No matching user records found.
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
    currentEditReportToCandidates = await storage.getReportToUsers(targetDesignation, editingUserId);
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

  /* ==========================================================================
     10. Admin Settings Panel (Manage Roles & Designations)
     ========================================================================== */
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

  // Note: the old "Reset All Data" (hard-wipe-and-reseed) feature was intentionally
  // removed during the Supabase migration - it required an unauthenticated DELETE
  // capability, and this app has no login/auth to restrict who could trigger it (the
  // anon key is public by design). Restore it only alongside real authentication.
  function initSettingsPanel() {}

  function renderSettingsLists() {
    const roleListContainer = document.getElementById('rolesConfigList');
    const designationListContainer = document.getElementById('designationsConfigList');

    if (roleListContainer) {
      const roles = storage.getRoles();
      roleListContainer.innerHTML = roles.map(r => `
        <div class="config-chip" style="opacity:1;">
          <span>✅ ${r}</span>
        </div>
      `).join('');
    }

    if (designationListContainer) {
      const designations = storage.getDesignations();
      designationListContainer.innerHTML = designations.map(d => `
        <div class="config-chip" style="opacity:1;">
          <span>✅ ${d}</span>
        </div>
      `).join('');
    }
  }

  /* ==========================================================================
     11. Excel Export Functionality
     ========================================================================== */
  // Role-based Excel export: one sheet/tab per role (BP, Supervisor, FC), matching the
  // grouping the app has always used.
  const EXPORT_ROLE_ORDER = ['BP', 'Supervisor', 'FC'];

  // Required columns in order:
  // Division | District | Upazila | Thana | Name | Gender | Father's Name | Mother's Name | Mobile Number | Email | Date of Birth | Designation | Role | Report To | NID Number | NID Front Side Image | NID Back Side Image | User Photo | Status | Created Date
  const EXCEL_HEADERS = [
    "Division", "District", "Upazila", "Thana", "Name", "Gender", "Father's Name",
    "Mother's Name", "Mobile Number", "Email", "Date of Birth", "Designation", "Role",
    "Report To", "NID Number", "NID Front Side Image", "NID Back Side Image",
    "User Photo", "Status", "Created Date"
  ];

  function buildExcelRow(u) {
    return [
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
      // NID Front/Back live in a PRIVATE Storage bucket - exporting a signed URL into a
      // spreadsheet would bake in a link that expires and could be forwarded outside the
      // app, so only presence is noted here (same non-leaking behavior as the old
      // Base64-placeholder export). User Photo is public/low-sensitivity, so its
      // permanent public URL is exported directly - genuinely useful, and doesn't expire.
      u.nidFront ? '[On file - view in app]' : 'N/A',
      u.nidBack ? '[On file - view in app]' : 'N/A',
      u.userPhoto || 'N/A',
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

  // `exportFromDate`/`exportToDate` (each "yyyy-MM-dd", from the Export Options popup) and
  // `exportRole` ('' | 'BP' | 'Supervisor' | 'FC') narrow the export beyond whatever the
  // dashboard's own filters (search, location, its own From/To Date range, etc.) already
  // apply. The export queries Supabase directly with the combined filter set - it never
  // downloads the whole table into the browser just to filter it client-side.
  async function exportUsersToExcel(exportFromDate = '', exportToDate = '', exportRole = '') {
    const btnExportExcel = document.getElementById('btnExportExcel');
    if (btnExportExcel) {
      btnExportExcel.disabled = true;
      btnExportExcel.classList.add('is-loading');
    }

    const exportFilters = {
      ...getAdminFilterValues(),
      // Export Options popup values win over the dashboard's own From/To Date if both are set.
      fromDate: exportFromDate || getAdminFilterValues().fromDate,
      toDate: exportToDate || getAdminFilterValues().toDate,
      role: exportRole || getAdminFilterValues().role
    };

    let users;
    try {
      users = await dbService.getAllUsersForExport(exportFilters);
    } catch (err) {
      showToast(err.message || 'Failed to load data for export.', 'danger');
      if (btnExportExcel) {
        btnExportExcel.disabled = false;
        btnExportExcel.classList.remove('is-loading');
      }
      return;
    }

    if (btnExportExcel) {
      btnExportExcel.disabled = false;
      btnExportExcel.classList.remove('is-loading');
    }

    if (users.length === 0) {
      showToast('No user records match the selected export options.', 'warning');
      return;
    }

    // Which role sheets/files to produce: all 3 by default, or just the one picked in the popup.
    const rolesToExport = exportRole ? [exportRole] : EXPORT_ROLE_ORDER;

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

    let dateStr;
    if (exportFromDate || exportToDate) {
      dateStr = `${exportFromDate || 'start'}_to_${exportToDate || 'now'}`;
    } else {
      const fFromDate = document.getElementById('filterFromDate')?.value || '';
      const fToDate = document.getElementById('filterToDate')?.value || '';
      dateStr = (fFromDate || fToDate)
        ? `${fFromDate || 'start'}_to_${fToDate || 'now'}`
        : new Date().toISOString().slice(0, 10);
    }
    const roleSuffix = exportRole ? `_${exportRole}` : '';

    // Check if SheetJS XLSX library is available
    if (typeof XLSX !== 'undefined') {
      const mobileColLetter = XLSX.utils.encode_col(EXCEL_HEADERS.indexOf('Mobile Number'));
      const workbook = XLSX.utils.book_new();
      rolesToExport.forEach(role => {
        const rows = usersByRole[role].map(buildExcelRow);
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
        XLSX.utils.book_append_sheet(workbook, worksheet, role);
      });

      XLSX.writeFile(workbook, `User_Account_Collection${roleSuffix}_${dateStr}.xlsx`);
      showToast(
        unmatchedCount > 0
          ? `Exported (${unmatchedCount} record(s) with an unrecognized role were skipped).`
          : exportRole
            ? `Exported successfully - ${exportRole} sheet included.`
            : 'Exported successfully - BP, Supervisor, and FC sheets included.',
        'success'
      );
    } else {
      // High-compatibility CSV fallback with UTF-8 BOM. A single .csv can't hold multiple
      // tabs, so this downloads one file per role (skipping roles with no matching records).
      let filesDownloaded = 0;
      rolesToExport.forEach(role => {
        const rows = usersByRole[role].map(buildExcelRow);
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
        link.setAttribute("download", `User_Account_Collection_${role}_${dateStr}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        filesDownloaded++;
      });

      showToast(
        filesDownloaded > 0
          ? `Exported ${filesDownloaded} CSV file(s)${exportRole ? '' : ', one per role (BP/Supervisor/FC)'}.`
          : 'No user records available to export.',
        filesDownloaded > 0 ? 'success' : 'warning'
      );
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
        // Supabase, not a local cache.
        const dupCheck = await storage.checkDuplicate(updatedMobile, null, editingUserId);
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
          });

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

    // Export Options Modal Buttons
    const exportModal = document.getElementById('exportOptionsModal');
    const btnCloseExportModal = document.getElementById('btnCloseExportModal');
    const btnCancelExport = document.getElementById('btnCancelExport');
    const btnConfirmExport = document.getElementById('btnConfirmExport');

    if (btnCloseExportModal) {
      btnCloseExportModal.addEventListener('click', () => {
        exportModal.classList.remove('open');
      });
    }

    if (btnCancelExport) {
      btnCancelExport.addEventListener('click', () => {
        exportModal.classList.remove('open');
      });
    }

    if (btnConfirmExport) {
      btnConfirmExport.addEventListener('click', async () => {
        if (btnConfirmExport.disabled) return;
        const exportFromDate = document.getElementById('exportFromDate').value; // '' = no lower bound
        const exportToDate = document.getElementById('exportToDate').value; // '' = no upper bound
        const exportRole = document.getElementById('exportRole').value; // '' = all roles

        if (exportFromDate && exportToDate && exportFromDate > exportToDate) {
          showToast('From Date must be on or before To Date.', 'danger');
          return;
        }

        btnConfirmExport.disabled = true;
        btnConfirmExport.classList.add('is-loading');
        await exportUsersToExcel(exportFromDate, exportToDate, exportRole);
        btnConfirmExport.disabled = false;
        btnConfirmExport.classList.remove('is-loading');

        exportModal.classList.remove('open');
      });
    }

    // Close Modals on Overlay Backdrop Click
    window.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-backdrop')) {
        e.target.classList.remove('open');
      }
    });
  }

  // Opens the Export Options modal (From/To Date + Role) - resets it to defaults ("any
  // date", "all roles") each time so stale selections from a previous export don't carry over.
  function openExportOptionsModal() {
    const modal = document.getElementById('exportOptionsModal');
    const exportFromDateInput = document.getElementById('exportFromDate');
    const exportToDateInput = document.getElementById('exportToDate');
    const exportRoleSelect = document.getElementById('exportRole');
    if (!modal) return;

    if (exportFromDateInput) exportFromDateInput.value = '';
    if (exportToDateInput) exportToDateInput.value = '';
    if (exportRoleSelect) exportRoleSelect.value = '';

    modal.classList.add('open');
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
