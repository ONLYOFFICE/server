import {useState, useEffect} from 'react';
import styles from './styles.module.css';

export default function JsonField({
  label,
  value,
  onChange,
  placeholder = '',
  error = null,
  description = null
}) {
  const [jsonError, setJsonError] = useState(null);
  const [isValidJson, setIsValidJson] = useState(true);

  // Validate JSON on every change
  useEffect(() => {
    if (value.trim() === '') {
      setJsonError(null);
      setIsValidJson(true);
      return;
    }

    try {
      JSON.parse(value);
      setJsonError(null);
      setIsValidJson(true);
    } catch (err) {
      setJsonError(`Invalid JSON: ${err.message}`);
      setIsValidJson(false);
    }
  }, [value]);

  const formatJson = () => {
    if (value.trim() !== '') {
      try {
        const parsed = JSON.parse(value);
        const formatted = JSON.stringify(parsed, null, 2);
        onChange(formatted);
      } catch (err) {
        // If JSON is invalid, don't format
        console.warn('Cannot format invalid JSON:', err);
      }
    }
  };

  const lines = value.split('\n');
  const lineNumbers = lines.map((_, index) => index + 1);

  return (
    <div className={styles.field}>
      <label className={styles.label}>{label}</label>
      <div className={styles.inputContainer}>
        <div className={styles.jsonContainer}>
          <div className={styles.lineNumbers}>
            {lineNumbers.map(num => (
              <div key={num} className={styles.lineNumber}>{num}</div>
            ))}
          </div>
          <textarea
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
            className={`${styles.textarea} ${error || jsonError ? styles.inputError : ''}`}
            rows={10}
            spellCheck={false}
          />
          <button
            type="button"
            className={styles.formatButton}
            onClick={formatJson}
            disabled={!isValidJson}
            title="Format JSON"
          >
            Format
          </button>
        </div>
        {(error || jsonError) && <div className={styles.errorMessage}>{error || jsonError}</div>}
      </div>
    </div>
  );
}
