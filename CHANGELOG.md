# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### BREAKING

- **Container output is now identical regardless of which operation produced it.**
  Previously `list` and `start`/`stop` returned different shapes for the same
  container. Specifically:
  - `ports` is now populated on `start`/`stop` (previously always `[]`, because
    the code read the list-response field, while inspect responses carry ports
    under `NetworkSettings.Ports`).
  - `createdAt` is always ISO-8601 with milliseconds. The inspect path previously
    leaked Docker's raw nanosecond string, e.g. `2026-07-31T13:42:39.344492418Z`.
  - `labels` now honours `includeLabels` on every path, and the key is **always
    present** — suppressing labels yields `{}` rather than omitting the field.
    A field that sometimes disappears breaks downstream IF/Switch nodes.

### Added

- **Nine new container operations**, bringing the container resource to fifteen:
  Inspect, Create, Restart, Kill, Pause, Unpause, Rename, Remove, List Processes
  and Get Filesystem Changes.
  - **Inspect** returns health status, exit code, restart count, start and finish
    times, restart policy, resource limits, network addresses, mounts, and
    environment variables as an object rather than a `KEY=value` array.
  - **Create** builds port, volume, environment and label mappings from
    structured fields instead of hand-written JSON, and can start the container in
    the same step. Commands are parsed with quote awareness, so
    `sh -c "echo hello world"` stays three arguments rather than five.
  - **List Processes** zips Docker's parallel title and row arrays into objects,
    so a workflow can reference `process.pid` instead of `process[1]`.
  - **Get Filesystem Changes** handles Docker returning a literal `null` for an
    unchanged filesystem rather than an empty list.
  - Dry run is available on every destructive operation (Stop, Restart, Kill,
    Remove) and returns an identical payload shape across all of them.
- **Portainer connection mode.** Docker can now be reached through an existing
  Portainer instance, alongside socket, TCP and TLS. All four modes are served by
  a single client, so every operation works identically on each.
- **TLS connection mode implemented.** The credential schema has advertised TLS
  since 0.1.0 without an implementation. Includes optional CA, required client
  certificate and key, and an opt-in switch to skip certificate verification for
  self-signed setups.
- **Test Connection support** on the Docker API credential (`docker.ping()` plus a
  version probe), reporting the daemon version and connection mode on success and
  a human-readable reason on failure.
- **Credential icon** — the credential previously rendered as a grey placeholder.
- Required-field validation on credentials. Connection fields are now marked
  required per mode, so a TCP credential can no longer be saved with an empty host.
- Platform-aware default socket path: Windows hosts now default to
  `//./pipe/docker_engine` instead of a Unix path that could never connect.

### Changed

- **The access guard is now an allowlist and fails closed.** It previously listed
  known write operations, so any operation added without updating that list would
  have been silently available to Read Only credentials. Unrecognised operations
  are now denied by default. A Custom API Call is classified by its HTTP method.

### Fixed

- **Container logs from TTY containers returned nothing.** Containers started with
  a TTY (`docker run -t`, or `tty: true` in Compose) emit a raw, unframed log
  stream, while non-TTY containers use Docker's 8-byte multiplexed framing. The
  parser assumed framing unconditionally, misread the first bytes of log text as a
  length field, and silently returned `logs: []` with `lineCount: 0` — reported as
  a successful execution with no error. Get Container Logs now inspects the
  container and parses whichever format Docker actually sends.

### Added

- `tty` field on Get Container Logs output, indicating which log format the
  container uses.
- `warning` field on Get Container Logs when a stream filter is requested for a
  TTY container. Docker merges stdout and stderr into one stream for TTY
  containers, so filtering is not possible; all output is returned and labelled
  `stdout` rather than silently yielding nothing.
- Unit tests for both log parsers, including a regression test built from real
  bytes captured off a live TTY container.

---

## [0.1.1] - 2026-03-28

### Fixed

- Corrected asset path for node icon, ensuring it displays correctly in the n8n editor.
- Updated all internal package references from `n8n-nodes-docker` to `n8n-nodes-docker-api`.
- Fixed the license badge in `README.md` to display correctly.

---

## [0.1.0] - 2026-03-23

### Added

- Initial release of n8n-nodes-docker-api package
- Docker API credentials with Unix Socket and TCP connection support
- Docker API node with 4 core operations:
  - List Containers (with name, status filters)
  - Get Container Logs (stdout/stderr separated, timestamped)
  - Start Container
  - Stop Container (with dry-run mode)
- Access control modes:
  - Read Only (list containers, get logs only)
  - Full Control (all operations)
- Normalized container output (id, shortId, name, image, status, createdAt)
- Unit test setup with Jest
- TypeScript support with ESLint and Prettier configuration

### Changed

- N/A

### Deprecated

- N/A

### Removed

- N/A

### Fixed

- N/A

### Security

- N/A

---

## Future Roadmap

### v2.0.0 (Planned)

- Restart Container operation
- Remove Container operation
- Image operations (list, pull, remove)
- TLS support for secure remote connections
- Container autocomplete in node UI

### v3.0.0 (Planned)

- Run container (ephemeral jobs)
- Execute commands in container
- Container stats/metrics

### v4.0.0 (Planned)

- Docker Trigger node (event-based webhooks)

---

## Versioning Notes

- **MAJOR** version (0.x.0 → 1.x.0): Breaking changes or major new functionality
- **MINOR** version (x.1.0 → x.2.0): New features, backward compatible
- **PATCH** version (x.x.1 → x.x.2): Bug fixes, backward compatible

> **Note:** While in `0.x.x` status, the API may change. Once we reach `1.0.0`, we'll follow strict semantic versioning with backward compatibility guarantees.
