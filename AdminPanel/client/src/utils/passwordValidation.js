/**
 * Password validation utility
 * Validates password strength according to security requirements
 */

// Default password settings matching DocSpace standard
const DEFAULT_PASSWORD_SETTINGS = {
  minLength: 8,
  maxLength: 128,
  upperCase: true,
  digits: true,
  specSymbols: true
};

/**
 * Validates password strength
 * @param {string} password - Password to validate
 * @param {Object} settings - Password settings (optional)
 * @returns {Object} Validation result with isValid boolean and error message
 */
export function validatePasswordStrength(password, settings = DEFAULT_PASSWORD_SETTINGS) {
  const errors = [];

  // Check minimum length
  if (password.length < settings.minLength) {
    errors.push(`Password must be at least ${settings.minLength} characters long`);
  }

  // Check maximum length
  if (password.length > settings.maxLength) {
    errors.push(`Password must not exceed ${settings.maxLength} characters`);
  }

  // Check for at least one digit
  if (settings.digits && !/\d/.test(password)) {
    errors.push('Password must contain at least one digit');
  }

  // Check for at least one uppercase letter
  if (settings.upperCase && !/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  // Check for at least one special character
  if (settings.specSymbols && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push('Password must contain at least one special character (!@#$%^&*()_+-=[]{}|;:,.<>?)');
  }

  return {
    isValid: errors.length === 0,
    errors: errors,
    errorMessage: errors.length > 0 ? errors.join('. ') : null
  };
}

/**
 * Gets detailed password requirements with validation status
 * @param {string} password - Password to validate
 * @param {Object} settings - Password settings (optional)
 * @returns {Object} Requirements status with progress and requirements array
 */
export function getPasswordRequirementsStatus(password, settings = DEFAULT_PASSWORD_SETTINGS) {
  const requirements = [];
  
  // Length requirement
  requirements.push({
    text: `from ${settings.minLength} to ${settings.maxLength} characters`,
    isValid: password.length >= settings.minLength && password.length <= settings.maxLength
  });

  // Digits requirement
  if (settings.digits) {
    requirements.push({
      text: 'digits',
      isValid: /\d/.test(password)
    });
  }

  // Uppercase requirement
  if (settings.upperCase) {
    requirements.push({
      text: 'capital letters',
      isValid: /[A-Z]/.test(password)
    });
  }

  // Special symbols requirement
  if (settings.specSymbols) {
    requirements.push({
      text: 'special characters (!@#$%^&*)',
      isValid: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)
    });
  }

  // Calculate progress (0-100)
  const validRequirements = requirements.filter(req => req.isValid).length;
  const totalRequirements = requirements.length;
  const progress = totalRequirements > 0 ? (validRequirements / totalRequirements) * 100 : 0;

  return {
    requirements,
    progress,
    isValid: progress === 100
  };
}

/**
 * Gets password strength requirements as a readable string
 * @returns {string} Requirements description
 */
export function getPasswordRequirements() {
  return 'Password must be 8-128 characters long and contain at least one uppercase letter, one lowercase letter, one digit, and one special character';
}
