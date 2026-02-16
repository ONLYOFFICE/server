/**
 * Generate plain text report from statistics data
 * @param {Object} data - Statistics data object
 * @param {string} mode - Display mode: 'all' | 'edit' | 'view'
 * @returns {string} Plain text report
 */
export function generateStatisticsTxt(data, mode = 'all') {
  const {licenseInfo = {}, quota = {}, connectionsStat = {}} = data;

  const isUsersModel = licenseInfo.usersCount > 0;
  const limitEdit = isUsersModel ? licenseInfo.usersCount : licenseInfo.connections || 0;
  const limitView = isUsersModel ? licenseInfo.usersViewCount : licenseInfo.connectionsView || 0;

  const lines = [];

  if (isUsersModel) {
    const SECONDS_PER_DAY = 86400;
    const days = parseInt(licenseInfo.usersExpire / SECONDS_PER_DAY, 10) || 1;
    const qEditUnique = quota?.edit?.usersCount?.unique || 0;
    const qEditAnon = quota?.edit?.usersCount?.anonymous || 0;
    const qViewUnique = quota?.view?.usersCount?.unique || 0;
    const qViewAnon = quota?.view?.usersCount?.anonymous || 0;
    const remainingEdit = limitEdit - qEditUnique;
    const remainingView = limitView - qViewUnique;

    lines.push(`User activity in the last ${days} ${days > 1 ? 'days' : 'day'}`);
    lines.push('');

    if (mode === 'all' || mode === 'edit') {
      lines.push('Editors:');
      lines.push(`  Active: ${qEditUnique}, Internal: ${qEditUnique - qEditAnon}, External: ${qEditAnon}, Remaining: ${remainingEdit}`);
      lines.push('');
    }
    if (mode === 'all' || mode === 'view') {
      lines.push('Live Viewer:');
      lines.push(`  Active: ${qViewUnique}, Internal: ${qViewUnique - qViewAnon}, External: ${qViewAnon}, Remaining: ${remainingView}`);
    }
  } else {
    const activeEdit = quota?.edit?.connectionsCount || 0;
    const activeView = quota?.view?.connectionsCount || 0;
    const remainingEdit = limitEdit - activeEdit;
    const remainingView = limitView - activeView;

    if (mode === 'all' || mode === 'edit') {
      lines.push('Editors');
      lines.push(`Usage: ${activeEdit} / ${limitEdit}`);
      lines.push(`Active: ${activeEdit}`);
      lines.push(`Remaining: ${remainingEdit}`);
      lines.push('');
    }
    if (mode === 'all' || mode === 'view') {
      lines.push('Live Viewer');
      lines.push(`Usage: ${activeView} / ${limitView}`);
      lines.push(`Active: ${activeView}`);
      lines.push(`Remaining: ${remainingView}`);
      lines.push('');
    }

    const timePeriods = ['hour', 'day', 'week', 'month'];
    const timeLabels = ['Last Hour', '24 Hours', 'Week', 'Month'];

    lines.push('Peak Concurrent Sessions');
    if (mode === 'all' || mode === 'edit') {
      const editorPeaks = timePeriods.map((period, index) => {
        const value = connectionsStat?.[period]?.edit?.max ?? 0;
        return `${timeLabels[index]}: ${value}`;
      });
      lines.push('Editors: ' + editorPeaks.join(', '));
    }
    if (mode === 'all' || mode === 'view') {
      const viewerPeaks = timePeriods.map((period, index) => {
        const value = connectionsStat?.[period]?.liveview?.max ?? 0;
        return `${timeLabels[index]}: ${value}`;
      });
      lines.push('Live Viewer: ' + viewerPeaks.join(', '));
    }
    lines.push('');

    lines.push('Average Concurrent Sessions');
    if (mode === 'all' || mode === 'edit') {
      const editorAvr = timePeriods.map((period, index) => {
        const value = connectionsStat?.[period]?.edit?.avr ?? 0;
        return `${timeLabels[index]}: ${value}`;
      });
      lines.push('Editors: ' + editorAvr.join(', '));
    }
    if (mode === 'all' || mode === 'view') {
      const viewerAvr = timePeriods.map((period, index) => {
        const value = connectionsStat?.[period]?.liveview?.avr ?? 0;
        return `${timeLabels[index]}: ${value}`;
      });
      lines.push('Live Viewer: ' + viewerAvr.join(', '));
    }
  }

  return lines.join('\r\n');
}
