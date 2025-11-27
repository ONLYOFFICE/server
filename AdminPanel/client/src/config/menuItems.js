import WOPISettings from '../pages/WOPISettings/WOPISettings';
import Expiration from '../pages/Expiration/Expiration';
import SecuritySettings from '../pages/SecuritySettings/SecuritySettings';
import EmailConfig from '../pages/NotitifcationConfig/NotificationConfig';
import FileLimits from '../pages/FileLimits/FileLimits';
import LoggerConfig from '../pages/LoggerConfig/LoggerConfig';
import Statistics from '../pages/Statistics';
import ChangePassword from '../pages/ChangePassword/ChangePassword';
import HealthCheck from '../pages/HealthCheck/HealthCheck';
import AiIntegration from '../pages/AiIntegration';
import Settings from '../pages/Settings/Settings';
import Example from '../pages/Example/Example';
import Forgotten from '../pages/Forgotten/Forgotten';

export const menuItems = [
  {key: 'statistics', label: 'Statistics', path: '/statistics', component: Statistics, iconIndex: 1},
  {key: 'ai-integration', label: 'AI Integration', path: '/ai-integration', component: AiIntegration, iconIndex: 2},
  {key: 'example', label: 'Example', path: '/example', component: Example, iconIndex: 3},
  {key: 'file-limits', label: 'File Limits', path: '/file-limits', component: FileLimits, iconIndex: 4},
  {key: 'ip-filtering', label: 'IP Filtering', path: '/ip-filtering', component: SecuritySettings, iconIndex: 5},
  {key: 'expiration', label: 'Expiration', path: '/expiration', component: Expiration, iconIndex: 6},
  {key: 'wopi-settings', label: 'WOPI Settings', path: '/wopi-settings', component: WOPISettings, iconIndex: 8},
  {key: 'notifications', label: 'Notifications', path: '/notifications', component: EmailConfig, iconIndex: 9},
  {key: 'logger-config', label: 'Logger Config', path: '/logger-config', component: LoggerConfig, iconIndex: 10},
  {key: 'settings', label: 'Settings', path: '/settings', component: Settings, iconIndex: 11},
  {key: 'forgotten', label: 'Forgotten Files', path: '/forgotten', component: Forgotten, iconIndex: 12},
  {key: 'healthcheck', label: 'Health Check', path: '/healthcheck', component: HealthCheck, iconIndex: 13},
  {key: 'change-password', label: 'Change Password', path: '/change-password', component: ChangePassword, iconIndex: 14}
];
