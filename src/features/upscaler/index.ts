import type Database from 'better-sqlite3';
import type { Config } from '../../config';
import type { Feature } from '../../core/types';
import { UpscalerClient } from './client';
import { createUpscalerHandler } from './handler';

export function createUpscalerFeature(config: Config, _db: Database.Database): Feature {
  const client = new UpscalerClient({
    binPath: config.upscaler.binPath,
    modelsPath: config.upscaler.modelsPath,
    model: config.upscaler.model,
    scale: config.upscaler.scale,
    format: 'png',
  });
  return {
    id: 'upscaler',
    channelIds: config.upscaler.channelIds,
    handler: createUpscalerHandler(client),
  };
}
