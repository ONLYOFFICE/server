import CardWrapper from '../CardWrapper/CardWrapper';
import styles from './ActivityCard.module.css';

const TIME_LABELS = ['Last Hour', '24 Hours', 'Week', 'Month'];

/**
 * ActivityCard component for displaying statistics in a table format
 * Used for Peak, Average, or User Activity values
 * @param {Object} props
 * @param {string} props.title - Card title (e.g., 'Peak Concurrent Sessions')
 * @param {string} props.description - Card description
 * @param {Array<number|Array>} props.editorValues - Array of values for editors (numbers or [value, status] tuples)
 * @param {Array<number|Array>} props.viewerValues - Array of values for viewers (numbers or [value, status] tuples)
 * @param {string} props.mode - Display mode: 'all' | 'edit' | 'view'
 * @param {Array<string>} props.labels - Optional custom labels (defaults to TIME_LABELS)
 */
export default function ActivityCard({title, description, editorValues, viewerValues, mode, labels = TIME_LABELS}) {
  const renderTableCard = (cardTitle, cardDescription, values) => {
    return (
      <div className={styles.tableCard}>
        <h4 className={styles.tableTitle}>{cardTitle}</h4>
        <p className={styles.tableDescription}>{cardDescription}</p>
        <div className={styles.valuesContainer}>
          {labels.map((label, index) => {
            // Handle both number values and [value, color] tuples
            const valueData = values[index];
            const value = Array.isArray(valueData) ? valueData[0] : valueData || 0;
            const color = Array.isArray(valueData) ? valueData[1] : '';

            return (
              <div key={index} className={styles.valueItem}>
                <div className={styles.value} style={color ? {color} : undefined}>
                  {value}
                </div>
                <div className={styles.label}>{label}</div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const content = [];
  if (mode === 'all' || mode === 'edit') {
    content.push(<div key='editors'>{renderTableCard('Editors', 'Active editing sessions and availability', editorValues)}</div>);
  }
  if (mode === 'all' || mode === 'view') {
    if (mode === 'all') {
      content.push(<div key='divider' className={styles.divider} />);
    }
    content.push(<div key='viewer'>{renderTableCard('Live Viewer', 'Active read-only sessions and availability', viewerValues)}</div>);
  }

  return (
    <CardWrapper title={title} description={description}>
      {content}
    </CardWrapper>
  );
}
