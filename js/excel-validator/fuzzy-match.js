/**
 * Excel Validator - Fuzzy String Matching
 * Dependency-free Levenshtein-distance similarity scoring, used to compare
 * uploaded values against the existing master data (locations/designation/role)
 * and against column-header synonyms. No external library, no AI calls.
 */

/** Uppercase, trim, collapse whitespace, strip punctuation - the shared comparison key. */
function normalizeForMatch(str) {
  if (str === null || str === undefined) return '';
  return str
    .toString()
    .toUpperCase()
    .replace(/[.,'"()/\\_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Classic Levenshtein edit distance between two strings. */
function levenshteinDistance(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prevRow = new Array(n + 1);
  let currRow = new Array(n + 1);
  for (let j = 0; j <= n; j++) prevRow[j] = j;

  for (let i = 1; i <= m; i++) {
    currRow[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      currRow[j] = Math.min(
        currRow[j - 1] + 1,      // insertion
        prevRow[j] + 1,          // deletion
        prevRow[j - 1] + cost    // substitution
      );
    }
    [prevRow, currRow] = [currRow, prevRow];
  }
  return prevRow[n];
}

/**
 * Jaro similarity (0-1) between two strings - counts matching characters within a
 * proximity window and penalizes transpositions (order swaps), which plain
 * Levenshtein treats as two full edits and badly under-scores. This matters for
 * short place names: a transposition typo like "Dahka" vs "Dhaka" is a single,
 * obvious mistake to a human, and should score high, not ~60%.
 */
function jaroSimilarity(a, b) {
  if (a === b) return 1;
  const aLen = a.length;
  const bLen = b.length;
  if (aLen === 0 || bLen === 0) return 0;

  const matchWindow = Math.max(0, Math.floor(Math.max(aLen, bLen) / 2) - 1);
  const aMatched = new Array(aLen).fill(false);
  const bMatched = new Array(bLen).fill(false);

  let matches = 0;
  for (let i = 0; i < aLen; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, bLen);
    for (let j = start; j < end; j++) {
      if (bMatched[j] || a[i] !== b[j]) continue;
      aMatched[i] = true;
      bMatched[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  let transpositions = 0;
  let bIndex = 0;
  for (let i = 0; i < aLen; i++) {
    if (!aMatched[i]) continue;
    while (!bMatched[bIndex]) bIndex++;
    if (a[i] !== b[bIndex]) transpositions++;
    bIndex++;
  }
  transpositions = Math.floor(transpositions / 2);

  return (matches / aLen + matches / bLen + (matches - transpositions) / matches) / 3;
}

/** Jaro-Winkler similarity (0-1): Jaro similarity with a bonus for a shared prefix (up to 4 chars). */
function jaroWinklerSimilarity(a, b) {
  const jaro = jaroSimilarity(a, b);
  let prefixLen = 0;
  const maxPrefix = Math.min(4, a.length, b.length);
  while (prefixLen < maxPrefix && a[prefixLen] === b[prefixLen]) prefixLen++;
  return jaro + prefixLen * 0.1 * (1 - jaro);
}

/**
 * Similarity score 0-100 between two raw strings, based on Jaro-Winkler similarity
 * (well-suited to short-string typos: case, spacing, transpositions, single-letter
 * substitutions). Exact match (after normalization) = 100.
 */
function similarityScore(rawA, rawB) {
  const a = normalizeForMatch(rawA);
  const b = normalizeForMatch(rawB);
  if (!a && !b) return 100;
  if (!a || !b) return 0;
  if (a === b) return 100;

  const score = jaroWinklerSimilarity(a, b) * 100;
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Finds the best match for `value` among `candidates` (array of strings, or array of
 * objects when `getLabel` is provided to extract the comparable string from each).
 * Returns { candidate, score } for the highest-scoring candidate, or null if candidates is empty.
 */
function findBestMatch(value, candidates, getLabel) {
  if (!candidates || candidates.length === 0) return null;
  const label = getLabel || (c => c);

  let best = null;
  let bestScore = -1;
  for (const candidate of candidates) {
    const score = similarityScore(value, label(candidate));
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return { candidate: best, score: bestScore };
}

if (typeof window !== 'undefined') {
  window.normalizeForMatch = normalizeForMatch;
  window.levenshteinDistance = levenshteinDistance;
  window.jaroWinklerSimilarity = jaroWinklerSimilarity;
  window.similarityScore = similarityScore;
  window.findBestMatch = findBestMatch;
}
