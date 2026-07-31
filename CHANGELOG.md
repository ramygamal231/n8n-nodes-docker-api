# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
