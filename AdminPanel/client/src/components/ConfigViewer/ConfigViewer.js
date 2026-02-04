import {useMemo} from 'react';
import {useSelector} from 'react-redux';
import {selectConfig, selectConfigLoading, selectConfigError} from '../../store/slices/configSlice';
import Button from '../Button/Button';
import styles from './ConfigViewer.module.scss';

const ConfigViewer = () => {
  const config = useSelector(selectConfig);
  const isLoading = useSelector(selectConfigLoading);
  const error = useSelector(selectConfigError);

  const jsonString = useMemo(() => {
    return config ? JSON.stringify(config, null, 2) : '';
  }, [config]);

  const copyToClipboard = async () => {
    if (!jsonString) return;
    await navigator.clipboard.writeText(jsonString);
  };

  if (isLoading) {
    return <div className={styles.loading}>Loading configuration...</div>;
  }

  if (error || !config) {
    return (
      <div className={styles.error}>
        <p>Error loading configuration: {typeof error === 'string' ? error : error?.message || 'Unknown error'}</p>
      </div>
    );
  }

  return (
    <div className={styles.configViewer}>
      <div className={styles.toolbar}>
        <p className={styles.description}>
          Sensitive parameters (passwords, keys, secrets) are shown as <span className={styles.redactedBadge}>REDACTED</span>.
        </p>
        <Button onClick={copyToClipboard}>Copy JSON</Button>
      </div>
      <div className={styles.configContent}>
        <pre className={styles.jsonPre}>{jsonString}</pre>
      </div>
    </div>
  );
};

export default ConfigViewer;
