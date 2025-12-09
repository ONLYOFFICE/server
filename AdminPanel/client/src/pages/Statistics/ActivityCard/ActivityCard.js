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
 * @param {number} props.columns - Number of columns (defaults to 4)
 */
export default function ActivityCard({title, description, editorValues, viewerValues, mode, labels = TIME_LABELS, columns = 4}) {
  const renderTableCard = (cardTitle, cardDescription, values) => {
    // Always display the specified number of columns, filling with empty values if needed
    const displayItems = Array.from({length: columns}, (_, index) => {
      const label = labels[index] || '';
      const valueData = values[index];
      const value = valueData !== undefined ? (Array.isArray(valueData) ? valueData[0] : valueData) : '';
      const color = Array.isArray(valueData) ? valueData[1] : '';

      return {label, value, color};
    });

    return (
      <div className={styles.tableCard}>
        <h4 className={styles.tableTitle}>{cardTitle}</h4>
        <p className={styles.tableDescription}>{cardDescription}</p>
        <div className={styles.valuesContainer}>
          {displayItems.map((item, index) => (
            <div key={index} className={index === 0 ? styles.valueItemFirst : styles.valueItem}>
              <div className={styles.value} style={item.color ? {color: item.color} : undefined}>
                {item.value !== '' ? item.value : '\u00A0'}
              </div>
              <div className={styles.label}>{item.label}</div>
            </div>
          ))}
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
