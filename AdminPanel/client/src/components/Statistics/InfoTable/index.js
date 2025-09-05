import styles from './styles.module.css';

/**
 * Renders a two-section info table for Editor and Live Viewer values.
 * Values can optionally include a status class in v[1] like 'critical' or 'normal'.
 * Sections can be toggled via the `mode` prop: 'all' | 'edit' | 'view'.
 *
 * @param {{
 *   caption?: string,
 *   editor: Array<[number|string, ("critical"|"normal")?]>,
 *   viewer: Array<[number|string, ("critical"|"normal")?]>,
 *   desc: string[],
 *   mode?: 'all' | 'edit' | 'view'
 * }} props
 */
export default function InfoTable({caption, editor, viewer, desc, mode = 'all'}) {
  return (
    <div className={styles.container}>
      {caption && <div className={styles.sectionHeader}>{caption}</div>}

      {mode !== 'view' && (
        <>
          <div className={styles.editorsLabel}>EDITORS</div>
          <div className={styles.divider}></div>
          <div className={styles.row}>
            {[0, 1, 2, 3].map(i => (
              <div key={i} className={`${styles.valueCell} ${editor[i] && editor[i][1] ? styles[editor[i][1]] : ''}`}>
                {editor[i] && editor[i][0] !== undefined ? editor[i][0] : ''}
              </div>
            ))}
          </div>
          <div className={styles.row}>
            {[0, 1, 2, 3].map(i => (
              <div key={i} className={styles.labelCell}>
                {desc[i] || ''}
              </div>
            ))}
          </div>
        </>
      )}

      {mode !== 'edit' && (
        <>
          <div className={styles.viewerLabel}>LIVE VIEWER</div>
          <div className={styles.divider}></div>
          <div className={styles.row}>
            {[0, 1, 2, 3].map(i => (
              <div key={i} className={`${styles.valueCell} ${viewer[i] && viewer[i][1] ? styles[viewer[i][1]] : ''}`}>
                {viewer[i] && viewer[i][0] !== undefined ? viewer[i][0] : ''}
              </div>
            ))}
          </div>
          <div className={styles.row}>
            {[0, 1, 2, 3].map(i => (
              <div key={i} className={styles.labelCell}>
                {desc[i] || ''}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
