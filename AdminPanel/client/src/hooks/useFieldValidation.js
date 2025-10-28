import {useState, useEffect, useCallback} from 'react';
import {useSelector} from 'react-redux';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import {selectSchema, selectSchemaLoading, selectSchemaError} from '../store/slices/configSlice';

// Cron expression with 6 space-separated fields (server-compatible)
const CRON6_REGEX = /^\s*\S+(?:\s+\S+){5}\s*$/;

/**
 * Hook for field validation using backend schema
 * @returns {Object} { validateField, getFieldError, isLoading, error }
 */
export const useFieldValidation = () => {
  const [validator, setValidator] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  const schema = useSelector(selectSchema);
  const isLoading = useSelector(selectSchemaLoading);
  const error = useSelector(selectSchemaError);

  useEffect(() => {
    if (schema && !validator) {
      try {
        // Build AJV validator with custom and standard formats
        const ajv = new Ajv({allErrors: true, strict: false});
        addFormats(ajv); // Add standard formats including email
        ajv.addFormat('cron6', CRON6_REGEX); // Add custom cron6 format

        const validateFn = ajv.compile(schema);
        setValidator(() => validateFn);
      } catch (err) {
        console.error('Failed to initialize field validator:', err);
      }
    }
  }, [schema, validator]);

  /**
   * Validates a single field value against the schema
   * @param {string} fieldPath - Dot-notation path to the field (e.g., 'FileConverter.converter.maxDownloadBytes')
   * @param {*} value - Value to validate
   * @returns {string|null} Error message or null if valid
   */
  const validateField = useCallback(
    (fieldPath, value) => {
      if (!validator) {
        return null; // No validator available yet
      }

      // Create a minimal object with just the field we want to validate
      const testObject = createNestedObject(fieldPath, value);

      // Validate the test object
      const isValid = validator(testObject);

      if (!isValid && validator.errors) {
        // Find errors that match our field path
        const relevantErrors = validator.errors.filter(err => {
          const errorPath = (err.instancePath || '').replace(/^\/|\/$/g, '').replace(/\//g, '.');
          return errorPath === fieldPath || errorPath === '';
        });

        if (relevantErrors.length > 0) {
          const errorMessage = relevantErrors[0].message || 'Invalid value';
          setFieldErrors(prev => ({...prev, [fieldPath]: errorMessage}));
          return errorMessage;
        }
      }

      // Clear any existing error for this field
      setFieldErrors(prev => {
        const newErrors = {...prev};
        delete newErrors[fieldPath];
        return newErrors;
      });

      return null;
    },
    [validator]
  );

  /**
   * Gets the current error message for a field
   * @param {string} fieldPath - Dot-notation path to the field
   * @returns {string|null} Error message or null
   */
  const getFieldError = useCallback(
    fieldPath => {
      return fieldErrors[fieldPath] || null;
    },
    [fieldErrors]
  );

  /**
   * Clears error for a specific field
   * @param {string} fieldPath - Dot-notation path to the field
   */
  const clearFieldError = useCallback(fieldPath => {
    setFieldErrors(prev => {
      const newErrors = {...prev};
      delete newErrors[fieldPath];
      return newErrors;
    });
  }, []);

  /**
   * Checks if there are any validation errors
   * @returns {boolean} True if there are validation errors
   */
  const hasValidationErrors = useCallback(() => {
    return Object.keys(fieldErrors).length > 0;
  }, [fieldErrors]);

  return {
    validateField,
    getFieldError,
    clearFieldError,
    hasValidationErrors,
    isLoading,
    error
  };
};

/**
 * Creates a nested object from a dot-notation path and value
 * @param {string} path - Dot-notation path (e.g., 'FileConverter.converter.maxDownloadBytes')
 * @param {*} value - Value to set
 * @returns {Object} Nested object
 */
export function createNestedObject(path, value) {
  const parts = path.split('.');
  const result = {};
  let current = result;

  for (let i = 0; i < parts.length - 1; i++) {
    current[parts[i]] = {};
    current = current[parts[i]];
  }

  current[parts[parts.length - 1]] = value;
  return result;
}
