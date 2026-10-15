# Server

[![License](https://img.shields.io/badge/License-GNU%20AGPL%20V3-green.svg?style=flat)](https://www.gnu.org/licenses/agpl-3.0.en.html)

The backend layer of [ONLYOFFICE Docs][2]. It contains the Node.js services that the editors talk to: the co-authoring document service, file conversion dispatch and metrics, together with the shared `Common` library and default configuration.

In the full ONLYOFFICE Docs source tree this repository corresponds to the `server` component. The product build, native binaries, editor UI and packaging are assembled by the parent DocumentServer build pipeline.

## Repository layout

- `DocService` — co-authoring server, file API, converter dispatch and admin endpoints.
- `FileConverter` — wrapper around the document conversion binary.
- `Metrics` — StatsD-based metrics exporter.
- `Common` — shared sources and configuration files used by every service.
- `branding/welcome` — example welcome pages shipped with a fresh installation.

This repository holds the Node.js sources only. It is not the build root for ONLYOFFICE Docs: the binary distribution (runtime, system service, packaging) is assembled separately.

## Runtime entry points

- `docservice`: starts the co-authoring HTTP/WebSocket service from `DocService/sources/server.js`.
- `fileconverter`: starts the converter worker master from `FileConverter/sources/convertermaster.js`.

## Configuration

Configuration is layered with [node-config](https://github.com/lorenwest/node-config). All config files live in `Common/config`:

- `default.json` — defaults shared by every deployment.
- `production-linux.json` / `production-windows.json` — production overrides per platform.
- `development-linux.json` / `development-windows.json` / `development-mac.json` — overrides used in development.

To change settings locally without modifying the tracked files, create a `local.json` under `Common/config`.

Runtime changes can also be stored in the `runtime.json` file referenced by `runtimeConfig.filePath`; packaged deployments should keep it in the persistent data directory so these settings survive application updates.

## Development notes

Top-level npm scripts are intended for repository maintenance: installing subproject dependencies, linting, formatting and running Jest tests. `npm run build` installs dependencies for the tracked subprojects; it does not produce a complete ONLYOFFICE Docs package.

Local maintenance tasks require Node.js and npm compatible with the checked-in lockfiles.

## Installation

If you just want to run ONLYOFFICE Docs Community Edition, install a packaged release using the official guide rather than building from this repository:

- Community Edition installation: <https://helpcenter.onlyoffice.com/docs/installation/community/>

The packaged build provides everything required to run the server.

## User feedback and support

Questions about [ONLYOFFICE Docs][2] are best asked on the official forum: [forum.onlyoffice.com][1]. Development questions can also be tagged on [Stack Overflow][3].

[1]: https://forum.onlyoffice.com
[2]: https://github.com/ONLYOFFICE/DocumentServer
[3]: https://stackoverflow.com/questions/tagged/onlyoffice

## License

Server is released under the GNU AGPL v3.0. See the `LICENSE.txt` file for details.
