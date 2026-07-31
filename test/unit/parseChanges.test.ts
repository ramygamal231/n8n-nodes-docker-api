import { parseChanges } from '../../nodes/Docker/actions/container/manage.operation';

/**
 * Regression tests for the two traps in /containers/{id}/changes, both of which
 * were hit against a live daemon:
 *
 *  - dockerode returns the body as a raw Buffer of JSON text, not parsed JSON.
 *  - Docker sends literal `null` rather than `[]` for an unchanged filesystem.
 */
describe('parseChanges', () => {
  it('REGRESSION: parses a Buffer containing "null" as no changes', () => {
    // Calling .map() on this Buffer previously returned another Buffer with every
    // element coerced to 0, surfacing as {"type":"Buffer","data":[0,0,0,0,0]}.
    const buf = Buffer.from('null\n', 'utf8');
    expect(buf.length).toBe(5);
    expect(parseChanges(buf)).toEqual([]);
  });

  it('parses a Buffer containing real changes', () => {
    const buf = Buffer.from(
      JSON.stringify([
        { Path: '/tmp/added.txt', Kind: 1 },
        { Path: '/etc/hosts', Kind: 0 },
        { Path: '/var/gone', Kind: 2 },
      ]),
      'utf8',
    );
    expect(parseChanges(buf)).toEqual([
      { path: '/tmp/added.txt', kind: 'added' },
      { path: '/etc/hosts', kind: 'modified' },
      { path: '/var/gone', kind: 'deleted' },
    ]);
  });

  it('maps the Kind enum correctly', () => {
    expect(parseChanges([{ Path: '/a', Kind: 0 }])[0].kind).toBe('modified');
    expect(parseChanges([{ Path: '/a', Kind: 1 }])[0].kind).toBe('added');
    expect(parseChanges([{ Path: '/a', Kind: 2 }])[0].kind).toBe('deleted');
    expect(parseChanges([{ Path: '/a', Kind: 99 }])[0].kind).toBe('unknown');
  });

  it('accepts an already-parsed array', () => {
    expect(parseChanges([{ Path: '/x', Kind: 1 }])).toEqual([{ path: '/x', kind: 'added' }]);
  });

  it('treats null, undefined and empty input as no changes', () => {
    expect(parseChanges(null)).toEqual([]);
    expect(parseChanges(undefined)).toEqual([]);
    expect(parseChanges(Buffer.alloc(0))).toEqual([]);
    expect(parseChanges('')).toEqual([]);
    expect(parseChanges('null')).toEqual([]);
  });

  it('does not throw on malformed JSON', () => {
    expect(parseChanges(Buffer.from('{not json', 'utf8'))).toEqual([]);
  });

  it('ignores non-array JSON and junk entries', () => {
    expect(parseChanges(Buffer.from('{"unexpected":true}', 'utf8'))).toEqual([]);
    expect(parseChanges([null, undefined, { Path: '/ok', Kind: 1 }])).toEqual([
      { path: '/ok', kind: 'added' },
    ]);
  });
});
