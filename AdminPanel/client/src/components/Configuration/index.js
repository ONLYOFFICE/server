import { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import { fetchConfiguration, updateConfiguration } from '../../api';
import { getNestedValue } from '../../utils/getNestedValue';
import { mergeNestedObjects } from '../../utils/mergeNestedObjects';
import { configurationSections, ROLES } from '../../config/configurationSchema';
import { selectUser } from '../../store/slices/userSlice';
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

  const filteredSections = configurationSections.map(section => ({
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
  })).filter(section => section.fields.length > 0);

  useEffect(() => {
    const loadConfiguration = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchConfiguration();
        setConfig(data);
        
        const initialValues = {};
        filteredSections.forEach(section => {
          section.fields.forEach(field => {
            initialValues[field.path] = getNestedValue(data, field.path, '');
          });
        });
        setFieldValues(initialValues);
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
        const newErrors = { ...prev };
        delete newErrors[path];
        return newErrors;
      });
    }
  };

  const handleSaveSection = async (sectionTitle) => {
    const section = filteredSections.find(s => s.title === sectionTitle);
    if (!section) return;

    // Clear previous errors for this section
    const newFieldErrors = { ...fieldErrors };
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
        setFieldErrors(prev => ({ ...prev, ...errors }));
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
            {section.fields.map((field) => (
              <ConfigurationField
                key={field.path}
                label={field.label}
                value={fieldValues[field.path] || ''}
                onChange={(value) => handleFieldChange(field.path, value)}
                type={field.type}
                error={fieldErrors[field.path]}
                min={field.min}
                max={field.max}
                options={field.options}
                description={field.description}
              />
            ))}
            
            <Button
              onClick={() => handleSaveSection(section.title)}
              errorText="FAILED"
            >
              SAVE
            </Button>
          </ExpandableSection>
        );
      })}
    </div>
  );
} 