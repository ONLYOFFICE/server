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
        roles: [ROLES.ADMIN],
        description: 'File type limits for conversion (admin only). Format: [{"type": "docx;dotx", "zip": {"uncompressed": "50MB", "template": "*.xml"}}]'
      }
    ]
  }
];
