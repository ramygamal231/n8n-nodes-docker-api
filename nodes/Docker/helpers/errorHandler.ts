export function translateDockerError(error: unknown): string {
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
  if (lower.includes('unauthorized') || lower.includes('authentication required')) {
    return (
      'Registry authentication failed. Add registry credentials under Additional Fields, ' +
      'or check that the token has not expired.'
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

  if (msg.includes('ECONNREFUSED')) {
    return 'Cannot connect to Docker daemon. Is Docker running? Check your connection settings.';
  }
  if (msg.includes('ENOENT') && msg.includes('docker.sock')) {
    return 'Docker socket not found at the specified path. Verify the socket path in your credential.';
  }
  if (msg.toLowerCase().includes('permission denied')) {
    return 'Permission denied accessing Docker socket. Ensure the n8n process has permission to access the socket.';
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

  // Fallback: return original message without prefix for cleaner output
  return msg;
}
