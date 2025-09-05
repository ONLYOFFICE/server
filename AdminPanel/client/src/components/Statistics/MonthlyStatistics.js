import {memo, useMemo} from 'react';
import InfoTable from './InfoTable/index';

const MILLISECONDS_PER_DAY = 86400000;

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
      <div style={{textAlign: 'center', fontWeight: 600, margin: '16px 0'}}>Usage statistics for the reporting period</div>
      {periods.map((p, idx) => {
        const caption = p.endDate
          ? `${p.startDate.toLocaleDateString()} - ${p.endDate.toLocaleDateString()}`
          : `From ${p.startDate.toLocaleDateString()}`;

        const editor = [
          [p.internalEdit, ''],
          [p.externalEdit, ''],
          [p.internalEdit + p.externalEdit, '']
        ];
        const viewer = [
          [p.internalView, ''],
          [p.externalView, ''],
          [p.internalView + p.externalView, '']
        ];
        const desc = ['Internal', 'External', 'Active', ''];

        return <InfoTable key={idx} mode={mode} caption={caption} editor={editor} viewer={viewer} desc={desc} />;
      })}
    </>
  );
}

export default memo(MonthlyStatistics);
