import type { Feature } from './types';

export class FeatureRouter {
  private channelMap = new Map<string, Feature>();

  register(feature: Feature): void {
    for (const channelId of feature.channelIds) {
      if (this.channelMap.has(channelId)) {
        const existing = this.channelMap.get(channelId)!;
        console.warn(
          `[router] Channel ${channelId} already registered to "${existing.id}", ` +
          `overwriting with "${feature.id}"`
        );
      }
      this.channelMap.set(channelId, feature);
    }
    console.log(
      `[router] Feature "${feature.id}" registered ` +
      `(${feature.channelIds.size} channel(s))`
    );
  }

  resolve(channelId: string): Feature | undefined {
    return this.channelMap.get(channelId);
  }

  get registeredChannelIds(): Set<string> {
    return new Set(this.channelMap.keys());
  }
}
