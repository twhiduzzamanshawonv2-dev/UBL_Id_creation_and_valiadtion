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
   * Builds the corrected workbook: original columns + original row order/values preserved,
   * auto-corrected cells (confidence >= AUTO_FIX_MIN) overwritten in place, plus three
   * appended columns (Validation Status / Correction Status / Validation Remarks). The
   * mapped Mobile Number column is forced to a text cell type so a restored leading zero
   * survives the download, mirroring the existing Admin export (js/app.js).
   */
  function buildCorrectedWorkbook(originalHeaders, mapping, processedRows) {
    const headers = [...originalHeaders, 'Validation Status', 'Correction Status', 'Validation Remarks'];
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

  if (typeof window !== 'undefined') {
    window.readWorkbookFile = readWorkbookFile;
    window.buildCorrectedWorkbook = buildCorrectedWorkbook;
    window.downloadWorkbook = downloadWorkbook;
  }
})();
