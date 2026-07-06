import type Database from 'better-sqlite3';
import type { Config } from '../../config';
import type { Feature } from '../../core/types';
import { CompressorClient } from './client';
import { createCompressorHandler } from './handler';

export function createCompressorFeature(config: Config, _db: Database.Database): Feature {
  const client = new CompressorClient({
    ffmpegPath: config.compressor.ffmpegPath,
    imageQuality: config.compressor.imageQuality,
    videoCrf: config.compressor.videoCrf,
    videoPreset: config.compressor.videoPreset,
  });
  return {
    id: 'compressor',
    channelIds: config.compressor.channelIds,
    handler: createCompressorHandler(client),
  };
}
