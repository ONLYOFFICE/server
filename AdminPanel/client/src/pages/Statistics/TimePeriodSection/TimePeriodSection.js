import StatisticsCard from '../StatisticsCard/StatisticsCard';
import styles from './TimePeriodSection.module.css';

const TIME_LABELS = ['Last Hour', '24 Hours', 'Week', 'Month'];

/**
 * TimePeriodSection component for Peak or Average values
 * @param {Object} props
 * @param {string} props.title - Section title (e.g., 'Peak Concurrent Sessions')
 * @param {string} props.description - Section description
 * @param {Array<number>} props.editorValues - Array of 4 values for editors
 * @param {Array<number>} props.viewerValues - Array of 4 values for viewers
 * @param {string} props.mode - Display mode: 'all' | 'edit' | 'view'
 */
export default function TimePeriodSection({title, description, editorValues, viewerValues, mode}) {
  const renderTimePeriodCard = (cardTitle, cardDescription, values) => {
    return (
      <div className={styles.timePeriodCard}>
        <h4 className={styles.timePeriodTitle}>{cardTitle}</h4>
        <p className={styles.timePeriodDescription}>{cardDescription}</p>
        <div className={styles.valuesContainer}>
          {TIME_LABELS.map((label, index) => (
            <div key={index} className={styles.valueItem}>
              <div className={styles.value}>{values[index] || 0}</div>
              <div className={styles.label}>{label}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const content = [];
  if (mode === 'all' || mode === 'edit') {
    content.push(<div key='editors'>{renderTimePeriodCard('Editors', 'Active editing sessions and availability', editorValues)}</div>);
  }
  if (mode === 'all' || mode === 'view') {
    if (mode === 'all') {
      content.push(<div key='divider' className={styles.divider} />);
    }
    content.push(<div key='viewer'>{renderTimePeriodCard('Live Viewer', 'Active read-only sessions and availability', viewerValues)}</div>);
  }

  return (
    <StatisticsCard title={title} description={description}>
      {content}
    </StatisticsCard>
  );
}
