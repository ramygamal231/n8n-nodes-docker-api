# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- A rejected Portainer access token now produces a readable message instead of
  leaking Docker's raw `(HTTP code 401) unexpected - Invalid JWT token`.
- A registry `unauthorized` response now names both of its possible causes.
  Registries answer identically for a private repository and for one that does
  not exist — revealing which private repositories exist would be a leak — so
  reporting only "authentication failed" sent people hunting for a credential
  problem when they had simply mistyped the repository name.
- **A failed build no longer leaves a container behind.** Docker's builder runs
  each step in a throwaway container and keeps it when a step fails, so you can
  attach and debug — sensible at a terminal, wrong in a workflow. Nobody is
  watching a scheduled run, and a build that fails every night accumulated one
  container per run until the disk filled, invisibly, since the operation
  reported an error and returned nothing. The container is now removed and the
  removal is stated in the error message. If it cannot be removed, that is
  reported too, rather than leaking silently.
- **Skip Certificate Verification now actually skips it.** The option turned off
  hostname checking but left chain verification running, so connecting to a
  daemon with a self-signed certificate — the only reason the option exists, and
  what its description promises — still failed with `unable to verify the first
  certificate` whether the box was ticked or not. It has to be applied through a
  custom HTTPS agent: docker-modem forwards only `key`, `cert`, `ca`,
  `checkServerIdentity` and `agent` to the request, so `rejectUnauthorized` set
  on the client is silently dropped. Found by running the TLS transport against a
  real mutual-TLS endpoint for the first time.
- **A socket permission failure now explains itself.** Node never uses the words
  "permission denied" for a refused connection — it reports `EACCES` on Unix and
  `EPERM` on Windows, and the rule matched neither. A socket whose ownership
  changed under a running n8n therefore surfaced as the raw
  `connect EACCES /var/run/docker.sock`, naming the failure but not the fix, for
  one of the commonest deployment problems there is. The message now points at
  the docker group and at socket ownership after a daemon restart.
- **Get Events now says when Docker could not reach back as far as asked.** The
  daemon keeps a fixed ring of recent events in memory (256 by default) and
  answers historical queries from that alone. On a busy host it rolls in minutes
  — a single container with a healthcheck emits three events per interval — so a
  request for the last hour could return the last two minutes with nothing to
  distinguish that from an hour in which nothing happened. The result now carries
  `oldestEvent`, `newestEvent` and `windowTruncated`, plus a warning naming how
  far back the data actually goes.
- Search Images now rejects an empty search term, like every other text input in
  the node. It previously sent the empty term to the registry and returned
  whatever came back — and a blank field is nearly always an expression that
  resolved to nothing.
- A malformed image reference now says the reference is invalid, rather than
  surfacing Node's `Request path contains unescaped characters`, which describes
  the HTTP client's internals and never mentions the name the user typed.

- **Package size reduced from 4.2 MB to 72 kB.** Documentation screenshots were
  being copied into the published package, where nothing uses them — GitHub and
  npm both resolve README images against the repository.
- Get Container Logs no longer renders the Container ID field twice. It was
  declared both in its own description and in the shared one covering every
  operation that targets a container.
- The container identifier now appears directly beneath Operation rather than
  below the optional settings that modify it.

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

- **Build Image.** Builds from a Dockerfile supplied as text — the common case,
  which otherwise requires assembling a tar archive by hand — or from a build
  context passed in as binary data when the build needs to `COPY` local files.
  Build arguments, target stage, labels, `--no-cache` and `--pull` are all
  supported. The build streams to completion and returns a summary (image ID,
  tags, duration, step count) rather than a progress firehose. A failing `RUN`
  step surfaces the step that failed and its output, instead of a bare non-zero
  exit.
- **Create Image From Container** (`commit`) — snapshots a container's filesystem
  as a new image, with optional author, message, and config changes.
- **Save Image** and **Load Image** — move images in and out as tar archives
  through n8n binary data, for backup or transfer to a host with no registry
  access. Save accepts multiple references in one call.
- **Prune Build Cache.** The builder cache is not touched by image pruning and is
  frequently the largest reclaimable space on a build host, yet nothing surfaced
  it. Supports a filter on cache age and a dry run.
- **Export Container** — the container's filesystem as a tar archive in binary
  data.
- **Get Path Info** — stat a path inside a container without copying it out.
  Returns name, size, mode, modified time, and whether it is a directory or a
  symlink. A missing path reports which path in which container was not found,
  rather than a bare 404.
- **Update Container** — change memory and CPU limits and the restart policy on a
  running container, without recreating it.
- **Check Registry Credentials** — verifies a registry username and password
  against the registry before a pull or push depends on them.
- **Get Registry Info** — reads an image's manifest from the registry without
  pulling it, returning the digest and the platforms the tag is published for.
  This is the cheap half of a pull: comparing the returned digest against the
  running image answers "is there a new version?" for a few kilobytes, where the
  same question asked with a pull downloads every layer to find out nothing
  changed. It also confirms a tag exists for a given architecture before a deploy
  commits to it, instead of failing at container start.

- **Connection Retry.** A request that never reached the daemon is retried
  automatically with exponential backoff — `ECONNREFUSED`, a missing or
  unreadable socket, an unreachable host, or a `502`/`503`/`504` from a proxy in
  front of Docker. Three attempts by default, configurable per node.

  Two rules keep it from causing more harm than it prevents:

  - **Anything Docker answered is never retried.** A missing container, a name
    conflict, a refused registry login — the daemon was reachable and replied, so
    retrying would bury a configuration problem under a delay.
  - **A write is never repeated once it may have been applied.** If the
    connection breaks *after* the request was sent, the daemon may already have
    created that container. Reads are retried; writes are not, and the error says
    the outcome is unknown instead of implying nothing happened.

  Retries wrap a single request, not an operation and not the node. Run Container
  is create, start, wait, remove — retrying *that* after the wait failed would
  leave a second container behind. It is also why n8n's own **Retry On Fail** is
  the wrong tool here: it re-executes the whole node, so items that already
  succeeded run again. Measured, not assumed — a node with two succeeding items
  and one failing item ran the succeeding two three times each.

- **Container creation reaches the options real deployments need.** Health check,
  CPU limit and CPU shares, capabilities to add and drop, privileged, devices,
  extra hosts, DNS servers, shared memory size, tmpfs mounts, and an init process.

  Two of these were defects rather than absences:

  - **Health check.** Wait For State can wait for `healthy`, but there was no way
    to *define* a health check when creating a container — so on any image that
    did not already ship one, an advertised feature could not be used at all.
  - **CPU limit.** Update Container could set CPU shares and Create could not, so
    the only way to create a CPU-limited container was to create it unlimited and
    immediately update it.

- **`health` is now part of every container result.** Wait For State reported it
  and nothing else did, so List and Inspect could not answer "which containers are
  unhealthy" — the question the deploy-then-verify workflows this node is built
  for actually ask. It is `null` when the container defines no health check, which
  is deliberately distinct from `"unhealthy"`: one means nobody is checking, the
  other means something checked and it failed. Docker's list endpoint has no
  health field at all and buries the status inside its human-readable text, as
  `Up 2 minutes (healthy)`; that is parsed out so both paths agree.

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
  - All five event types are verified end to end against a live daemon:
    container, image, network, volume and daemon. Daemon events have no API call
    that produces them — the daemon emits one when it re-reads its configuration
    — so that path is exercised by signalling dockerd and confirming the event
    arrives typed correctly.
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
