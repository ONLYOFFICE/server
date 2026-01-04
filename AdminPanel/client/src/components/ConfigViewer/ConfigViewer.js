import {useMemo, useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {fetchConfiguration} from '../../api';
import styles from './ConfigViewer.module.scss';

const ConfigViewer = () => {
  const [copySuccess, setCopySuccess] = useState(false);

  const {
    data: config,
    isLoading,
    isError,
    error
  } = useQuery({
    queryKey: ['configuration'],
    queryFn: fetchConfiguration,
    retry: false
  });

  const jsonString = useMemo(() => {
    return config ? JSON.stringify(config, null, 2) : '';
  }, [config]);

  const copyToClipboard = async () => {
    if (!jsonString) return;
    try {
      await navigator.clipboard.writeText(jsonString);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      // Clipboard API may fail on HTTP or restricted contexts
    }
  };

  if (isLoading) {
    return <div className={styles.loading}>Loading configuration...</div>;
  }

  if (isError || !config) {
    return (
      <div className={styles.error}>
        <p>Error loading configuration: {error?.message || 'Unknown error'}</p>
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
          {copySuccess ? '✓ Copied!' : 'Copy JSON'}
        </button>
      </div>
      <div className={styles.configContent}>
        <pre className={styles.jsonPre}>{jsonString}</pre>
      </div>
    </div>
  );
};

export default ConfigViewer;
