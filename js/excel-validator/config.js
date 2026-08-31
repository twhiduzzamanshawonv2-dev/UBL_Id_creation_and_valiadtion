/**
 * Excel Validator - Confidence Thresholds
 * 95-100%: auto-correct. 85-94%: suggest + flag for review (not applied).
 * Below 85%: leave value untouched, flag for manual review.
 */
const EXCEL_VALIDATOR_CONFIG = {
  AUTO_FIX_MIN: 95,
  REVIEW_MIN: 85,
  // Report To reference matching only: below AUTO_FIX_MIN/REVIEW_MIN but still worth
  // surfacing as a non-blocking "possible match" hint. Below this, no suggestion at all.
  REPORT_TO_POSSIBLE_MIN: 70,
  MAX_FILE_SIZE_MB: 15,
  BATCH_SIZE: 200
};

if (typeof window !== 'undefined') {
  window.EXCEL_VALIDATOR_CONFIG = EXCEL_VALIDATOR_CONFIG;
}
