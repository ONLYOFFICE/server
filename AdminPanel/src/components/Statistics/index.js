import React from 'react';
import { useQuery } from '@tanstack/react-query';
import TopBlock from './TopBlock/index';
import InfoTable from './InfoTable/index';
import styles from './styles.module.css';
import { fetchStatistics } from '../../api';

export default function Statistics() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['statistics'],
    queryFn: fetchStatistics,
  });

  if (isLoading) return <div>Loading statistics...</div>;
  if (error) return <div style={{ color: 'red' }}>Error: {error.message}</div>;
  if (!data) return null;

  const { licenseInfo, quota, connectionsStat, serverInfo } = data;

  const buildDate = licenseInfo.buildDate ? new Date(licenseInfo.buildDate).toLocaleDateString() : '';
  const buildBlock = (
    <TopBlock title="Build">
      <div>Type: {licenseInfo.packageType === 0 ? 'Open source' : licenseInfo.packageType === 1 ? 'Enterprise Edition' : 'Developer Edition'}</div>
      <div>Version: {serverInfo.buildVersion}.{serverInfo.buildNumber}</div>
      <div>Release date: {buildDate}</div>
    </TopBlock>
  );
  const licenseBlock = (
    <TopBlock title="License">
      {licenseInfo.startDate === null ? 'No license' : 
      <div>Start date: {licenseInfo.startDate ? new Date(licenseInfo.startDate).toLocaleDateString() : ''}</div>
}
    </TopBlock>
  );
  const connectionsBlock = (
    <TopBlock title="Connections limit">
      <div>Editors: {licenseInfo.connections}</div>
      <div>Live Viewer: {licenseInfo.connectionsView}</div>
    </TopBlock>
  );

  const valueEdit = licenseInfo.connections - (quota.edit.connectionsCount || 0);
  const valueView = licenseInfo.connectionsView - (quota.view.connectionsCount || 0);
  const editor = [
    [quota.edit.connectionsCount || 0, ''],
    [valueEdit, valueEdit > licenseInfo.connections * 0.1 ? 'normal' : 'critical']
  ];
  const viewer = [
    [quota.view.connectionsCount || 0, ''],
    [valueView, valueView > licenseInfo.connectionsView * 0.1 ? 'normal' : 'critical']
  ];
  const desc = ['Active', 'Remaining'];

  const peaksDesc = ['Last Hour', '24 Hours', 'Week', 'Month'];
  const peaksEditor = ['hour', 'day', 'week', 'month'].map(k => [connectionsStat?.[k]?.edit?.max || 0]);
  const peaksViewer = ['hour', 'day', 'week', 'month'].map(k => [connectionsStat?.[k]?.liveview?.max || 0]);
  const avrEditor = ['hour', 'day', 'week', 'month'].map(k => [connectionsStat?.[k]?.edit?.avr || 0]);
  const avrViewer = ['hour', 'day', 'week', 'month'].map(k => [connectionsStat?.[k]?.liveview?.avr || 0]);

  return (
    <div>
      <div className={styles.topRow}>{buildBlock}{licenseBlock}{connectionsBlock}</div>
      <InfoTable caption="Current connections" editor={editor} viewer={viewer} desc={desc} />
      <InfoTable caption="Peaks" editor={peaksEditor} viewer={peaksViewer} desc={peaksDesc} />
      <InfoTable caption="Average" editor={avrEditor} viewer={avrViewer} desc={peaksDesc} />
    </div>
  );
} 