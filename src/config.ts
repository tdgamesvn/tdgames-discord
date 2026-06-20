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

export interface Config {
  discord: {
    token: string;
    clientId: string;
    allowedChannelIds: Set<string>;
  };
  cliproxy: {
    apiUrl: string;
    apiKey: string;
  };
  openai: {
    apiKey: string | null;
    apiUrl: string;
  };
  image: {
    model: string;
    size: string;
  };
  session: {
    historyLimit: number;
    expireMinutes: number;
  };
  queue: {
    maxPending: number;
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
    // .env not found — rely on actual env vars (production)
  }

  const rawChannels = requireEnv('ALLOWED_CHANNEL_IDS');
  const allowedChannelIds = new Set(
    rawChannels.split(',').map((id) => id.trim()).filter(Boolean)
  );

  return {
    discord: {
      token: requireEnv('DISCORD_TOKEN'),
      clientId: requireEnv('DISCORD_CLIENT_ID'),
      allowedChannelIds,
    },
    cliproxy: {
      apiUrl: requireEnv('CLIPROXY_API_URL'),
      apiKey: requireEnv('CLIPROXY_API_KEY'),
    },
    openai: {
      apiKey: process.env.OPENAI_API_KEY ?? null,
      apiUrl: process.env.OPENAI_API_URL ?? 'https://api.openai.com',
    },
    image: {
      model: process.env.IMAGE_MODEL ?? 'gpt-image-1',
      size: process.env.IMAGE_SIZE ?? '1024x1024',
    },
    session: {
      historyLimit: requireEnvInt('SESSION_HISTORY_LIMIT'),
      expireMinutes: requireEnvInt('SESSION_EXPIRE_MINUTES'),
    },
    queue: {
      maxPending: requireEnvInt('CHANNEL_QUEUE_MAX_PENDING'),
    },
  };
}

// Singleton — loaded once on first import (or first getConfig() call)
let configInstance: Config | null = null;

export function getConfig(): Config {
  if (!configInstance) {
    configInstance = loadConfig();
  }
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
