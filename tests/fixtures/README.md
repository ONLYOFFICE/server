# info.json fixtures

This folder contains sample `info.json` responses used to test:

- Static page `branding/info/index.html`
- AdminPanel statistics UI

Each file is a valid `info.json` payload.

## How to use

`DocService/sources/routes/info.js` already has optional fixture support:

- Set `USE_FIXTURES = true`.
- Put JSON files into `tests/fixtures/info/`.
- Fixtures are returned in groups of requests controlled by `FIXTURE_REPEAT`.

Disable fixtures by setting `USE_FIXTURES = false` (default).

## Files
