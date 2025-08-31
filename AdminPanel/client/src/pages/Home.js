import { useState } from 'react';
import Statistics from '../components/Statistics';
import Configuration from '../components/Configuration';
import Tabs from '../components/Tabs';
import styles from './styles.module.css';

const tabs = [
  { key: 'statistics', label: 'STATISTICS' },
  { key: 'configuration', label: 'CONFIGURATION' },
];

const tabComponents = {
  statistics: <Statistics />,
  configuration: <Configuration />,
};

export default function Home() {
  const [activeTab, setActiveTab] = useState('statistics');

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Document Server Admin Panel</h1>
      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab}>
        {tabComponents[activeTab]}
      </Tabs>
    </div>
  );
}