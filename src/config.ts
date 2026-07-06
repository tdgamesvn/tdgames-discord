function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function requireEnvInt(name: string): number {
  const raw = requireEnv(name);
  const n = parseInt(raw, 10);
  if (isNaN(n)) throw new Error(`Env var ${name} must be an integer, got: ${raw}`);
  return n;
}

function parseChannelIds(envVar: string): Set<string> {
  const raw = process.env[envVar] ?? '';
  return new Set(raw.split(',').map((id) => id.trim()).filter(Boolean));
}

function parseBool(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

export interface Config {
  discord: {
    token: string;
    clientId: string;
    errorChannelId: string | null;
  };
  cliproxy: {
    apiUrl: string;
    apiKey: string;
    maxConcurrent: number;
  };
  openai: {
    apiKey: string | null;
    apiUrl: string;
  };
  session: {
    historyLimit: number;
    expireMinutes: number;
  };
  queue: {
    maxPending: number;
  };
  imageGen: {
    channelIds: Set<string>;
    model: string;
    size: string;
    /** Model override used when falling back to OpenAI directly (CLIProxy may use different model names). */
    fallbackModel: string;
  };
  textChat: {
    channelIds: Set<string>;
    model: string;
    fallbackModel: string;
  };
  upscaler: {
    channelIds: Set<string>;
    binPath: string;
    modelsPath: string;
    scale: number;
    model: string;
  };
  upscalerVideo: {
    channelIds: Set<string>;
    maxDurationSec: number;
    ffmpegPath: string;
    ffprobePath: string;
  };
  compressor: {
    channelIds: Set<string>;
    ffmpegPath: string;
    /** WebP lossy quality, 0-100 — higher keeps more detail at the cost of size. */
    imageQuality: number;
    /** libx264 CRF, 0-51 — lower means higher quality (and bigger file). */
    videoCrf: number;
    videoPreset: string;
  };
  chatStorage: {
    enabled: boolean;
    includeBotMessages: boolean;
  };
  communicationHub: {
    ingestEnabled: boolean;
    ingestUrl: string;
  };
}

export function loadConfig(): Config {
  // Load .env file if it exists (dev mode — skip in test environment)
  try {
    if (process.env.NODE_ENV === 'test') throw new Error('skip');
    const envContent = require('fs').readFileSync('.env', 'utf8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    // .env not found or test env — OK
  }

  return {
    discord: {
      token: requireEnv('DISCORD_TOKEN'),
      clientId: requireEnv('DISCORD_CLIENT_ID'),
      errorChannelId: process.env.ERROR_CHANNEL_ID?.trim() || null,
    },
    cliproxy: {
      apiUrl: requireEnv('CLIPROXY_API_URL'),
      apiKey: requireEnv('CLIPROXY_API_KEY'),
      maxConcurrent: parseInt(process.env.CLIPROXY_MAX_CONCURRENT ?? '1', 10) || 1,
    },
    openai: {
      apiKey: process.env.OPENAI_API_KEY ?? null,
      apiUrl: process.env.OPENAI_API_URL ?? 'https://api.openai.com',
    },
    session: {
      historyLimit: requireEnvInt('SESSION_HISTORY_LIMIT'),
      expireMinutes: requireEnvInt('SESSION_EXPIRE_MINUTES'),
    },
    queue: {
      maxPending: requireEnvInt('CHANNEL_QUEUE_MAX_PENDING'),
    },
    imageGen: {
      channelIds: parseChannelIds('IMAGE_CHANNEL_IDS'),
      model: process.env.IMAGE_MODEL ?? 'gpt-image-2',
      size: process.env.IMAGE_SIZE ?? 'auto',
      fallbackModel: process.env.IMAGE_FALLBACK_MODEL ?? 'gpt-image-2',
    },
    textChat: {
      channelIds: parseChannelIds('CHAT_CHANNEL_IDS'),
      model: process.env.CHAT_MODEL ?? 'gpt-4o-mini',
      fallbackModel: process.env.CHAT_FALLBACK_MODEL ?? 'gpt-4o-mini',
    },
    upscaler: {
      channelIds: parseChannelIds('UPSCALE_CHANNEL_IDS'),
      binPath: process.env.UPSCAYL_BIN_PATH
        ?? '/Applications/Upscayl.app/Contents/Resources/bin/upscayl-bin',
      modelsPath: process.env.UPSCAYL_MODELS_PATH
        ?? '/Applications/Upscayl.app/Contents/Resources/models',
      scale: parseInt(process.env.UPSCALE_SCALE ?? '4', 10) || 4,
      model: process.env.UPSCALE_MODEL ?? 'upscayl-standard-4x',
    },
    upscalerVideo: {
      channelIds: parseChannelIds('UPSCALER_VIDEO_CHANNEL_IDS'),
      maxDurationSec: parseInt(process.env.UPSCALE_VIDEO_MAX_DURATION_SEC ?? '20', 10) || 20,
      ffmpegPath: process.env.FFMPEG_PATH ?? 'ffmpeg',
      ffprobePath: process.env.FFPROBE_PATH ?? 'ffprobe',
    },
    compressor: {
      channelIds: parseChannelIds('COMPRESSOR_CHANNEL_IDS'),
      ffmpegPath: process.env.FFMPEG_PATH ?? 'ffmpeg',
      imageQuality: parseInt(process.env.COMPRESS_IMAGE_QUALITY ?? '85', 10) || 85,
      videoCrf: parseInt(process.env.COMPRESS_VIDEO_CRF ?? '23', 10) || 23,
      videoPreset: process.env.COMPRESS_VIDEO_PRESET ?? 'medium',
    },
    chatStorage: {
      enabled: parseBool('CHAT_STORAGE_ENABLED', false),
      includeBotMessages: parseBool('CHAT_STORAGE_INCLUDE_BOTS', false),
    },
    communicationHub: {
      ingestEnabled: parseBool('COMMUNICATION_HUB_INGEST_ENABLED', true),
      ingestUrl: process.env.COMMUNICATION_HUB_INGEST_URL
        ?? 'http://127.0.0.1:3460/api/ingest/discord/event',
    },
  };
}

// Singleton — loaded once on first import (or first getConfig() call)
let configInstance: Config | null = null;

export function getConfig(): Config {
  if (!configInstance) configInstance = loadConfig();
  return configInstance;
}

// Try to create singleton at import time; if it fails, it can be retried via getConfig()
let config: Config | undefined;
try {
  config = loadConfig();
} catch (e) {
  // Allow module to load even if config fails; getConfig() will retry
  console.warn('Failed to load config at import time:', e);
}

export { config };
