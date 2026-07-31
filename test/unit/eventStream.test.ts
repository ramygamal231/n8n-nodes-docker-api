import {
  buildEventFilters,
  createEventLineParser,
  isNewEvent,
  nextBackoffMs,
  normalizeEvent,
} from '../../nodes/Docker/helpers/eventStream';

const evt = (action: string, nano: string, name = 'n8ntest-logger') =>
  JSON.stringify({
    Type: 'container',
    Action: action,
    Actor: { ID: 'a'.repeat(64), Attributes: { name, image: 'alpine' } },
    scope: 'local',
    time: 1785505548,
    timeNano: Number(nano),
  });

describe('createEventLineParser', () => {
  it('parses whole lines from a single chunk', () => {
    const p = createEventLineParser();
    const out = p.push(`${evt('start', '1')}\n${evt('die', '2')}\n`);
    expect(out.map((e) => e.Action)).toEqual(['start', 'die']);
  });

  it('REGRESSION: reassembles an event split across chunk boundaries', () => {
    // TCP splits wherever it likes, routinely mid-object. Parsing each chunk in
    // isolation would silently drop every event unlucky enough to be split.
    const line = `${evt('start', '1')}\n`;
    const cut = Math.floor(line.length / 2);
    const p = createEventLineParser();

    expect(p.push(line.slice(0, cut))).toEqual([]); // incomplete: nothing yet
    const out = p.push(line.slice(cut));
    expect(out).toHaveLength(1);
    expect(out[0].Action).toBe('start');
  });

  it('handles many events arriving in one chunk with a partial tail', () => {
    const p = createEventLineParser();
    const whole = `${evt('start', '1')}\n${evt('die', '2')}\n`;
    const partial = evt('stop', '3').slice(0, 20);

    expect(p.push(whole + partial).map((e) => e.Action)).toEqual(['start', 'die']);
    // The tail only completes once the rest arrives.
    expect(p.push(evt('stop', '3').slice(20) + '\n').map((e) => e.Action)).toEqual(['stop']);
  });

  it('skips a malformed line instead of throwing', () => {
    const p = createEventLineParser();
    const out = p.push(`not json\n${evt('start', '1')}\n`);
    expect(out).toHaveLength(1);
    expect(out[0].Action).toBe('start');
  });

  it('flush returns a trailing line with no newline', () => {
    const p = createEventLineParser();
    expect(p.push(evt('start', '1'))).toEqual([]);
    expect(p.flush().map((e) => e.Action)).toEqual(['start']);
    expect(p.flush()).toEqual([]); // buffer cleared
  });

  it('ignores blank lines and keep-alives', () => {
    const p = createEventLineParser();
    expect(p.push('\n\n  \n')).toEqual([]);
  });
});

describe('isNewEvent — Docker `since` is inclusive', () => {
  it('accepts everything when nothing has been seen', () => {
    expect(isNewEvent('100', undefined)).toBe(true);
    expect(isNewEvent('100', '0')).toBe(true);
  });

  it('REGRESSION: rejects the boundary event redelivered on reconnect', () => {
    // Reconnecting with since=lastSeen redelivers that exact event. Without this,
    // every reconnect would re-fire the workflow for something already handled.
    expect(isNewEvent('1785505548000000000', '1785505548000000000')).toBe(false);
  });

  it('accepts a strictly later event', () => {
    expect(isNewEvent('1785505548000000001', '1785505548000000000')).toBe(true);
  });

  it('compares beyond Number.MAX_SAFE_INTEGER without losing precision', () => {
    const a = '1785505548000000001';
    const b = '1785505548000000002';
    // These are indistinguishable as JS numbers, which would break dedupe.
    expect(Number(a) === Number(b)).toBe(true);
    expect(isNewEvent(b, a)).toBe(true);
    expect(isNewEvent(a, b)).toBe(false);
  });

  it('does not drop events when a timestamp is unparseable', () => {
    // Failing open is right here: a duplicate is recoverable, a dropped alert is not.
    expect(isNewEvent('not-a-number', '100')).toBe(true);
  });
});

describe('normalizeEvent', () => {
  it('flattens the Actor block into usable fields', () => {
    const raw = JSON.parse(evt('die', '1785505548000000000'));
    const e = normalizeEvent(raw);
    expect(e.type).toBe('container');
    expect(e.action).toBe('die');
    expect(e.name).toBe('n8ntest-logger');
    expect(e.image).toBe('alpine');
    expect(e.shortId).toBe('aaaaaaaaaaaa');
    expect(e.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('keeps timeNano as a string to preserve precision', () => {
    const e = normalizeEvent(JSON.parse(evt('start', '1785505548123456789')));
    expect(typeof e.timeNano).toBe('string');
  });

  it('survives an event with no Actor at all', () => {
    const e = normalizeEvent({ Type: 'daemon', Action: 'reload' });
    expect(e.actorId).toBeNull();
    expect(e.shortId).toBeNull();
    expect(e.attributes).toEqual({});
  });
});

describe('buildEventFilters', () => {
  it('maps node fields onto Docker filter names', () => {
    expect(
      buildEventFilters({
        eventTypes: ['container', 'image'],
        actions: ['start', 'die'],
        container: 'n8ntest-logger',
        image: 'alpine',
        label: 'a=b',
      }),
    ).toEqual({
      type: ['container', 'image'],
      // Docker calls the action filter "event", not "action".
      event: ['start', 'die'],
      container: ['n8ntest-logger'],
      image: ['alpine'],
      label: ['a=b'],
    });
  });

  it('omits empty values so Docker does not filter everything out', () => {
    expect(buildEventFilters({ eventTypes: ['container'], actions: [] })).toEqual({
      type: ['container'],
    });
    expect(buildEventFilters({})).toEqual({});
  });
});

describe('nextBackoffMs', () => {
  it('doubles and then caps', () => {
    expect(nextBackoffMs(1000)).toBe(2000);
    expect(nextBackoffMs(2000)).toBe(4000);
    expect(nextBackoffMs(20000)).toBe(30000);
    expect(nextBackoffMs(30000)).toBe(30000);
  });
});
