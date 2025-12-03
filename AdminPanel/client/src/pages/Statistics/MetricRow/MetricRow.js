import styles from './MetricRow.module.css';

/**
 * MetricRow component for displaying Active or Remaining metrics
 * @param {Object} props
 * @param {number} props.count - The count value
 * @param {string} props.description - Description text
 * @param {string} props.label - Label text (e.g., 'Sessions', 'Available')
 * @param {string} props.title - Title (e.g., 'Active', 'Remaining')
 * @param {string} props.color - Optional color for the count value
 */
export default function MetricRow({count, description, label, title, color = '#333333'}) {
  return (
    <div className={styles.container}>
      <table className={styles.table}>
        <tbody>
          <tr>
            <td className={styles.titleCell}>{title}</td>
            <td className={styles.countCell} style={{color}}>
              {count}
            </td>
          </tr>
          <tr>
            <td className={styles.descriptionCell}>{description}</td>
            <td className={styles.labelCell}>{label}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
