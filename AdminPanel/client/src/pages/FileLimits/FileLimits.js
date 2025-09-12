import { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { fetchConfig, saveConfig, selectConfig, selectConfigLoading } from '../../store/slices/configSlice';
import { getNestedValue } from '../../utils/getNestedValue';
import { mergeNestedObjects } from '../../utils/mergeNestedObjects';
import { useFieldValidation } from '../../hooks/useFieldValidation';
import PageHeader from '../../components2/PageHeader/PageHeader';
import PageDescription from '../../components2/PageDescription/PageDescription';
import Input from '../../components2/Input/Input';
import SaveButton from '../../components2/SaveButton/SaveButton';
import styles from './FileLimits.module.scss';

function FileLimits() {
  const dispatch = useDispatch();
  const config = useSelector(selectConfig);
  const loading = useSelector(selectConfigLoading);
  const { validateField, getFieldError } = useFieldValidation();
  
  // Local state for form fields
  const [localSettings, setLocalSettings] = useState({
    maxDownloadBytes: '',
    docxUncompressed: '',
    xlsxUncompressed: '',
    pptxUncompressed: ''
  });
  const [hasChanges, setHasChanges] = useState(false);

  // Configuration paths
  const CONFIG_PATHS = {
    maxDownloadBytes: 'FileConverter.converter.maxDownloadBytes',
    docxUncompressed: 'FileConverter.converter.inputLimits.0.zip.uncompressed',
    xlsxUncompressed: 'FileConverter.converter.inputLimits.1.zip.uncompressed', 
    pptxUncompressed: 'FileConverter.converter.inputLimits.2.zip.uncompressed'
  };

  // Load config data when component mounts
  useEffect(() => {
    if (!config) {
      dispatch(fetchConfig());
    } else {
      const settings = {};
      
      // Get max download bytes
      settings.maxDownloadBytes = getNestedValue(config, CONFIG_PATHS.maxDownloadBytes, '');
      
      // Get input limits - need to handle array structure
      const inputLimits = getNestedValue(config, 'FileConverter.converter.inputLimits', []);
      
      // Find limits by document type
      const docxLimit = inputLimits.find(limit => limit.type && limit.type.includes('docx'));
      const xlsxLimit = inputLimits.find(limit => limit.type && limit.type.includes('xlsx'));
      const pptxLimit = inputLimits.find(limit => limit.type && limit.type.includes('pptx'));
      
      settings.docxUncompressed = docxLimit?.zip?.uncompressed || '';
      settings.xlsxUncompressed = xlsxLimit?.zip?.uncompressed || '';
      settings.pptxUncompressed = pptxLimit?.zip?.uncompressed || '';
      
      setLocalSettings(settings);
      setHasChanges(false);
    }
  }, [dispatch, config]);


  // Handle field changes
  const handleFieldChange = (field, value) => {
    setLocalSettings(prev => ({
      ...prev,
      [field]: value
    }));

    // Validate the field if it's maxDownloadBytes (has schema validation)
    if (field === 'maxDownloadBytes' && value !== '') {
      const numericValue = parseInt(value);
      if (!isNaN(numericValue)) {
        validateField(CONFIG_PATHS.maxDownloadBytes, numericValue);
      }
    }

    // Check if there are changes
    const hasFieldChanges = Object.keys(localSettings).some(key => {
      const currentValue = key === field ? value : localSettings[key];
      let originalValue;
      
      if (key === 'maxDownloadBytes') {
        originalValue = getNestedValue(config, CONFIG_PATHS.maxDownloadBytes, '');
      } else {
        // Handle input limits array structure for comparison
        const inputLimits = getNestedValue(config, 'FileConverter.converter.inputLimits', []);
        if (key === 'docxUncompressed') {
          const docxLimit = inputLimits.find(limit => limit.type && limit.type.includes('docx'));
          originalValue = docxLimit?.zip?.uncompressed || '';
        } else if (key === 'xlsxUncompressed') {
          const xlsxLimit = inputLimits.find(limit => limit.type && limit.type.includes('xlsx'));
          originalValue = xlsxLimit?.zip?.uncompressed || '';
        } else if (key === 'pptxUncompressed') {
          const pptxLimit = inputLimits.find(limit => limit.type && limit.type.includes('pptx'));
          originalValue = pptxLimit?.zip?.uncompressed || '';
        }
      }
      
      return currentValue.toString() !== originalValue.toString();
    });
    
    setHasChanges(hasFieldChanges);
  };

  // Handle save
  const handleSave = async () => {
    if (!hasChanges) return;

    // Create config update object
    const configUpdate = {};
    
    // Set max download bytes
    configUpdate['FileConverter.converter.maxDownloadBytes'] = parseInt(localSettings.maxDownloadBytes);
    
    // Update input limits - we need to preserve the existing structure
    const currentInputLimits = getNestedValue(config, 'FileConverter.converter.inputLimits', []);
    const updatedInputLimits = currentInputLimits.map(limit => {
      if (limit.type && limit.type.includes('docx')) {
        return {
          ...limit,
          zip: {
            ...limit.zip,
            uncompressed: localSettings.docxUncompressed
          }
        };
      } else if (limit.type && limit.type.includes('xlsx')) {
        return {
          ...limit,
          zip: {
            ...limit.zip,
            uncompressed: localSettings.xlsxUncompressed
          }
        };
      } else if (limit.type && limit.type.includes('pptx')) {
        return {
          ...limit,
          zip: {
            ...limit.zip,
            uncompressed: localSettings.pptxUncompressed
          }
        };
      }
      return limit;
    });
    
    configUpdate['FileConverter.converter.inputLimits'] = updatedInputLimits;

    const mergedConfig = mergeNestedObjects([configUpdate]);
    await dispatch(saveConfig(mergedConfig)).unwrap();
    setHasChanges(false);
  };

  if (loading) {
    return (
      <div className={styles.loading}>
        Loading file limits settings...
      </div>
    );
  }

  return (
    <div className={styles.fileLimits}>
      <PageHeader>File Size Limits</PageHeader>
      <PageDescription>
        Configure maximum file sizes and download limits for document processing
      </PageDescription>

      <div className={styles.settingsSection}>
        <div className={styles.sectionTitle}>Download Limits</div>
        
        <div className={styles.formRow}>
          <Input
            label="Max Download Bytes"
            type="number"
            value={localSettings.maxDownloadBytes}
            onChange={(value) => handleFieldChange('maxDownloadBytes', value)}
            placeholder="104857600"
            description="Maximum number of bytes that can be downloaded (e.g., 104857600 = 100MB)"
            min="0"
            error={getFieldError(CONFIG_PATHS.maxDownloadBytes)}
          />
        </div>
      </div>

      <div className={styles.settingsSection}>
        <div className={styles.sectionTitle}>Input File Size Limits</div>
        <div className={styles.sectionDescription}>
          Configure uncompressed size limits for different document types when processing ZIP archives
        </div>
        
        <div className={styles.formRow}>
          <Input
            label="Word Documents (DOCX, DOTX, DOCM, DOTM)"
            value={localSettings.docxUncompressed}
            onChange={(value) => handleFieldChange('docxUncompressed', value)}
            placeholder="50MB"
            description="Maximum uncompressed size for Word document archives"
          />
        </div>

        <div className={styles.formRow}>
          <Input
            label="Excel Documents (XLSX, XLTX, XLSM, XLTM)"
            value={localSettings.xlsxUncompressed}
            onChange={(value) => handleFieldChange('xlsxUncompressed', value)}
            placeholder="300MB"
            description="Maximum uncompressed size for Excel document archives"
          />
        </div>

        <div className={styles.formRow}>
          <Input
            label="PowerPoint Documents (PPTX, PPSX, POTX, PPTM, PPSM, POTM)"
            value={localSettings.pptxUncompressed}
            onChange={(value) => handleFieldChange('pptxUncompressed', value)}
            placeholder="50MB"
            description="Maximum uncompressed size for PowerPoint document archives"
          />
        </div>
      </div>

      <div className={styles.actions}>
        <SaveButton 
          onClick={handleSave}
          disabled={!hasChanges}
        >
          Save Changes
        </SaveButton>
      </div>
    </div>
  );
}

export default FileLimits;
