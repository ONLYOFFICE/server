import WOPISettings from '../pages/WOPISettings/WOPISettings';
import Expiration from '../pages/Expiration/Expiration';
import SecuritySettings from '../pages/SecuritySettings/SecuritySettings';
import EmailConfig from '../pages/NotitifcationConfig/NotificationConfig';
import FileLimits from '../pages/FileLimits/FileLimits';
import RequestFiltering from '../pages/RequestFiltering/RequestFiltering';
import LoggerConfig from '../pages/LoggerConfig/LoggerConfig';
import Statistics from '../pages/Statistics';
import ChangePassword from '../pages/ChangePassword/ChangePassword';

export const menuItems = [
  {key: 'statistics', label: 'Statistics', path: '/statistics', component: Statistics},
  {key: 'file-limits', label: 'File Limits', path: '/file-limits', component: FileLimits},
  {key: 'ip-filtering', label: 'IP Filtering', path: '/ip-filtering', component: SecuritySettings},
  {key: 'expiration', label: 'Expiration', path: '/expiration', component: Expiration},
  {key: 'request-filtering', label: 'Request Filtering', path: '/request-filtering', component: RequestFiltering},
  {key: 'wopi-settings', label: 'WOPI Settings', path: '/wopi-settings', component: WOPISettings},
  {key: 'notifications', label: 'Notifications', path: '/notifications', component: EmailConfig},
  {key: 'logger-config', label: 'Logger Config', path: '/logger-config', component: LoggerConfig},
  {key: 'change-password', label: 'Change Password', path: '/change-password', component: ChangePassword}
];
