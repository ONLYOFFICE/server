import Dashboard from '../pages/Dashboard/Dashboard';
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
  {key: 'dashboard', label: 'Dashboard', path: '/dashboard', component: Dashboard, iconIndex: 0, requiresConfig: false},
  {key: 'statistics', label: 'Statistics', path: '/statistics', component: Statistics, iconIndex: 1, requiresConfig: false},
  {key: 'ai-integration', label: 'AI Integration', path: '/ai-integration', component: AiIntegration, iconIndex: 2, requiresConfig: true},
  {key: 'example', label: 'Example', path: '/example', component: Example, iconIndex: 3, requiresConfig: false},
  {key: 'file-limits', label: 'File Limits', path: '/file-limits', component: FileLimits, iconIndex: 4, requiresConfig: true},
  {key: 'ip-filtering', label: 'IP Filtering', path: '/ip-filtering', component: SecuritySettings, iconIndex: 5, requiresConfig: true},
  {key: 'expiration', label: 'Expiration', path: '/expiration', component: Expiration, iconIndex: 6, requiresConfig: true},
  {key: 'wopi-settings', label: 'WOPI Settings', path: '/wopi-settings', component: WOPISettings, iconIndex: 8, requiresConfig: true},
  {key: 'notifications', label: 'Notifications', path: '/notifications', component: EmailConfig, iconIndex: 9, requiresConfig: true},
  {key: 'logger-config', label: 'Logger Config', path: '/logger-config', component: LoggerConfig, iconIndex: 10, requiresConfig: true},
  {key: 'settings', label: 'Settings', path: '/settings', component: Settings, iconIndex: 11, requiresConfig: true},
  {key: 'forgotten', label: 'Forgotten Files', path: '/forgotten', component: Forgotten, iconIndex: 12, requiresConfig: false},
  {key: 'healthcheck', label: 'Health Check', path: '/healthcheck', component: HealthCheck, iconIndex: 13, requiresConfig: false},
  {key: 'change-password', label: 'Change Password', path: '/change-password', component: ChangePassword, iconIndex: 14, requiresConfig: false}
];
