import { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import Ajv from 'ajv';
import { fetchConfiguration, updateConfiguration, fetchConfigurationSchema } from '../../api';
import { getNestedValue } from '../../utils/getNestedValue';
import { selectUser } from '../../store/slices/userSlice';
import styles from './styles.module.css';

const imgSwitch = "http://localhost:3845/assets/38da887d9e7955d2e58c0231b4f42ef734a0e32d.svg";

/**
 * File Size Limits configuration component
 * Manages download limits and enforcement settings for the file converter service
 * @returns {JSX.Element} File Size Limits component
 */
export default function FileSizeLimits() {
  const user = useSelector(selectUser);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [maxDownloadBytes, setMaxDownloadBytes] = useState('');
  const [enforceDownloadLimits, setEnforceDownloadLimits] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [validator, setValidator] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  /**
   * Builds an Ajv validator instance for the provided JSON Schema
   * @param {object} schema - JSON schema for validation
   * @returns {Ajv.ValidateFunction} Compiled validator function
   */
  const buildValidator = (schema) => {
    const ajv = new Ajv({ allErrors: true, strict: false });
    return ajv.compile(schema);
  };

  /**
   * Converts bytes to megabytes for display
   * @param {number} bytes - Size in bytes
   * @returns {string} Size in MB as string
   */
  const bytesToMB = (bytes) => {
    return bytes ? Math.round(bytes / (1024 * 1024)).toString() : '';
  };

  /**
   * Converts megabytes to bytes for storage
   * @param {string} mb - Size in MB as string
   * @returns {number} Size in bytes
   */
  const mbToBytes = (mb) => {
    const num = parseInt(mb, 10);
    return isNaN(num) ? 0 : num * 1024 * 1024;
  };

  useEffect(() => {
    const loadConfiguration = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // Fetch config and schema in parallel
        const [data, schema] = await Promise.all([
          fetchConfiguration(), 
          fetchConfigurationSchema()
        ]);

        // Extract current values
        const currentMaxDownloadBytes = getNestedValue(data, 'FileConverter.converter.maxDownloadBytes', 104857600);
        setMaxDownloadBytes(bytesToMB(currentMaxDownloadBytes));
        
        // For now, enforce limits is always enabled in this design
        setEnforceDownloadLimits(true);

        // Build Ajv validator from schema
        const validateFn = buildValidator(schema);
        setValidator(() => validateFn);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    loadConfiguration();
  }, []);

  /**
   * Handles input change for maximum download size
   * @param {Event} e - Input change event
   */
  const handleMaxDownloadChange = (e) => {
    const value = e.target.value;
    setMaxDownloadBytes(value);
    
    // Clear field error when user modifies the input
    if (fieldErrors.maxDownloadBytes) {
      setFieldErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors.maxDownloadBytes;
        return newErrors;
      });
    }
  };

  /**
   * Handles toggle switch change for enforce limits
   * @param {Event} e - Checkbox change event
   */
  const handleEnforceLimitsChange = (e) => {
    setEnforceDownloadLimits(e.target.checked);
  };

  /**
   * Handles save changes action
   * Validates and updates the configuration
   */
  const handleSaveChanges = async () => {
    try {
      setIsSaving(true);
      setFieldErrors({});

      const bytesValue = mbToBytes(maxDownloadBytes);
      
      // Basic client-side validation
      if (bytesValue <= 0) {
        setFieldErrors({ maxDownloadBytes: 'Value must be greater than 0' });
        return;
      }
      
      if (bytesValue > 104857600) { // 100MB limit from schema
        setFieldErrors({ maxDownloadBytes: 'Value cannot exceed 100MB' });
        return;
      }

      const configUpdate = {
        FileConverter: {
          converter: {
            maxDownloadBytes: bytesValue
          }
        }
      };

      // Validate with Ajv if validator is available
      if (validator) {
        const valid = validator(configUpdate);
        if (!valid && validator.errors) {
          const errors = {};
          validator.errors.forEach(err => {
            if (err.instancePath === '/FileConverter/converter/maxDownloadBytes') {
              errors.maxDownloadBytes = err.message || 'Invalid value';
            }
          });
          if (Object.keys(errors).length > 0) {
            setFieldErrors(errors);
            return;
          }
        }
      }

      await updateConfiguration(configUpdate);
      
    } catch (error) {
      console.error('Save error:', error);
      
      // Handle validation errors from backend
      if (error.error && error.error.details && Array.isArray(error.error.details)) {
        const errors = {};
        error.error.details.forEach(detail => {
          if (detail.path && detail.message) {
            const fieldPath = detail.path.join('.');
            if (fieldPath === 'FileConverter.converter.maxDownloadBytes') {
              errors.maxDownloadBytes = detail.message;
            }
          }
        });
        setFieldErrors(errors);
      } else {
        setError('Failed to save configuration');
      }
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) {
    return <div className={styles.loading}>Loading configuration...</div>;
  }

  if (error) {
    return <div className={styles.error}>Error: {error}</div>;
  }

  // Only show to admin users
  if (!user?.isAdmin) {
    return null;
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>File Size Limits</h1>
        <p className={styles.subtitle}>Configure upload and download limits for your platform</p>
      </div>
      
      <div className={styles.content}>
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <h3 className={styles.sectionTitle}>Download Limits H3</h3>
            <p className={styles.sectionDescription}>Control download restrictions and bandwidth</p>
          </div>
          
          <div className={styles.inputGroup}>
            <label className={styles.inputLabel}>Maximum Download (MB)</label>
            <div className={styles.inputContainer}>
              <input
                type="text"
                value={maxDownloadBytes}
                onChange={handleMaxDownloadChange}
                placeholder="Enter value"
                className={`${styles.input} ${fieldErrors.maxDownloadBytes ? styles.inputError : ''}`}
              />
              {fieldErrors.maxDownloadBytes && (
                <div className={styles.errorMessage}>{fieldErrors.maxDownloadBytes}</div>
              )}
            </div>
          </div>
          
          <div className={styles.toggleGroup}>
            <span className={styles.toggleLabel}>Enforce Download Limits</span>
            <div className={styles.toggleContainer}>
              <div className={styles.switchContainer}>
                <img 
                  src={imgSwitch} 
                  alt="Toggle switch" 
                  className={styles.switchImage}
                />
                <input
                  type="checkbox"
                  checked={enforceDownloadLimits}
                  onChange={handleEnforceLimitsChange}
                  className={styles.switchInput}
                />
              </div>
              <span className={styles.toggleStatus}>
                {enforceDownloadLimits ? 'On' : 'Off'}
              </span>
            </div>
          </div>
        </div>
      </div>
      
      <button 
        className={`${styles.saveButton} ${isSaving ? styles.saving : ''}`}
        onClick={handleSaveChanges}
        disabled={isSaving}
      >
        {isSaving ? 'Saving...' : 'Save Changes'}
      </button>
    </div>
  );
}
