/**
 * Excel Validator - UI Wiring
 * Drives the 4-step wizard (Upload -> Map Columns -> Validate -> Review & Download)
 * using column-mapper.js / row-validator.js / excel-io.js. Self-contained: does not
 * touch app.js's closure/state, only relies on the DOM ids in the "excel-validator"
 * view section and the globals exposed by the other excel-validator/*.js files.
 */
document.addEventListener('DOMContentLoaded', () => {
  const section = document.getElementById('view-excel-validator');
  if (!section) return; // markup not present - nothing to wire up

  const cfg = window.EXCEL_VALIDATOR_CONFIG || { AUTO_FIX_MIN: 95, REVIEW_MIN: 85, MAX_FILE_SIZE_MB: 15, BATCH_SIZE: 200 };

  const state = {
    file: null,
    headers: [],
    rawRows: [],
    mapping: [],
    processedRows: [],
    filter: 'all',
    referenceFile: null,
    referenceIndex: null
  };

  const els = {
    dropzone: document.getElementById('evDropzone'),
    fileInput: document.getElementById('evFileInput'),
    fileInfo: document.getElementById('evFileInfo'),
    fileName: document.getElementById('evFileName'),
    fileMeta: document.getElementById('evFileMeta'),
    btnRemoveFile: document.getElementById('evBtnRemoveFile'),
    uploadProgressWrap: document.getElementById('evUploadProgressWrap'),
    uploadProgressFill: document.getElementById('evUploadProgressFill'),
    btnToMapping: document.getElementById('evBtnToMapping'),

    mappingTableBody: document.getElementById('evMappingTableBody'),
    btnBackToUpload: document.getElementById('evBtnBackToUpload'),
    btnToValidate: document.getElementById('evBtnToValidate'),

    validateProgressFill: document.getElementById('evValidateProgressFill'),
    validateProgressText: document.getElementById('evValidateProgressText'),

    dashboard: document.getElementById('evDashboard'),
    filterBar: document.getElementById('evFilterBar'),
    reviewTableHead: document.getElementById('evReviewTableHead'),
    reviewTableBody: document.getElementById('evReviewTableBody'),
    btnBackToUploadFromReview: document.getElementById('evBtnBackToUploadFromReview'),
    btnDownload: document.getElementById('evBtnDownload'),
    btnAcceptAllReviews: document.getElementById('evBtnAcceptAllReviews'),
    btnDeclineAllReviews: document.getElementById('evBtnDeclineAllReviews'),

    refDropzone: document.getElementById('evRefDropzone'),
    refFileInput: document.getElementById('evRefFileInput'),
    refFileInfo: document.getElementById('evRefFileInfo'),
    refFileName: document.getElementById('evRefFileName'),
    refFileMeta: document.getElementById('evRefFileMeta'),
    btnRemoveRefFile: document.getElementById('evBtnRemoveRefFile'),
    refUploadProgressWrap: document.getElementById('evRefUploadProgressWrap'),
    refUploadProgressFill: document.getElementById('evRefUploadProgressFill'),
    reportToSummary: document.getElementById('evReportToSummary'),
    btnToggleReportToLog: document.getElementById('evBtnToggleReportToLog'),
    reportToChangeLogWrap: document.getElementById('evReportToChangeLogWrap'),
    reportToChangeLogBody: document.getElementById('evReportToChangeLogBody')
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
    document.querySelectorAll('.ev-panel').forEach(p => p.classList.remove('active'));
    const panel = document.getElementById('evPanel' + stepName.charAt(0).toUpperCase() + stepName.slice(1));
    if (panel) panel.classList.add('active');

    const order = ['upload', 'mapping', 'validate', 'review'];
    const activeIdx = order.indexOf(stepName);
    document.querySelectorAll('.ev-step-dot').forEach(dot => {
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
    setStep('upload');
  }

  /* ---------------------------------------------------------------------
     Step 1: Upload
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
     Fully independent of the main upload above - skipping this section
     entirely leaves Workflow A (no reference file) unaffected.
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
     Step 2: Column Mapping
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
          <td><select class="form-control ev-mapping-select" data-index="${i}">${options}</select></td>
          <td><span class="ev-confidence-badge ${confClass}">${m.field ? m.confidenceLevel : 'Unmapped'}</span></td>
        </tr>`;
    }).join('');

    els.mappingTableBody.querySelectorAll('.ev-mapping-select').forEach(select => {
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

  // Agency/Campaign are DB-backed admin-managed master data (unlike the static
  // BD_LOCATIONS/fixed Role-Designation enum already baked into the page) - this is the
  // one deliberate, minimal exception to this module's "fully offline" design. app.js
  // already loads the full Agency/Campaign lists once at startup (see storage.js
  // loadAgenciesAndCampaigns()) for its own dropdowns/filters, so this reuses that
  // already-cached data instead of making a fresh network call - genuinely zero extra
  // requests, and never per-row.
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
    setStep('validate');
    runValidation();
  });

  /* ---------------------------------------------------------------------
     Step 3: Validate (batched so the tab stays responsive on large files)
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

  function finishValidation() {
    renderDashboard();
    renderReportToSummary();
    renderReviewTable();
    setStep('review');
  }

  /* ---------------------------------------------------------------------
     Step 4: Review & Download
     --------------------------------------------------------------------- */
  // Re-derives the row's overall status from its fields every time (rather than trusting a
  // stored value) because accept/decline mutates a field's `resolution` in place after the
  // initial validation pass - the status must reflect the user's latest decisions.
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

  // Human-readable labels for reference-matcher.js's matchingMethod enum (spec #13),
  // shared by the correction-note card and the Change Log table.
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

  // Change History status label for one Report To field result (spec #2/#7) - distinct
  // from the generic field status ('valid'/'corrected'/'review'/'invalid') because the
  // audit trail needs to say "Accepted (Auto)" for an already-applied auto-fix, not just
  // "Corrected". Returns null for rows that don't belong in the Change Log at all (no
  // match attempted, or already an exact match with nothing to record).
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
    return null; // exact-match-unchanged ("Valid.") or no confident match - nothing to log
  }

  // Summary of Report To reference matching (spec #8/#25) - only rendered when both a
  // Reference Excel was uploaded and Report To was actually mapped on the Main Excel;
  // otherwise stays hidden (Workflow A keeps the review screen exactly as before).
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
      if (!f.matchingMethod && !f.warning) noMatch++; // no confident match at all (ambiguous/possible tracked in the change log instead)
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

  // Detailed Report To Change Log (spec #9) - every row where a correction was suggested,
  // applied, or flagged (possible/ambiguous), so the user can audit the full history
  // before downloading. Exact matches and "no match found" rows need no action, so they're
  // left out of this table (they still count in the summary tiles above).
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
      // A syntactically valid but unusual-looking value (currently only the Smart Email
      // Validation Engine sets this - see js/email-validator.js) stays 'valid' (never
      // blocked, never auto-changed) but still surfaces its warning as a hover tooltip.
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

    // status === 'review': needs an explicit user decision - show the suggested change plus
    // Accept/Decline (or, once resolved, the outcome and an Undo link back to unresolved).
    const target = escapeHtml(displayValue(fieldResult.suggested));

    // Report To Correction Note: just the plain "Original -> Suggested" change, same
    // compact shape as every other field's review diff. The full reason/matching
    // method/source (spec #2/#12) are still there on hover and in the Report To Change
    // Log (spec #9) for anyone who wants the detail - they're just not forced into view here.
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

    // Build with explicit original index for correct row numbering
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

  // Event delegation: the review table body is fully re-rendered on every change, so binding
  // once here (rather than per-button, per-render) avoids piling up detached listeners.
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

  resetAll();
});
