import {useState, useEffect} from 'react';
import {useSelector} from 'react-redux';
import Ajv from 'ajv';
import {fetchConfiguration, updateConfiguration, fetchConfigurationSchema} from '../../api';
import {getNestedValue} from '../../utils/getNestedValue';
import {mergeNestedObjects} from '../../utils/mergeNestedObjects';
import {configurationSections, ROLES} from '../../config/configurationSchema';
import {selectUser} from '../../store/slices/userSlice';
import ExpandableSection from '../ExpandableSection';
import ConfigurationInput from '../ConfigurationInput';
import SelectField from '../SelectField';
import JsonField from '../JsonField';
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
            let value = getNestedValue(data, field.path, '');
            
            // Stringify JSON values for json type fields
            if (field.type === 'json' && value !== '') {
              try {
                value = JSON.stringify(value, null, 2);
              } catch (error) {
                console.warn(`Failed to stringify JSON for field ${field.path}:`, error);
              }
            }
            
            initialValues[field.path] = value;
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
      let value = fieldValues[field.path];
      
      // Parse JSON values for json type fields
      if (field.type === 'json') {
        try {
          value = JSON.parse(value);
        } catch (error) {
          // If JSON parsing fails, keep the string value and let backend validation handle it
          console.warn(`Failed to parse JSON for field ${field.path}:`, error);
        }
      }
      
      if (field.type === 'checkbox') {
        value = Boolean(value);
      }
      
      obj[field.path] = value;
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
      // Handle validation errors from backend
      if (error.error && error.error.details && Array.isArray(error.error.details)) {
        const errors = {};
        error.error.details.forEach(detail => {
          if (detail.path && detail.message) {
            // Find the field that contains this error path
            let fieldPath = null;
            
            // Check each field in the current section to see if the error path starts with the field path
            section.fields.forEach(field => {
              const fieldPathParts = field.path.split('.');
              const errorPathParts = detail.path;
              
              // Check if the error path starts with the field path
              if (fieldPathParts.length <= errorPathParts.length) {
                let matches = true;
                for (let i = 0; i < fieldPathParts.length; i++) {
                  if (fieldPathParts[i] !== errorPathParts[i]) {
                    matches = false;
                    break;
                  }
                }
                if (matches) {
                  fieldPath = field.path;
                }
              }
            });
            
            // If we found a matching field, use it; otherwise use the full path
            if (fieldPath) {
              errors[fieldPath] = detail.message;
            } else {
              // Fallback: use the full path
              errors[detail.path.join('.')] = detail.message;
            }
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
            {section.fields.map(field => {
              // Select component based on type
              let FieldComponent;
              switch (field.type) {
                case 'select':
                  FieldComponent = SelectField;
                  break;
                case 'json':
                  FieldComponent = JsonField;
                  break;
                default:
                  FieldComponent = ConfigurationInput;
                  break;
              }

              return (
                <FieldComponent
                  key={field.path}
                  label={field.label}
                  value={fieldValues[field.path] || ''}
                  onChange={value => handleFieldChange(field.path, value)}
                  type={field.type}
                  error={fieldErrors[field.path]}
                  min={field.min}
                  max={field.max}
                  options={field.options}
                  // description={field.description}
                />
              );
            })}

            <Button onClick={() => handleSaveSection(section.title)} errorText='FAILED'>
              SAVE
            </Button>
          </ExpandableSection>
        );
      })}
    </div>
  );
}
