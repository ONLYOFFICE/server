// Role enum for access control
export const ROLES = {
  ADMIN: 'admin',
  USER: 'user'
};

export const configurationSections = [
  {
    title: 'Garbage Collector',
    fields: [
      {
        path: 'services.CoAuthoring.expire.filesCron',
        label: 'Files Cron',
        type: 'text',
        roles: [ROLES.ADMIN],
        description: 'Cron expression for file cleanup (admin only)'
      },
      {
        path: 'services.CoAuthoring.expire.documentsCron',
        label: 'Documents Cron',
        type: 'text',
        roles: [ROLES.ADMIN],
        description: 'Cron expression for document cleanup (admin only)'
      },
      {
        path: 'services.CoAuthoring.expire.files',
        label: 'Files Expiration Time',
        type: 'number',
        min: 0,
        roles: [ROLES.ADMIN],
        description: 'Files expiration time in seconds (admin only)'
      },
      {
        path: 'services.CoAuthoring.expire.filesremovedatonce',
        label: 'Files Removed At Once',
        type: 'number',
        min: 0,
        roles: [ROLES.ADMIN],
        description: 'Number of files to remove at once (admin only)'
      },
      {
        path: 'services.CoAuthoring.expire.sessionidle',
        label: 'Session Idle Timeout',
        type: 'text',
        roles: [ROLES.ADMIN, ROLES.USER],
        description: 'Session idle timeout (e.g., "1h", "30m")'
      },
      {
        path: 'services.CoAuthoring.expire.sessionabsolute',
        label: 'Session Absolute Timeout',
        type: 'text',
        roles: [ROLES.ADMIN, ROLES.USER],
        description: 'Session absolute timeout (e.g., "30d", "24h")'
      }
    ]
  },
  {
    title: 'Auto Assembly',
    fields: [
      {
        path: 'services.CoAuthoring.autoAssembly.step',
        label: 'Auto Assembly Step',
        type: 'select',
        options: [
          {value: '1m', label: '1 minute'},
          {value: '5m', label: '5 minutes'},
          {value: '10m', label: '10 minutes'},
          {value: '15m', label: '15 minutes'},
          {value: '30m', label: '30 minutes'}
        ],
        roles: [ROLES.ADMIN, ROLES.USER],
        description: 'Step interval for auto assembly process'
      }
    ]
  },
  {
    title: 'File Size Limits',
    fields: [
      {
        path: 'FileConverter.converter.maxDownloadBytes',
        label: 'Max Download Bytes',
        type: 'number',
        min: 0,
        max: 104857600,
        roles: [ROLES.ADMIN, ROLES.USER],
        description: 'Maximum number of bytes allowed for download (max: 100MB)'
      },
      {
        path: 'FileConverter.converter.inputLimits',
        label: 'Input Limits',
        type: 'json',
        roles: [ROLES.ADMIN, ROLES.USER],
        description: 'File type limits for conversion. Format: [{"type": "docx;dotx", "zip": {"uncompressed": "50MB", "template": "*.xml"}}]'
      }
    ]
  },
  {
    title: 'WOPI Configuration',
    fields: [
      {
        path: 'wopi.enable',
        label: 'Enable WOPI',
        type: 'checkbox',
        roles: [ROLES.ADMIN, ROLES.USER],
        description: 'Enable WOPI (Web Application Open Platform Interface) support'
      }
    ]
  },
  {
    title: 'Email Configuration',
    fields: [
      {
        path: 'email.smtpServerConfiguration.host',
        label: 'SMTP Host',
        type: 'text',
        roles: [ROLES.ADMIN, ROLES.USER],
        description: 'SMTP server hostname'
      },
      {
        path: 'email.smtpServerConfiguration.port',
        label: 'SMTP Port',
        type: 'number',
        min: 1,
        max: 65535,
        roles: [ROLES.ADMIN, ROLES.USER],
        description: 'SMTP server port number'
      },
      {
        path: 'email.smtpServerConfiguration.auth.user',
        label: 'SMTP Username',
        type: 'text',
        roles: [ROLES.ADMIN, ROLES.USER],
        description: 'SMTP authentication username'
      },
      {
        path: 'email.smtpServerConfiguration.auth.pass',
        label: 'SMTP Password',
        type: 'password',
        roles: [ROLES.ADMIN, ROLES.USER],
        description: 'SMTP authentication password'
      },
      {
        path: 'email.connectionConfiguration.disableFileAccess',
        label: 'Disable File Access',
        type: 'checkbox',
        roles: [ROLES.ADMIN, ROLES.USER],
        description: 'Disable file access for email connections'
      },
      {
        path: 'email.connectionConfiguration.disableUrlAccess',
        label: 'Disable URL Access',
        type: 'checkbox',
        roles: [ROLES.ADMIN, ROLES.USER],
        description: 'Disable URL access for email connections'
      },
      {
        path: 'email.contactDefaults.from',
        label: 'Default From Email',
        type: 'email',
        roles: [ROLES.ADMIN, ROLES.USER],
        description: 'Default sender email address'
      },
      {
        path: 'email.contactDefaults.to',
        label: 'Default To Email',
        type: 'email',
        roles: [ROLES.ADMIN, ROLES.USER],
        description: 'Default recipient email address'
      }
    ]
  }
];
