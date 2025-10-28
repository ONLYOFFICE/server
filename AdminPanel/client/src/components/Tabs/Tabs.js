import styles from './Tabs.module.scss';

function Tabs({tabs, activeTab, onTabChange, children}) {
  return (
    <div className={styles.tabsContainer}>
      <div className={styles.tabsHeader}>
        {tabs.map(tab => (
          <button
            key={tab.key}
            className={`${styles.tab} ${activeTab === tab.key ? styles['tab--active'] : ''}`}
            onClick={() => onTabChange(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className={styles.tabContent}>{children}</div>
    </div>
  );
}

export default Tabs;
