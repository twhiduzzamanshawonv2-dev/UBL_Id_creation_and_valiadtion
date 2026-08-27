/**
 * Smart Email Validation / Normalization / Typo-Correction Engine
 * -----------------------------------------------------------------------
 * The ONE reusable email validation service for this app - used by both the
 * User Registration form (js/app.js, live on the Email field) and the Excel
 * Validator (js/excel-validator/row-validator.js, per uploaded row), so both
 * surfaces apply the exact same normalization/typo-correction rules. Do not
 * duplicate this logic elsewhere - extend smartValidateEmail() instead.
 *
 * Result shape matches the rest of the Excel Validator pipeline (see
 * classifyFuzzyResult() in row-validator.js):
 *   { original, corrected, suggested, confidence, status, message, resolution }
 * status:
 *   'valid'     - already correct as typed (message may still carry a
 *                 non-blocking "looks unusual" warning for a suspicious address)
 *   'corrected' - auto-applied (lowercase normalization and/or a >=95%-
 *                 confidence domain typo fix - see AUTO_FIX_MIN)
 *   'review'    - 85-94% confidence domain guess, suggested but NEVER
 *                 auto-applied (see REVIEW_MIN) - same accept/decline shape
 *                 as every other fuzzy-matched Excel Validator field
 *   'invalid'   - fails structural validation, or a disposable-domain block
 *
 * Uses the same 95/85 confidence thresholds and the same Jaro-Winkler
 * similarity engine (window.jaroWinklerSimilarity, js/excel-validator/
 * fuzzy-match.js) as every other fuzzy-matched field in the Excel Validator -
 * only called at validation time (not at script-load time), so load order
 * relative to fuzzy-match.js does not matter.
 */
(function () {
  const AUTO_FIX_MIN = 95;
  const REVIEW_MIN = 85;

  // Canonical domain -> known exact-typo variants. These ARE the recognized
  // mistake (100% confidence), not a fuzzy guess - see requirement #6/#8/#9.
  const KNOWN_TYPOS = {
    'gmail.com': [
      'gamil.com', 'gmal.com', 'gmil.com', 'gmai.com', 'gmali.com', 'gimail.com',
      'gmaill.com', 'gmaiil.com', 'gmalil.com', 'gmail.co', 'gmail.con',
      'gmail.comm', 'gmail.coom', 'gmail.cmo', 'gmail.cim', 'gmail.xom'
    ],
    'yahoo.com': ['yaho.com', 'yahooo.com', 'yhoo.com', 'yahoo.co', 'yahoo.con'],
    'hotmail.com': ['hotmai.com', 'hotmal.com', 'hotmial.com', 'hotmil.com', 'hotmail.co', 'hotmail.con'],
    'outlook.com': ['outlok.com', 'outloo.com', 'outlook.co', 'outlook.con']
  };

  // Recognized legitimate providers - never rewritten themselves, and skipped
  // by fuzzy matching (so yahoo.com is never "corrected" to gmail.com just for
  // being less common - see requirement #13).
  const RECOGNIZED_DOMAINS = new Set([
    'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
    'icloud.com', 'proton.me', 'protonmail.com', 'aol.com', 'mail.com'
  ]);

  // Configurable (requirement #15) - extend this set (or wire up an external
  // lookup inside isDisposableDomain() below) to enable stricter disposable-
  // email blocking. Deliberately a local list, not a network call, so this
  // never fires an external request per keystroke.
  const DISPOSABLE_DOMAINS = new Set([
    'mailinator.com', '10minutemail.com', 'tempmail.com', 'guerrillamail.com',
    'yopmail.com', 'trashmail.com', 'throwawaymail.com', 'getnada.com',
    'fakeinbox.com', 'sharklasers.com', 'dispostable.com'
  ]);

  const typoLookup = new Map();
  Object.keys(KNOWN_TYPOS).forEach(canonical => {
    KNOWN_TYPOS[canonical].forEach(typo => typoLookup.set(typo, canonical));
  });

  /** Trim + lowercase only - the unconditional part of normalization (requirement #11). */
  function normalizeEmail(raw) {
    return String(raw == null ? '' : raw).trim().toLowerCase();
  }

  function domainSimilarity(a, b) {
    if (a === b) return 100;
    if (typeof window.jaroWinklerSimilarity !== 'function') return 0;
    return Math.max(0, Math.min(100, Math.round(window.jaroWinklerSimilarity(a, b) * 100)));
  }

  /** Best-matching known provider domain for a given (unrecognized) domain string. */
  function fuzzyDomainMatch(domain) {
    let best = null;
    let bestScore = -1;
    Object.keys(KNOWN_TYPOS).forEach(canonical => {
      const score = domainSimilarity(domain, canonical);
      if (score > bestScore) {
        bestScore = score;
        best = canonical;
      }
    });
    return { candidate: best, score: bestScore };
  }

  function isDisposableDomain(domain) {
    return DISPOSABLE_DOMAINS.has(domain);
  }

  // Soft, non-blocking heuristics only (requirement #14) - a syntactically
  // valid email is never rejected on these grounds, only flagged for review.
  function looksSuspicious(local, domain) {
    if (/^(.)\1{4,}$/.test(local)) return true; // e.g. "aaaaaaaa"
    if (/^(test|demo|sample|admin|user|abc|xyz)\d*$/.test(local)) return true; // e.g. "test", "test123"
    if (/^\d{5,}$/.test(local)) return true; // e.g. "123456"
    if (['test.com', 'xyz.com', 'example.com', 'abc.com', 'sample.com'].includes(domain)) return true;
    return false;
  }

  /**
   * The single shared entry point. See file header for the result shape and
   * status meanings. Pure/synchronous - safe to call on every keystroke,
   * though callers (see applySmartEmailValidation() in js/app.js) only run
   * the full domain-correction pass on blur/paste/submit, not on every
   * keystroke, to avoid "fixing" a domain the user hasn't finished typing yet.
   */
  function smartValidateEmail(rawInput) {
    const original = rawInput == null ? '' : String(rawInput);
    const trimmed = original.trim();

    const invalid = (message) => ({
      original, corrected: trimmed, suggested: null, confidence: 0,
      status: 'invalid', message, resolution: null, warning: false
    });

    if (!trimmed) return invalid('Please enter Email.');

    if (/\s/.test(trimmed)) {
      return invalid('Invalid email: spaces are not allowed inside an email address.');
    }

    const hadUppercase = /[A-Z]/.test(trimmed);
    const lower = trimmed.toLowerCase();

    const atCount = (lower.match(/@/g) || []).length;
    if (atCount === 0) return invalid('Invalid email: the "@" symbol is missing.');
    if (atCount > 1) return invalid('Invalid email: only one "@" symbol is allowed.');

    const [local, domain] = lower.split('@');
    if (!local) return invalid('Invalid email: missing the part before "@".');
    if (!domain) return invalid('Invalid email: missing a domain after "@".');
    if (/(^\.|\.$|\.\.)/.test(local)) {
      return invalid('Invalid email: the part before "@" must not start/end with a dot or contain consecutive dots.');
    }
    if (!/^[a-z0-9._%+-]+$/.test(local)) {
      return invalid('Invalid email: the part before "@" contains characters that are not allowed.');
    }
    if (!domain.includes('.')) {
      return invalid('Invalid email: the domain must include an extension (e.g. .com).');
    }
    if (/(^\.|\.$|\.\.)/.test(domain)) {
      return invalid('Invalid email: the domain must not start/end with a dot or contain consecutive dots.');
    }
    if (!/^[a-z0-9.-]+$/.test(domain)) {
      return invalid('Invalid email: the domain contains characters that are not allowed.');
    }
    const domainParts = domain.split('.');
    if (domainParts.some(p => !p)) return invalid('Invalid email: the domain format is invalid.');
    const tld = domainParts[domainParts.length - 1];
    if (!/^[a-z]{2,}$/.test(tld)) return invalid('Invalid email: the domain extension is invalid.');

    // Domain typo/fuzzy correction - only ever touches the domain, never the
    // local part, and never invents a provider for an unrecognized (custom/
    // company) domain (requirement #13).
    let correctedDomain = domain;
    let domainCorrectionNote = null;
    let domainConfidence = 100;
    let reviewSuggestion = null;

    if (typoLookup.has(domain)) {
      correctedDomain = typoLookup.get(domain);
      domainCorrectionNote = `${domain} → ${correctedDomain}`;
    } else if (!RECOGNIZED_DOMAINS.has(domain)) {
      const { candidate, score } = fuzzyDomainMatch(domain);
      if (candidate && score >= AUTO_FIX_MIN) {
        correctedDomain = candidate;
        domainCorrectionNote = `${domain} → ${candidate}`;
        domainConfidence = score;
      } else if (candidate && score >= REVIEW_MIN) {
        reviewSuggestion = { candidate, score };
      }
      // below REVIEW_MIN: left untouched - treated as a legitimate custom/company domain.
    }

    if (reviewSuggestion) {
      const suggestedEmail = `${local}@${reviewSuggestion.candidate}`;
      return {
        original, corrected: `${local}@${domain}`, suggested: suggestedEmail,
        confidence: reviewSuggestion.score, status: 'review',
        message: `We couldn't confidently identify this email domain. Did you mean "${reviewSuggestion.candidate}"? Please check it manually.`,
        resolution: null, warning: false
      };
    }

    if (isDisposableDomain(correctedDomain)) {
      return invalid('Temporary email addresses are not allowed. Please use a permanent email address.');
    }

    const correctedEmail = `${local}@${correctedDomain}`;
    const domainWasCorrected = !!domainCorrectionNote;
    const suspicious = looksSuspicious(local, correctedDomain);

    let status = 'valid';
    let message = 'Valid email address.';

    if (domainWasCorrected && hadUppercase) {
      status = 'corrected';
      message = `Email corrected and normalized: ${trimmed} → ${correctedEmail}`;
    } else if (domainWasCorrected) {
      status = 'corrected';
      message = `Email corrected: ${domainCorrectionNote}`;
    } else if (hadUppercase) {
      status = 'corrected';
      message = 'Email normalized to lowercase.';
    } else if (suspicious) {
      message = 'This email address looks unusual. Please verify that it is correct.';
    }

    return {
      original, corrected: correctedEmail, suggested: null,
      confidence: domainConfidence, status, message, resolution: null,
      warning: status === 'valid' && suspicious
    };
  }

  if (typeof window !== 'undefined') {
    window.normalizeEmail = normalizeEmail;
    window.smartValidateEmail = smartValidateEmail;
  }
})();
