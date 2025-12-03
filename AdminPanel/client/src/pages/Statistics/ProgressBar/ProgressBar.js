import styles from './ProgressBar.module.css';

/**
 * ProgressBar component for displaying usage percentage
 * @param {Object} props
 * @param {number} props.current - Current usage count
 * @param {number} props.limit - Maximum limit
 * @param {number} props.percent - Usage percentage (0-100)
 * @param {string} props.color - Color for the progress bar
 * @param {string} props.label - Label for the progress bar (e.g., 'Editor', 'Viewer')
 */
export default function ProgressBar({current, limit, percent, color, label}) {
  const isCritical = percent >= 90;
  const actualPercent = Math.max(0, Math.min(100, percent));
  const tooltipText = isCritical ? `Usage: ${Math.round(percent)}% — High load. Consider increasing ${label.toLowerCase()} session limit.` : '';

  return (
    <div className={styles.container}>
      <table className={styles.labelTable}>
        <tbody>
          <tr>
            <td className={styles.labelCell}>
              {label} Usage
              {isCritical && (
                <span className={styles.infoIcon} title={tooltipText}>
                  <svg width='16' height='16' viewBox='0 0 16 16' fill='none' xmlns='http://www.w3.org/2000/svg'>
                    <circle cx='8' cy='8' r='7.25' stroke='#666666' strokeWidth='1.5' />
                    <path
                      d='M8.18 10.9002C8.17333 10.9335 8.17 10.9769 8.17 11.0302C8.17 11.1902 8.23 11.2702 8.35 11.2702C8.40333 11.2702 8.46 11.2535 8.52 11.2202C8.58667 11.1869 8.68 11.1302 8.8 11.0502L8.93 11.3902C8.81667 11.5435 8.64 11.7002 8.4 11.8602C8.16667 12.0202 7.87 12.1002 7.51 12.1002C7.20333 12.1002 6.96333 12.0435 6.79 11.9302C6.62333 11.8102 6.54 11.6569 6.54 11.4702C6.54 11.4302 6.54333 11.3969 6.55 11.3702L6.81 9.4002L7.09 7.3102L6.53 7.0102L6.61 6.5802L8.54 6.3202L8.8 6.4402L8.18 10.9002ZM8.17 5.4602C7.97 5.4602 7.79 5.3802 7.63 5.2202C7.47667 5.0602 7.4 4.8802 7.4 4.6802C7.4 4.40686 7.49333 4.17686 7.68 3.9902C7.86667 3.79686 8.11333 3.7002 8.42 3.7002C8.65333 3.7002 8.84 3.77686 8.98 3.9302C9.12 4.08353 9.19 4.2602 9.19 4.4602C9.19 4.75353 9.10333 4.99353 8.93 5.1802C8.75667 5.36686 8.50333 5.4602 8.17 5.4602Z'
                      fill='#666666'
                    />
                  </svg>
                </span>
              )}
            </td>
            <td className={styles.valueCell}>
              {current} / {limit}
            </td>
          </tr>
        </tbody>
      </table>
      <div className={styles.barContainer}>
        <div
          className={styles.barFill}
          style={{
            width: `${actualPercent}%`,
            backgroundColor: color
          }}
        />
      </div>
    </div>
  );
}
