import WOPISettings from '../pages/WOPISettings/WOPISettings';
import Expiration from '../pages/Expiration/Expiration';
import SecuritySettings from '../pages/SecuritySettings/SecuritySettings';
import EmailConfig from '../pages/EmailConfig/EmailConfig';
import NotificationRules from '../pages/NotificationRules/NotificationRules';
import FileLimits from '../pages/FileLimits/FileLimits';
import RequestFiltering from '../pages/RequestFiltering/RequestFiltering';
import LoggerConfig from '../pages/LoggerConfig/LoggerConfig';
import Statistics from '../pages/Statistics';
import ChangePassword from '../pages/ChangePassword/ChangePassword';

// Generic component factory function for pages not yet implemented
const createMockComponent = label => () => <div>{label} Component</div>;

export const menuItems = [
  {key: 'statistics', label: 'Statistics', path: '/statistics', component: Statistics},
  {key: 'examples', label: 'Examples', path: '/examples', component: createMockComponent('Examples')},
  {key: 'file-limits', label: 'File Limits', path: '/file-limits', component: FileLimits},
  {key: 'ip-filtering', label: 'IP Filtering', path: '/ip-filtering', component: SecuritySettings},
  {key: 'expiration', label: 'Expiration', path: '/expiration', component: Expiration},
  {key: 'request-filtering', label: 'Request Filtering', path: '/request-filtering', component: RequestFiltering},
  {key: 'wopi-settings', label: 'WOPI Settings', path: '/wopi-settings', component: WOPISettings},
  {key: 'email-config', label: 'Email Config', path: '/email-config', component: EmailConfig},
  {key: 'logger-config', label: 'Logger Config', path: '/logger-config', component: LoggerConfig},
  {key: 'notification-rules', label: 'Notification Rules', path: '/notification-rules', component: NotificationRules},
  {key: 'health-check', label: 'Health Check', path: '/health-check', component: createMockComponent('Health Check')},
  {key: 'config-check', label: 'Config Check', path: '/config-check', component: createMockComponent('Config Check')},
  {key: 'database-info', label: 'Database Info', path: '/database-info', component: createMockComponent('Database Info')},
  {key: 'forgotten-folder', label: 'Forgotten Folder', path: '/forgotten-folder', component: createMockComponent('Forgotten Folder')},
  {key: 'license-info', label: 'License Info', path: '/license-info', component: createMockComponent('License Info')},
  {key: 'deployment-info', label: 'Deployment Info', path: '/deployment-info', component: createMockComponent('Deployment Info')},
  {key: 'system-info', label: 'System Info', path: '/system-info', component: createMockComponent('System Info')},
  {key: 'change-password', label: 'Change Password', path: '/change-password', component: ChangePassword}
];
