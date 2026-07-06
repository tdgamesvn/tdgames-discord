import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('loadConfig', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NODE_ENV = 'test';
    process.env.DISCORD_TOKEN = 'test-token';
    process.env.DISCORD_CLIENT_ID = '111';
    process.env.CLIPROXY_API_URL = 'http://localhost:8317';
    process.env.CLIPROXY_API_KEY = 'test-key';
    process.env.IMAGE_CHANNEL_IDS = '123,456';
    process.env.IMAGE_MODEL = 'gpt-image-1';
    process.env.IMAGE_SIZE = '1024x1024';
    process.env.CHAT_CHANNEL_IDS = '789';
    process.env.SESSION_HISTORY_LIMIT = '10';
    process.env.SESSION_EXPIRE_MINUTES = '30';
    process.env.CHANNEL_QUEUE_MAX_PENDING = '5';
  });

  it('parses IMAGE_CHANNEL_IDS into imageGen.channelIds Set', async () => {
    const { loadConfig } = await import('../src/config');
    const cfg = loadConfig();
    expect(cfg.imageGen.channelIds).toBeInstanceOf(Set);
    expect(cfg.imageGen.channelIds.has('123')).toBe(true);
    expect(cfg.imageGen.channelIds.has('456')).toBe(true);
  });

  it('parses CHAT_CHANNEL_IDS into textChat.channelIds Set', async () => {
    const { loadConfig } = await import('../src/config');
    const cfg = loadConfig();
    expect(cfg.textChat.channelIds).toBeInstanceOf(Set);
    expect(cfg.textChat.channelIds.has('789')).toBe(true);
  });

  it('parses numeric env vars as numbers', async () => {
    const { loadConfig } = await import('../src/config');
    const cfg = loadConfig();
    expect(cfg.session.historyLimit).toBe(10);
    expect(cfg.session.expireMinutes).toBe(30);
    expect(cfg.queue.maxPending).toBe(5);
  });

  it('parses chat storage boolean env vars', async () => {
    process.env.CHAT_STORAGE_ENABLED = 'true';
    process.env.CHAT_STORAGE_INCLUDE_BOTS = '1';
    const { loadConfig } = await import('../src/config');
    const cfg = loadConfig();
    expect(cfg.chatStorage.enabled).toBe(true);
    expect(cfg.chatStorage.includeBotMessages).toBe(true);
  });

  it('defaults chat storage to disabled and excludes bot messages', async () => {
    delete process.env.CHAT_STORAGE_ENABLED;
    delete process.env.CHAT_STORAGE_INCLUDE_BOTS;
    const { loadConfig } = await import('../src/config');
    const cfg = loadConfig();
    expect(cfg.chatStorage.enabled).toBe(false);
    expect(cfg.chatStorage.includeBotMessages).toBe(false);
  });

  it('throws if DISCORD_TOKEN is missing', async () => {
    delete process.env.DISCORD_TOKEN;
    const { loadConfig } = await import('../src/config');
    expect(() => loadConfig()).toThrow('DISCORD_TOKEN');
  });

  it('returns empty set when IMAGE_CHANNEL_IDS not set', async () => {
    delete process.env.IMAGE_CHANNEL_IDS;
    const { loadConfig } = await import('../src/config');
    const cfg = loadConfig();
    expect(cfg.imageGen.channelIds.size).toBe(0);
  });

  it('Config has no discord.allowedChannelIds (old field removed)', async () => {
    const { loadConfig } = await import('../src/config');
    const cfg = loadConfig();
    expect((cfg.discord as any).allowedChannelIds).toBeUndefined();
  });
});
