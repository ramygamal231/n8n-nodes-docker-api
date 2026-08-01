export function translateDockerError(error: unknown): string {
  return `${translateMessage(error)}${retrySuffix(error)}`;
}

/**
 * What the connection retry did, appended to whatever the message turned out to
 * be. It has to be reattached here because translateMessage replaces the raw
 * text entirely, which would otherwise discard it.
 *
 * Worth saying out loud: "we tried three times over four seconds and it never
 * came back" is a different problem from "it failed once", and only the first
 * justifies looking at the daemon rather than the workflow.
 */
function retrySuffix(error: unknown): string {
  const e = error as { retryAttempts?: number; retryNote?: string };
  if (e?.retryNote) return ` ${e.retryNote}`;
  if (typeof e?.retryAttempts === 'number' && e.retryAttempts > 1) {
    return ` (after ${e.retryAttempts} attempts)`;
  }
  return '';
}

function translateMessage(error: unknown): string {
  const msg = (error as Error)?.message ?? String(error);
  const lower = msg.toLowerCase();

  // --- registry errors -----------------------------------------------------
  // These must be checked BEFORE the generic "not found" rules below. A failed
  // pull says "manifest ... not found", which would otherwise be reported as
  // "the container or image may have been removed" — technically true and
  // completely unhelpful when the real problem is a typo in the image name.
  if (lower.includes('manifest unknown') || /manifest for .* not found/.test(lower)) {
    return (
      'Image not found in the registry. Check the image name and tag are correct, ' +
      'and that the tag exists for this platform.'
    );
  }
  if (lower.includes('pull access denied') || lower.includes('repository does not exist')) {
    return (
      'Access denied by the registry. The repository may not exist, or it is private ' +
      'and requires registry credentials.'
    );
  }
  // A 401 from the API itself means the connection credential is wrong — most
  // often an expired or mistyped Portainer access token. Docker's own socket and
  // TCP transports never return this, so it is specific to a proxied connection.
  // Portainer phrases it "Invalid JWT token", which matches none of the usual
  // wordings and previously leaked out raw as "(HTTP code 401) unexpected - ...".
  if (
    lower.includes('invalid jwt') ||
    lower.includes('jwt token') ||
    lower.includes('http code 401') ||
    lower.includes('(401)')
  ) {
    return (
      'Authentication failed. The access token was rejected — check it is correct and ' +
      'has not expired, and that it has access to the selected environment.'
    );
  }
  // Registries deliberately answer "unauthorized" for a repository that does not
  // exist, rather than 404 — revealing which private repositories exist would be
  // an information leak. So this single response means either cause, and saying
  // only "authentication failed" sends someone hunting for a credential problem
  // when they have actually just mistyped the repository name.
  if (lower.includes('unauthorized') || lower.includes('authentication required')) {
    return (
      'Registry rejected the request: either the repository does not exist, or it is ' +
      'private and needs credentials — registries return the same response for both. ' +
      'Check the repository name, and add registry credentials under Additional Fields ' +
      'if it is private.'
    );
  }
  // Node's HTTP client rejects a malformed path before the request is ever sent,
  // with wording that describes its own internals. Reaching a user, "Request path
  // contains unescaped characters" says nothing about the image name they typed.
  if (lower.includes('unescaped characters') || lower.includes('invalid url')) {
    return (
      'That image reference is not valid. Image names must be lowercase with no spaces, ' +
      'and a tag looks like name:tag — check for stray spaces or special characters.'
    );
  }
  if (lower.includes('tag does not exist') || lower.includes('no such image')) {
    return (
      'Image not found locally. Pull it first, or check the reference — an image ID is ' +
      'not the same as a name:tag.'
    );
  }
  if (lower.includes('no such host') || lower.includes('dial tcp')) {
    return (
      'Cannot reach the registry. Check the registry address and that the Docker host ' +
      'has network access to it.'
    );
  }
  if (lower.includes('server gave http response to https client')) {
    return (
      'The registry answered over plain HTTP but Docker expected HTTPS. For a local or ' +
      'internal registry, add it to the daemon’s insecure-registries list.'
    );
  }
  if (lower.includes('image is being used by') || lower.includes('conflict: unable to delete')) {
    return (
      'Image is still in use by one or more containers. Remove those containers first, ' +
      'or enable Force.'
    );
  }

  // --- container startup ----------------------------------------------------
  // A taken host port is one of the most common real-world failures, and Docker
  // reports it as a 500 wrapped in networking-driver wording that buries the
  // actual cause.
  if (lower.includes('port is already allocated') || lower.includes('address already in use')) {
    const port = msg.match(/Bind for [\d.:]*?(\d+) failed/i)?.[1];
    return (
      `Host port ${port ? `${port} ` : ''}is already in use by something else. ` +
      'Choose a different host port, or stop whatever is bound to it.'
    );
  }
  if (lower.includes('driver failed programming external connectivity')) {
    return (
      'Docker could not set up port forwarding for this container. The host port may be ' +
      'in use, or the Docker network may need restarting.'
    );
  }
  if (lower.includes('invalid reference format')) {
    return (
      'That image reference is not valid. Names must be lowercase, and a tag looks like ' +
      'name:tag — check for stray spaces or capital letters.'
    );
  }

  if (msg.includes('ECONNREFUSED')) {
    return 'Cannot connect to Docker daemon. Is Docker running? Check your connection settings.';
  }
  if (msg.includes('ENOENT') && msg.includes('docker.sock')) {
    return 'Docker socket not found at the specified path. Verify the socket path in your credential.';
  }
  // Node never uses the words "permission denied" for a refused connection — it
  // reports EACCES on Unix and EPERM on Windows, and the old rule matched neither.
  // A socket whose ownership changed under a running n8n therefore surfaced as the
  // raw "connect EACCES /var/run/docker.sock", which names the failure but not
  // the fix. This is one of the most common real deployment problems.
  if (
    msg.toLowerCase().includes('permission denied') ||
    /\bE(ACCES|PERM)\b/.test(msg)
  ) {
    return (
      'Permission denied opening the Docker socket. The n8n process is not allowed to access ' +
      'it — on Linux add that user to the docker group, or check the socket’s ownership if it ' +
      'was recreated by a daemon restart. On Windows, check the named pipe’s permissions.'
    );
  }
  // Must precede the container rule below. Docker answers an unrecognised
  // endpoint with "page not found", which a broad 'not found' match reported as
  // "Container not found" — actively misleading, since no container is involved.
  if (lower.includes('page not found')) {
    return (
      'Docker does not recognise that API endpoint. Check the path, and that the ' +
      'endpoint exists in your Docker Engine version.'
    );
  }
  if (
    msg.includes('No such container') ||
    /container .*not found/i.test(msg) ||
    msg.includes('no such id')
  ) {
    return 'Container not found. Verify the container ID or name is correct and the container exists.';
  }
  if (msg.includes('is not running')) {
    return 'Container is not running. Start the container before performing this operation.';
  }
  if (msg.includes('already started') || msg.includes('already running')) {
    return 'Container is already running.';
  }
  if (msg.includes('404')) {
    return 'Resource not found. The container or image may have been removed.';
  }
  if (msg.includes('409')) {
    return 'Conflict: The container may already be in the requested state.';
  }
  if (msg.includes('timeout') || msg.includes('ETIMEDOUT')) {
    return 'Connection timed out. Check network connectivity to the Docker host.';
  }
  // Node's wording for a response cut off partway through. On its own it is the
  // single word "aborted", which tells the user nothing about what happened or
  // what to do next.
  //
  // The uncertainty is stated here rather than only by the retry layer, because
  // that layer wraps modem.dial and cannot see a break in a HIJACKED stream —
  // exec and attach fail this way long after dial returned. The honest thing to
  // say is identical in both cases: the request was delivered, the answer was
  // not, and nobody knows which side of that the daemon acted on.
  if (lower === 'aborted' || lower.includes('request aborted') || lower.includes('socket hang up')) {
    return (
      'The connection to Docker was interrupted before the response arrived, so it is not ' +
      'known whether the daemon completed the operation. The daemon may have restarted, or a ' +
      'proxy in front of it closed the connection. Check the current state before running this ' +
      'again.'
    );
  }

  // Fallback: return original message without prefix for cleaner output
  return msg;
}
