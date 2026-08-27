/**
 * Excel Validator - Intelligent Column Detection
 * Maps arbitrary uploaded spreadsheet headers (e.g. "Full Name", "Mobile No",
 * "Consumer Name") onto the system's standard fields, using the same
 * normalization/fuzzy-matching helpers as the rest of the module (fuzzy-match.js).
 */
(function () {
  const FIELD_DEFINITIONS = [
    { field: 'name', label: 'Name', synonyms: ['NAME', 'FULL NAME', 'CONSUMER NAME', 'EMPLOYEE NAME', 'APPLICANT NAME', 'USER NAME'] },
    { field: 'fatherName', label: "Father's Name", synonyms: ["FATHERS NAME", 'FATHER NAME', 'FATHER'] },
    { field: 'motherName', label: "Mother's Name", synonyms: ["MOTHERS NAME", 'MOTHER NAME', 'MOTHER'] },
    { field: 'gender', label: 'Gender', synonyms: ['GENDER', 'SEX'] },
    { field: 'mobile', label: 'Phone Number', synonyms: ['MOBILE', 'MOBILE NO', 'MOBILE NUMBER', 'PHONE', 'PHONE NUMBER', 'CONTACT NUMBER', 'CONTACT NO', 'CELL', 'CELL NUMBER', 'CELL PHONE'] },
    { field: 'email', label: 'Email', synonyms: ['EMAIL', 'EMAIL ADDRESS', 'E MAIL'] },
    { field: 'dob', label: 'Date of Birth', synonyms: ['DOB', 'DATE OF BIRTH', 'BIRTH DATE', 'BIRTHDATE'] },
    { field: 'division', label: 'Division', synonyms: ['DIVISION'] },
    { field: 'district', label: 'District', synonyms: ['DISTRICT', 'ZILA'] },
    { field: 'upazila', label: 'Upazila', synonyms: ['UPAZILA', 'UPAZILLA'] },
    { field: 'thana', label: 'Thana', synonyms: ['THANA', 'POLICE STATION', 'THANA UPAZILA'] },
    { field: 'designation', label: 'Designation', synonyms: ['DESIGNATION', 'POST', 'POSITION'] },
    { field: 'role', label: 'Role', synonyms: ['ROLE'] },
    { field: 'nid', label: 'NID Number', synonyms: ['NID', 'NID NUMBER', 'NATIONAL ID', 'NID NO'] },
    { field: 'reportTo', label: 'Report To', synonyms: ['REPORT TO', 'REPORTING TO'] }
  ];

  const HIGH_CONFIDENCE_SCORE = 95;
  const MEDIUM_CONFIDENCE_MIN = 78;
  const LOW_CONFIDENCE_MIN = 60;

  function confidenceLevel(score) {
    if (score >= HIGH_CONFIDENCE_SCORE) return 'High';
    if (score >= MEDIUM_CONFIDENCE_MIN) return 'Medium';
    if (score >= LOW_CONFIDENCE_MIN) return 'Low';
    return 'None';
  }

  /**
   * Best (field, score) for a single uploaded header, scanning every synonym of
   * every field definition and keeping the single best score found.
   */
  function bestFieldForHeader(header) {
    let best = null;
    let bestScore = -1;
    FIELD_DEFINITIONS.forEach(def => {
      def.synonyms.forEach(syn => {
        const score = similarityScore(header, syn);
        if (score > bestScore) {
          bestScore = score;
          best = def;
        }
      });
    });
    return best ? { field: best.field, label: best.label, score: bestScore } : null;
  }

  /**
   * Maps an array of uploaded headers to standard fields. Returns an ordered array
   * (same order/length as `headers`) of:
   *   { column, index, field, label, confidence, confidenceLevel }
   * `field`/`label` are null when nothing confidently matched (LOW_CONFIDENCE_MIN not met)
   * or the best-matching field was already claimed by an earlier (higher-scoring) column -
   * those rows need manual mapping in the UI.
   */
  function mapColumns(headers) {
    const candidates = headers.map((header, index) => {
      const best = bestFieldForHeader(header);
      return {
        column: header,
        index,
        field: best ? best.field : null,
        label: best ? best.label : null,
        confidence: best ? best.score : 0
      };
    });

    // Resolve conflicts (two columns mapping to the same field) by giving the field to
    // the highest-scoring column only; the loser falls back to unmapped for manual review.
    const claimedBy = new Map(); // field -> candidate index (into `candidates`)
    candidates
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.field && c.confidence >= LOW_CONFIDENCE_MIN)
      .sort((a, b) => b.c.confidence - a.c.confidence)
      .forEach(({ c, i }) => {
        if (!claimedBy.has(c.field)) {
          claimedBy.set(c.field, i);
        }
      });

    return candidates.map((c, i) => {
      const won = c.field && claimedBy.get(c.field) === i;
      return {
        column: c.column,
        index: c.index,
        field: won ? c.field : null,
        label: won ? c.label : null,
        confidence: won ? c.confidence : 0,
        confidenceLevel: won ? confidenceLevel(c.confidence) : 'None'
      };
    });
  }

  if (typeof window !== 'undefined') {
    window.EXCEL_FIELD_DEFINITIONS = FIELD_DEFINITIONS;
    window.mapColumns = mapColumns;
  }
})();
