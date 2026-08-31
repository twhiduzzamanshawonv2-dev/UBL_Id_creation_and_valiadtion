/**
 * Excel Validator - Reference Name Matching Service
 * Optional layer used only for standardizing the "Report To" column against a
 * user-uploaded Reference Excel of correct/standard names. Nothing here runs
 * unless a Reference file has been uploaded (see excel-validator-ui.js) and
 * setReferenceNameIndex() has been called - row-validator.js checks
 * hasReferenceNameIndex() before touching Report To at all, so the rest of
 * the validator is completely unaffected when no Reference file is present.
 *
 * Reuses fuzzy-match.js (normalizeForMatch/similarityScore) and the header
 * synonym lists already defined in column-mapper.js (EXCEL_FIELD_DEFINITIONS)
 * - no separate matching engine, no external/AI service call.
 */
(function () {
  const NAME_HEADER_SYNONYMS = [
    'NAME', 'FULL NAME', 'EMPLOYEE NAME', 'USER NAME', 'PERSON NAME',
    'CONSUMER NAME', 'STAFF NAME'
  ];
  // Only tried when no genuine Name-ish header exists on the sheet at all (see
  // detectNameColumn below). Many real reference/roster files have their OWN
  // Report To/Supervisor column (who *that* person reports to) sitting right next to a
  // real Name column - if this list were merged into NAME_HEADER_SYNONYMS and that
  // Report To column happened to appear before Name in the sheet, it would win the "which
  // column has the names" detection and the real names would never make it into the
  // index at all (silently causing every Main Excel row to come back "No Match Found").
  const NAME_HEADER_FALLBACK_SYNONYMS = ['REPORT TO', 'REPORTING TO', 'SUPERVISOR', 'SUPERVISOR NAME'];
  const HEADER_DETECT_MIN_SCORE = 60;
  const LARGE_LIST_FALLBACK_LIMIT = 500; // full-list fuzzy scan only below this size (perf guard)

  function tokenize(name) {
    const norm = normalizeForMatch(name);
    return norm ? norm.split(' ').filter(Boolean) : [];
  }

  function detectColumnIndex(headers, synonyms, minScore) {
    let bestIdx = -1;
    let bestScore = -1;
    headers.forEach((h, i) => {
      if (!h) return;
      let localBest = -1;
      synonyms.forEach(syn => {
        const s = similarityScore(h, syn);
        if (s > localBest) localBest = s;
      });
      if (localBest > bestScore) {
        bestScore = localBest;
        bestIdx = i;
      }
    });
    return bestScore >= minScore ? bestIdx : -1;
  }

  function detectNameColumn(headers) {
    const primary = detectColumnIndex(headers, NAME_HEADER_SYNONYMS, HEADER_DETECT_MIN_SCORE);
    if (primary !== -1) return primary;
    // No column looked like an actual Name header - fall back to a Report To/Supervisor
    // style header, for a reference file whose only usable column IS named that way.
    return detectColumnIndex(headers, NAME_HEADER_FALLBACK_SYNONYMS, HEADER_DETECT_MIN_SCORE);
  }

  function detectContextColumn(headers, field) {
    const def = (window.EXCEL_FIELD_DEFINITIONS || []).find(f => f.field === field);
    if (!def) return -1;
    return detectColumnIndex(headers, def.synonyms, HEADER_DETECT_MIN_SCORE);
  }

  /**
   * Builds a searchable index from the parsed Reference workbook's sheets:
   * sheets: [{ name, headers, rows }] (rows are arrays, header-1 style, from readReferenceWorkbookFile).
   * Every sheet is inspected independently for a usable Name column (spec #16) - sheets
   * without one are silently skipped rather than failing the whole file. Deduplicates
   * identical (name, role, designation) triples (spec #18) but keeps distinct people who
   * share a name yet differ in role/designation as separate candidate entries, so
   * disambiguation by context stays possible.
   */
  function buildReferenceIndex(sheets) {
    const entries = [];
    const seenKeys = new Set();
    let usableSheets = 0;

    (sheets || []).forEach(sheet => {
      const headers = sheet.headers || [];
      const rows = sheet.rows || [];
      const nameIdx = detectNameColumn(headers);
      if (nameIdx === -1) return;
      usableSheets++;

      const roleIdx = detectContextColumn(headers, 'role');
      const designationIdx = detectContextColumn(headers, 'designation');

      rows.forEach(row => {
        const rawName = row[nameIdx];
        if (rawName === undefined || rawName === null || String(rawName).trim() === '') return;
        const name = String(rawName).trim();
        const role = roleIdx !== -1 && row[roleIdx] != null ? String(row[roleIdx]).trim() : '';
        const designation = designationIdx !== -1 && row[designationIdx] != null ? String(row[designationIdx]).trim() : '';
        const key = `${normalizeForMatch(name)}|${normalizeForMatch(role)}|${normalizeForMatch(designation)}`;
        if (seenKeys.has(key)) return;
        seenKeys.add(key);
        entries.push({ name, role, designation, tokens: tokenize(name), norm: normalizeForMatch(name), sheet: sheet.name });
      });
    });

    const exactMap = new Map();      // normalized name -> entry[] (>1 means duplicate names, spec #18)
    const tokenIndex = new Map();    // token -> Set<entry index>, for candidate filtering (spec #24)
    const initialsIndex = new Map(); // first letter of a token -> Set<entry index>, for initials (spec #6)

    entries.forEach((entry, i) => {
      if (!exactMap.has(entry.norm)) exactMap.set(entry.norm, []);
      exactMap.get(entry.norm).push(entry);

      entry.tokens.forEach(t => {
        if (!tokenIndex.has(t)) tokenIndex.set(t, new Set());
        tokenIndex.get(t).add(i);
        const letter = t[0];
        if (!initialsIndex.has(letter)) initialsIndex.set(letter, new Set());
        initialsIndex.get(letter).add(i);
      });
    });

    return { entries, exactMap, tokenIndex, initialsIndex, usableSheets };
  }

  /**
   * Candidate filtering (spec #24): rather than fuzzy-scoring against every reference
   * name for every row, first narrow down to entries that share at least one token (or,
   * for a bare initial, share that initial) with the raw value. Only falls back to a full
   * scan when nothing token-matched AND the reference list is small enough for that to
   * stay cheap.
   */
  function gatherCandidates(rawTokens, index) {
    const idxSet = new Set();
    rawTokens.forEach(t => {
      if (t.length >= 2 && index.tokenIndex.has(t)) {
        index.tokenIndex.get(t).forEach(i => idxSet.add(i));
      } else if (t.length === 1 && index.initialsIndex.has(t)) {
        index.initialsIndex.get(t).forEach(i => idxSet.add(i));
      }
    });
    if (idxSet.size > 0) return Array.from(idxSet).map(i => index.entries[i]);
    return index.entries.length <= LARGE_LIST_FALLBACK_LIMIT ? index.entries : [];
  }

  /**
   * Shared token-overlap bookkeeping used by both scoreCandidate (confidence) and
   * determineMatchMethod (audit-trail matching method) so the two never disagree about
   * how a match was actually made.
   */
  function tokenOverlapAnalysis(rawTokens, candTokens) {
    const candRemaining = new Set(candTokens);
    let exact = 0;
    let initials = 0;
    rawTokens.forEach(t => {
      if (candRemaining.has(t)) {
        exact++;
        candRemaining.delete(t);
        return;
      }
      if (t.length === 1) {
        for (const c of candRemaining) {
          if (c[0] === t) {
            initials++;
            candRemaining.delete(c);
            break;
          }
        }
      }
    });
    const matchedTotal = exact + initials;
    return {
      exact,
      initials,
      matchedTotal,
      allRawAccounted: matchedTotal === rawTokens.length,
      sameTokenSet: exact === rawTokens.length && exact === candTokens.length
    };
  }

  /**
   * Combined token + character similarity score (0-100) between a raw value's tokens and
   * a candidate reference entry's tokens. Token-based agreement is weighted higher than
   * plain character similarity (spec #8), and initials-only agreement is deliberately
   * capped below auto-fix territory (spec #6/#30 - "do not make aggressive assumptions").
   */
  function scoreCandidate(rawTokens, rawNorm, candTokens, candNorm) {
    if (rawNorm === candNorm) return 100;
    if (rawTokens.length === 0 || candTokens.length === 0) return similarityScore(rawNorm, candNorm);

    const analysis = tokenOverlapAnalysis(rawTokens, candTokens);

    // Same set of words, just reordered (spec #8 example: "Md Abdur Rahman" vs "Abdur Rahman Md").
    if (analysis.sameTokenSet) return 97;

    const shorterLen = Math.min(rawTokens.length, candTokens.length);
    const longerLen = Math.max(rawTokens.length, candTokens.length);
    const charScore = similarityScore(rawNorm, candNorm);

    // Every token of the SHORTER name was found in the longer one (e.g. "Md Tusher" fully
    // contained in "Md Tusher Hossain" - a dropped/extra surname is common when a Main
    // Excel and a Reference Excel come from different sources). The plain Dice ratio below
    // punishes this heavily because it divides by the *combined* length, so a clean 2-of-2
    // match on a 2-vs-3-token name only scored ~80% and never crossed the review threshold.
    // Score it on how completely the shorter side is covered instead, tapered down for
    // every extra unmatched token on the longer side so wildly different lengths don't
    // get overconfident just because they share one word.
    if (analysis.matchedTotal === shorterLen && shorterLen >= 2) {
      const subsetScore = 90 - (longerLen - shorterLen) * 3;
      const score = Math.max(subsetScore, charScore);
      return Math.round(Math.max(0, Math.min(analysis.initials > 0 ? 92 : 100, score)));
    }

    const diceRatio = (2 * analysis.matchedTotal) / (rawTokens.length + candTokens.length);
    let score = Math.max(diceRatio * 100, charScore);
    if (analysis.initials > 0) score = Math.min(score, 92); // initials alone -> review, never auto-fix

    return Math.round(Math.max(0, Math.min(100, score)));
  }

  /**
   * Classifies WHY a match was made, for the Report To Correction Notes / Change History
   * audit trail (see row-validator.js's MATCH_METHOD_REASONS). Checked in the same
   * trim -> case -> spacing -> punctuation order the normalization pipeline itself uses
   * (spec #7), then falls through to token-based / fuzzy classification.
   */
  function determineMatchMethod(rawValue, matched, rawTokens, candTokens, viaContext) {
    if (viaContext) return 'context_aware_match';

    const rawTrim = String(rawValue).trim();
    if (rawTrim === matched) return 'exact_match';
    if (rawTrim.toLowerCase() === matched.toLowerCase()) return 'case_insensitive_match';

    const collapseSpaces = s => s.replace(/\s+/g, ' ').trim();
    const stripPunct = s => s.replace(/[.,'"()/\\_-]+/g, ' ');

    const rawSpaceNorm = collapseSpaces(rawTrim.toLowerCase());
    const matchedSpaceNorm = collapseSpaces(matched.toLowerCase());
    if (rawSpaceNorm === matchedSpaceNorm) return 'normalized_match';

    const rawPunctNorm = collapseSpaces(stripPunct(rawTrim.toLowerCase()));
    const matchedPunctNorm = collapseSpaces(stripPunct(matched.toLowerCase()));
    if (rawPunctNorm === matchedPunctNorm) return 'punctuation_match';

    const analysis = tokenOverlapAnalysis(rawTokens, candTokens);
    if (analysis.sameTokenSet) return 'token_order_match';
    if (rawTokens.length === candTokens.length && analysis.allRawAccounted) return 'token_match';
    return 'fuzzy_match';
  }

  function disambiguateByContext(candidates, context) {
    if (!context) return candidates;
    const roleNorm = normalizeForMatch(context.role || '');
    const desigNorm = normalizeForMatch(context.designation || '');
    if (!roleNorm && !desigNorm) return candidates;
    const narrowed = candidates.filter(c => {
      const cRole = normalizeForMatch(c.role || '');
      const cDesig = normalizeForMatch(c.designation || '');
      return (roleNorm && cRole === roleNorm) || (desigNorm && cDesig === desigNorm);
    });
    return narrowed.length > 0 ? narrowed : candidates;
  }

  function computeMatch(rawValue, rawNorm, context, index, cfg) {
    const rawTokens = tokenize(rawValue);
    const exact = index.exactMap.get(rawNorm);
    if (exact && exact.length > 0) {
      if (exact.length === 1) {
        const method = determineMatchMethod(rawValue, exact[0].name, rawTokens, exact[0].tokens, false);
        return { matched: exact[0].name, score: 100, ambiguous: false, candidates: exact, method };
      }
      const narrowed = disambiguateByContext(exact, context);
      if (narrowed.length === 1) {
        const viaContext = narrowed.length < exact.length;
        const method = determineMatchMethod(rawValue, narrowed[0].name, rawTokens, narrowed[0].tokens, viaContext);
        return { matched: narrowed[0].name, score: 100, ambiguous: false, candidates: narrowed, method };
      }
      // Same normalized name, multiple distinct people, context couldn't tell them apart -
      // never guess (spec #18/#19/#30).
      return { matched: null, score: 100, ambiguous: true, candidates: exact, method: null };
    }

    const candidates = gatherCandidates(rawTokens, index);
    if (candidates.length === 0) return { matched: null, score: 0, ambiguous: false, candidates: [], method: null };

    const scored = candidates
      .map(c => ({ entry: c, score: scoreCandidate(rawTokens, rawNorm, c.tokens, c.norm) }))
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    const second = scored[1];
    // Two (near-)equally strong matches at review-worthy confidence - don't auto-pick one
    // (spec #30: "Possible Match 1: 91% / Possible Match 2: 90%" style tie).
    if (second && best.score - second.score <= 1 && best.score >= cfg.REVIEW_MIN) {
      const tied = scored.filter(s => best.score - s.score <= 1).map(s => s.entry);
      return { matched: null, score: best.score, ambiguous: true, candidates: tied, method: null };
    }

    const method = determineMatchMethod(rawValue, best.entry.name, rawTokens, best.entry.tokens, false);
    return { matched: best.entry.name, score: best.score, ambiguous: false, candidates: [best.entry], method };
  }

  const matchCache = new Map();

  /**
   * Matches a raw "Report To" value against the built Reference index. `context` is an
   * optional { role, designation } drawn from the same Main Excel row, used only to
   * disambiguate multiple reference entries that share an identical name (spec #19).
   * Returns null when there's no index/value to compare, otherwise:
   *   { matched: string|null, score: 0-100, ambiguous: boolean, candidates: entry[], method: string|null }
   * `matched` is the exact Reference Excel name (never a re-derived value, spec #14) and
   * is null when nothing confident was found or multiple candidates tied. `method` is one
   * of exact_match/case_insensitive_match/normalized_match/punctuation_match/token_match/
   * token_order_match/fuzzy_match/context_aware_match, or null when unresolved/no match.
   */
  function matchReportToAgainstReference(rawValue, context, index, cfg) {
    if (!index || !index.entries || index.entries.length === 0) return null;
    const rawNorm = normalizeForMatch(rawValue);
    if (!rawNorm) return null;

    const contextKey = context ? `${normalizeForMatch(context.role || '')}|${normalizeForMatch(context.designation || '')}` : '';
    const cacheKey = `${rawNorm}::${contextKey}`;
    if (matchCache.has(cacheKey)) return matchCache.get(cacheKey);

    const result = computeMatch(rawValue, rawNorm, context, index, cfg || window.EXCEL_VALIDATOR_CONFIG);
    matchCache.set(cacheKey, result);
    return result;
  }

  let currentIndex = null;

  function setReferenceNameIndex(index) {
    currentIndex = index || null;
    matchCache.clear();
  }

  function clearReferenceNameIndex() {
    currentIndex = null;
    matchCache.clear();
  }

  function getReferenceNameIndex() {
    return currentIndex;
  }

  function hasReferenceNameIndex() {
    return !!(currentIndex && currentIndex.entries && currentIndex.entries.length > 0);
  }

  if (typeof window !== 'undefined') {
    window.buildReferenceNameIndex = buildReferenceIndex;
    window.matchReportToAgainstReference = matchReportToAgainstReference;
    window.setReferenceNameIndex = setReferenceNameIndex;
    window.clearReferenceNameIndex = clearReferenceNameIndex;
    window.getReferenceNameIndex = getReferenceNameIndex;
    window.hasReferenceNameIndex = hasReferenceNameIndex;
  }
})();
