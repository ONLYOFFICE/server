import {useState, useEffect} from 'react';
import {fetchConfiguration} from '../../api';
import styles from './ConfigViewer.module.scss';

const ConfigViewer = () => {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [jsonString, setJsonString] = useState('');

  useEffect(() => {
    const loadConfig = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchConfiguration();
        setConfig(data);
        setJsonString(JSON.stringify(data, null, 2));
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    loadConfig();
  }, []);

  const copyToClipboard = () => {
    if (jsonString) {
      navigator.clipboard.writeText(jsonString);
    }
  };

  if (loading) {
    return <div className={styles.loading}>Loading configuration...</div>;
  }

  if (error || !config) {
    return (
      <div className={styles.error}>
        <p>Error loading configuration: {error}</p>
      </div>
    );
  }

  return (
    <div className={styles.configViewer}>
      <div className={styles.toolbar}>
        <p className={styles.description}>
          Sensitive parameters (passwords, keys, secrets) are shown as <span className={styles.redactedBadge}>REDACTED</span>.
        </p>
        <button className={styles.copyButton} onClick={copyToClipboard}>
          Copy JSON
        </button>
      </div>
      <div className={styles.configContent}>
        <pre className={styles.jsonPre}>{jsonString}</pre>
      </div>
    </div>
  );
};

export default ConfigViewer;
