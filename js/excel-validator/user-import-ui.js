/**
 * Import Users from Excel - UI Wiring (SUPER ADMIN ONLY)
 * A separate, standalone page from the "Validation" page (excel-validator-ui.js /
 * view-excel-validator, both left completely untouched) - this drives its own
 * 6-step wizard (Agency & Campaign -> Upload -> Map Columns -> Validate ->
 * Review & Import) under the "view-user-import" section, using "ui"-prefixed
 * element ids so nothing here can ever collide with the Validation page.
 *
 * Reuses the exact same shared validation engine the Validation page uses -
 * column-mapper.js / row-validator.js / excel-io.js / fuzzy-match.js /
 * master-index.js / reference-matcher.js - none of which are modified for this
 * feature. The only genuinely new capability here is actually writing the
 * accepted rows into the database (via dbService.importUsersBatch(), which
 * calls the Super-Admin-only import_users_batch() RPC - see supabase/schema.sql).
 */
document.addEventListener('DOMContentLoaded', () => {
  const section = document.getElementById('view-user-import');
  if (!section) return; // markup not present - nothing to wire up

  const cfg = window.EXCEL_VALIDATOR_CONFIG || { AUTO_FIX_MIN: 95, REVIEW_MIN: 85, MAX_FILE_SIZE_MB: 15, BATCH_SIZE: 200 };

  const state = {
    destinationAgencyId: null,
    destinationAgencyName: null,
    destinationCampaignId: null,
    destinationCampaignName: null,
    file: null,
    headers: [],
    rawRows: [],
    mapping: [],
    processedRows: [],
    filter: 'all',
    referenceFile: null,
    referenceIndex: null,
    importResult: null
  };

  const els = {
    agencySelect: document.getElementById('uiAgencySelect'),
    campaignSelect: document.getElementById('uiCampaignSelect'),
    btnToUpload: document.getElementById('uiBtnToUpload'),

    dropzone: document.getElementById('uiDropzone'),
    fileInput: document.getElementById('uiFileInput'),
    fileInfo: document.getElementById('uiFileInfo'),
    fileName: document.getElementById('uiFileName'),
    fileMeta: document.getElementById('uiFileMeta'),
    btnRemoveFile: document.getElementById('uiBtnRemoveFile'),
    uploadProgressWrap: document.getElementById('uiUploadProgressWrap'),
    uploadProgressFill: document.getElementById('uiUploadProgressFill'),
    btnToMapping: document.getElementById('uiBtnToMapping'),

    mappingTableBody: document.getElementById('uiMappingTableBody'),
    btnBackToUpload: document.getElementById('uiBtnBackToUpload'),
    btnToValidate: document.getElementById('uiBtnToValidate'),

    validateProgressFill: document.getElementById('uiValidateProgressFill'),
    validateProgressText: document.getElementById('uiValidateProgressText'),

    dashboard: document.getElementById('uiDashboard'),
    filterBar: document.getElementById('uiFilterBar'),
    reviewTableHead: document.getElementById('uiReviewTableHead'),
    reviewTableBody: document.getElementById('uiReviewTableBody'),
    btnBackToUploadFromReview: document.getElementById('uiBtnBackToUploadFromReview'),
    btnDownload: document.getElementById('uiBtnDownload'),
    btnAcceptAllReviews: document.getElementById('uiBtnAcceptAllReviews'),
    btnDeclineAllReviews: document.getElementById('uiBtnDeclineAllReviews'),

    refDropzone: document.getElementById('uiRefDropzone'),
    refFileInput: document.getElementById('uiRefFileInput'),
    refFileInfo: document.getElementById('uiRefFileInfo'),
    refFileName: document.getElementById('uiRefFileName'),
    refFileMeta: document.getElementById('uiRefFileMeta'),
    btnRemoveRefFile: document.getElementById('uiBtnRemoveRefFile'),
    refUploadProgressWrap: document.getElementById('uiRefUploadProgressWrap'),
    refUploadProgressFill: document.getElementById('uiRefUploadProgressFill'),
    reportToSummary: document.getElementById('uiReportToSummary'),
    btnToggleReportToLog: document.getElementById('uiBtnToggleReportToLog'),
    reportToChangeLogWrap: document.getElementById('uiReportToChangeLogWrap'),
    reportToChangeLogBody: document.getElementById('uiReportToChangeLogBody'),

    btnDownloadReport: document.getElementById('uiBtnDownloadReport'),
    btnImport: document.getElementById('uiBtnImport'),
    importProgressWrap: document.getElementById('uiImportProgressWrap'),
    importProgressFill: document.getElementById('uiImportProgressFill'),
    importSummary: document.getElementById('uiImportSummary'),
    importResultsWrap: document.getElementById('uiImportResultsWrap'),
    importResultsBody: document.getElementById('uiImportResultsBody')
  };

  const REVIEW_TABLE_ROW_CAP = 500;

  /* ---------------------------------------------------------------------
     Small local helpers (independent of app.js's private closure)
     --------------------------------------------------------------------- */
  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  function displayValue(val) {
    if (val instanceof Date && !isNaN(val.getTime())) {
      const y = val.getFullYear(), m = String(val.getMonth() + 1).padStart(2, '0'), d = String(val.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    return val ?? '';
  }

  function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  function setStep(stepName) {
    section.querySelectorAll('.ev-panel').forEach(p => p.classList.remove('active'));
    const panel = document.getElementById('uiPanel' + stepName.charAt(0).toUpperCase() + stepName.slice(1));
    if (panel) panel.classList.add('active');

    const order = ['destination', 'upload', 'mapping', 'validate', 'review'];
    const activeIdx = order.indexOf(stepName);
    document.getElementById('uiStepper').querySelectorAll('.ev-step-dot').forEach(dot => {
      const idx = order.indexOf(dot.getAttribute('data-step'));
      dot.classList.toggle('active', idx === activeIdx);
      dot.classList.toggle('completed', idx < activeIdx);
    });
  }

  function resetAll() {
    state.file = null;
    state.headers = [];
    state.rawRows = [];
    state.mapping = [];
    state.processedRows = [];
    state.filter = 'all';
    state.referenceFile = null;
    state.referenceIndex = null;
    if (window.clearReferenceNameIndex) window.clearReferenceNameIndex();
    els.fileInput.value = '';
    els.fileInfo.style.display = 'none';
    els.uploadProgressWrap.style.display = 'none';
    els.uploadProgressFill.style.width = '0%';
    els.btnToMapping.disabled = true;
    if (els.refFileInput) els.refFileInput.value = '';
    if (els.refFileInfo) els.refFileInfo.style.display = 'none';
    if (els.refUploadProgressWrap) {
      els.refUploadProgressWrap.style.display = 'none';
      els.refUploadProgressFill.style.width = '0%';
    }
    if (els.reportToSummary) {
      els.reportToSummary.style.display = 'none';
      els.reportToSummary.innerHTML = '';
    }
    if (els.reportToChangeLogWrap) els.reportToChangeLogWrap.style.display = 'none';
    if (els.reportToChangeLogBody) els.reportToChangeLogBody.innerHTML = '';
    if (els.btnToggleReportToLog) {
      els.btnToggleReportToLog.style.display = 'none';
      els.btnToggleReportToLog.textContent = '🧾 View Report To Change Log';
    }

    state.importResult = null;
    if (els.importSummary) { els.importSummary.style.display = 'none'; els.importSummary.innerHTML = ''; }
    if (els.importResultsWrap) els.importResultsWrap.style.display = 'none';
    if (els.importResultsBody) els.importResultsBody.innerHTML = '';
    if (els.importProgressWrap) { els.importProgressWrap.style.display = 'none'; els.importProgressFill.style.width = '0%'; }

    // Destination (Agency/Campaign) is deliberately NOT cleared here - "Validate Another
    // File" / "Remove file" almost always means importing more rows into the SAME
    // destination, so re-picking it every time would just be friction. Only a page
    // (re)load starts at the Destination step (see the DOMContentLoaded-time resetAll()
    // call at the bottom of this file).
    setStep(state.destinationAgencyId && state.destinationCampaignId ? 'upload' : 'destination');
  }

  /* ---------------------------------------------------------------------
     Step 1: Destination (Agency + Campaign) - Super Admin explicitly picks
     WHERE every imported user will be created. Never read from the Excel
     file (see the mismatch check in finishValidation() below) - this is the
     one value the server (import_users_batch()) actually trusts.
     --------------------------------------------------------------------- */
  function populateDestinationDropdowns() {
    if (!els.agencySelect) return;
    const agencies = (window.storage && window.storage.getAgencies) ? window.storage.getAgencies({ activeOnly: true }) : [];
    els.agencySelect.innerHTML = '<option value="">Select Agency</option>' +
      agencies.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
  }

  function updateBtnToUploadState() {
    if (els.btnToUpload) els.btnToUpload.disabled = !(state.destinationAgencyId && state.destinationCampaignId);
  }

  if (els.agencySelect) {
    els.agencySelect.addEventListener('change', () => {
      const agencyId = els.agencySelect.value || null;
      state.destinationAgencyId = agencyId;
      state.destinationAgencyName = agencyId ? (els.agencySelect.selectedOptions[0] || {}).textContent : null;
      state.destinationCampaignId = null;
      state.destinationCampaignName = null;

      const campaigns = agencyId && window.storage && window.storage.getCampaigns
        ? window.storage.getCampaigns({ agencyId, activeOnly: true })
        : [];
      if (els.campaignSelect) {
        els.campaignSelect.innerHTML = '<option value="">Select Campaign</option>' +
          campaigns.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
        els.campaignSelect.disabled = !agencyId;
      }
      updateBtnToUploadState();
    });
  }

  if (els.campaignSelect) {
    els.campaignSelect.addEventListener('change', () => {
      const campaignId = els.campaignSelect.value || null;
      state.destinationCampaignId = campaignId;
      state.destinationCampaignName = campaignId ? (els.campaignSelect.selectedOptions[0] || {}).textContent : null;
      updateBtnToUploadState();
    });
  }

  if (els.btnToUpload) {
    els.btnToUpload.addEventListener('click', () => {
      if (!state.destinationAgencyId || !state.destinationCampaignId) return;
      setStep('upload');
    });
  }

  /* ---------------------------------------------------------------------
     Step 2: Upload
     --------------------------------------------------------------------- */
  const ALLOWED_EXTENSIONS = ['.xlsx', '.xls', '.csv'];

  function isAllowedFile(file) {
    const name = file.name.toLowerCase();
    return ALLOWED_EXTENSIONS.some(ext => name.endsWith(ext));
  }

  async function handleFileSelected(file) {
    if (!file) return;

    if (!isAllowedFile(file)) {
      showToast('Unsupported file type. Please upload a .xlsx, .xls, or .csv file.', 'danger');
      return;
    }
    const maxBytes = cfg.MAX_FILE_SIZE_MB * 1024 * 1024;
    if (file.size > maxBytes) {
      showToast(`File is too large. Maximum allowed size is ${cfg.MAX_FILE_SIZE_MB}MB.`, 'danger');
      return;
    }

    els.fileName.textContent = file.name;
    els.fileMeta.textContent = 'Reading file...';
    els.fileInfo.style.display = 'block';
    els.uploadProgressWrap.style.display = 'block';
    els.uploadProgressFill.style.width = '0%';
    els.btnToMapping.disabled = true;

    try {
      const parsed = await window.readWorkbookFile(file, pct => {
        els.uploadProgressFill.style.width = pct + '%';
      });

      if (parsed.duplicateHeaders && parsed.duplicateHeaders.length > 0) {
        showToast(`Duplicate column headers found: ${parsed.duplicateHeaders.join(', ')}. Only the first occurrence of each will be used.`, 'warning');
      }
      if (parsed.rows.length === 0) {
        showToast('The file has headers but no data rows.', 'warning');
      }

      state.file = file;
      state.headers = parsed.headers;
      state.rawRows = parsed.rows;

      els.fileMeta.textContent = `${parsed.rows.length} data row(s) detected · ${(file.size / 1024).toFixed(1)} KB`;
      els.btnToMapping.disabled = parsed.rows.length === 0 && parsed.headers.length === 0;
      showToast('File uploaded successfully.', 'success');
    } catch (err) {
      state.file = null;
      els.fileInfo.style.display = 'none';
      showToast(err.message || 'Failed to read the file.', 'danger');
    } finally {
      els.uploadProgressWrap.style.display = 'none';
    }
  }

  els.dropzone.addEventListener('click', () => els.fileInput.click());
  els.dropzone.addEventListener('dragover', e => {
    e.preventDefault();
    els.dropzone.classList.add('ev-dropzone-active');
  });
  els.dropzone.addEventListener('dragleave', () => els.dropzone.classList.remove('ev-dropzone-active'));
  els.dropzone.addEventListener('drop', e => {
    e.preventDefault();
    els.dropzone.classList.remove('ev-dropzone-active');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  });
  els.fileInput.addEventListener('change', e => {
    if (e.target.files && e.target.files[0]) handleFileSelected(e.target.files[0]);
  });
  els.btnRemoveFile.addEventListener('click', () => resetAll());

  /* ---------------------------------------------------------------------
     Optional: Reference Excel File (Report To standardization source)
     --------------------------------------------------------------------- */
  async function handleReferenceFileSelected(file) {
    if (!file || !els.refDropzone) return;

    if (!isAllowedFile(file)) {
      showToast('Unsupported reference file type. Please upload a .xlsx, .xls, or .csv file.', 'danger');
      return;
    }
    const maxBytes = cfg.MAX_FILE_SIZE_MB * 1024 * 1024;
    if (file.size > maxBytes) {
      showToast(`Reference file is too large. Maximum allowed size is ${cfg.MAX_FILE_SIZE_MB}MB.`, 'danger');
      return;
    }

    els.refFileName.textContent = file.name;
    els.refFileMeta.textContent = 'Reading reference file...';
    els.refFileInfo.style.display = 'block';
    els.refUploadProgressWrap.style.display = 'block';
    els.refUploadProgressFill.style.width = '0%';

    try {
      const parsed = await window.readReferenceWorkbookFile(file, pct => {
        els.refUploadProgressFill.style.width = pct + '%';
      });
      const index = window.buildReferenceNameIndex(parsed.sheets);

      if (!index || index.entries.length === 0) {
        state.referenceFile = null;
        state.referenceIndex = null;
        if (window.clearReferenceNameIndex) window.clearReferenceNameIndex();
        els.refFileInfo.style.display = 'none';
        els.refFileInput.value = '';
        showToast('Reference file could not be processed. We couldn\'t find a suitable Name column in the uploaded file. Please upload a reference file containing a Name/Employee Name/Full Name column.', 'danger');
        return;
      }

      state.referenceFile = file;
      state.referenceIndex = index;
      window.setReferenceNameIndex(index);

      els.refFileMeta.textContent = `${index.entries.length.toLocaleString()} unique name(s) found across ${index.usableSheets} sheet(s) · ${(file.size / 1024).toFixed(1)} KB`;
      showToast('Reference file uploaded. Report To values will be matched against it.', 'success');
    } catch (err) {
      state.referenceFile = null;
      state.referenceIndex = null;
      if (window.clearReferenceNameIndex) window.clearReferenceNameIndex();
      els.refFileInfo.style.display = 'none';
      showToast(err.message || 'Failed to read the reference file.', 'danger');
    } finally {
      els.refUploadProgressWrap.style.display = 'none';
    }
  }

  if (els.refDropzone) {
    els.refDropzone.addEventListener('click', () => els.refFileInput.click());
    els.refDropzone.addEventListener('dragover', e => {
      e.preventDefault();
      els.refDropzone.classList.add('ev-dropzone-active');
    });
    els.refDropzone.addEventListener('dragleave', () => els.refDropzone.classList.remove('ev-dropzone-active'));
    els.refDropzone.addEventListener('drop', e => {
      e.preventDefault();
      els.refDropzone.classList.remove('ev-dropzone-active');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleReferenceFileSelected(e.dataTransfer.files[0]);
      }
    });
    els.refFileInput.addEventListener('change', e => {
      if (e.target.files && e.target.files[0]) handleReferenceFileSelected(e.target.files[0]);
    });
    els.btnRemoveRefFile.addEventListener('click', () => {
      state.referenceFile = null;
      state.referenceIndex = null;
      if (window.clearReferenceNameIndex) window.clearReferenceNameIndex();
      els.refFileInput.value = '';
      els.refFileInfo.style.display = 'none';
      showToast('Reference file removed.', 'info');
    });
  }

  els.btnToMapping.addEventListener('click', () => {
    if (!state.headers.length) return;
    state.mapping = window.mapColumns(state.headers);
    renderMappingTable();
    setStep('mapping');
  });

  /* ---------------------------------------------------------------------
     Step 3: Column Mapping
     --------------------------------------------------------------------- */
  function renderMappingTable() {
    const fieldOptions = window.EXCEL_FIELD_DEFINITIONS;
    els.mappingTableBody.innerHTML = state.mapping.map((m, i) => {
      const options = ['<option value="">— Not Mapped —</option>']
        .concat(fieldOptions.map(f => `<option value="${f.field}" ${m.field === f.field ? 'selected' : ''}>${escapeHtml(f.label)}</option>`))
        .join('');
      const confClass = m.confidenceLevel === 'High' ? 'ev-conf-high' : m.confidenceLevel === 'Medium' ? 'ev-conf-medium' : m.confidenceLevel === 'Low' ? 'ev-conf-low' : 'ev-conf-none';
      return `
        <tr data-index="${i}">
          <td>${escapeHtml(m.column) || '<em class="text-muted">(blank header)</em>'}</td>
          <td><select class="form-control ui-mapping-select" data-index="${i}">${options}</select></td>
          <td><span class="ev-confidence-badge ${confClass}">${m.field ? m.confidenceLevel : 'Unmapped'}</span></td>
        </tr>`;
    }).join('');

    els.mappingTableBody.querySelectorAll('.ui-mapping-select').forEach(select => {
      select.addEventListener('change', () => {
        const idx = Number(select.getAttribute('data-index'));
        const chosenField = select.value || null;
        const fieldDef = fieldOptions.find(f => f.field === chosenField);

        if (chosenField) {
          state.mapping.forEach((m, j) => {
            if (j !== idx && m.field === chosenField) {
              m.field = null;
              m.label = null;
              m.confidence = 0;
              m.confidenceLevel = 'None';
              showToast(`"${state.mapping[j].column}" was unmapped because "${state.mapping[idx].column}" is now mapped to ${fieldDef.label}.`, 'warning');
            }
          });
        }

        state.mapping[idx].field = chosenField;
        state.mapping[idx].label = fieldDef ? fieldDef.label : null;
        state.mapping[idx].confidence = chosenField ? 100 : 0;
        state.mapping[idx].confidenceLevel = chosenField ? 'Manual' : 'None';
        renderMappingTable();
      });
    });
  }

  els.btnBackToUpload.addEventListener('click', () => setStep('upload'));

  function loadAgencyCampaignMasterData() {
    const agencies = (window.storage && window.storage.getAgencies) ? window.storage.getAgencies() : [];
    const campaigns = (window.storage && window.storage.getCampaigns) ? window.storage.getCampaigns() : [];
    window.EXCEL_VALIDATOR_MASTER_DATA = { agencies, campaigns };
    if (window.resetMasterIndex) window.resetMasterIndex(); // rebuild indexes against the fresh snapshot
  }

  els.btnToValidate.addEventListener('click', () => {
    if (!state.mapping.some(m => m.field)) {
      showToast('Please map at least one column before validating.', 'danger');
      return;
    }
    loadAgencyCampaignMasterData();
    // reference-matcher.js's Report To reference index is a single shared global,
    // not scoped to this page - the "Validation" page (view-excel-validator) uses
    // the exact same global. Re-sync it to THIS page's own last-known state right
    // before validating, so a Reference Excel uploaded/removed on the other page
    // (if the user switched tabs without reloading) can never leak into this run.
    if (state.referenceIndex && window.setReferenceNameIndex) {
      window.setReferenceNameIndex(state.referenceIndex);
    } else if (window.clearReferenceNameIndex) {
      window.clearReferenceNameIndex();
    }
    setStep('validate');
    runValidation();
  });

  /* ---------------------------------------------------------------------
     Step 4: Validate (batched so the tab stays responsive on large files)
     --------------------------------------------------------------------- */
  function rowToMappedObject(rawRow) {
    const mapped = {};
    state.mapping.forEach(m => {
      if (!m.field) return;
      if (m.field in mapped) return; // conflict guard, mapping already dedupes but stay safe
      mapped[m.field] = rawRow[m.index];
    });
    return mapped;
  }

  function runValidation() {
    state.processedRows = [];
    const total = state.rawRows.length;
    let i = 0;

    if (total === 0) {
      finishValidation();
      return;
    }

    function processBatch() {
      const end = Math.min(i + cfg.BATCH_SIZE, total);
      for (; i < end; i++) {
        const raw = state.rawRows[i];
        const mapped = rowToMappedObject(raw);
        const result = window.validateRow(mapped);
        state.processedRows.push({ raw, result });
      }
      const pct = Math.round((i / total) * 100);
      els.validateProgressFill.style.width = pct + '%';
      els.validateProgressText.textContent = `Validating ${i.toLocaleString()} / ${total.toLocaleString()} rows`;

      if (i < total) {
        setTimeout(processBatch, 0);
      } else {
        finishValidation();
      }
    }
    processBatch();
  }

  // Agency/Campaign mismatch check (Option B: validate rather than silently ignore the
  // Excel's own Agency/Campaign columns). Runs only when the column was actually
  // mapped - row-validator.js's matchAgencyCampaignHierarchy() has already
  // fuzzy-matched it against the real master list; this just compares THAT matched
  // value against the Super Admin's selected destination and blocks the row (marks the
  // field invalid) on a mismatch, so a mismatched row can never be imported into the
  // wrong Agency/Campaign no matter what the file says.
  function applyDestinationMismatchCheck() {
    const checks = [
      { key: 'agency', label: 'Agency', selectedName: state.destinationAgencyName },
      { key: 'campaign', label: 'Campaign', selectedName: state.destinationCampaignName }
    ];
    state.processedRows.forEach(({ result }) => {
      checks.forEach(({ key, label, selectedName }) => {
        const f = result.fields[key];
        if (!f || !selectedName) return;
        if (f.status === 'invalid') return; // already unusable for its own reason
        const effectiveValue = window.getEffectiveValue(f);
        if (!effectiveValue) return;
        if (normalizeForMatch(effectiveValue) !== normalizeForMatch(selectedName)) {
          f.status = 'invalid';
          f.resolution = null;
          f.message = `${label}/Campaign mismatch. Selected ${label}: "${selectedName}". Excel ${label}: "${effectiveValue}". Please correct the selection or Excel file before continuing.`;
        }
      });
    });
  }

  function finishValidation() {
    applyDestinationMismatchCheck();
    renderDashboard();
    renderReportToSummary();
    renderReviewTable();
    setStep('review');
  }

  /* ---------------------------------------------------------------------
     Step 5: Review, Download & Import
     --------------------------------------------------------------------- */
  function rowOverallStatus(result) {
    return window.getEffectiveRowStatus(result); // 'invalid' | 'review' | 'corrected' | 'valid'
  }

  function renderDashboard() {
    const counts = { total: state.processedRows.length, valid: 0, corrected: 0, invalid: 0, review: 0 };
    let totalCorrections = 0;
    let totalErrors = 0;
    state.processedRows.forEach(({ result }) => {
      const status = rowOverallStatus(result);
      if (status === 'valid') counts.valid++;
      else if (status === 'corrected') counts.corrected++;
      else if (status === 'invalid') counts.invalid++;
      else if (status === 'review') counts.review++;
      totalCorrections += window.getEffectiveCorrectionCount(result);
      totalErrors += Object.values(result.fields).filter(f => f.status === 'invalid').length;
    });

    const tiles = [
      { label: 'Total Rows', value: counts.total, cls: '' },
      { label: 'Valid', value: counts.valid, cls: 'ev-tile-valid' },
      { label: 'Corrected', value: counts.corrected, cls: 'ev-tile-corrected' },
      { label: 'Needs Review', value: counts.review, cls: 'ev-tile-review' },
      { label: 'Invalid', value: counts.invalid, cls: 'ev-tile-invalid' },
      { label: 'Total Corrections', value: totalCorrections, cls: '' },
      { label: 'Total Errors', value: totalErrors, cls: '' }
    ];

    els.dashboard.innerHTML = tiles.map(t => `
      <div class="ev-dashboard-tile ${t.cls}">
        <div class="ev-dashboard-value">${t.value.toLocaleString()}</div>
        <div class="ev-dashboard-label">${t.label}</div>
      </div>
    `).join('');
  }

  const MATCH_METHOD_LABELS = {
    exact_match: 'Exact Match',
    case_insensitive_match: 'Case-Insensitive Match',
    normalized_match: 'Normalized Match (Spacing)',
    punctuation_match: 'Punctuation-Normalized Match',
    token_match: 'Token-Based Match',
    token_order_match: 'Token-Based Match (Name Order)',
    fuzzy_match: 'Fuzzy Name Match',
    context_aware_match: 'Context-Aware Match'
  };

  function matchMethodLabel(method) {
    return MATCH_METHOD_LABELS[method] || (method ? method : '—');
  }

  function reportToLogStatus(f) {
    if (!f) return null;
    if (f.status === 'corrected') return 'Accepted (Auto)';
    if (f.status === 'review') {
      if (f.resolution === 'accepted') return 'Accepted';
      if (f.resolution === 'declined') return 'Declined';
      return 'Pending';
    }
    if (f.warning && f.matchingMethod) return 'Possible Match (Not Applied)';
    if (f.warning && !f.matchingMethod) return 'Ambiguous - Manual Review';
    return null;
  }

  function renderReportToSummary() {
    if (!els.reportToSummary) return;
    const reportToMapped = state.mapping.some(m => m.field === 'reportTo');
    if (!reportToMapped || !state.referenceIndex) {
      els.reportToSummary.style.display = 'none';
      els.reportToSummary.innerHTML = '';
      if (els.reportToChangeLogWrap) els.reportToChangeLogWrap.style.display = 'none';
      if (els.btnToggleReportToLog) els.btnToggleReportToLog.style.display = 'none';
      return;
    }

    let total = 0, exact = 0, suggested = 0, accepted = 0, declined = 0, noMatch = 0, changesApplied = 0;
    state.processedRows.forEach(({ result }) => {
      const f = result.fields.reportTo;
      if (!f || String(f.original ?? '').trim() === '') return;
      total++;
      if (f.reason === 'Valid.') { exact++; return; }
      if (f.status === 'corrected') { suggested++; accepted++; changesApplied++; return; }
      if (f.status === 'review') {
        suggested++;
        if (f.resolution === 'accepted') { accepted++; changesApplied++; }
        else if (f.resolution === 'declined') declined++;
        return;
      }
      if (!f.matchingMethod && !f.warning) noMatch++;
    });

    els.reportToSummary.innerHTML = `
      <div class="card-header-box"><h3>Report To Validation Summary</h3></div>
      <p class="text-muted" style="margin-bottom:0.75rem;">Reference file: <strong>${escapeHtml(state.referenceFile ? state.referenceFile.name : '')}</strong></p>
      <div class="ev-dashboard">
        <div class="ev-dashboard-tile"><div class="ev-dashboard-value">${total.toLocaleString()}</div><div class="ev-dashboard-label">Total Report To Values</div></div>
        <div class="ev-dashboard-tile ev-tile-valid"><div class="ev-dashboard-value">${exact.toLocaleString()}</div><div class="ev-dashboard-label">Exact Matches</div></div>
        <div class="ev-dashboard-tile ev-tile-review"><div class="ev-dashboard-value">${suggested.toLocaleString()}</div><div class="ev-dashboard-label">Suggested Corrections</div></div>
        <div class="ev-dashboard-tile ev-tile-corrected"><div class="ev-dashboard-value">${accepted.toLocaleString()}</div><div class="ev-dashboard-label">Accepted Corrections</div></div>
        <div class="ev-dashboard-tile"><div class="ev-dashboard-value">${declined.toLocaleString()}</div><div class="ev-dashboard-label">Declined Corrections</div></div>
        <div class="ev-dashboard-tile ev-tile-invalid"><div class="ev-dashboard-value">${noMatch.toLocaleString()}</div><div class="ev-dashboard-label">No Match Found</div></div>
        <div class="ev-dashboard-tile ev-tile-corrected"><div class="ev-dashboard-value">${changesApplied.toLocaleString()}</div><div class="ev-dashboard-label">Total Changes Applied</div></div>
      </div>`;
    els.reportToSummary.style.display = 'block';

    if (els.btnToggleReportToLog) els.btnToggleReportToLog.style.display = 'inline-flex';
    renderReportToChangeLog();
  }

  const REPORT_TO_LOG_ROW_CAP = 500;

  function renderReportToChangeLog() {
    if (!els.reportToChangeLogWrap || !els.reportToChangeLogBody) return;

    const entries = [];
    state.processedRows.forEach(({ result }, rowIndex) => {
      const f = result.fields.reportTo;
      const status = reportToLogStatus(f);
      if (!status) return;
      entries.push({ rowIndex, f, status });
    });

    if (entries.length === 0) {
      els.reportToChangeLogBody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-muted">No Report To corrections to show.</td></tr>';
      return;
    }

    const shown = entries.slice(0, REPORT_TO_LOG_ROW_CAP);
    els.reportToChangeLogBody.innerHTML = shown.map(({ rowIndex, f, status }) => {
      const changedTo = f.suggested != null ? f.suggested : (f.status === 'corrected' ? f.corrected : f.original);
      return `<tr>
        <td>${rowIndex + 1}</td>
        <td>${escapeHtml(f.original)}</td>
        <td>${escapeHtml(changedTo)}</td>
        <td>${escapeHtml(f.reason || '')}</td>
        <td>${escapeHtml(matchMethodLabel(f.matchingMethod))}</td>
        <td>${f.confidence}%</td>
        <td>${escapeHtml(status)}</td>
      </tr>`;
    }).join('');

    if (entries.length > REPORT_TO_LOG_ROW_CAP) {
      els.reportToChangeLogBody.innerHTML += `<tr><td colspan="7" class="text-center py-3 text-muted">Showing first ${REPORT_TO_LOG_ROW_CAP.toLocaleString()} of ${entries.length.toLocaleString()} logged change(s).</td></tr>`;
    }
  }

  if (els.btnToggleReportToLog) {
    els.btnToggleReportToLog.addEventListener('click', () => {
      if (!els.reportToChangeLogWrap) return;
      const showing = els.reportToChangeLogWrap.style.display !== 'none';
      els.reportToChangeLogWrap.style.display = showing ? 'none' : 'block';
      els.btnToggleReportToLog.textContent = showing ? '🧾 View Report To Change Log' : '🧾 Hide Report To Change Log';
    });
  }

  els.filterBar.addEventListener('click', e => {
    const btn = e.target.closest('.ev-filter-btn');
    if (!btn) return;
    state.filter = btn.getAttribute('data-filter');
    els.filterBar.querySelectorAll('.ev-filter-btn').forEach(b => b.classList.toggle('active', b === btn));
    renderReviewTable();
  });

  function renderFieldCell(fieldResult, rowIndex, fieldKey) {
    if (!fieldResult) return '<span class="text-muted">—</span>';
    const orig = escapeHtml(displayValue(fieldResult.original));

    if (fieldResult.status === 'valid') {
      const warn = fieldResult.warning
        ? ` <span class="ev-diff-warn" title="${escapeHtml(fieldResult.message || '')}">⚠</span>`
        : '';
      return `<span>${orig || '<span class="text-muted">—</span>'}</span>${warn}`;
    }
    if (fieldResult.status === 'invalid') {
      return `<span class="ev-diff ev-diff-invalid" title="${escapeHtml(fieldResult.message || '')}">${orig || '<em>empty</em>'}</span>`;
    }
    if (fieldResult.status === 'corrected') {
      const target = escapeHtml(displayValue(fieldResult.corrected));
      return `<span class="ev-diff ev-diff-corrected" title="${escapeHtml(fieldResult.message || '')}">${orig} <span class="ev-diff-arrow">→</span> ${target} <span class="ev-confidence">${fieldResult.confidence}%</span></span>`;
    }

    const target = escapeHtml(displayValue(fieldResult.suggested));
    const noteTitle = fieldKey === 'reportTo'
      ? `${escapeHtml(fieldResult.reason || '')} (${escapeHtml(matchMethodLabel(fieldResult.matchingMethod))}, source: ${escapeHtml(fieldResult.source || '')})`
      : escapeHtml(fieldResult.message || '');
    const diffLine = `<span class="ev-diff ev-diff-review" title="${noteTitle}">${orig} <span class="ev-diff-arrow">→</span> ${target} <span class="ev-confidence">${fieldResult.confidence}%</span></span>`;

    if (!fieldResult.resolution) {
      return `<div class="ev-review-cell">${diffLine}<div class="ev-review-actions">
        <button type="button" class="ev-accept-btn" data-row="${rowIndex}" data-field="${fieldKey}">✓ Accept</button>
        <button type="button" class="ev-decline-btn" data-row="${rowIndex}" data-field="${fieldKey}">✕ Decline</button>
      </div></div>`;
    }
    const resolved = fieldResult.resolution === 'accepted'
      ? { label: 'Accepted', cls: 'ev-resolved-accepted' }
      : { label: 'Declined', cls: 'ev-resolved-declined' };
    return `<div class="ev-review-cell">${diffLine}<div class="ev-review-actions">
      <span class="ev-resolved-tag ${resolved.cls}">${resolved.label}</span>
      <button type="button" class="ev-undo-btn" data-row="${rowIndex}" data-field="${fieldKey}">Undo</button>
    </div></div>`;
  }

  function statusBadge(status) {
    const map = {
      valid: ['Valid', 'ev-badge-valid'],
      corrected: ['Corrected', 'ev-badge-corrected'],
      review: ['Needs Review', 'ev-badge-review'],
      invalid: ['Invalid', 'ev-badge-invalid']
    };
    const [label, cls] = map[status] || [status, ''];
    return `<span class="ev-badge ${cls}">${label}</span>`;
  }

  function renderReviewTable() {
    const mappedFields = state.mapping.filter(m => m.field);
    els.reviewTableHead.innerHTML = '<th>#</th>' + mappedFields.map(m => `<th>${escapeHtml(m.label)}</th>`).join('') + '<th>Status</th>';

    const filtered = state.filter === 'all'
      ? state.processedRows
      : state.processedRows.filter(({ result }) => rowOverallStatus(result) === state.filter);

    const shown = filtered.slice(0, REVIEW_TABLE_ROW_CAP);

    if (shown.length === 0) {
      els.reviewTableBody.innerHTML = `<tr><td colspan="${mappedFields.length + 2}" class="text-center py-4 text-muted">No rows match this filter.</td></tr>`;
      return;
    }

    let html = '';
    let shownCount = 0;
    for (let i = 0; i < state.processedRows.length && shownCount < REVIEW_TABLE_ROW_CAP; i++) {
      const entry = state.processedRows[i];
      const status = rowOverallStatus(entry.result);
      if (state.filter !== 'all' && status !== state.filter) continue;
      shownCount++;
      const cells = mappedFields.map(m => `<td>${renderFieldCell(entry.result.fields[m.field], i, m.field)}</td>`).join('');
      html += `<tr><td>${i + 1}</td>${cells}<td>${statusBadge(status)}</td></tr>`;
    }
    els.reviewTableBody.innerHTML = html;

    if (filtered.length > REVIEW_TABLE_ROW_CAP) {
      els.reviewTableBody.innerHTML += `<tr><td colspan="${mappedFields.length + 2}" class="text-center py-3 text-muted">Showing first ${REVIEW_TABLE_ROW_CAP.toLocaleString()} of ${filtered.length.toLocaleString()} matching rows. The full corrected data is included in the downloaded file.</td></tr>`;
    }
  }

  els.reviewTableBody.addEventListener('click', e => {
    const btn = e.target.closest('.ev-accept-btn, .ev-decline-btn, .ev-undo-btn');
    if (!btn) return;
    const rowIdx = Number(btn.getAttribute('data-row'));
    const fieldKey = btn.getAttribute('data-field');
    const fieldResult = state.processedRows[rowIdx] && state.processedRows[rowIdx].result.fields[fieldKey];
    if (!fieldResult) return;

    if (btn.classList.contains('ev-accept-btn')) fieldResult.resolution = 'accepted';
    else if (btn.classList.contains('ev-decline-btn')) fieldResult.resolution = 'declined';
    else fieldResult.resolution = null;

    renderDashboard();
    if (fieldKey === 'reportTo') renderReportToSummary();
    renderReviewTable();
  });

  function resolveAllPendingReviews(resolution) {
    let count = 0;
    state.processedRows.forEach(({ result }) => {
      Object.values(result.fields).forEach(f => {
        if (f.status === 'review' && !f.resolution) {
          f.resolution = resolution;
          count++;
        }
      });
    });
    if (count === 0) {
      showToast('No pending "Needs Review" items to resolve.', 'info');
      return;
    }
    renderDashboard();
    renderReportToSummary();
    renderReviewTable();
    showToast(`${resolution === 'accepted' ? 'Accepted' : 'Declined'} ${count} pending suggestion(s).`, 'success');
  }

  if (els.btnAcceptAllReviews) {
    els.btnAcceptAllReviews.addEventListener('click', () => resolveAllPendingReviews('accepted'));
  }
  if (els.btnDeclineAllReviews) {
    els.btnDeclineAllReviews.addEventListener('click', () => resolveAllPendingReviews('declined'));
  }

  els.btnBackToUploadFromReview.addEventListener('click', () => resetAll());

  /* ---------------------------------------------------------------------
     Import Valid Users to Database
     --------------------------------------------------------------------- */
  // Re-derives the ISO date from the row's ORIGINAL raw cell value (not the display
  // string in field.corrected, e.g. "23-May-02") using the exact same parseDOB() the
  // validator already proved this value parses with.
  function fieldToISODate(field) {
    if (!field) return null;
    const parsed = window.excelValidatorInternals && window.excelValidatorInternals.parseDOB
      ? window.excelValidatorInternals.parseDOB(field.original)
      : null;
    if (!parsed || isNaN(parsed.getTime())) return null;
    const y = parsed.getFullYear(), m = String(parsed.getMonth() + 1).padStart(2, '0'), d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function fieldValue(fields, key) {
    const f = fields[key];
    return f ? window.getEffectiveValue(f) : '';
  }

  // row-validator.js never produces a fields.gender result (it's not one of the
  // corrected/validated fields), so the raw mapped value has to be read and
  // normalized here instead of going through fieldValue()/getEffectiveValue().
  function normalizeGender(raw) {
    const norm = normalizeForMatch(raw);
    if (norm === 'M' || norm === 'MALE') return 'Male';
    if (norm === 'F' || norm === 'FEMALE') return 'Female';
    return null;
  }

  // Shapes one accepted row exactly like register_user()'s `p` argument (minus
  // agencyId/campaignId, fixed for the whole batch - see db-service.js
  // importUsersBatch()). Location fields are DB text[] columns; the Excel only ever
  // supplies one value per cell, so each becomes a single-element array (or empty).
  function buildImportRow(fields, mappedRaw) {
    const arrOrEmpty = key => {
      const v = fieldValue(fields, key);
      return v ? [v] : [];
    };
    return {
      name: fieldValue(fields, 'name'),
      gender: normalizeGender(mappedRaw.gender),
      fatherName: fieldValue(fields, 'fatherName') || '',
      motherName: fieldValue(fields, 'motherName') || '',
      mobile: fieldValue(fields, 'mobile'),
      email: fieldValue(fields, 'email'),
      dob: fieldToISODate(fields.dob),
      division: arrOrEmpty('division'),
      district: arrOrEmpty('district'),
      upazila: arrOrEmpty('upazila'),
      thana: arrOrEmpty('thana'),
      designation: fieldValue(fields, 'designation'),
      role: fieldValue(fields, 'role'),
      // fields.reportTo only exists when a Reference Excel was uploaded AND indexed -
      // without one, Report To passes straight through untouched, and
      // register_user()/_insert_registered_user() still resolves it against the real
      // Supervisor/FC list server-side.
      reportTo: (fields.reportTo ? fieldValue(fields, 'reportTo') : mappedRaw.reportTo) || null,
      nid: fieldValue(fields, 'nid') || ''
    };
  }

  function renderImportResults(importResult, acceptedEntries) {
    const { importedRows: imported = 0, failedRows: failed = 0, skipped = 0, total = 0 } = importResult;
    const tiles = [
      { label: 'Total Rows', value: total, cls: '' },
      { label: 'Imported', value: imported, cls: 'ev-tile-valid' },
      { label: 'Skipped (Invalid/Unresolved)', value: skipped, cls: 'ev-tile-review' },
      { label: 'Failed', value: failed, cls: 'ev-tile-invalid' }
    ];
    els.importSummary.innerHTML = tiles.map(t => `
      <div class="ev-dashboard-tile ${t.cls}">
        <div class="ev-dashboard-value">${t.value.toLocaleString()}</div>
        <div class="ev-dashboard-label">${t.label}</div>
      </div>
    `).join('');
    els.importSummary.style.display = 'grid';

    const byRowIndex = new Map((importResult.results || []).map(r => [r.rowIndex, r]));
    els.importResultsBody.innerHTML = acceptedEntries.map(({ rowIndex, name }) => {
      const r = byRowIndex.get(rowIndex);
      const outcome = r && r.success
        ? '<span class="ev-badge ev-badge-valid">Imported</span>'
        : '<span class="ev-badge ev-badge-invalid">Failed</span>';
      const detail = r && r.success ? (r.user_code || '') : (r ? r.error : 'No result returned.');
      return `<tr><td>${rowIndex + 1}</td><td>${escapeHtml(name)}</td><td>${outcome}</td><td>${escapeHtml(detail)}</td></tr>`;
    }).join('');
    els.importResultsWrap.style.display = 'block';
  }

  if (els.btnImport) {
    els.btnImport.addEventListener('click', async () => {
      if (!state.destinationAgencyId || !state.destinationCampaignId) {
        showToast('Please select a destination Agency and Campaign first.', 'danger');
        return;
      }
      if (!state.processedRows.length) {
        showToast('No validated data to import.', 'warning');
        return;
      }

      const acceptedEntries = [];
      const rows = [];
      let skipped = 0;
      state.processedRows.forEach((entry, rowIndex) => {
        const status = rowOverallStatus(entry.result);
        if (status === 'valid' || status === 'corrected') {
          acceptedEntries.push({ rowIndex, name: fieldValue(entry.result.fields, 'name') || `Row ${rowIndex + 1}` });
          rows.push(buildImportRow(entry.result.fields, rowToMappedObject(entry.raw)));
        } else {
          skipped++;
        }
      });

      if (rows.length === 0) {
        showToast('No Valid/Corrected rows to import - resolve or fix the flagged rows first.', 'danger');
        return;
      }

      els.btnImport.disabled = true;
      els.importProgressWrap.style.display = 'block';
      els.importProgressFill.style.width = '50%';

      try {
        const counts = {
          total: state.processedRows.length,
          valid: state.processedRows.filter(({ result }) => rowOverallStatus(result) === 'valid').length,
          corrected: state.processedRows.filter(({ result }) => rowOverallStatus(result) === 'corrected').length,
          invalid: state.processedRows.filter(({ result }) => rowOverallStatus(result) === 'invalid').length
        };
        const fileName = state.file ? state.file.name : 'import.xlsx';
        const result = await window.dbService.importUsersBatch(
          state.destinationAgencyId, state.destinationCampaignId, fileName, rows, counts
        );
        els.importProgressFill.style.width = '100%';
        state.importResult = { ...result, skipped, total: state.processedRows.length };
        renderImportResults(state.importResult, acceptedEntries);
        showToast(`Import complete: ${result.importedRows} imported, ${result.failedRows} failed, ${skipped} skipped.`, result.failedRows ? 'warning' : 'success');
      } catch (err) {
        showToast(err.message || 'Failed to import users.', 'danger');
      } finally {
        els.btnImport.disabled = false;
        els.importProgressWrap.style.display = 'none';
      }
    });
  }

  /* ---------------------------------------------------------------------
     Download Validation Report - a plain CSV audit copy.
     --------------------------------------------------------------------- */
  if (els.btnDownloadReport) {
    els.btnDownloadReport.addEventListener('click', () => {
      if (!state.processedRows.length) {
        showToast('No validated data to export.', 'warning');
        return;
      }
      const mappedFields = state.mapping.filter(m => m.field);
      const header = ['Row #', ...mappedFields.map(m => m.label), 'Row Status', 'Import Result'].map(csvCell);
      const importByRowIndex = new Map(((state.importResult && state.importResult.results) || []).map(r => [r.rowIndex, r]));

      const lines = [header.join(',')];
      state.processedRows.forEach((entry, i) => {
        const status = rowOverallStatus(entry.result);
        const r = importByRowIndex.get(i);
        const importResultText = !state.importResult ? 'Not Imported' : (r ? (r.success ? `Imported (${r.user_code})` : `Failed: ${r.error}`) : 'Skipped');
        const cells = [String(i + 1), ...mappedFields.map(m => displayValue(window.getEffectiveValue(entry.result.fields[m.field]))), status, importResultText];
        lines.push(cells.map(csvCell).join(','));
      });

      const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const baseName = (state.file && state.file.name ? state.file.name.replace(/\.[^.]+$/, '') : 'data');
      a.href = url;
      a.download = `${baseName}_ValidationReport.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast('Validation report downloaded.', 'success');
    });
  }

  function csvCell(value) {
    const str = String(value ?? '');
    return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  }

  els.btnDownload.addEventListener('click', () => {
    if (!state.processedRows.length) {
      showToast('No validated data to export.', 'warning');
      return;
    }
    try {
      const workbook = window.buildCorrectedWorkbook(state.headers, state.mapping, state.processedRows);
      const baseName = (state.file && state.file.name ? state.file.name.replace(/\.[^.]+$/, '') : 'data');
      window.downloadWorkbook(workbook, `${baseName}_Validated.xlsx`);
      showToast('Corrected Excel file downloaded.', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to generate the corrected file.', 'danger');
    }
  });

  // Called by js/app.js's switchTab() every time this view is opened, so the Agency
  // dropdown always reflects the latest master data (storage.loadAgenciesAndCampaigns()
  // runs at login, well before this module's own one-time DOMContentLoaded setup).
  window.refreshUserImportDestination = populateDestinationDropdowns;

  resetAll();
  populateDestinationDropdowns();
});
