import {useQuery, useMutation, useQueryClient} from '@tanstack/react-query';
import Button from '../Button/Button';
import Section from '../Section/Section';
import Note from '../Note/Note';
import {enterMaintenanceMode, exitMaintenanceMode, getMaintenanceStatus} from '../../api';
import styles from './ShutdownTab.module.scss';

const SHUTDOWN_TITLE = 'Server Shutdown';
const SHUTDOWN_DESCRIPTION =
  'Control server shutdown mode. In shutdown mode, new editor connections are blocked and existing sessions are gracefully closed. This does not restart the server process.';

const ShutdownTab = () => {
  const queryClient = useQueryClient();

  const {
    data: maintenanceStatus,
    isLoading: statusLoading,
    isError: statusError,
    error
  } = useQuery({
    queryKey: ['maintenanceStatus'],
    queryFn: getMaintenanceStatus,
    retry: false
  });

  const shutdownMutation = useMutation({
    mutationFn: enterMaintenanceMode,
    onSuccess: () => {
      queryClient.invalidateQueries({queryKey: ['maintenanceStatus']});
    }
  });

  const resumeMutation = useMutation({
    mutationFn: exitMaintenanceMode,
    onSuccess: () => {
      queryClient.invalidateQueries({queryKey: ['maintenanceStatus']});
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

  if (statusError) {
    return (
      <Section title={SHUTDOWN_TITLE} description={SHUTDOWN_DESCRIPTION}>
        <Note type='warning' title='Failed to Load Status'>
          Unable to connect to DocService. {error?.message || 'Please check if the service is running.'}
        </Note>
      </Section>
    );
  }

  return (
    <Section title={SHUTDOWN_TITLE} description={SHUTDOWN_DESCRIPTION}>
      <div className={styles.container}>
        <div className={styles.statusNote}>
          {maintenanceStatus?.shutdown ? (
            <Note type='warning' title='Shutdown Mode Active'>
              New connections are blocked and existing sessions are being closed.
            </Note>
          ) : (
            <Note type='success' title='Normal Operation'>
              Server is accepting new connections.
            </Note>
          )}
        </div>

        <div>
          <Button onClick={handleShutdown} disabled={maintenanceStatus?.shutdown || shutdownMutation.isPending}>
            Shutdown
          </Button>
          <p className={styles.buttonDescription}>
            Blocks new editor connections and closes existing sessions. Use before restarting nodes or performing maintenance.
          </p>
        </div>
        <div>
          <Button onClick={handleResume} disabled={!maintenanceStatus?.shutdown || resumeMutation.isPending}>
            Resume
          </Button>
          <p className={styles.buttonDescription}>Returns server to normal mode and allows new editor connections.</p>
        </div>
      </div>
    </Section>
  );
};

export default ShutdownTab;
