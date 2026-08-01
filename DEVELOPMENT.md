# Development Notes

## Quick Start

```bash
# Install dependencies
npm install

# Build (watch mode for development)
npm run dev

# Run tests
npm test

# Lint
npm run lint
```

## n8n Local Development — Automated Test Harness

An isolated, disposable n8n lives at `C:\n8n-test`. It is **not** the personal
instance in `~/.n8n` (that one is left untouched, on port 5678).

| | |
|---|---|
| Editor | http://127.0.0.1:5680 |
| Login | `test@n8n-docker.local` / `DockerTest2026x` |
| Data | `C:\n8n-test\.n8n` (throwaway sqlite) |
| n8n | 2.32.7, running on its own bundled Node 22.23.2 |
| Node loaded as | `CUSTOM.docker` (custom-dir load, not an npm install) |

The package is symlinked in via `C:\n8n-test\.n8n\custom\node_modules\`, so n8n
reads this repo's `dist/` directly.

```powershell
# start / restart the harness
powershell -File C:\n8n-test\start-n8n.ps1
```

After changing source: `npm run build`, then **restart n8n** — node classes are
only loaded at boot, so a rebuild alone is not enough.

### Gotchas discovered while building this

- **Port 5680, not 5679.** n8n's task-runner broker also defaults to 5679; using
  it for the editor makes n8n die at boot with "Task Broker's port is already in use".
- **n8n 2.x requires Node >= 22.22.** The harness ships its own Node so the
  system Node (22.18.0, used by other global tooling) is not disturbed.
- **On Windows the Docker socket path is `//./pipe/docker_engine`**, not
  `/var/run/docker.sock`. The credential's default is the Linux path.

### Running node tests through real n8n

`C:\n8n-test\run-test.js` drives a real workflow end to end:
upsert workflow → activate → POST webhook → read the execution's `runData` → assert.

```bash
# whole suite
node C:\n8n-test\run-test.js --file C:\n8n-test\suite.json

# one ad-hoc case
node C:\n8n-test\run-test.js '{"name":"list","params":{"resource":"container","operation":"list","showAll":true}}'

# every suite
for f in suite phase1 phase2 phase3 phase4 phase5 phase7 \
         comp-newops comp-core comp-dist depth1 depth2; do
  node C:\n8n-test\run-test.js --file C:\n8n-test\$f.json
done
```

| Spec file | Covers |
|---|---|
| `suite` | core container and image operations |
| `phase1`–`phase5` | each development phase's new operations |
| `phase7` | Custom API Call, access guard, error translation |
| `comp-newops` | Build, Save/Load, Commit, Export, Path Info, Update, Auth |
| `comp-core` | multi-item fan-out, continueOnFail, Copy To, Search, Create |
| `comp-dist` | Get Registry Info |
| `depth1` | second and third scenarios per operation; every optional field |
| `depth2` | failure paths, including an unreachable daemon on every resource |

### Measuring whether the tests are actually thorough

Two audits, because they answer different questions and the weaker one is easy to
mistake for the stronger.

`coverage.js` asks **does every operation have at least one spec** — it reads the
operation list from the running n8n instance and the covered set from the spec
files, so neither side is taken on trust.

`depth-audit.js` asks the question that actually matters: **how many scenarios
does each operation have, how many of those are failure cases, and which input
fields has no spec ever set.** A field nothing sets has never run, however many
specs its operation has. Both read `SPEC_FILES` — add new spec files to both.

```bash
node C:\n8n-test\coverage.js
node C:\n8n-test\depth-audit.js
```

The five operations with no failure-case spec are all prunes, which sweep and
have no failure mode of their own; they are covered by dry-run and exact-list
assertions instead. The one unexercised "field" is `customNotice`, a UI notice
that takes no input.

### The unreachable-daemon credential

`.credid_dead` is a TCP credential pointing at a port with nothing listening.
The local daemon always answers, so without it the connection-failure path of
every operation is unreachable from a test — while being the single most common
real-world failure. `depth2` runs it against every resource.

### Testing the TLS transport

Docker Desktop does not expose a TLS endpoint, and reconfiguring the daemon to
add one is invasive and easy to leave broken. Instead `n8ntest-tlsproxy` runs
nginx terminating TLS in front of the Docker socket, with `ssl_verify_client on`
so client certificates are genuinely required rather than merely offered.

`C:\n8n-test\tls\` holds a CA, a server certificate carrying `IP:127.0.0.1` in
its SAN, a client certificate with the `clientAuth` EKU, and a second *rogue* CA
whose client certificate the proxy must reject.

```powershell
docker run -d --name n8ntest-tlsproxy -l n8ntest=true -p 127.0.0.1:2376:2376 `
  -v /var/run/docker.sock:/var/run/docker.sock `
  -v C:\n8n-test\tls\nginx.conf:/etc/nginx/nginx.conf:ro `
  -v C:\n8n-test\tls:/certs:ro nginx:alpine
```

```bash
node C:\n8n-test\run-test.js --file C:\n8n-test\tls-suite.json
```

Six credentials drive it: valid mutual TLS, read-only, a certificate signed by
the rogue CA, no CA supplied, skip-verification, and a wrong port. The suite runs
real operations across every resource over TLS — including the streaming paths
(logs, TTY logs, exec, pull, build, save), since a proxy that buffered them would
let a passing test prove nothing about streaming.

Note that Windows `curl` uses schannel and cannot load PEM client certificates,
so it reports a handshake failure that has nothing to do with the proxy. Verify
by hand with Node, which is also what the node itself uses.

### Testing the trigger node

A trigger is a workflow *entry point*, so it cannot be driven through a webhook
like an operation. `C:\n8n-test\trigger-test.js` activates a workflow whose only
node is the trigger, causes a real Docker event, and asserts that n8n created an
execution carrying it.

```bash
node C:\n8n-test\trigger-test.js
```

### Testing daemon events

Daemon events need their own harness, because no Docker API call produces one —
the daemon emits `daemon/reload` when it re-reads its configuration, which takes
a SIGHUP. On Docker Desktop that means signalling `dockerd` inside the
`docker-desktop` WSL distro.

```bash
node C:\n8n-test\daemon-trigger-test.js
```

A SIGHUP is a *live* reload: dockerd re-reads `daemon.json` and applies a subset
of settings without stopping, restarting or recreating anything. Because that is
a stronger claim than the rest of the suite makes, the harness does not take it
on trust — it records every container (with `StartedAt` and `RestartCount`),
image, volume and network before signalling, and diffs afterwards. If the reload
disturbed anything the diff prints it and the test fails.

It covers the two behaviours that are easy to get wrong and invisible when they
break: **catch-up** (deactivate, cause an event, reactivate — the event must
still arrive) and **no duplicate delivery** (Docker's `since` is inclusive, so
the boundary event is redelivered on every reconnect and must be filtered out).

Spec fields: `name`, `params` (node parameters), `credential` (`full` | `readonly`),
`input` (webhook body), `expectError` (substring the node's error must contain),
`workflow` (put this spec in its own named, persistent workflow — inspectable in
the UI; omit to share one scratch workflow), `extraNodes` + `connections` (build a
multi-node graph, e.g. Docker → IF → Docker).

### Fixture safety policy

Read-only operations (`list`, `getLogs`, inspect, …) may run against **any**
container on the host — real ones included, that is useful signal.

**State-changing operations must only target synthetic `n8ntest-*` fixtures.**
The host has real, important stopped containers (qdrant, postgres, redis,
meilisearch, ollama, …) that must never be started, stopped, removed or pruned by
a test. `run-test.js` enforces this in `assertSafe()` and refuses the spec *before*
creating any workflow. Override per-spec with `"allowUnsafe": true` only when you
genuinely mean it.

The guard is deliberately strict: it blocks destructive ops on real containers
even with `dryRun: true`. Relax that in `assertSafe()` if it gets in the way.

As v1.0.0 adds create/remove/image operations, extend `DESTRUCTIVE_OPS` /
`DESTRUCTIVE_IMAGE_OPS` in `run-test.js` in the same commit, and build the
matching synthetic fixtures rather than reusing real images.

### UI / UX verification

The node's front end can be driven headlessly with `agent-browser` — login,
open the node panel, flip Operation, and screenshot. This is how to verify
`displayOptions` show/hide logic, which breaks silently as fields are added.

```bash
agent-browser open http://127.0.0.1:5680
agent-browser snapshot -i                      # login form refs
# fill email/password, click Sign in, open a workflow, dblclick the node
agent-browser screenshot panel.png
```

> **Assert on `runData`, never on the webhook response body.** The webhook's
> `responseData` option defaults to `firstEntryJson`, which will happily show you
> 1 item when the node actually emitted 17.

Fixture containers (all labelled `n8ntest=true`, safe to `docker rm`):
`n8ntest-logger` (stdout+stderr, no TTY), `n8ntest-tty` (TTY), `n8ntest-ports`
(published tcp+udp ports), `n8ntest-stopped` (start/stop target),
`n8ntest-portainer` (Portainer CE, for the Portainer transport).

`C:\n8n-test\fixtures.js` defines the canonical state of each and is run
automatically before every suite. Specs that start or stop containers otherwise
leave the host dirty and make suites order-dependent — running `phase1.json`
before `suite.json` used to fail `start: n8ntest-stopped` with "Container is
already running". Reset manually with `node C:\n8n-test\fixtures.js`.

### Verifying the credential Test Connection button

**Status: verified working** (2026-08-01) across socket, TCP, TLS and Portainer,
including the failure paths.

This one cannot be tested in the normal custom-directory setup — see the section
below for why — so it is verified by loading the node the way a real user gets
it. The procedure, for repeating before a release:

```bash
# 1. pack the current build
npm pack --pack-destination C:\n8n-test

# 2. install it (npm errors inside .n8n/nodes, so stage it elsewhere first)
mkdir C:\n8n-test\stage && cd C:\n8n-test\stage && npm init -y
npm install C:\n8n-test\n8n-nodes-docker-api-<version>.tgz
cp -r node_modules/. C:\n8n-test\.n8n\nodes\node_modules\

# 3. register it, since n8n loads community packages from the DB, not from disk
#    INSERT INTO installed_packages (packageName, installedVersion, ...)
#    INSERT INTO installed_nodes    (name, type, latestVersion, package)
#      types: n8n-nodes-docker-api.docker, n8n-nodes-docker-api.dockerTrigger

# 4. move the custom-dir symlink OUT of .n8n so nothing registers twice, restart

# 5. POST /rest/credentials/test with each connection mode
```

Confirm `supportedNodes` is populated before testing — that is the thing custom-dir
loading does not provide:

```
dockerApi supportedNodes: ["n8n-nodes-docker-api.docker","n8n-nodes-docker-api.dockerTrigger"]
```

Afterwards, remove the package, delete the DB rows and restore the custom-dir
symlink to get live reload back.

### Why the custom directory cannot test it

n8n only populates a credential's `supportedNodes` for nodes loaded as **npm
packages**. Our node loads from the **custom directory**, so:

```
dockerApi    supportedNodes: undefined        <- our node, custom-dir load
portainerApi supportedNodes: ["n8n-nodes-docker.docker", ...]   <- npm package
```

`CredentialsTester.getCredentialTestFunction()` iterates `getSupportedNodes()`,
finds nothing, and returns *"No testing function found for this credential."*
The `testedBy` + `methods.credentialTest` implementation is correct per n8n's
contract — it simply cannot resolve in this load mode.

Installing the packed tarball into `.n8n/nodes/` does not help: n8n loads
community packages from the `installed_packages` DB table, which only its
registry-based install flow populates.

**Therefore the Test Connection button must be verified on a release candidate**,
published to npm and installed through n8n's Community Nodes UI, before 1.0.0
ships. Everything else is verifiable here.

## Project Structure

- `credentials/` - Docker API credential type (socket, TCP, TLS)
- `nodes/Docker/` - Main node implementation
  - `actions/` - Operation implementations (list, getLogs, start, stop)
  - `descriptions/` - Node UI field definitions
  - `helpers/` - Utilities (normalize, error handling, access guard)
- `utils/` - Shared utilities (dockerode client factory)
- `test/unit/` - Unit tests for helpers

## v1 Implementation Status

✅ Complete:
- DockerApi credentials (socket + TCP, TLS schema ready)
- List Containers operation
- Get Container Logs operation
- Start Container operation
- Stop Container operation (with dry run)
- Access mode enforcement (readonly vs full-control)
- Error handling with human-readable messages
- Output normalization

Not yet implemented (v2+):
- TLS authentication (schema exists, not implemented)
- **Retry logic with exponential backoff** (see Known Limitations)
- Restart Container
- Remove Container
- Image operations (list, pull, remove)
- Container name autocomplete
- Trigger node

## Known Limitations

### No Retry Logic (v2 Target)

The current implementation **does not retry failed Docker operations**. If the Docker daemon becomes unreachable mid-workflow or socket permissions change, operations fail immediately.

**Why this matters:**
- Transient Docker daemon restarts cause workflow failures
- Socket permission changes during execution are not handled
- No exponential backoff for connection issues

**Planned fix (v2):**
- Add `utils/retry.ts` with configurable exponential backoff
- Retry only transient errors (ECONNREFUSED, timeout)
- Skip retry on permanent errors (container not found, permission denied)
- Expose retry settings in node UI (max retries, base delay)

**Workaround (v1):**
- Add n8n's built-in "Retry On Fail" node before Docker operations
- Configure your workflow to retry the entire node on failure

## Testing

Three layers, only two of which currently exist:

**1. Unit tests (exist).** Pure helpers, no Docker needed. 37 tests.
```bash
npm test
```
Covers `accessGuard`, `errorHandler`, `normalizeContainer`.

**2. Integration tests (DO NOT EXIST YET).** There is no `test/integration/`
directory. Nothing automatically exercises `list`/`start`/`stop`/`getLogs`,
`resolveContainer`, or `dockerClient` against a live daemon from Jest.
This is the biggest coverage gap.

**3. End-to-end through real n8n (exists, see harness section above).**
```bash
node C:\n8n-test\run-test.js --file C:\n8n-test\suite.json
```

## Common Issues

**Node not appearing in n8n:**
1. Ensure `npm run build` completed successfully
2. Check n8n dev server is restarted
3. Verify npm link is correct

**Docker connection errors:**
- Socket mode: Ensure n8n process has access to `/var/run/docker.sock`
- TCP mode: Ensure Docker daemon is running with `-H tcp://0.0.0.0:2375`

## Next Session Starting Point

When continuing development:
1. Read the spec: `n8n-docker-node-plan.md`
2. Check current implementation in `nodes/Docker/`
3. Review what's working in n8n at localhost:5678
4. Pick next v2 feature from roadmap
