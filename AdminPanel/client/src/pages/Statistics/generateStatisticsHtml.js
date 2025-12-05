/**
 * Generate HTML string from statistics data for PDF export
 * @param {Object} data - Statistics data object
 * @param {string} mode - Display mode: 'all' | 'edit' | 'view'
 * @returns {string} Full HTML string for PDF conversion
 */
export function generateStatisticsHtml(data, mode = 'all') {
  const {licenseInfo = {}, quota = {}, connectionsStat = {}} = data;

  // Derived values
  const isUsersModel = licenseInfo.usersCount > 0;
  const limitEdit = isUsersModel ? licenseInfo.usersCount : licenseInfo.connections || 0;
  const limitView = isUsersModel ? licenseInfo.usersViewCount : licenseInfo.connectionsView || 0;

  let html = '';

  if (isUsersModel) {
    const SECONDS_PER_DAY = 86400;
    const days = parseInt(licenseInfo.usersExpire / SECONDS_PER_DAY, 10) || 1;
    const qEditUnique = quota?.edit?.usersCount?.unique || 0;
    const qEditAnon = quota?.edit?.usersCount?.anonymous || 0;
    const qViewUnique = quota?.view?.usersCount?.unique || 0;
    const qViewAnon = quota?.view?.usersCount?.anonymous || 0;

    const remainingEdit = limitEdit - qEditUnique;
    const remainingView = limitView - qViewUnique;

    const title = `User activity in the last ${days} ${days > 1 ? 'days' : 'day'}`;
    html += `<b>${title}</b><br><br>`;

    let userActivityContent = '';
    if (mode === 'all' || mode === 'edit') {
      userActivityContent += `<b>Editors:</b> Active: ${qEditUnique}, Internal: ${qEditUnique - qEditAnon}, External: ${qEditAnon}, Remaining: ${remainingEdit}`;
    }

    if (mode === 'all' || mode === 'view') {
      if (userActivityContent) {
        userActivityContent += '<br>';
      }
      userActivityContent += `<b>Live Viewer:</b> Active: ${qViewUnique}, Internal: ${qViewUnique - qViewAnon}, External: ${qViewAnon}, Remaining: ${remainingView}`;
    }

    html += userActivityContent;
  } else {
    const activeEdit = quota?.edit?.connectionsCount || 0;
    const activeView = quota?.view?.connectionsCount || 0;
    const remainingEdit = limitEdit - activeEdit;
    const remainingView = limitView - activeView;

    if (mode === 'all' || mode === 'edit') {
      html += '<b>Editors</b><br><br>';
      html += `Usage: ${activeEdit} / ${limitEdit}<br>`;
      html += `Active: ${activeEdit}<br>`;
      html += `Remaining: ${remainingEdit}<br>`;
      html += '<br><br><br>';
    }

    // Live Viewer section
    if (mode === 'all' || mode === 'view') {
      html += '<b>Live Viewer</b><br><br>';
      html += `Usage: ${activeView} / ${limitView}<br>`;
      html += `Active: ${activeView}<br>`;
      html += `Remaining: ${remainingView}<br>`;
      html += '<br><br><br>';
    }

    // Peak Concurrent Sessions
    const timePeriods = ['hour', 'day', 'week', 'month'];
    const timeLabels = ['Last Hour', '24 Hours', 'Week', 'Month'];

    let peakContent = '';
    if (mode === 'all' || mode === 'edit') {
      const editorPeaks = timePeriods.map((period, index) => {
        const item = connectionsStat?.[period];
        const value = item?.edit?.max || 0;
        return `${timeLabels[index]}: ${value}`;
      });
      peakContent += `<b>Editors:</b> ${editorPeaks.join(', ')}`;
    }

    if (mode === 'all' || mode === 'view') {
      const viewerPeaks = timePeriods.map((period, index) => {
        const item = connectionsStat?.[period];
        const value = item?.liveview?.max || 0;
        return `${timeLabels[index]}: ${value}`;
      });
      if (peakContent) {
        peakContent += '<br><b>Live Viewer:</b> ';
      } else {
        peakContent += '<b>Live Viewer:</b> ';
      }
      peakContent += viewerPeaks.join(', ');
    }

    html += `<b>Peak Concurrent Sessions</b><br><br>${peakContent}<br><br><br><br>`;

    // Average Concurrent Sessions
    let averageContent = '';
    if (mode === 'all' || mode === 'edit') {
      const editorAvr = timePeriods.map((period, index) => {
        const item = connectionsStat?.[period];
        const value = item?.edit?.avr || 0;
        return `${timeLabels[index]}: ${value}`;
      });
      averageContent += `<b>Editors:</b> ${editorAvr.join(', ')}`;
    }

    if (mode === 'all' || mode === 'view') {
      const viewerAvr = timePeriods.map((period, index) => {
        const item = connectionsStat?.[period];
        const value = item?.liveview?.avr || 0;
        return `${timeLabels[index]}: ${value}`;
      });
      if (averageContent) {
        averageContent += '<br><b>Live Viewer:</b> ';
      } else {
        averageContent += '<b>Live Viewer:</b> ';
      }
      averageContent += viewerAvr.join(', ');
    }

    html += `<b>Average Concurrent Sessions</b><br><br>${averageContent}`;
  }

  const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
  <title>Statistics Report</title>
</head>
<body>
  ${html}
</body>
</html>`;

  return fullHtml;
}
