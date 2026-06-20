import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('loadConfig', () => {
  beforeEach(() => {
    // Reset modules between tests to re-evaluate config
    vi.resetModules();
    process.env.DISCORD_TOKEN = 'test-token';
    process.env.DISCORD_CLIENT_ID = '111';
    process.env.ALLOWED_CHANNEL_IDS = '123,456';
    process.env.CLIPROXY_API_URL = 'http://localhost:8317';
    process.env.CLIPROXY_API_KEY = 'test-key';
    process.env.IMAGE_MODEL = 'gpt-image-1';
    process.env.IMAGE_SIZE = '1024x1024';
    process.env.SESSION_HISTORY_LIMIT = '10';
    process.env.SESSION_EXPIRE_MINUTES = '30';
    process.env.CHANNEL_QUEUE_MAX_PENDING = '5';
  });

  it('parses ALLOWED_CHANNEL_IDS into a Set', async () => {
    const { loadConfig } = await import('../src/config');
    const cfg = loadConfig();
    expect(cfg.discord.allowedChannelIds).toBeInstanceOf(Set);
    expect(cfg.discord.allowedChannelIds.has('123')).toBe(true);
    expect(cfg.discord.allowedChannelIds.has('456')).toBe(true);
  });

  it('parses numeric env vars as numbers', async () => {
    const { loadConfig } = await import('../src/config');
    const cfg = loadConfig();
    expect(cfg.session.historyLimit).toBe(10);
    expect(cfg.session.expireMinutes).toBe(30);
    expect(cfg.queue.maxPending).toBe(5);
  });

  it('throws if DISCORD_TOKEN is missing', async () => {
    delete process.env.DISCORD_TOKEN;
    const { loadConfig } = await import('../src/config');
    expect(() => loadConfig()).toThrow('DISCORD_TOKEN');
  });

  it('throws if ALLOWED_CHANNEL_IDS is missing', async () => {
    delete process.env.ALLOWED_CHANNEL_IDS;
    const { loadConfig } = await import('../src/config');
    expect(() => loadConfig()).toThrow('ALLOWED_CHANNEL_IDS');
  });
});
