import React from 'react';
import styles from './styles.module.css';

export default function Tabs({ tabs, activeTab, onTabChange, children }) {
  return (
    <div>
      <div className={styles.tabContainer}>
        {tabs.map(tab => (
          <div
            key={tab.key}
            onClick={() => onTabChange(tab.key)}
            className={activeTab === tab.key ? `${styles.tab} ${styles.tabActive}` : styles.tab}
          >
            {tab.label}
          </div>
        ))}
      </div>
      <div className={styles.tabContent}>
        {children}
      </div>
    </div>
  );
} 