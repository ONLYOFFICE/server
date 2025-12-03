/**
 * Mock statistics data for testing
 * Use this instead of API data for testing the HTML generation
 */
export const MOCK_STATISTICS_DATA = {
  licenseInfo: {
    packageType: 1, // 0 = Open Source, 1 = Enterprise, 2 = Developer
    buildDate: '2025-08-20T00:00:00Z',
    mode: 4,
    endDate: '2026-08-20T00:00:00Z',
    type: 0,
    startDate: '2025-08-01T00:00:00Z',
    connections: 100,
    connectionsView: 500,
    usersCount: 0,
    usersViewCount: 0
  },
  serverInfo: {
    buildVersion: '8.2',
    buildNumber: '1234',
    date: '2025-09-05T12:00:00Z'
  },
  quota: {
    edit: {
      connectionsCount: 24
    },
    view: {
      connectionsCount: 496
    },
    byMonth: []
  },
  connectionsStat: {
    hour: {
      edit: {max: 12, avr: 12},
      liveview: {max: 23, avr: 23}
    },
    day: {
      edit: {max: 18, avr: 18},
      liveview: {max: 42, avr: 42}
    },
    week: {
      edit: {max: 20, avr: 20},
      liveview: {max: 49, avr: 49}
    },
    month: {
      edit: {max: 24, avr: 24},
      liveview: {max: 56, avr: 56}
    }
  }
};
