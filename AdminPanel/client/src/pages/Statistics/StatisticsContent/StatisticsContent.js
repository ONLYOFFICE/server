import {useMemo} from 'react';
import LimitCard from '../LimitCard/LimitCard';
import ActivityCard from '../ActivityCard/ActivityCard';
import styles from './StatisticsContent.module.css';

const TIME_PERIODS = ['hour', 'day', 'week', 'month'];
const SECONDS_PER_DAY = 86400;
const USER_ACTIVITY_LABELS = ['Active', 'Internal', 'External', 'Remaining'];

/**
 * Helper function to get usage color based on percentage
 * @param {number} percent - Usage percentage (0-100)
 * @returns {string} Color hex code
 */
const getUsageColor = percent => {
  if (percent >= 90) return '#CB0000'; // Critical - Red
  if (percent >= 70) return '#FF6F3D'; // Warning - Orange
  return '#007B14'; // Normal - Green
};

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

  const userActivityData = useMemo(() => {
    if (!isUsersModel) return null;

    const days = parseInt(licenseInfo.usersExpire / SECONDS_PER_DAY, 10) || 1;
    const qEditUnique = quota?.edit?.usersCount?.unique || 0;
    const qEditAnon = quota?.edit?.usersCount?.anonymous || 0;
    const qViewUnique = quota?.view?.usersCount?.unique || 0;
    const qViewAnon = quota?.view?.usersCount?.anonymous || 0;

    const remainingEdit = limitEdit - qEditUnique;
    const remainingView = limitView - qViewUnique;

    const editUsagePercent = limitEdit > 0 ? (qEditUnique / limitEdit) * 100 : 0;
    const viewUsagePercent = limitView > 0 ? (qViewUnique / limitView) * 100 : 0;
    const remainingEditColor = getUsageColor(editUsagePercent);
    const remainingViewColor = getUsageColor(viewUsagePercent);

    const editor = [
      [qEditUnique, ''],
      [qEditUnique - qEditAnon, ''],
      [qEditAnon, ''],
      [remainingEdit, remainingEditColor]
    ];

    const viewer = [
      [qViewUnique, ''],
      [qViewUnique - qViewAnon, ''],
      [qViewAnon, ''],
      [remainingView, remainingViewColor]
    ];

    return {
      days,
      editor,
      viewer,
      caption: `User activity in the last ${days} ${days > 1 ? 'days' : 'day'}`
    };
  }, [isUsersModel, licenseInfo, quota, limitEdit, limitView]);

  const activeEdit = quota?.edit?.connectionsCount || 0;
  const activeView = quota?.view?.connectionsCount || 0;
  const remainingEdit = limitEdit - activeEdit;
  const remainingView = limitView - activeView;

  // Calculate peak and average values (for connections model)
  const {editorPeaks, viewerPeaks, editorAvr, viewerAvr} = useMemo(() => {
    if (isUsersModel) {
      return {editorPeaks: [], viewerPeaks: [], editorAvr: [], viewerAvr: []};
    }

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
  }, [connectionsStat, isUsersModel]);

  if (isUsersModel && userActivityData) {
    return (
      <div className={styles.container}>
        <div className={styles.connectionsRow}>
          <div className={styles.connectionsCard}>
            <ActivityCard
              title={userActivityData.caption}
              description='User activity breakdown by type and remaining capacity'
              editorValues={userActivityData.editor}
              viewerValues={userActivityData.viewer}
              mode={mode}
              labels={USER_ACTIVITY_LABELS}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {(mode === 'all' || mode === 'edit' || mode === 'view') && (
        <div className={styles.connectionsRow}>
          {(mode === 'all' || mode === 'edit') && (
            <div className={styles.connectionsCard}>
              <LimitCard active={activeEdit} limit={limitEdit} remaining={remainingEdit} type='Editor' />
            </div>
          )}
          {(mode === 'all' || mode === 'view') && (
            <div className={styles.connectionsCard}>
              <LimitCard active={activeView} limit={limitView} remaining={remainingView} type='Viewer' />
            </div>
          )}
        </div>
      )}

      <div className={styles.peakAverageRow}>
        <div className={styles.peakCard}>
          <ActivityCard
            title='Peak Concurrent Sessions'
            description='Maximum concurrent connections during different time periods'
            editorValues={editorPeaks}
            viewerValues={viewerPeaks}
            mode={mode}
          />
        </div>
        <div className={styles.averageCard}>
          <ActivityCard
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
