// tests/router.test.ts
import { describe, it, expect, vi } from 'vitest';
import { FeatureRouter } from '../src/core/router';
import type { Feature } from '../src/core/types';

function makeFeature(id: string, channelIds: string[]): Feature {
  return {
    id,
    channelIds: new Set(channelIds),
    handler: vi.fn().mockResolvedValue(undefined),
  };
}

describe('FeatureRouter', () => {
  it('resolves a registered channel to its feature', () => {
    const router = new FeatureRouter();
    const feat = makeFeature('image-gen', ['chan-1', 'chan-2']);
    router.register(feat);
    expect(router.resolve('chan-1')).toBe(feat);
    expect(router.resolve('chan-2')).toBe(feat);
  });

  it('returns undefined for unregistered channel', () => {
    const router = new FeatureRouter();
    expect(router.resolve('unknown')).toBeUndefined();
  });

  it('registeredChannelIds returns all registered channels', () => {
    const router = new FeatureRouter();
    router.register(makeFeature('a', ['c1', 'c2']));
    router.register(makeFeature('b', ['c3']));
    const ids = router.registeredChannelIds;
    expect(ids.has('c1')).toBe(true);
    expect(ids.has('c2')).toBe(true);
    expect(ids.has('c3')).toBe(true);
    expect(ids.size).toBe(3);
  });

  it('overwrites with warning when channel already registered', () => {
    const router = new FeatureRouter();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const feat1 = makeFeature('a', ['c1']);
    const feat2 = makeFeature('b', ['c1']);
    router.register(feat1);
    router.register(feat2);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('already registered'));
    expect(router.resolve('c1')).toBe(feat2);
    warnSpy.mockRestore();
  });
});
