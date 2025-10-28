import styles from './styles.module.css';

/**
 * Mode switcher component for statistics view.
 * Persists selected mode to localStorage via parent.
 *
 * @param {{
 *  mode: 'all'|'edit'|'view',
 *  setMode: (mode: 'all'|'edit'|'view') => void
 * }} props
 */
export default function ModeSwitcher({mode, setMode}) {
  return (
    <div className={styles.modeBar}>
      <span className={`${styles.modeLink} ${mode === 'all' ? styles.current : ''}`} onClick={() => setMode('all')}>
        All
      </span>
      <span className={styles.modeSeparator}>|</span>
      <span className={`${styles.modeLink} ${mode === 'edit' ? styles.current : ''}`} onClick={() => setMode('edit')}>
        Editors
      </span>
      <span className={styles.modeSeparator}>|</span>
      <span className={`${styles.modeLink} ${mode === 'view' ? styles.current : ''}`} onClick={() => setMode('view')}>
        Live Viewer
      </span>
    </div>
  );
}
