import styles from './styles.module.css';

/**
 * Component to display when the server is unavailable
 */
export default function ServerUnavailable() {
  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>Admin Panel Not Available</h1>
        <p className={styles.description}>
          By default, the Admin Panel is disabled. You need to start it manually or add it to autostart. If the service is already running, there may
          be a network connection issue or server configuration problem.
        </p>
      </div>
    </div>
  );
}
