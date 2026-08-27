/**
 * Validation & Formatting Utility Functions
 */

/**
 * Format string to Title Case (First letter of each word capitalized, remaining lowercase)
 * Automatically strips dots, commas, numbers, and special characters from names.
 * Example: "MD., RAHIM #123 UDDIN" -> "Md Rahim Uddin"
 */
function formatTitleCase(str) {
  if (!str) return '';
  // Remove special characters, dots, commas, numbers (allow letters & spaces only)
  return str
    .replace(/[^A-Za-z\s]/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map(word => {
      if (!word) return '';
      // Capitalize first character, keep rest lowercase
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

/**
 * Validate Name Field (Only letters and spaces allowed; special characters, dots, commas & numbers are auto-stripped)
 */
function validateName(name, label = 'Name') {
  if (!name || !name.toString().trim()) {
    return { valid: false, message: `Please enter ${label}.` };
  }
  const cleanValue = formatTitleCase(name);
  if (!cleanValue) {
    return { valid: false, message: `Please enter valid ${label} (letters only).` };
  }
  return { valid: true, cleanValue: cleanValue };
}

/**
 * Validate Bangladesh Mobile Number
 * Standard format: 01XXXXXXXXX (11 digits, starting with 013 - 019)
 */
function validateMobile(mobile) {
  if (!mobile) return { valid: false, message: 'Please enter Mobile Number.' };
  const cleanMobile = mobile.toString().trim();
  
  if (!/^\d+$/.test(cleanMobile)) {
    return { valid: false, message: 'Mobile Number must contain digits only.' };
  }
  
  if (cleanMobile.length !== 11) {
    return { valid: false, message: 'Mobile Number must be exactly 11 digits (e.g., 01712345678).' };
  }
  
  const bdMobileRegex = /^01[3-9]\d{8}$/;
  if (!bdMobileRegex.test(cleanMobile)) {
    return { valid: false, message: 'Invalid Bangladesh mobile operator prefix. Must start with 013-019.' };
  }

  return { valid: true, cleanValue: cleanMobile };
}

/**
 * Validate Bangladesh NID Number
 * Numeric values only. Standard lengths: 10 digits (Smart Card), 13 digits, or 17 digits.
 */
function validateNID(nid) {
  if (!nid) return { valid: false, message: 'Please enter NID Number.' };
  const cleanNID = nid.toString().trim();
  
  if (!/^\d+$/.test(cleanNID)) {
    return { valid: false, message: 'NID Number must contain numeric digits only.' };
  }
  
  if (![10, 13, 17].includes(cleanNID.length)) {
    return { valid: false, message: 'NID Number must be 10, 13, or 17 digits.' };
  }

  return { valid: true, cleanValue: cleanNID };
}

/**
 * Validate (and smart-correct) an Email Address.
 * Delegates to the shared Smart Email Validation Engine (js/email-validator.js -
 * window.smartValidateEmail()) so the Registration form, Excel Validator, and
 * any future import path all apply the exact same normalization/typo-correction
 * rules - see that file for the full normalization/typo/confidence logic.
 *
 * Kept backward-compatible with every existing caller of validateEmail()
 * (`.valid`/`.message`/`.cleanValue`), while also exposing the richer
 * `status`/`corrected`/`suggested`/`confidence` fields for callers that want
 * to show a "corrected"/"needs review" message (see applySmartEmailValidation()
 * in js/app.js; row-validator.js calls window.smartValidateEmail() directly).
 *
 * `status` is one of: 'valid' | 'corrected' | 'review' | 'invalid'. Only
 * 'invalid' should block submission - 'review' means the domain couldn't be
 * confidently guessed (never auto-applied) and is NOT treated as blocking.
 */
function validateEmail(email) {
  const result = window.smartValidateEmail(email);
  return {
    valid: result.status !== 'invalid',
    cleanValue: result.status === 'invalid' ? undefined : result.corrected,
    message: result.message,
    status: result.status,
    original: result.original,
    corrected: result.corrected,
    suggested: result.suggested,
    confidence: result.confidence
  };
}

/**
 * Calculate a person's exact age in full years as of a reference date (defaults to today).
 * Uses year/month/day comparison (not just year subtraction) so it's correct for people
 * who haven't had their birthday yet this year, and naturally leap-year-safe since it
 * relies on native Date semantics rather than manual day-counting.
 */
function calculateAge(dob, referenceDate = new Date()) {
  const birthDate = new Date(dob);
  let age = referenceDate.getFullYear() - birthDate.getFullYear();
  const monthDiff = referenceDate.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && referenceDate.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

/**
 * Validate Minimum Age Requirement (Date of Birth)
 * The account creation date is always "today" - never a hardcoded date - so this is
 * re-evaluated live against the current date every time it runs.
 */
function validateMinimumAge(dob, minAge = 18) {
  if (!dob) return { valid: false, message: 'Please select Date of Birth.' };

  const age = calculateAge(dob);
  if (age < minAge) {
    return { valid: false, message: `User must be at least ${minAge} years old to create an account.` };
  }

  return { valid: true, age };
}

/**
 * Validate Image File (JPG, JPEG, PNG, max 5MB)
 */
function validateImageFile(file, maxMB = 5) {
  if (!file) {
    return { valid: false, message: 'File is missing.' };
  }

  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
  if (!allowedTypes.includes(file.type.toLowerCase())) {
    return { valid: false, message: 'Only JPG, JPEG, and PNG image files are allowed.' };
  }

  const maxSizeBytes = maxMB * 1024 * 1024;
  if (file.size > maxSizeBytes) {
    return { valid: false, message: `Image file size must be less than ${maxMB}MB.` };
  }

  return { valid: true };
}

if (typeof window !== 'undefined') {
  window.formatTitleCase = formatTitleCase;
  window.validateName = validateName;
  window.validateMobile = validateMobile;
  window.validateEmail = validateEmail;
  window.validateNID = validateNID;
  window.calculateAge = calculateAge;
  window.validateMinimumAge = validateMinimumAge;
  window.validateImageFile = validateImageFile;
}
