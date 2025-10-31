import {useFieldValidation} from '../hooks/useFieldValidation';
import {useMemo} from 'react';

/**
 * Hook for password validation
 * @param {string} password - Password to validate
 * @returns {Object} { isValid, errorMessage, invalidRules, isLoading, error }
 */
export function usePasswordValidation(password) {
  const {validateField, isLoading} = useFieldValidation();

  const validationResult = useMemo(() => {
    const rules = ['minLength', 'hasDigit', 'hasUppercase', 'hasSpecialChar', 'allowedCharactersOnly'];

    const invalidRules = rules.filter(rule => {
      const fieldPath = `adminPanel.passwordValidation.${rule}`;
      const error = validateField(fieldPath, password || '');
      return !!error;
    });

    return {
      isValid: invalidRules.length === 0,
      invalidRules
    };
  }, [validateField, password]);

  return {
    ...validationResult,
    isLoading
  };
}
