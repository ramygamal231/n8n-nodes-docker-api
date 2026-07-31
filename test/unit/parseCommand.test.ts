import { parseCommand } from '../../nodes/Docker/actions/container/create.operation';

/**
 * Docker takes a command as argv. Users type a shell-looking string, so the
 * splitter has to respect quoting — otherwise `sh -c "echo hello world"` becomes
 * five arguments and the container runs something entirely different from what
 * was typed.
 */
describe('parseCommand', () => {
  it('splits on whitespace', () => {
    expect(parseCommand('nginx -g daemon off')).toEqual(['nginx', '-g', 'daemon', 'off']);
  });

  it('keeps a double-quoted section as one argument', () => {
    expect(parseCommand('sh -c "echo hello world"')).toEqual(['sh', '-c', 'echo hello world']);
  });

  it('keeps a single-quoted section as one argument', () => {
    expect(parseCommand("sh -c 'echo hello world'")).toEqual(['sh', '-c', 'echo hello world']);
  });

  it('allows single quotes inside double quotes', () => {
    expect(parseCommand(`sh -c "echo 'nested'"`)).toEqual(['sh', '-c', "echo 'nested'"]);
  });

  it('does not treat backslash as an escape inside single quotes', () => {
    expect(parseCommand("sh -c 'a\\b'")).toEqual(['sh', '-c', 'a\\b']);
  });

  it('honours a backslash escape outside quotes', () => {
    expect(parseCommand('echo hello\\ world')).toEqual(['echo', 'hello world']);
  });

  it('collapses runs of whitespace', () => {
    expect(parseCommand('echo    a     b')).toEqual(['echo', 'a', 'b']);
  });

  it('preserves a deliberately empty quoted argument', () => {
    // `sh -c ""` must yield three args, not two - the empty string is meaningful.
    expect(parseCommand('sh -c ""')).toEqual(['sh', '-c', '']);
  });

  it('returns an empty array for an empty string', () => {
    expect(parseCommand('')).toEqual([]);
    expect(parseCommand('   ')).toEqual([]);
  });

  it('handles the real fixture command', () => {
    expect(parseCommand(`sh -c "i=0; while true; do echo \\"line $i\\"; sleep 2; done"`)).toEqual([
      'sh',
      '-c',
      'i=0; while true; do echo "line $i"; sleep 2; done',
    ]);
  });
});
