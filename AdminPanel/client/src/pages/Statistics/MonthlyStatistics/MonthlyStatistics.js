import {memo, useMemo} from 'react';
import ActivityCard from '../ActivityCard/ActivityCard';
import styles from '../styles.module.css';

const MILLISECONDS_PER_DAY = 86400000;
const MONTHLY_STATISTICS_LABELS = ['Active', 'Internal', 'External'];

/**
 * Count internal/external users.
 * @param {Record<string, { anonym?: boolean }>} users
 * @returns {{internal: number, external: number}}
 */
function countUsers(users = {}) {
  let internal = 0;
  let external = 0;
  for (const uid in users) {
    if (Object.prototype.hasOwnProperty.call(users, uid)) {
      users[uid]?.anonym ? external++ : internal++;
    }
  }
  return {internal, external};
}

/**
 * MonthlyStatistics - renders usage statistics by month.
 * Mirrors logic from branding/info/index.html fillStatistic().
 *
 * @param {{ byMonth?: Array<any>, mode: 'all'|'edit'|'view' }} props
 */
function MonthlyStatistics({byMonth, mode}) {
  const periods = useMemo(() => {
    if (!Array.isArray(byMonth) || byMonth.length < 1) return [];

    // Build periods in chronological order, then reverse for display.
    const mapped = byMonth
      .map((item, index) => {
        const date = item?.date ? new Date(item.date) : null;
        if (!date) return null;

        const editCounts = countUsers(item?.users);
        const viewCounts = countUsers(item?.usersView);

        const nextDate = index + 1 < byMonth.length ? new Date(byMonth[index + 1].date) : null;

        return {
          startDate: date,
          endDate: nextDate ? new Date(nextDate.getTime() - MILLISECONDS_PER_DAY) : null,
          internalEdit: editCounts.internal,
          externalEdit: editCounts.external,
          internalView: viewCounts.internal,
          externalView: viewCounts.external
        };
      })
      .filter(Boolean)
      .reverse();

    return mapped;
  }, [byMonth]);

  if (periods.length < 1) return null;

  return (
    <>
      <h2 className={styles.title}>Usage statistics for the reporting period</h2>
      <p className={styles.description}>Monthly usage breakdown by user type for each reporting period</p>
      {periods.map((p, idx) => {
        const caption = p.endDate
          ? `${p.startDate.toLocaleDateString()} - ${p.endDate.toLocaleDateString()}`
          : `From ${p.startDate.toLocaleDateString()}`;

        const editorValues = [
          p.internalEdit + p.externalEdit, // Active
          p.internalEdit, // Internal
          p.externalEdit // External
        ];

        const viewerValues = [
          p.internalView + p.externalView, // Active
          p.internalView, // Internal
          p.externalView // External
        ];

        return (
          <ActivityCard
            key={idx}
            title={caption}
            description='Monthly usage statistics by user type'
            editorValues={editorValues}
            viewerValues={viewerValues}
            mode={mode}
            labels={MONTHLY_STATISTICS_LABELS}
          />
        );
      })}
    </>
  );
}

export default memo(MonthlyStatistics);
