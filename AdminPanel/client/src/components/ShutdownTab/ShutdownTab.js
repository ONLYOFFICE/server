import {useQuery, useMutation, useQueryClient} from '@tanstack/react-query';
import Button from '../Button/Button';
import Section from '../Section/Section';
import {enterMaintenanceMode, exitMaintenanceMode, getMaintenanceStatus} from '../../api';
import styles from './ShutdownTab.module.scss';

const SHUTDOWN_TITLE = 'Server Shutdown';
const SHUTDOWN_DESCRIPTION =
  'Control server shutdown mode. In shutdown mode, new editor connections are blocked and existing sessions are gracefully closed. This does not restart the server process.';

const ShutdownTab = () => {
  const queryClient = useQueryClient();

  const {data: maintenanceStatus = {shutdown: false}, isLoading: statusLoading} = useQuery({
    queryKey: ['maintenanceStatus'],
    queryFn: getMaintenanceStatus,
    retry: false,
    onError: () => {}
  });

  const shutdownMutation = useMutation({
    mutationFn: enterMaintenanceMode,
    onSuccess: () => {
      queryClient.setQueryData(['maintenanceStatus'], prev => ({...(prev || {}), shutdown: true}));
    }
  });

  const resumeMutation = useMutation({
    mutationFn: exitMaintenanceMode,
    onSuccess: () => {
      queryClient.setQueryData(['maintenanceStatus'], prev => ({...(prev || {}), shutdown: false}));
    }
  });

  const handleShutdown = async () => {
    const confirmed = window.confirm(
      'Shutdown server? This will block new editor connections and gracefully close existing sessions. The server will remain in this state until you resume it or restart it manually.'
    );

    if (!confirmed) {
      return;
    }

    await shutdownMutation.mutateAsync();
  };

  const handleResume = async () => {
    await resumeMutation.mutateAsync();
  };

  if (statusLoading) {
    return (
      <Section title={SHUTDOWN_TITLE} description={SHUTDOWN_DESCRIPTION}>
        <div className={styles.loading}>Loading status...</div>
      </Section>
    );
  }

  return (
    <Section title={SHUTDOWN_TITLE} description={SHUTDOWN_DESCRIPTION}>
      <div className={styles.container}>
        <div className={`${styles.statusBadge} ${maintenanceStatus.shutdown ? styles.statusBadgeWarning : styles.statusBadgeSuccess}`}>
          <div className={styles.statusTitle}>Current Status:</div>
          <div className={styles.statusContent}>
            {maintenanceStatus.shutdown ? (
              <span className={styles.statusTextWarning}>⚠️ Shutdown Mode Active - New connections blocked</span>
            ) : (
              <span className={styles.statusTextSuccess}>✓ Normal Operation - Accepting new connections</span>
            )}
          </div>
        </div>

        <div>
          <Button onClick={handleShutdown} disabled={maintenanceStatus.shutdown || shutdownMutation.isPending} disableResult={true}>
            Shutdown
          </Button>
          <p className={styles.buttonDescription}>
            Blocks new editor connections and closes existing sessions. Use before restarting nodes or performing maintenance.
          </p>
        </div>
        <div>
          <Button onClick={handleResume} disabled={!maintenanceStatus.shutdown || resumeMutation.isPending}>
            Resume
          </Button>
          <p className={styles.buttonDescription}>Returns server to normal mode and allows new editor connections.</p>
        </div>
      </div>
    </Section>
  );
};

export default ShutdownTab;
