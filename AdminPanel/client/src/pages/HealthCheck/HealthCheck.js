import {useState, useEffect} from 'react';
import {checkHealth} from '../../api';
import PageHeader from '../../components/PageHeader/PageHeader';
import PageDescription from '../../components/PageDescription/PageDescription';
import FixedSaveButton from '../../components/FixedSaveButton/FixedSaveButton';
import styles from './HealthCheck.module.scss';

function HealthCheck() {
  const [healthStatus, setHealthStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchHealthStatus = async () => {
    try {
      setLoading(true);
      setError(null);
      const status = await checkHealth();
      setHealthStatus(status);
    } catch (err) {
      setError(err.message);
      setHealthStatus(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealthStatus();
  }, []);

  const getStatusColor = () => {
    if (loading) return '#666';
    if (error) return '#dc3545';
    return '#28a745';
  };

  return (
    <div className={`${styles.healthCheck} ${styles.pageWithFixedSave}`}>
      <PageHeader>Health Check</PageHeader>
      <PageDescription>Monitor the status of DocService backend</PageDescription>

      <div className={styles.statusCard}>
        <div className={styles.statusHeader}>
          <div className={styles.statusIndicator} style={{backgroundColor: getStatusColor()}} />
          <h3 className={styles.statusTitle}>DocService Status</h3>
        </div>

        <div className={styles.statusContent}>
          {error && (
            <div className={styles.error}>
              <h4>{error}</h4>
            </div>
          )}

          {healthStatus && (
            <div className={styles.success}>
              <h4>Service is healthy</h4>
            </div>
          )}
        </div>
      </div>

      <FixedSaveButton onClick={fetchHealthStatus} disabled={loading} disableResult={true}>
        {loading ? 'Checking...' : 'Refresh'}
      </FixedSaveButton>
    </div>
  );
}

export default HealthCheck;
