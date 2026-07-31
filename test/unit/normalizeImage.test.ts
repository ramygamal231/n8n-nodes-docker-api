import { normalizeImageInfo } from '../../nodes/Docker/helpers/normalizeImage';
import { summarizeProgress } from '../../nodes/Docker/actions/image/registry.operation';

/** Real /images/json entry. Created is unix seconds here. */
const LIST_SHAPE = {
  Id: 'sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b',
  ParentId: '',
  RepoTags: ['alpine:latest'],
  RepoDigests: ['alpine@sha256:79ff19e9084a00eece421b2523fb93e22d730e2c0e525905de047e848e56d95f'],
  Created: 1781222464,
  Size: 8451234,
  Labels: { maintainer: 'alpine' },
} as any;

/** Real /images/{name}/json entry for the same image. Created is RFC3339 here. */
const INSPECT_SHAPE = {
  Id: 'sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b',
  RepoTags: ['alpine:latest'],
  RepoDigests: ['alpine@sha256:79ff19e9084a00eece421b2523fb93e22d730e2c0e525905de047e848e56d95f'],
  Created: '2026-06-16T00:01:04.123456789Z',
  Size: 8451234,
  Architecture: 'amd64',
  Os: 'linux',
  Config: { Labels: { maintainer: 'alpine' }, Env: ['PATH=/usr/bin'] },
  RootFS: { Type: 'layers', Layers: ['sha256:aaa', 'sha256:bbb'] },
} as any;

describe('normalizeImageInfo — shape consistency', () => {
  const fromList = normalizeImageInfo(LIST_SHAPE);
  const fromInspect = normalizeImageInfo(INSPECT_SHAPE);

  it('produces identical keys from list and inspect', () => {
    expect(Object.keys(fromList).sort()).toEqual(Object.keys(fromInspect).sort());
  });

  it('agrees on every field except the sub-second part of createdAt', () => {
    expect({ ...fromList, createdAt: null }).toEqual({ ...fromInspect, createdAt: null });
  });

  it('strips the sha256: prefix when shortening the ID', () => {
    expect(fromList.shortId).toBe('28bd5fe8b56d');
    expect(fromList.shortId).not.toContain('sha256');
  });

  it('normalises both timestamp encodings to ISO with milliseconds', () => {
    expect(fromInspect.createdAt).toBe('2026-06-16T00:01:04.123Z');
    expect(fromList.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('converts size to MB', () => {
    expect(fromList.sizeMB).toBeCloseTo(8.06, 1);
  });

  it('honours includeLabels but always keeps the key', () => {
    const without = normalizeImageInfo(LIST_SHAPE, { includeLabels: false });
    expect(without).toHaveProperty('labels');
    expect(without.labels).toEqual({});
  });
});

describe('normalizeImageInfo — untagged images', () => {
  it('drops Docker\'s "<none>:<none>" placeholder and marks the image dangling', () => {
    const raw = { ...LIST_SHAPE, RepoTags: ['<none>:<none>'] };
    const out = normalizeImageInfo(raw);
    expect(out.tags).toEqual([]);
    expect(out.dangling).toBe(true);
    // With no tag to show, primaryTag falls back to the short ID.
    expect(out.primaryTag).toBe('28bd5fe8b56d');
  });

  it('treats a tagged image as not dangling', () => {
    expect(normalizeImageInfo(LIST_SHAPE).dangling).toBe(false);
    expect(normalizeImageInfo(LIST_SHAPE).primaryTag).toBe('alpine:latest');
  });

  it('survives null RepoTags entirely', () => {
    const out = normalizeImageInfo({ ...LIST_SHAPE, RepoTags: null, Labels: null });
    expect(out.tags).toEqual([]);
    expect(out.labels).toEqual({});
  });
});

describe('summarizeProgress — Docker pull/push event streams', () => {
  it('counts unique layers and extracts the digest', () => {
    const events = [
      { status: 'Pulling from library/alpine', id: 'latest' },
      { status: 'Pulling fs layer', id: 'aaa' },
      { status: 'Downloading', id: 'aaa', progressDetail: { current: 10, total: 100 } },
      { status: 'Download complete', id: 'aaa' },
      { status: 'Pull complete', id: 'aaa' },
      { status: 'Already exists', id: 'bbb' },
      { status: 'Digest: sha256:deadbeef' },
      { status: 'Status: Downloaded newer image for alpine:latest' },
    ];
    const s = summarizeProgress(events);
    expect(s.layers.sort()).toEqual(['aaa', 'bbb']);
    expect(s.digest).toBe('sha256:deadbeef');
    expect(s.finalStatus).toBe('Status: Downloaded newer image for alpine:latest');
    expect(s.events).toBe(8);
  });

  it('reads the digest from the aux field that push uses', () => {
    const s = summarizeProgress([{ aux: { Digest: 'sha256:pushed', Tag: 'v1', Size: 123 } }]);
    expect(s.digest).toBe('sha256:pushed');
  });

  it('handles an empty stream without throwing', () => {
    expect(summarizeProgress([])).toEqual({
      events: 0,
      layers: [],
      digest: null,
      finalStatus: null,
    });
  });
});

describe('summarizeProgress — digest formats across operations', () => {
  it('reads the "Digest: sha256:..." form that pull emits', () => {
    expect(summarizeProgress([{ status: 'Digest: sha256:abc123' }]).digest).toBe('sha256:abc123');
  });

  it('REGRESSION: reads the "v1: digest: sha256:... size: N" form that push emits', () => {
    // Previously only the two pull-shaped forms were handled, so a successful
    // push reported digest: null while the digest sat in the status line.
    const s = summarizeProgress([
      { status: 'v1: digest: sha256:79ff19e9084a00eece421b2523fb93e2 size: 1022' },
    ]);
    expect(s.digest).toBe('sha256:79ff19e9084a00eece421b2523fb93e2');
  });

  it('prefers the aux digest when both are present', () => {
    const s = summarizeProgress([
      { status: 'v1: digest: sha256:fromstatus size: 10', aux: { Digest: 'sha256:fromaux' } },
    ]);
    expect(s.digest).toBe('sha256:fromaux');
  });

  it('leaves digest null when no event carries one', () => {
    expect(summarizeProgress([{ status: 'Pulling fs layer', id: 'aaa' }]).digest).toBeNull();
  });
});
