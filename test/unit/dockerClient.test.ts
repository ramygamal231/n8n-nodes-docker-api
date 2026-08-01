import { ICredentialDataDecryptedObject } from 'n8n-workflow';

import { createDockerClient, DockerCredentialError } from '../../utils/dockerClient';

/**
 * These assert the options handed to dockerode, because the transport is chosen
 * once at connection time and every operation inherits whatever it decided. A
 * mistake here is invisible in the operation code and shows up only as a
 * connection that is less secure, or less usable, than the credential claims.
 */
const tlsCreds = (over: Record<string, unknown> = {}): ICredentialDataDecryptedObject => (({
  authMode: 'tls',
  host: '127.0.0.1',
  tlsPort: 2376,
  cert: '---CERT---',
  clientKey: '---KEY---',
  ca: '---CA---',
  accessMode: 'full',
  ...over,
}) as ICredentialDataDecryptedObject);

/** The client exposes the transport configuration it was built with. */
const modemOf = (creds: ICredentialDataDecryptedObject) =>
  createDockerClient(creds).options as unknown as Record<string, unknown>;

describe('createDockerClient — TLS', () => {
  it('passes the certificate material through to the transport', () => {
    const modem = modemOf(tlsCreds());
    expect(modem.protocol).toBe('https');
    expect(modem.host).toBe('127.0.0.1');
    expect(modem.port).toBe(2376);
    expect(modem.cert).toBe('---CERT---');
    expect(modem.key).toBe('---KEY---');
    expect(modem.ca).toBe('---CA---');
  });

  it('omits the CA entirely when none is supplied, rather than sending an empty one', () => {
    // An empty string is not "no CA" to Node's TLS stack. Omitting the key falls
    // back to the system trust store, which is what a publicly signed daemon
    // certificate needs.
    const modem = modemOf(tlsCreds({ ca: '   ' }));
    expect(modem.ca).toBeUndefined();
  });

  it('verifies by default', () => {
    const modem = modemOf(tlsCreds());
    expect(modem.checkServerIdentity).toBeUndefined();
    expect(modem.agent).toBeUndefined();
  });

  it('disables BOTH verification checks when Skip Certificate Verification is on', () => {
    // Regression test. Only checkServerIdentity was overridden, which governs
    // hostname matching alone. Chain verification stayed on, so a self-signed
    // daemon certificate — the one case the option exists for — still failed
    // with "unable to verify the first certificate" no matter how it was set.
    const modem = modemOf(tlsCreds({ skipTlsVerify: true }));
    expect(typeof modem.checkServerIdentity).toBe('function');
    // It must travel on an agent: docker-modem forwards only key, cert, ca,
    // checkServerIdentity and agent, so rejectUnauthorized set on the client
    // itself never reaches the request and is silently ignored.
    const agent = modem.agent as { options?: { rejectUnauthorized?: boolean } } | undefined;
    expect(agent).toBeDefined();
    expect(agent?.options?.rejectUnauthorized).toBe(false);
  });

  it('requires the client certificate and key', () => {
    expect(() => createDockerClient(tlsCreds({ cert: '' }))).toThrow(DockerCredentialError);
    expect(() => createDockerClient(tlsCreds({ clientKey: '' }))).toThrow(DockerCredentialError);
  });

  it('rejects a non-numeric TLS port before touching the network', () => {
    expect(() => createDockerClient(tlsCreds({ tlsPort: 'not-a-port' }))).toThrow(
      DockerCredentialError,
    );
  });
});
