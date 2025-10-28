# info.json Fixtures for Rendering Tests

This directory contains sample `info.json` payloads that exercise different rendering paths in:

- Static page: `branding/info/index.html`
- React AdminPanel: `AdminPanel/client/src/components/Statistics/`

Each file is self-contained and adheres to the server `info.json` schema used by the UI.

## Automatic Fixture Cycling

To enable automatic cycling through fixtures on each request, add this code to your `licenseInfo` function:

```javascript
const path = require('path');
const fs = require('fs');

// Request counter for cycling through fixtures (persistent across calls)
licenseInfo.requestCounter = (licenseInfo.requestCounter || 0) + 1;
licenseInfo.fixtureFiles = licenseInfo.fixtureFiles || [];

// Load fixture files list on first call
if (licenseInfo.fixtureFiles.length === 0) {
  try {
    const fixturesDir = path.join(__dirname, '../../../tests/fixtures/info');
    const files = fs.readdirSync(fixturesDir);
    licenseInfo.fixtureFiles = files.filter(file => file.endsWith('.json'));
  } catch (e) {
    // If fixtures directory doesn't exist, continue with normal flow
  }
}

// Cycle through fixtures on every request
if (licenseInfo.fixtureFiles.length > 0) {
  const fixtureIndex = (licenseInfo.requestCounter - 1) % licenseInfo.fixtureFiles.length;
  const fixturePath = path.join(__dirname, '../../../tests/fixtures/info', licenseInfo.fixtureFiles[fixtureIndex]);
  try {
    const fixtureData = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    return res.json(fixtureData);
  } catch (e) {
    // If fixture fails to load, continue with normal flow
  }
}
```

## Files
