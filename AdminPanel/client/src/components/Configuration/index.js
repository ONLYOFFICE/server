import {useState, useEffect} from 'react';
import {useSelector} from 'react-redux';
import Ajv from 'ajv';
import {fetchConfiguration, updateConfiguration, fetchConfigurationSchema} from '../../api';
import {getNestedValue} from '../../utils/getNestedValue';
import {mergeNestedObjects} from '../../utils/mergeNestedObjects';
import {configurationSections, ROLES} from '../../config/configurationSchema';
import {selectUser} from '../../store/slices/userSlice';
import ExpandableSection from '../ExpandableSection';
import ConfigurationField from '../ConfigurationInput';
import Button from '../Button';
import styles from './styles.module.css';

export default function Configuration() {
  const user = useSelector(selectUser);
  const [, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fieldValues, setFieldValues] = useState({});
  const [fieldErrors, setFieldErrors] = useState({});
  const [validator, setValidator] = useState(null);

  // Cron expression with 6 space-separated fields (server-compatible)
  const CRON6_REGEX = /^\s*\S+(?:\s+\S+){5}\s*$/;

  /**
   * Builds an Ajv validator instance for the provided JSON Schema.
   * @param {object} schema - Derived per-scope JSON schema
   * @returns {Ajv.ValidateFunction}
   */
  const buildValidator = schema => {
    const ajv = new Ajv({allErrors: true, strict: false});
    ajv.addFormat('cron6', CRON6_REGEX);
    return ajv.compile(schema);
  };

  /**
   * Converts Ajv errors to a field error map suitable for UI display.
   * @param {Ajv.ErrorObject[]} errors
   * @param {Set<string>} allowedPaths - Field paths in the current section to filter on
   * @returns {Record<string, string>}
   */
  const ajvErrorsToFieldErrors = (errors, allowedPaths) => {
    const result = {};
    if (!Array.isArray(errors)) return result;

    for (const err of errors) {
      const fieldPath = (err.instancePath || '').replace(/^\/|\/$/g, '').replace(/\//g, '.');
      if (allowedPaths.has(fieldPath)) {
        result[fieldPath] = err.message || 'Invalid value';
      }
    }
    return result;
  };

  const filteredSections = configurationSections
    .map(section => ({
      ...section,
      fields: section.fields.filter(field => {
        if (user?.isAdmin && field.roles.includes(ROLES.ADMIN)) {
          return true;
        }
        if (!user?.isAdmin && field.roles.includes(ROLES.USER)) {
          return true;
        }

        return false;
      })
    }))
    .filter(section => section.fields.length > 0);

  useEffect(() => {
    const loadConfiguration = async () => {
      try {
        setLoading(true);
        setError(null);
        // Fetch config and schema in parallel
        const [data, schema] = await Promise.all([fetchConfiguration(), fetchConfigurationSchema()]);
        setConfig(data);

        const initialValues = {};
        filteredSections.forEach(section => {
          section.fields.forEach(field => {
            initialValues[field.path] = getNestedValue(data, field.path, '');
          });
        });
        setFieldValues(initialValues);

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

  const handleFieldChange = (path, value) => {
    setFieldValues(prev => ({
      ...prev,
      [path]: value
    }));
    // Clear error for this field when user modifies it
    if (fieldErrors[path]) {
      setFieldErrors(prev => {
        const newErrors = {...prev};
        delete newErrors[path];
        return newErrors;
      });
    }
  };

  const handleSaveSection = async sectionTitle => {
    const section = filteredSections.find(s => s.title === sectionTitle);
    if (!section) return;

    // Clear previous errors for this section
    const newFieldErrors = {...fieldErrors};
    section.fields.forEach(field => {
      delete newFieldErrors[field.path];
    });
    setFieldErrors(newFieldErrors);

    const changedObjects = section.fields.map(field => {
      const obj = {};
      obj[field.path] = fieldValues[field.path];
      return obj;
    });

    const mergedConfig = mergeNestedObjects(changedObjects);

    // Client-side validation using Ajv and the server-provided schema
    if (validator) {
      const valid = validator(mergedConfig);
      if (!valid) {
        const allowed = new Set(section.fields.map(f => f.path));
        const errorsMap = ajvErrorsToFieldErrors(validator.errors, allowed);
        if (Object.keys(errorsMap).length > 0) {
          setFieldErrors(prev => ({...prev, ...errorsMap}));
          throw new Error('Validation failed');
        }
      }
    }

    try {
      await updateConfiguration(mergedConfig);
    } catch (error) {
      console.log('error777', JSON.stringify(error));
      // Handle validation errors from backend
      if (error.error && error.error.details && Array.isArray(error.error.details)) {
        const errors = {};
        error.error.details.forEach(detail => {
          if (detail.path && detail.message) {
            // Join the path array to create the field path
            const fieldPath = detail.path.join('.');
            errors[fieldPath] = detail.message;
          }
        });
        setFieldErrors(prev => ({...prev, ...errors}));
      } else {
        // Handle other types of errors
        console.error('Save error:', error);
      }
      throw error; // Re-throw to trigger error state in Button component
    }
  };

  if (loading) {
    return <div className={styles.loading}>Loading configuration...</div>;
  }

  if (error) {
    return <div className={styles.error}>Error: {error}</div>;
  }

  return (
    <div className={styles.configuration}>
      {filteredSections.map((section, index) => {
        return (
          <ExpandableSection key={index} title={section.title}>
            {section.fields.map(field => (
              <ConfigurationField
                key={field.path}
                label={field.label}
                value={fieldValues[field.path] || ''}
                onChange={value => handleFieldChange(field.path, value)}
                type={field.type}
                error={fieldErrors[field.path]}
                min={field.min}
                max={field.max}
                options={field.options}
                description={field.description}
              />
            ))}

            <Button onClick={() => handleSaveSection(section.title)} errorText='FAILED'>
              SAVE
            </Button>
          </ExpandableSection>
        );
      })}
    </div>
  );
}
