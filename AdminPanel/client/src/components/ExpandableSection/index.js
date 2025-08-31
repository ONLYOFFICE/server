import {useState} from 'react';
import styles from './styles.module.css';

export default function ExpandableSection({title, children}) {
  const [isExpanded, setIsExpanded] = useState(false);

  const toggleExpanded = () => {
    setIsExpanded(!isExpanded);
  };

  return (
    <div className={styles.expandableSection}>
      <div className={styles.header} onClick={toggleExpanded}>
        <span className={styles.title}>{title}</span>
        <span className={`${styles.arrow} ${isExpanded ? styles.expanded : styles.collapsed}`}>▼</span>
      </div>
      {isExpanded && <div className={styles.content}>{children}</div>}
    </div>
  );
}
