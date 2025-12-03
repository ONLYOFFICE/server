import {useMemo} from 'react';
import ConnectionsCard from '../ConnectionsCard/ConnectionsCard';
import TimePeriodSection from '../TimePeriodSection/TimePeriodSection';
import styles from './StatisticsContent.module.css';

const TIME_PERIODS = ['hour', 'day', 'week', 'month'];

/**
 * StatisticsContent component - main component for rendering statistics
 * @param {Object} props
 * @param {Object} props.data - Statistics data object
 * @param {string} props.mode - Display mode: 'all' | 'edit' | 'view'
 */
export default function StatisticsContent({data, mode}) {
  const {licenseInfo = {}, quota = {}, connectionsStat = {}} = data;

  // Derived values
  const isUsersModel = licenseInfo.usersCount > 0;
  const limitEdit = isUsersModel ? licenseInfo.usersCount : licenseInfo.connections || 0;
  const limitView = isUsersModel ? licenseInfo.usersViewCount : licenseInfo.connectionsView || 0;

  // Current connections data
  const activeEdit = quota?.edit?.connectionsCount || 0;
  const activeView = quota?.view?.connectionsCount || 0;
  const remainingEdit = limitEdit - activeEdit;
  const remainingView = limitView - activeView;

  // Calculate peak and average values
  const {editorPeaks, viewerPeaks, editorAvr, viewerAvr} = useMemo(() => {
    const editorPeaks = [];
    const viewerPeaks = [];
    const editorAvr = [];
    const viewerAvr = [];

    TIME_PERIODS.forEach((period, index) => {
      const item = connectionsStat?.[period];
      if (item?.edit) {
        editorPeaks[index] = item.edit.max || 0;
        editorAvr[index] = item.edit.avr || 0;
      }
      if (item?.liveview) {
        viewerPeaks[index] = item.liveview.max || 0;
        viewerAvr[index] = item.liveview.avr || 0;
      }
    });

    return {editorPeaks, viewerPeaks, editorAvr, viewerAvr};
  }, [connectionsStat]);

  return (
    <div className={styles.container}>
      {/* Connections Cards Row */}
      {(mode === 'all' || mode === 'edit' || mode === 'view') && (
        <div className={styles.connectionsRow}>
          {(mode === 'all' || mode === 'edit') && (
            <div className={styles.connectionsCard}>
              <ConnectionsCard active={activeEdit} limit={limitEdit} remaining={remainingEdit} type='Editor' />
            </div>
          )}
          {(mode === 'all' || mode === 'view') && (
            <div className={styles.connectionsCard}>
              <ConnectionsCard active={activeView} limit={limitView} remaining={remainingView} type='Viewer' />
            </div>
          )}
        </div>
      )}

      {/* Peak and Average Row */}
      <div className={styles.peakAverageRow}>
        <div className={styles.peakCard}>
          <TimePeriodSection
            title='Peak Concurrent Sessions'
            description='Maximum concurrent connections during different time periods'
            editorValues={editorPeaks}
            viewerValues={viewerPeaks}
            mode={mode}
          />
        </div>
        <div className={styles.averageCard}>
          <TimePeriodSection
            title='Average Concurrent Sessions'
            description='Average concurrent connections during different time periods'
            editorValues={editorAvr}
            viewerValues={viewerAvr}
            mode={mode}
          />
        </div>
      </div>
    </div>
  );
}
