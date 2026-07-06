import type Database from 'better-sqlite3';
import type { Config } from '../../config';
import type { Feature } from '../../core/types';
import { UpscalerClient } from './client';
import { VideoUpscalerClient } from '../upscaler-video/client';
import { createUpscalerHandler } from './handler';

export function createUpscalerFeature(config: Config, _db: Database.Database): Feature {
  const imageClient = new UpscalerClient({
    binPath: config.upscaler.binPath,
    modelsPath: config.upscaler.modelsPath,
    model: config.upscaler.model,
    scale: config.upscaler.scale,
    format: 'png',
  });
  // Video upscale reuses the same Real-ESRGAN client for its per-frame pass.
  const videoClient = new VideoUpscalerClient({
    upscaler: imageClient,
    ffmpegPath: config.upscalerVideo.ffmpegPath,
    ffprobePath: config.upscalerVideo.ffprobePath,
    maxDurationSec: config.upscalerVideo.maxDurationSec,
  });
  return {
    id: 'upscaler',
    // Single shared channel set — handler auto-detects image vs video per message.
    channelIds: config.upscaler.channelIds,
    handler: createUpscalerHandler(imageClient, videoClient),
  };
}
