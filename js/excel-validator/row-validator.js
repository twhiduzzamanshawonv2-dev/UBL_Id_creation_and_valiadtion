/**
 * Excel Validator - Per-Row Validation & Correction Pipeline
 * Reuses the existing field validators (js/validation.js) and master data
 * (js/bd-locations.js / js/storage.js, via master-index.js) as the source of
 * truth, and layers confidence-scored fuzzy correction on top for free-text
 * fields (location, designation, role). No field is auto-corrected below
 * EXCEL_VALIDATOR_CONFIG.AUTO_FIX_MIN confidence.
 */
(function () {
  function isBlank(v) {
    return v === undefined || v === null || String(v).trim() === '';
  }

  /** Applies the 95/85 confidence thresholds to a fuzzy match result. */
  function classifyFuzzyResult(raw, matchedValue, score, label) {
    const cfg = window.EXCEL_VALIDATOR_CONFIG;
    if (score >= cfg.AUTO_FIX_MIN) {
      return {
        original: raw,
        corrected: matchedValue,
        suggested: matchedValue,
        confidence: score,
        status: matchedValue === String(raw).trim() ? 'valid' : 'corrected',
        message: matchedValue === String(raw).trim()
          ? 'Valid.'
          : `${label} auto-corrected from "${raw}" to "${matchedValue}" (confidence ${score}%).`,
        resolution: null
      };
    }
    if (score >= cfg.REVIEW_MIN) {
      return {
        original: raw,
        corrected: raw,
        suggested: matchedValue,
        confidence: score,
        status: 'review',
        message: `${label} possible match "${matchedValue}" (confidence ${score}%) - needs manual review.`,
        resolution: null
      };
    }
    return {
      original: raw,
      corrected: raw,
      suggested: null,
      confidence: score,
      status: 'invalid',
      message: `${label} could not be confidently matched against the master list (confidence ${score}%).`,
      resolution: null
    };
  }

  /* ---------------------------------------------------------------------
     User accept/decline resolution for 'review'-status fields (85-94%
     confidence: suggested but never auto-applied). These compute the
     EFFECTIVE status/value/message for a field given whatever the user has
     decided so far, without mutating the original match result - used
     everywhere a field is displayed, rolled up into a row status, or
     exported, so accepting/declining a suggestion updates all of those
     consistently and can be freely undone (resolution just goes back to null).
     --------------------------------------------------------------------- */
  function getEffectiveStatus(f) {
    if (!f) return 'valid';
    if (f.status === 'review') {
      if (f.resolution === 'accepted') return 'corrected';
      if (f.resolution === 'declined') return 'valid';
      return 'review';
    }
    return f.status;
  }

  function getEffectiveValue(f) {
    if (!f) return '';
    if (f.status === 'review') {
      return f.resolution === 'accepted' ? f.suggested : f.original;
    }
    return (f.status === 'corrected' || f.status === 'valid') ? f.corrected : f.original;
  }

  function getEffectiveMessage(f) {
    if (!f) return '';
    if (f.status === 'review') {
      if (f.resolution === 'accepted') return `${f.message} Accepted by user.`;
      if (f.resolution === 'declined') return `${f.message} Declined by user - original value kept.`;
    }
    return f.message;
  }

  const ROW_STATUS_ORDER = { invalid: 3, review: 2, corrected: 1, valid: 0 };

  function getEffectiveRowStatus(result) {
    let rowStatus = 'valid';
    Object.values(result.fields).forEach(f => {
      const s = getEffectiveStatus(f);
      if (ROW_STATUS_ORDER[s] > ROW_STATUS_ORDER[rowStatus]) rowStatus = s;
    });
    return rowStatus;
  }

  function getEffectiveCorrectionCount(result) {
    return Object.values(result.fields).filter(f => getEffectiveStatus(f) === 'corrected').length;
  }

  /* ---------------------------------------------------------------------
     Name / Father's Name / Mother's Name - reuses validateName/formatTitleCase
     --------------------------------------------------------------------- */
  function correctNameField(raw, label) {
    if (isBlank(raw)) {
      return { original: raw || '', corrected: '', suggested: null, confidence: 100, status: 'invalid', message: `${label} is empty.`, resolution: null };
    }
    const result = window.validateName(raw, label);
    if (!result.valid) {
      return { original: raw, corrected: raw, suggested: null, confidence: 0, status: 'invalid', message: result.message, resolution: null };
    }
    const changed = result.cleanValue !== String(raw).trim();
    return {
      original: raw,
      corrected: result.cleanValue,
      suggested: changed ? result.cleanValue : null,
      confidence: 100,
      status: changed ? 'corrected' : 'valid',
      message: changed ? `${label} formatted to standard case/spacing.` : 'Valid.',
      resolution: null
    };
  }

  /* ---------------------------------------------------------------------
     Mobile Number - reuses validateMobile. Leading zero is never stripped;
     the common "Excel dropped the leading 0 because the cell was numeric"
     failure mode is detected and repaired before validating.
     --------------------------------------------------------------------- */
  function correctMobileField(raw) {
    if (isBlank(raw)) {
      return { original: raw || '', corrected: '', suggested: null, confidence: 100, status: 'invalid', message: 'Mobile Number is empty.', resolution: null };
    }
    const trimmed = String(raw).trim();
    let candidate = trimmed.replace(/[\s-]/g, '');
    candidate = candidate.replace(/^\+?880/, '0'); // strip BD country code
    if (/^1[3-9]\d{8}$/.test(candidate)) {
      candidate = '0' + candidate; // restore a leading zero dropped by numeric Excel cells
    }
    const result = window.validateMobile(candidate);
    if (result.valid) {
      const changed = result.cleanValue !== trimmed;
      return {
        original: raw,
        corrected: result.cleanValue,
        suggested: changed ? result.cleanValue : null,
        confidence: 100,
        status: changed ? 'corrected' : 'valid',
        message: changed ? 'Mobile Number normalized (leading zero / formatting restored).' : 'Valid.',
        resolution: null
      };
    }
    return { original: raw, corrected: raw, suggested: null, confidence: 0, status: 'invalid', message: result.message, resolution: null };
  }

  /* ---------------------------------------------------------------------
     Date of Birth - parses common formats + Excel date serials, then reuses
     validateMinimumAge/calculateAge for the existing 18+ rule. Every valid
     date is mandatorily normalized to DD-Mon-YY (e.g. "23-May-02") on output -
     the same display format the existing system already uses for Date of
     Birth in its own Excel export (see formatDisplayDate in js/app.js).
     --------------------------------------------------------------------- */
  const DOB_MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function pad2(n) { return String(n).padStart(2, '0'); }

  function toISODate(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function formatDOBDisplay(d) {
    return `${pad2(d.getDate())}-${DOB_MONTH_NAMES[d.getMonth()]}-${String(d.getFullYear()).slice(-2)}`;
  }

  function parseDOB(raw) {
    if (raw instanceof Date && !isNaN(raw.getTime())) return raw;
    if (typeof raw === 'number' && isFinite(raw)) {
      // Excel serial date (days since 1899-12-30), in case cellDates wasn't applied.
      const epoch = new Date(Date.UTC(1899, 11, 30));
      const d = new Date(epoch.getTime() + raw * 86400000);
      return isNaN(d.getTime()) ? null : new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    }
    const str = String(raw).trim();
    if (!str) return null;

    let m = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));

    m = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (m) {
      let day = Number(m[1]);
      let month = Number(m[2]);
      const year = Number(m[3]);
      if (month > 12 && day <= 12) { const t = day; day = month; month = t; } // MM/DD -> swap to DD/MM
      return new Date(year, month - 1, day);
    }

    const native = new Date(str);
    return isNaN(native.getTime()) ? null : native;
  }

  function correctDOBField(raw) {
    if (isBlank(raw)) {
      return { original: raw || '', corrected: '', suggested: null, confidence: 100, status: 'invalid', message: 'Date of Birth is empty (mandatory field).', resolution: null };
    }
    const parsed = parseDOB(raw);
    if (!parsed || isNaN(parsed.getTime())) {
      return { original: raw, corrected: raw, suggested: null, confidence: 0, status: 'invalid', message: 'Unrecognized Date of Birth format.', resolution: null };
    }
    const now = new Date();
    if (parsed.getTime() > now.getTime()) {
      return { original: raw, corrected: raw, suggested: null, confidence: 0, status: 'invalid', message: 'Date of Birth is in the future.', resolution: null };
    }
    if (parsed.getFullYear() < 1900) {
      return { original: raw, corrected: raw, suggested: null, confidence: 0, status: 'invalid', message: 'Date of Birth is not a plausible date.', resolution: null };
    }

    const iso = toISODate(parsed);
    const ageResult = window.validateMinimumAge(iso);

    if (!ageResult.valid) {
      return { original: raw, corrected: raw, suggested: null, confidence: 100, status: 'invalid', message: ageResult.message, resolution: null };
    }

    // Valid - mandatorily normalized to DD-Mon-YY, regardless of the source format.
    const display = formatDOBDisplay(parsed);
    const rawStr = raw instanceof Date ? formatDOBDisplay(raw) : String(raw).trim();
    const changed = display !== rawStr;
    return {
      original: raw,
      corrected: display,
      suggested: changed ? display : null,
      confidence: 100,
      status: changed ? 'corrected' : 'valid',
      message: changed ? `Date of Birth formatted to ${display}.` : 'Valid.',
      resolution: null
    };
  }

  /* ---------------------------------------------------------------------
     Designation / Role - exact/synonym match first, then fuzzy against the
     fixed enum only (never invents a new value).
     --------------------------------------------------------------------- */
  function correctEnumField(raw, label) {
    if (isBlank(raw)) {
      return { original: raw || '', corrected: '', suggested: null, confidence: 100, status: 'invalid', message: `${label} is empty.`, resolution: null };
    }
    const idx = window.getDesignationRoleIndex();
    const norm = normalizeForMatch(raw);
    if (idx.exact.has(norm)) {
      const canonical = idx.exact.get(norm);
      const changed = canonical !== String(raw).trim();
      return {
        original: raw,
        corrected: canonical,
        suggested: changed ? canonical : null,
        confidence: 100,
        status: changed ? 'corrected' : 'valid',
        message: changed ? `${label} matched to "${canonical}".` : 'Valid.',
        resolution: null
      };
    }
    const best = findBestMatch(raw, idx.values);
    if (!best || !best.candidate) {
      return { original: raw, corrected: raw, suggested: null, confidence: 0, status: 'invalid', message: `Unrecognized ${label} value.`, resolution: null };
    }
    return classifyFuzzyResult(raw, best.candidate, best.score, label);
  }

  /* ---------------------------------------------------------------------
     Agency -> Campaign - same top-down, scoped-candidate-pool, parent-
     inference shape as the Location hierarchy below (just 2 levels instead
     of 4). Only Active Agencies/Campaigns are ever offered as match targets
     (see buildAgencyCampaignIndex in master-index.js).
     --------------------------------------------------------------------- */
  function matchAgencyCampaignHierarchy(raw) {
    const idx = window.getAgencyCampaignIndex();
    const cfg = window.EXCEL_VALIDATOR_CONFIG;
    const out = {};

    // Agency
    const agencyMatch = matchLevel(raw.agency, idx.agencies);
    out.agency = toFieldResult(raw.agency, agencyMatch, 'Agency');
    let effAgency = (!agencyMatch.empty && agencyMatch.matched && agencyMatch.score >= cfg.REVIEW_MIN) ? agencyMatch.matched : null;

    // Campaign - scoped to Agency when known, else the full deduped campaign list
    let campaignScope = effAgency ? idx.getCampaigns(effAgency) : idx.allCampaignNames;
    let campaignMatch = matchLevel(raw.campaign, campaignScope);

    if (!effAgency && !campaignMatch.empty && campaignMatch.matched && campaignMatch.score >= cfg.AUTO_FIX_MIN) {
      const owners = idx.campaignByNameOnly.get(normalizeForMatch(campaignMatch.matched)) || [];
      if (owners.length === 1) {
        effAgency = owners[0].agency;
        out.agency = inferredResult(raw.agency, effAgency, campaignMatch.score, 'Agency', `Campaign "${campaignMatch.matched}"`);
        campaignScope = idx.getCampaigns(effAgency);
        campaignMatch = matchLevel(raw.campaign, campaignScope);
      }
    }
    out.campaign = toFieldResult(raw.campaign, campaignMatch, 'Campaign');

    return out;
  }

  /* ---------------------------------------------------------------------
     Location Hierarchy - Division -> District -> Upazila -> Thana.
     Matches top-down, scoping each level's candidate pool to the already-
     matched parent (fast: only a handful of candidates, not the full
     523/685-entry lists). When a parent can't be confidently matched but a
     child matches uniquely and strongly, the parent chain is inferred from
     the child (so "Division=Dhaka, District=Gazipur, Upazila=Sreepur" style
     hierarchy mistakes get caught, not just single-field typos).
     --------------------------------------------------------------------- */
  function matchLevel(raw, candidateNames) {
    if (isBlank(raw)) return { empty: true };
    if (!candidateNames || candidateNames.length === 0) return { matched: null, score: 0 };
    const norm = normalizeForMatch(raw);
    for (const name of candidateNames) {
      if (normalizeForMatch(name) === norm) return { matched: name, score: 100 };
    }
    const best = findBestMatch(raw, candidateNames);
    return { matched: best.candidate, score: best.score };
  }

  function toFieldResult(raw, matchResult, label) {
    if (matchResult.empty) {
      return { original: raw || '', corrected: '', suggested: null, confidence: 100, status: 'invalid', message: `${label} is empty.`, resolution: null };
    }
    if (!matchResult.matched) {
      return { original: raw, corrected: raw, suggested: null, confidence: 0, status: 'invalid', message: `${label} could not be matched against the master location list.`, resolution: null };
    }
    return classifyFuzzyResult(raw, matchResult.matched, matchResult.score, label);
  }

  function inferredResult(raw, inferredValue, score, label, reasonLabel) {
    return {
      original: raw,
      corrected: inferredValue,
      suggested: inferredValue,
      confidence: score,
      status: 'corrected',
      message: `${label} inferred as "${inferredValue}" from the matched ${reasonLabel}.`,
      resolution: null
    };
  }

  function matchLocationHierarchy(raw) {
    const idx = window.getLocationIndex();
    const cfg = window.EXCEL_VALIDATOR_CONFIG;
    const out = {};

    // Division
    const divMatch = matchLevel(raw.division, idx.divisions);
    out.division = toFieldResult(raw.division, divMatch, 'Division');
    let effDivision = (!divMatch.empty && divMatch.matched && divMatch.score >= cfg.REVIEW_MIN) ? divMatch.matched : null;

    // District - scoped to division when known, else the full deduped district list
    let districtScope = effDivision ? idx.getDistricts(effDivision) : idx.allDistrictNames;
    let distMatch = matchLevel(raw.district, districtScope);

    if (!effDivision && !distMatch.empty && distMatch.matched && distMatch.score >= cfg.AUTO_FIX_MIN) {
      const owners = idx.districtByNameOnly.get(normalizeForMatch(distMatch.matched)) || [];
      if (owners.length === 1) {
        effDivision = owners[0].division;
        out.division = inferredResult(raw.division, effDivision, distMatch.score, 'Division', `District "${distMatch.matched}"`);
        districtScope = idx.getDistricts(effDivision);
        distMatch = matchLevel(raw.district, districtScope);
      }
    }
    out.district = toFieldResult(raw.district, distMatch, 'District');
    let effDistrict = (!distMatch.empty && distMatch.matched && distMatch.score >= cfg.REVIEW_MIN) ? distMatch.matched : null;

    // Upazila - scoped to division+district when both known, else the full deduped list
    let upazilaScope = (effDivision && effDistrict) ? idx.getUpazilas(effDivision, effDistrict) : idx.allUpazilaNames;
    let upzMatch = matchLevel(raw.upazila, upazilaScope);

    if ((!effDivision || !effDistrict) && !upzMatch.empty && upzMatch.matched && upzMatch.score >= cfg.AUTO_FIX_MIN) {
      const owners = idx.upazilaByNameOnly.get(normalizeForMatch(upzMatch.matched)) || [];
      if (owners.length === 1) {
        if (!effDivision) {
          effDivision = owners[0].division;
          out.division = inferredResult(raw.division, effDivision, upzMatch.score, 'Division', `Upazila "${upzMatch.matched}"`);
        }
        if (!effDistrict) {
          effDistrict = owners[0].district;
          out.district = inferredResult(raw.district, effDistrict, upzMatch.score, 'District', `Upazila "${upzMatch.matched}"`);
        }
        upazilaScope = idx.getUpazilas(effDivision, effDistrict);
        upzMatch = matchLevel(raw.upazila, upazilaScope);
      }
    }
    out.upazila = toFieldResult(raw.upazila, upzMatch, 'Upazila');
    let effUpazila = (!upzMatch.empty && upzMatch.matched && upzMatch.score >= cfg.REVIEW_MIN) ? upzMatch.matched : null;

    // Thana - scoped to the full division+district+upazila chain when known
    let thanaScope = (effDivision && effDistrict && effUpazila) ? idx.getThanas(effDivision, effDistrict, effUpazila) : idx.allThanaNames;
    let thanaMatch = matchLevel(raw.thana, thanaScope);

    if ((!effDivision || !effDistrict || !effUpazila) && !thanaMatch.empty && thanaMatch.matched && thanaMatch.score >= cfg.AUTO_FIX_MIN) {
      const owners = idx.thanaByNameOnly.get(normalizeForMatch(thanaMatch.matched)) || [];
      if (owners.length === 1) {
        if (!effDivision) {
          effDivision = owners[0].division;
          out.division = inferredResult(raw.division, effDivision, thanaMatch.score, 'Division', `Thana "${thanaMatch.matched}"`);
        }
        if (!effDistrict) {
          effDistrict = owners[0].district;
          out.district = inferredResult(raw.district, effDistrict, thanaMatch.score, 'District', `Thana "${thanaMatch.matched}"`);
        }
        if (!effUpazila) {
          effUpazila = owners[0].upazila;
          out.upazila = inferredResult(raw.upazila, effUpazila, thanaMatch.score, 'Upazila', `Thana "${thanaMatch.matched}"`);
        }
        thanaScope = idx.getThanas(effDivision, effDistrict, effUpazila);
        thanaMatch = matchLevel(raw.thana, thanaScope);
      }
    }
    out.thana = toFieldResult(raw.thana, thanaMatch, 'Thana');

    return out;
  }

  /* ---------------------------------------------------------------------
     Row-level orchestration
     --------------------------------------------------------------------- */
  const OPTIONAL_FIELDS = new Set(['fatherName', 'motherName', 'gender', 'email', 'nid', 'reportTo']);

  function validateRow(mapped) {
    const fields = {};

    if (['agency', 'campaign'].some(f => f in mapped)) {
      const acResults = matchAgencyCampaignHierarchy({ agency: mapped.agency, campaign: mapped.campaign });
      Object.assign(fields, acResults);
    }

    if ('name' in mapped) fields.name = correctNameField(mapped.name, 'Name');
    if ('fatherName' in mapped) fields.fatherName = correctNameField(mapped.fatherName, "Father's Name");
    if ('motherName' in mapped) fields.motherName = correctNameField(mapped.motherName, "Mother's Name");
    if ('mobile' in mapped) fields.mobile = correctMobileField(mapped.mobile);
    if ('dob' in mapped) fields.dob = correctDOBField(mapped.dob);
    if ('designation' in mapped) fields.designation = correctEnumField(mapped.designation, 'Designation');
    if ('role' in mapped) fields.role = correctEnumField(mapped.role, 'Role');

    if ('email' in mapped) {
      if (isBlank(mapped.email)) {
        fields.email = { original: mapped.email || '', corrected: '', suggested: null, confidence: 100, status: 'invalid', message: 'Email is empty.', resolution: null };
      } else {
        // Same Smart Email Validation Engine as the Registration form (js/email-validator.js) -
        // lowercase normalization, Gmail/Yahoo/Hotmail/Outlook typo correction, and fuzzy
        // domain review all apply identically here, so an uploaded Excel row gets the exact
        // same corrections a manually-registered user would.
        fields.email = window.smartValidateEmail(mapped.email);
      }
    }

    if ('nid' in mapped) {
      if (isBlank(mapped.nid)) {
        fields.nid = { original: mapped.nid || '', corrected: '', suggested: null, confidence: 100, status: 'invalid', message: 'NID Number is empty.', resolution: null };
      } else {
        const r = window.validateNID(mapped.nid);
        fields.nid = r.valid
          ? { original: mapped.nid, corrected: r.cleanValue, suggested: null, confidence: 100, status: 'valid', message: 'Valid.', resolution: null }
          : { original: mapped.nid, corrected: mapped.nid, suggested: null, confidence: 0, status: 'invalid', message: r.message, resolution: null };
      }
    }

    if (['division', 'district', 'upazila', 'thana'].some(f => f in mapped)) {
      const locResults = matchLocationHierarchy({
        division: mapped.division,
        district: mapped.district,
        upazila: mapped.upazila,
        thana: mapped.thana
      });
      Object.assign(fields, locResults);
    }

    if ('designation' in mapped && 'role' in mapped) {
      const desig = fields.designation, role = fields.role;
      if (desig && role && desig.status !== 'invalid' && role.status !== 'invalid') {
        const desigVal = desig.status === 'corrected' ? desig.corrected : desig.original;
        const roleVal = role.status === 'corrected' ? role.corrected : role.original;
        if (normalizeForMatch(desigVal) !== normalizeForMatch(roleVal) && role.status !== 'review') {
          role.status = 'review';
          role.suggested = desigVal;
          role.confidence = 90;
          role.message += ` Role ("${roleVal}") does not match Designation ("${desigVal}") - please confirm.`;
        }
      }
    }

    // Row-level status: worst-of across all fields (invalid > review > corrected > valid),
    // but a field left empty when it wasn't even mapped/present doesn't penalize the row.
    const order = { invalid: 3, review: 2, corrected: 1, valid: 0 };
    let rowStatus = 'valid';
    let correctionCount = 0;
    Object.keys(fields).forEach(key => {
      const f = fields[key];
      if (!f) return;
      if (order[f.status] > order[rowStatus]) rowStatus = f.status;
      if (f.status === 'corrected') correctionCount++;
    });

    return { fields, rowStatus, correctionCount };
  }

  if (typeof window !== 'undefined') {
    window.validateRow = validateRow;
    window.getEffectiveStatus = getEffectiveStatus;
    window.getEffectiveValue = getEffectiveValue;
    window.getEffectiveMessage = getEffectiveMessage;
    window.getEffectiveRowStatus = getEffectiveRowStatus;
    window.getEffectiveCorrectionCount = getEffectiveCorrectionCount;
    window.excelValidatorInternals = { correctNameField, correctMobileField, correctDOBField, correctEnumField, matchLocationHierarchy, matchAgencyCampaignHierarchy, parseDOB };
  }
})();
