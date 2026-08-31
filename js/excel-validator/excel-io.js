/**
 * Excel Validator - File Import/Export
 * Uses the SheetJS (XLSX) global already loaded by index.html for the
 * existing Admin export feature - reused here for both import and export,
 * no new dependency added.
 */
(function () {
  /**
   * Reads an uploaded .xlsx/.xls/.csv File into { headers, rows, duplicateHeaders, sheetName }.
   * `raw: true` keeps text cells as strings (so a leading zero typed as text survives) while
   * date-typed cells come through as JS Date objects (via cellDates) and numeric cells as
   * numbers - exactly the shapes row-validator.js's field correctors expect.
   */
  function readWorkbookFile(file, onProgress) {
    return new Promise((resolve, reject) => {
      if (typeof XLSX === 'undefined') {
        reject(new Error('The Excel engine failed to load. Please check your connection and reload the page.'));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read the file. It may be corrupted.'));
      if (typeof onProgress === 'function') {
        reader.onprogress = event => {
          if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
        };
      }
      reader.onload = event => {
        try {
          if (typeof onProgress === 'function') onProgress(100);
          const data = new Uint8Array(event.target.result);
          const workbook = XLSX.read(data, { type: 'array', cellDates: true });
          if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
            reject(new Error('The uploaded file has no worksheets.'));
            return;
          }
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
          if (!rows || rows.length === 0) {
            reject(new Error('The uploaded file is empty.'));
            return;
          }

          const headerRow = rows[0].map(h => (h === undefined || h === null) ? '' : String(h).trim());
          if (headerRow.every(h => h === '')) {
            reject(new Error('No column headers were found in the first row.'));
            return;
          }

          const dataRows = rows.slice(1).filter(r => r.some(cell => String(cell).trim() !== ''));

          const seenCounts = new Map();
          headerRow.forEach(h => {
            const norm = h.toLowerCase();
            if (!norm) return;
            seenCounts.set(norm, (seenCounts.get(norm) || 0) + 1);
          });
          const duplicateHeaders = [...seenCounts.entries()].filter(([, count]) => count > 1).map(([name]) => name);

          resolve({ headers: headerRow, rows: dataRows, duplicateHeaders, sheetName: workbook.SheetNames[0] });
        } catch (err) {
          reject(new Error('Could not parse this file. Please make sure it is a valid Excel (.xlsx/.xls) or CSV file.'));
        }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * Report To Correction Notes (spec #10/#11): a dedicated, human-readable note per row
   * describing exactly what happened to the Report To value - distinct from the generic,
   * all-fields "Validation Remarks" column, since a reader specifically auditing Report To
   * corrections shouldn't have to pick that field's text out of every other field's. Never
   * loses the original value (spec #18): it's always quoted inside the note text, even
   * when the Excel structure doesn't get a dedicated "Original Report To" column (spec #11
   * - only added when it wouldn't disrupt the existing single-column-per-field export).
   */
  function reportToChangeNote(f) {
    if (!f) return '';
    if (f.status === 'corrected') {
      const appliedBy = 'auto-applied';
      return `Changed from "${f.original}" to "${f.corrected}". ${f.reason || ''} Confidence: ${f.confidence}%. (${appliedBy}, source: ${f.source || 'Reference Excel'})`.trim();
    }
    if (f.status === 'review') {
      if (f.resolution === 'accepted') {
        return `Changed from "${f.original}" to "${f.suggested}". ${f.reason || ''} Confidence: ${f.confidence}%. (accepted by user, source: ${f.source || 'Reference Excel'})`.trim();
      }
      if (f.resolution === 'declined') {
        return `Suggested "${f.suggested}" (confidence ${f.confidence}%) was declined - original value "${f.original}" kept. ${f.reason || ''}`.trim();
      }
      return `Pending suggestion: "${f.suggested}" (confidence ${f.confidence}%). ${f.reason || ''}`.trim();
    }
    if (f.warning && f.matchingMethod) {
      return `Possible match found (confidence ${f.confidence}%) but not confident enough to apply automatically. ${f.reason || ''}`.trim();
    }
    if (f.warning && !f.matchingMethod) {
      return f.message || 'Multiple possible matches found - please review manually.';
    }
    return 'No change.';
  }

  /**
   * Builds the corrected workbook: original columns + original row order/values preserved,
   * auto-corrected cells (confidence >= AUTO_FIX_MIN) overwritten in place, plus three
   * appended columns (Validation Status / Correction Status / Validation Remarks), and -
   * only when a Report To column was mapped AND a Reference Excel was actually used - a
   * fourth "Report To Change Note" column (omitted entirely otherwise, so a run without a
   * Reference Excel exports byte-for-byte the same columns as before this feature existed).
   * The mapped Mobile Number column is forced to a text cell type so a restored leading
   * zero survives the download, mirroring the existing Admin export (js/app.js).
   */
  function buildCorrectedWorkbook(originalHeaders, mapping, processedRows) {
    const includeReportToNote = mapping.some(m => m.field === 'reportTo') &&
      processedRows.some(({ result }) => !!result.fields.reportTo);

    const headers = [...originalHeaders, 'Validation Status', 'Correction Status', 'Validation Remarks']
      .concat(includeReportToNote ? ['Report To Change Note'] : []);
    const aoa = [headers];

    const mobileMapping = mapping.find(m => m.field === 'mobile');

    processedRows.forEach(({ raw, result }) => {
      const outRow = raw.slice();
      while (outRow.length < originalHeaders.length) outRow.push('');

      mapping.forEach(m => {
        if (!m.field) return;
        const fieldResult = result.fields[m.field];
        if (!fieldResult) return;
        const effStatus = window.getEffectiveStatus(fieldResult);
        // Date of Birth's DD-Mon-YY output format is mandatory, not just a "when something
        // changed" correction - always write it as formatted text so an Excel-native Date
        // cell (which row-validator.js may leave at status 'valid' since nothing about its
        // *meaning* changed) never survives into the export as a raw date value.
        if (m.field === 'dob') {
          if (effStatus !== 'invalid') outRow[m.index] = window.getEffectiveValue(fieldResult);
          return;
        }
        if (effStatus === 'corrected') {
          outRow[m.index] = window.getEffectiveValue(fieldResult);
        }
      });

      const effStatuses = Object.values(result.fields).map(f => window.getEffectiveStatus(f));
      const validationStatus = effStatuses.includes('invalid') ? 'Invalid' : effStatuses.includes('review') ? 'Needs Review' : 'Valid';
      const correctionStatus = window.getEffectiveCorrectionCount(result) > 0 ? 'Corrected' : 'No Change';

      const remarks = Object.values(result.fields)
        .filter(f => window.getEffectiveStatus(f) !== 'valid' || f.status === 'review')
        .map(f => window.getEffectiveMessage(f))
        .join(' ') || 'All fields valid.';

      outRow.push(validationStatus, correctionStatus, remarks);
      if (includeReportToNote) outRow.push(reportToChangeNote(result.fields.reportTo));
      aoa.push(outRow);
    });

    const worksheet = XLSX.utils.aoa_to_sheet(aoa);
    if (mobileMapping) {
      const colLetter = XLSX.utils.encode_col(mobileMapping.index);
      for (let i = 0; i < processedRows.length; i++) {
        const cell = worksheet[colLetter + (i + 2)];
        if (cell) {
          cell.t = 's';
          cell.z = '@';
        }
      }
    }

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Validated Data');
    return workbook;
  }

  function downloadWorkbook(workbook, filename) {
    XLSX.writeFile(workbook, filename);
  }

  /**
   * Reads an uploaded Reference Excel/CSV File into { sheets: [{ name, headers, rows }], sheetNames }.
   * Unlike readWorkbookFile, every sheet is parsed (spec #16 - multi-sheet reference files),
   * since the Reference file's structure isn't assumed - reference-matcher.js decides per
   * sheet whether a usable Name column exists. A sheet with no data still comes back (with
   * empty headers/rows) rather than failing the whole file; only a genuinely unreadable or
   * worksheet-less file is rejected.
   */
  function readReferenceWorkbookFile(file, onProgress) {
    return new Promise((resolve, reject) => {
      if (typeof XLSX === 'undefined') {
        reject(new Error('The Excel engine failed to load. Please check your connection and reload the page.'));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read the reference file. It may be corrupted.'));
      if (typeof onProgress === 'function') {
        reader.onprogress = event => {
          if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
        };
      }
      reader.onload = event => {
        try {
          if (typeof onProgress === 'function') onProgress(100);
          const data = new Uint8Array(event.target.result);
          const workbook = XLSX.read(data, { type: 'array', cellDates: true });
          if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
            reject(new Error('The reference file has no worksheets.'));
            return;
          }
          const sheets = workbook.SheetNames.map(name => {
            const sheet = workbook.Sheets[name];
            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
            if (!rows || rows.length === 0) return { name, headers: [], rows: [] };
            const headerRow = rows[0].map(h => (h === undefined || h === null) ? '' : String(h).trim());
            const dataRows = rows.slice(1).filter(r => r.some(cell => String(cell).trim() !== ''));
            return { name, headers: headerRow, rows: dataRows };
          });
          resolve({ sheets, sheetNames: workbook.SheetNames });
        } catch (err) {
          reject(new Error('Could not parse the reference file. Please make sure it is a valid Excel (.xlsx/.xls) or CSV file.'));
        }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  if (typeof window !== 'undefined') {
    window.readWorkbookFile = readWorkbookFile;
    window.buildCorrectedWorkbook = buildCorrectedWorkbook;
    window.downloadWorkbook = downloadWorkbook;
    window.readReferenceWorkbookFile = readReferenceWorkbookFile;
  }
})();
