import type Database from 'better-sqlite3';
import type { Config } from '../../config';
import type { Feature } from '../../core/types';
import { UpscalerClient } from '../upscaler/client';
import { VideoUpscalerClient } from './client';
import { createUpscalerVideoHandler } from './handler';

export function createUpscalerVideoFeature(config: Config, _db: Database.Database): Feature {
  // Reuses the same Real-ESRGAN (upscayl-bin) binary/model already configured for image upscaling.
  const upscaler = new UpscalerClient({
    binPath: config.upscaler.binPath,
    modelsPath: config.upscaler.modelsPath,
    model: config.upscaler.model,
    scale: config.upscaler.scale,
    format: 'png',
  });
  const client = new VideoUpscalerClient({
    upscaler,
    ffmpegPath: config.upscalerVideo.ffmpegPath,
    ffprobePath: config.upscalerVideo.ffprobePath,
    maxDurationSec: config.upscalerVideo.maxDurationSec,
  });
  return {
    id: 'upscaler-video',
    channelIds: config.upscalerVideo.channelIds,
    handler: createUpscalerVideoHandler(client),
  };
}
