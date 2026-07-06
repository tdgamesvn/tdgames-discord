import type Database from 'better-sqlite3';
import type { Config } from '../../config';
import type { Feature } from '../../core/types';
import { ImageClient } from './client';
import { createImageGenHandler } from './handler';

export function createImageGenFeature(config: Config, db: Database.Database): Feature {
  const client = new ImageClient(
    config.cliproxy.apiUrl,
    config.cliproxy.apiKey,
    config.openai.apiKey ?? undefined,
    config.openai.apiUrl,
    config.cliproxy.maxConcurrent,
    config.imageGen.fallbackModel,
  );
  return {
    id: 'image-gen',
    channelIds: config.imageGen.channelIds,
    handler: createImageGenHandler(client),
  };
}
