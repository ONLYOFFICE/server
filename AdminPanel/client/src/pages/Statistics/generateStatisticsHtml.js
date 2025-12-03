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

  // Current connections data
  const activeEdit = quota?.edit?.connectionsCount || 0;
  const activeView = quota?.view?.connectionsCount || 0;
  const remainingEdit = limitEdit - activeEdit;
  const remainingView = limitView - activeView;

  // Calculate usage percentages
  const editUsagePercent = limitEdit > 0 ? (activeEdit / limitEdit) * 100 : 0;
  const viewUsagePercent = limitView > 0 ? (activeView / limitView) * 100 : 0;

  // Determine colors based on usage for progress bars
  const getUsageColor = percent => {
    if (percent >= 90) return '#CB0000'; // Critical - Red
    if (percent >= 70) return '#FF6F3D'; // Warning - Orange
    return '#007B14'; // Normal - Green
  };

  // Helper to generate progress bar HTML for PDF (using SVG)
  const generateProgressBar = (current, limit, percent, color, label) => {
    // Calculate actual percentage and ensure it's within bounds
    const actualPercent = Math.max(0, Math.min(100, percent));
    const filledWidth = actualPercent;
    const pdfWidth = 560; // Standard PDF width in pixels

    // Create simple rectangular path without rounded corners for PDF
    let filledPath = '';
    if (filledWidth > 0) {
      const filledPx = (pdfWidth * filledWidth) / 100;
      // Simple rectangle without rounded corners
      filledPath = `<rect x="0" y="0" width="${filledPx}" height="8" fill="${color}"/>`;
    }

    return `
      <div class="progress-bar-container" style="margin-bottom: 24px; margin-top: 0; padding-left: 0 !important; padding-right: 0 !important;">
        <table class="usage-label-table" style="width: 100%; border-collapse: collapse; margin: 0 !important; padding: 0 !important; padding-left: 0 !important; padding-right: 0 !important; border-spacing: 0;">
          <tr>
            <td style="font-weight: 700; font-size: 18px; line-height: 1 !important; color: #444444; padding: 0 !important; padding-left: 0 !important; padding-right: 0 !important; margin: 0 !important; vertical-align: bottom;">${label} Usage</td>
            <td style="color: #333333; font-weight: 700; font-size: 20px; line-height: 1 !important; text-align: right; padding: 0 !important; padding-left: 0 !important; padding-right: 0 !important; margin: 0 !important; white-space: nowrap; vertical-align: bottom;">${current} / ${limit}</td>
          </tr>
          <tr>
            <td colspan="2" style="padding: 0 !important; padding-left: 0 !important; padding-right: 0 !important; margin: 0 !important; line-height: 0 !important; font-size: 0 !important;">
              <svg width="${pdfWidth}" height="8" viewBox="0 0 ${pdfWidth} 8" style="display: block; margin: 0 !important; padding: 0 !important; vertical-align: top;">
                <!-- Empty background (gray) without rounded corners -->
                <rect x="0" y="0" width="${pdfWidth}" height="8" fill="#e0e0e0"/>
                <!-- Filled portion (colored) -->
                ${filledPath}
              </svg>
            </td>
          </tr>
        </table>
      </div>
    `;
  };

  // Helper to generate Active metric row
  const generateActiveRow = (count, description, label) => {
    return `
      <div style="margin-bottom: 24px;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="font-weight: 700; font-size: 18px; line-height: 130%; color: #444444; padding: 0; vertical-align: top;">Active</td>
            <td style="color: #333333; font-weight: 700; font-size: 20px; line-height: 130%; text-align: right; padding: 0; vertical-align: top;">${count}</td>
          </tr>
          <tr>
            <td style="font-weight: 600; font-size: 14px; line-height: 150%; color: #666666; padding: 0; padding-top: 4px;">${description}</td>
            <td style="font-weight: 600; font-size: 14px; line-height: 150%; color: #666666; text-align: right; padding: 0; padding-top: 4px;">${label}</td>
          </tr>
        </table>
      </div>
    `;
  };

  // Helper to generate Remaining metric row
  const generateRemainingRow = (count, description, label, color = '#333333') => {
    return `
      <div class="remaining-row">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="font-weight: 700; font-size: 18px; line-height: 130%; color: #444444; padding: 0; vertical-align: top;">Remaining</td>
            <td style="color: ${color}; font-weight: 700; font-size: 20px; line-height: 130%; text-align: right; padding: 0; vertical-align: top;">${count}</td>
          </tr>
          <tr>
            <td style="font-weight: 600; font-size: 14px; line-height: 150%; color: #666666; padding: 0; padding-top: 4px;">${description}</td>
            <td style="font-weight: 600; font-size: 14px; line-height: 150%; color: #666666; text-align: right; padding: 0; padding-top: 4px;">${label}</td>
          </tr>
        </table>
      </div>
    `;
  };

  // Helper to generate card
  // Using table structure for better LibreOffice PDF compatibility
  const generateCard = (title, description, content, additionalClass = '') => {
    const cardClass = additionalClass ? `statistics-card ${additionalClass}` : 'statistics-card';
    const paddingBottom = '32px';
    return `
      <table class="${cardClass}" cellpadding="0" cellspacing="0" style="width: 100%; border-collapse: separate; border-spacing: 0; background-color: #ffffff; border: 1px solid #e0e0e0; border-radius: 8px; margin: 0; overflow: hidden;">
        <tr>
          <td style="padding: 32px !important; padding-top: 23px !important; padding-right: 32px !important; padding-bottom: ${paddingBottom} !important; padding-left: 32px !important; border: none;">
            <h3 class="card-title" style="font-weight: 700; font-size: 22px; line-height: 150%; color: #333333; margin: 0; text-align: left;">${title}</h3>
            <p class="card-description" style="font-weight: 600; font-size: 14px; line-height: 150%; color: #666666; margin: 0 0 32px 0; text-align: left;">${description}</p>
            ${content}
          </td>
        </tr>
      </table>
    `;
  };

  // Generate Editors card
  const generateEditorsCard = () => {
    // Use the same usage percentage for color calculation (not remaining percentage)
    // If usage is high (e.g., 90%), remaining is low (10%), both should be red
    const remainingColor = getUsageColor(editUsagePercent);
    const content = `
      ${generateProgressBar(activeEdit, limitEdit, editUsagePercent, getUsageColor(editUsagePercent), 'Editor')}
      ${generateActiveRow(activeEdit, 'Users currently editing documents', 'Sessions')}
      ${generateRemainingRow(remainingEdit, 'Editor sessions before limit', 'Available', remainingColor)}
    `;
    return generateCard('Editors', 'Active editing sessions and availability', content, 'connections-card');
  };

  // Generate Live Viewer card
  const generateLiveViewerCard = () => {
    // Use the same usage percentage for color calculation (not remaining percentage)
    // If usage is high (e.g., 90%), remaining is low (10%), both should be red
    const remainingColor = getUsageColor(viewUsagePercent);
    const content = `
      ${generateProgressBar(activeView, limitView, viewUsagePercent, getUsageColor(viewUsagePercent), 'Viewer')}
      ${generateActiveRow(activeView, 'Users currently viewing documents', 'Sessions')}
      ${generateRemainingRow(remainingView, 'Viewer sessions before limit', 'Available', remainingColor)}
    `;
    return generateCard('Live Viewer', 'Active read-only sessions and availability', content, 'connections-card');
  };

  // Generate Peak Concurrent Sessions section
  const generatePeakSection = () => {
    const editorPeaks = [];
    const viewerPeaks = [];
    const timePeriods = ['hour', 'day', 'week', 'month'];
    const timeLabels = ['Last Hour', '24 Hours', 'Week', 'Month'];

    timePeriods.forEach((period, index) => {
      const item = connectionsStat?.[period];
      if (item?.edit) {
        editorPeaks[index] = item.edit.max || 0;
      }
      if (item?.liveview) {
        viewerPeaks[index] = item.liveview.max || 0;
      }
    });

    const generatePeakCard = (title, description, values) => {
      // Use table layout for PDF compatibility
      const content = `
        <div style="margin-bottom: 8px;">
          <h4 class="time-period-title" style="font-weight: 700; font-size: 18px; line-height: 130%; color: #444444; margin: 0 0 4px 0;">${title}</h4>
          <p class="time-period-description" style="font-weight: 600; font-size: 14px; line-height: 150%; color: #666666; margin: 0 0 28px 0;">${description}</p>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              ${timeLabels
                .map(
                  (label, index) => `
                <td style="text-align: right; padding: 0; vertical-align: top; width: 25%;">
                  <div style="font-size: 18px; font-weight: 600; color: #333333; margin-bottom: 4px;">${values[index] || 0}</div>
                  <div style="font-size: 12px; color: #666666;">${label}</div>
                </td>
              `
                )
                .join('')}
            </tr>
          </table>
        </div>
      `;
      return content;
    };

    let content = '';
    if (mode === 'all' || mode === 'edit') {
      content += generatePeakCard('Editors', 'Active editing sessions and availability', editorPeaks);
    }
    if (mode === 'all' || mode === 'view') {
      if (mode === 'all') {
        content += '<div style="margin-top: 32px; margin-bottom: 32px; border-top: 1px solid #e0e0e0;"></div>';
      }
      content += generatePeakCard('Live Viewer', 'Active read-only sessions and availability', viewerPeaks);
    }

    return generateCard('Peak Concurrent Sessions', 'Maximum concurrent connections during different time periods', content);
  };

  // Generate Average Concurrent Sessions section
  const generateAverageSection = () => {
    const editorAvr = [];
    const viewerAvr = [];
    const timePeriods = ['hour', 'day', 'week', 'month'];
    const timeLabels = ['Last Hour', '24 Hours', 'Week', 'Month'];

    timePeriods.forEach((period, index) => {
      const item = connectionsStat?.[period];
      if (item?.edit) {
        editorAvr[index] = item.edit.avr || 0;
      }
      if (item?.liveview) {
        viewerAvr[index] = item.liveview.avr || 0;
      }
    });

    const generateAverageCard = (title, description, values) => {
      // Use table layout for PDF compatibility
      const content = `
        <div style="margin-bottom: 8px;">
          <h4 class="time-period-title" style="font-weight: 700; font-size: 18px; line-height: 130%; color: #444444; margin: 0 0 4px 0;">${title}</h4>
          <p class="time-period-description" style="font-weight: 600; font-size: 14px; line-height: 150%; color: #666666; margin: 0 0 28px 0;">${description}</p>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              ${timeLabels
                .map(
                  (label, index) => `
                <td style="text-align: right; padding: 0; vertical-align: top; width: 25%;">
                  <div style="font-size: 18px; font-weight: 600; color: #333333; margin-bottom: 4px;">${values[index] || 0}</div>
                  <div style="font-size: 12px; color: #666666;">${label}</div>
                </td>
              `
                )
                .join('')}
            </tr>
          </table>
        </div>
      `;
      return content;
    };

    let content = '';
    if (mode === 'all' || mode === 'edit') {
      content += generateAverageCard('Editors', 'Active editing sessions and availability', editorAvr);
    }
    if (mode === 'all' || mode === 'view') {
      if (mode === 'all') {
        content += '<div style="margin-top: 32px; margin-bottom: 32px; border-top: 1px solid #e0e0e0;"></div>';
      }
      content += generateAverageCard('Live Viewer', 'Active read-only sessions and availability', viewerAvr);
    }

    return generateCard('Average Concurrent Sessions', 'Average concurrent connections during different time periods', content);
  };

  // Build HTML for PDF - everything stacked vertically (one card per row)
  let html = '';

  if (mode === 'all' || mode === 'edit') {
    html += `<div style="margin-bottom: 56px;">${generateEditorsCard()}</div>`;
  }
  if (mode === 'all' || mode === 'view') {
    html += `<div style="margin-bottom: 56px;">${generateLiveViewerCard()}</div>`;
    if (mode === 'all') {
      html += `<br><br><br><br>`;
    }
  }
  html += `<div style="margin-bottom: 50px;">${generatePeakSection()}</div>`;
  if (mode !== 'all') {
    html += `<br><br><br><br><br><br><br><br>`;
  }
  html += `<div style="margin-bottom: 0;">${generateAverageSection()}</div>`;

  const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
  <title>Statistics Report</title>
  <style type="text/css">
    body {
      font-family: Arial, sans-serif;
      margin: 0;
      padding: 0;
    }
    table {
      border-collapse: collapse;
    }
    td {
      vertical-align: top;
    }
    /* Ensure card border radius and border are applied */
    .statistics-card {
      border-radius: 8px !important;
      border: 1px solid #e0e0e0 !important;
      overflow: hidden;
    }
    /* Remove all margins and padding from progress bar container and usage label table for PDF */
    .progress-bar-container {
      margin-top: 0 !important;
      padding-left: 0 !important;
      padding-right: 0 !important;
    }
    .usage-label-table {
      margin: 0 !important;
      margin-bottom: 0 !important;
      margin-top: 0 !important;
      padding: 0 !important;
      padding-left: 0 !important;
      padding-right: 0 !important;
      border-spacing: 0 !important;
    }
    .usage-label-table tr {
      margin: 0 !important;
      padding: 0 !important;
    }
    .usage-label-table td {
      margin: 0 !important;
      padding: 0 !important;
      padding-left: 0 !important;
      padding-right: 0 !important;
      line-height: 1 !important;
    }
  </style>
</head>
<body>
  ${html}
</body>
</html>`;

  return fullHtml;
}
