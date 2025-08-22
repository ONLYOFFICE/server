import React from 'react';
import styles from './styles.module.css';

export default function InfoTable({ caption, editor, viewer, desc }) {
  return (
    <div className={styles.container}>
      {caption && (
        <div className={styles.sectionHeader}>{caption}</div>
      )}
      <div className={styles.editorsLabel}>EDITORS</div>
      <div className={styles.divider}></div>
      <div className={styles.row}>
        {editor.map((v, i) => (
          <div 
            key={i} 
            className={`${styles.valueCell} ${desc[i] === 'Remaining' ? styles.remainingValue : ''}`}
          >
            {v[0]}
          </div>
        ))}
      </div>
      <div className={styles.row}>
        {desc.map((d, i) => <div key={i} className={styles.labelCell}>{d}</div>)}
      </div>
      <div className={styles.viewerLabel}>LIVE VIEWER</div>
      <div className={styles.divider}></div>
      <div className={styles.row}>
        {viewer.map((v, i) => (
          <div 
            key={i} 
            className={`${styles.valueCell} ${desc[i] === 'Remaining' ? styles.remainingValue : ''}`}
          >
            {v[0]}
          </div>
        ))}
      </div>
      <div className={styles.row}>
        {desc.map((d, i) => <div key={i} className={styles.labelCell}>{d}</div>)}
      </div>
    </div>
  );
} 