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

- **Custom API Call** — a deliberate escape hatch to any Docker Engine endpoint,
  for anything this node does not cover or a newer Docker API than this release
  knows about. The response is returned exactly as Docker sent it and is
  explicitly marked `normalized: false`, in contrast to every other operation.
  It reuses the configured transport, so it works identically on socket, TCP, TLS
  and Portainer. Streaming endpoints are not supported here by design — use Get
  Events or the Docker Trigger node instead of hanging a workflow.
  - Read Only credentials permit `GET` and `HEAD`; any other method requires Full
    Control, since a Custom API Call cannot be classified by name alone.
- **New Docker Trigger node.** Starts a workflow when something happens in
  Docker — a container starting, dying, being killed, going out of memory or
  changing health status; an image being pulled or deleted; network and volume
  lifecycle. Filters (event type, action, container, image, label) are pushed to
  Docker rather than applied after the fact, so the daemon only sends what is
  wanted.
  - **Catches up on events missed while the workflow was not running.** Docker's
    event stream is live-only, so a restart would otherwise silently lose
    everything that happened while n8n was down. The last-seen event is persisted
    with the workflow and replayed from on reconnect. Verified: an event fired
    while the workflow was deactivated is delivered once it is reactivated.
  - **Reconnects automatically** with capped exponential backoff. The event
    stream dies for ordinary reasons — daemon restarts, socket hiccups, a laptop
    sleeping — and a trigger that quietly stops listening is worse than none.
  - **Never delivers the same event twice.** Docker's `since` parameter is
    inclusive, so the boundary event is redelivered on every reconnect;
    nanosecond timestamps are compared to filter it out. They are handled as
    strings because they exceed the precision of a JavaScript number.
- **Run Container (Ephemeral)** — create, run to completion, capture output and
  remove, in one operation. Returns exit code, stdout, stderr and duration. The
  container is cleaned up on every path including timeout, so a workflow that
  fails midway does not leave containers behind. An overrunning container is
  stopped and its output up to that point is still returned.
- **Execute Command** — runs a command inside a container and returns
  `{ stdout, stderr, exitCode }` from a single operation, rather than the three
  separate API calls Docker requires.
- **Wait For Container State** — blocks until a container is running, healthy or
  exited, with a timeout. Docker's own wait endpoint only handles *exited*;
  waiting for *healthy* is what deploy-then-verify workflows actually need.
  Waiting for health on an image with no HEALTHCHECK fails immediately with an
  explanation instead of spinning until the timeout.
- **Copy To / From Container** — file transfer through n8n's binary data system.
  A single file is unwrapped from Docker's tar so the user deals in files;
  directories are returned as a tar with a clear error explaining why one binary
  output cannot represent many files.
- **Get Container Stats** — CPU percentage, memory in MB and percent, network and
  block IO, and process count. Docker reports raw cumulative counters; the
  percentage is derived from the sample delta, and page cache is subtracted from
  memory so a container that has merely read files does not appear to be
  consuming it.
- **Prune Containers** with a dry-run preview listing exactly what would go.
- **New Network resource** (7 operations): List, Inspect, Create, Connect
  Container, Disconnect Container, Remove and Prune. Create supports a fixed
  subnet and gateway, internal and attachable networks, and IPv6. Connect
  supports a DNS alias.
- **New Volume resource** (5 operations): List, Inspect, Create, Remove and
  Prune, all with usage information where Docker provides it.
- **New System resource** (5 operations): Get Info, Get Version, Ping, Get Disk
  Usage and Get Events.
  - **Get Events reads a bounded window and always terminates.** Docker's events
    endpoint streams indefinitely when given no end time, which hangs a workflow
    forever. An end time is always sent. Continuous watching belongs in a trigger
    node, not an operation.
  - **Get Disk Usage** reports images, containers, volumes and build cache with
    counts, sizes in MB, and how much is reclaimable.
  - **Ping** returns reachability and round-trip latency.
- **Empty results now say whether they mean "none" or "not looked up".** Docker's
  network list never returns attached containers while inspect does, so an empty
  container list meant two different things depending on the call. Network output
  carries `containersEnumerated`, and volume output carries `usageKnown` for the
  same reason — Docker signals "size not calculated" with `-1`, which is neither
  zero nor unknown-shaped. Dry runs state the limitation in words too.
- **New Image resource with nine operations**: List, Inspect, Get History,
  Search, Pull, Push, Tag, Remove and Prune.
  - **Pull and Push** consume Docker's progress stream to completion and return a
    summary — layers processed, digest, final status and duration — rather than
    returning a stream that never ends or a wall of progress JSON. Failures that
    Docker reports *inside* an otherwise successful response are detected and
    raised, so a failed pull is never reported as a success.
  - **Remove** and **Prune** support dry run. Prune's preview lists the exact
    images that would go and the space reclaimed, and states plainly when the
    list cannot be exact — with "Dangling Only" disabled, Docker removes every
    image not referenced by a container, which cannot be determined in advance.
  - **Get History** reports each layer with its size and the command that created
    it, plus a total.
  - Image output is normalized the same way containers are, from a single source
    of truth, so list and inspect cannot diverge.
  - `includeLabels` defaults to **off** for image listings: image labels commonly
    carry large vendor descriptions, and enabling them can make a single list
    item eleven times bigger.
- **Endpoint-not-found errors are no longer reported as a missing container.**
  Docker answers an unrecognised API path with "page not found", which a broad
  match reported as "Container not found" — misleading when no container is
  involved. Surfaced by the Custom API Call operation.
- **Registry error messages.** A failed pull previously reported "the container
  or image may have been removed". Missing images, private repositories, expired
  credentials, unreachable registries, HTTP/HTTPS mismatches and images still in
  use by a container now each get an accurate, actionable message.
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
