# Workflow templates

Importable workflows built on [`n8n-nodes-docker-api`](https://www.npmjs.com/package/n8n-nodes-docker-api).

Each one is built around something this node can do that is otherwise awkward or
impossible, rather than demonstrating that a container can be listed.

Import via **Workflows → ⋯ → Import from File**, then edit the **Settings** node
(or the trigger's filters) and connect your own notification node where the
placeholders are.

---

## ♻️ Auto-update a container when a new image is published

`auto-update-containers.json`

Checks hourly whether the image you run has been rebuilt upstream, and if so
pulls it, replaces the container, and **waits until the new one reports
healthy** before calling the update a success.

**Why it is not just a scheduled `docker pull`:** the check reads the registry
manifest only — a few kilobytes — instead of pulling the whole image to discover
nothing changed. That is what makes running it hourly reasonable rather than
wasteful. It compares digests, never tags, because a tag moves and a digest does
not.

**The branch worth wiring up** is the unhealthy one. An update that deploys and
never comes up is the failure that matters, and the workflow separates it from
success rather than reporting "done" either way. That is where you would send a
loud alert, and where a rollback to the previous tag belongs.

Set the container name, image and ports in the **Settings** node. Adjust the
health check command to suit your service — the default probes an HTTP port.

## 🚑 Self-healing containers with escalation

`self-healing-containers.json`

Fires when a container dies, restarts it, confirms it stayed up, and escalates
to a human when restarting stops helping.

**Opt in per container** by adding the label `selfheal=true`. Nothing else is
touched, so this cannot restart something you deliberately stopped.

Three decisions in it are deliberate:

- **Logs are captured before the restart, not after.** Restarting can rotate or
  discard the very output that explains the crash. The alert carries the last 50
  lines with each line's stream of origin, so triage does not need a terminal.
- **It gives up after five restarts.** A container that has died five times will
  not be fixed by a sixth attempt, and a restart loop buries the cause while
  burning CPU. Past that point it escalates and stops.
- **Catch-up is enabled.** Docker's event stream is live-only, so a naive
  listener silently loses everything that happened while n8n was restarting —
  which is exactly when things tend to break. This replays what it missed.

If your container defines a health check, change **Confirm it stayed up** to
wait for `healthy` rather than `running`. Started is not the same as working.

---

## Testing

Both templates are exercised by the harness rather than assumed to work:

```bash
node C:\n8n-test\template-test.js      # imports both into n8n, activates the trigger
node C:\n8n-test\digest-logic-test.js  # the update decision, against real digests
```

The second one extracts the Code node's source straight from the published JSON
and runs it, so the test cannot drift away from what people actually import. It
covers the cases that would be expensive to get wrong: a registry answer with no
digest must not cause an hourly redeploy of a healthy container, and an image
that has never been pulled must count as needing a deploy rather than an error.
