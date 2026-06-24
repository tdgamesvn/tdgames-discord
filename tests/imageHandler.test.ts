import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('discord.js', () => ({
  AttachmentBuilder: vi.fn().mockImplementation((buffer: Buffer, opts: object) => ({
    _buffer: buffer,
    _opts: opts,
  })),
}));

import { createImageGenHandler } from '../src/features/image-gen/handler';
import type { ImageClient } from '../src/features/image-gen/client';
import type { FeatureContext } from '../src/core/types';

// ─── Helpers ────────────────────────────────────────────────────────────────

function stubFetchImage() {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: async () => Buffer.from('fake-downloaded-img').buffer,
  }));
}

function makeClient(): ImageClient {
  return {
    generate: vi.fn().mockResolvedValue({ buffer: Buffer.from('fake-img'), usedFallback: false }),
    edit: vi.fn().mockResolvedValue({ buffer: Buffer.from('fake-edited-img'), usedFallback: false }),
  } as unknown as ImageClient;
}

function makeCtx(overrides: Partial<FeatureContext> = {}): FeatureContext {
  return {
    db: {} as any,
    config: {
      imageGen: { model: 'gpt-image-1', size: '1024x1024', channelIds: new Set(['chan-456']) },
      textChat: { model: 'gpt-4o-mini', fallbackModel: 'gpt-4o-mini', channelIds: new Set() },
      discord: { token: '', clientId: '', errorChannelId: null },
      cliproxy: { apiUrl: '', apiKey: '', maxConcurrent: 1 },
      openai: { apiKey: null, apiUrl: '' },
      session: { historyLimit: 10, expireMinutes: 30 },
      queue: { maxPending: 5 },
    } as any,
    sessionStore: {
      get: vi.fn().mockReturnValue(null),
      upsert: vi.fn(),
      delete: vi.fn(),
    } as any,
    channelPromptStore: {
      get: vi.fn().mockReturnValue(null),
    } as any,
    errorReporter: { report: vi.fn().mockResolvedValue(undefined) } as any,
    statsStore: { increment: vi.fn() } as any,
    ...overrides,
  };
}

type FakeAttachment = { url: string; name: string; contentType: string };

function makeMessage(content: string, attachments: FakeAttachment[] = []) {
  const sentMsg = {
    attachments: { first: () => ({ url: 'https://cdn.discordapp.com/image.png' }) },
  };
  const thinkingMsg = { edit: vi.fn().mockResolvedValue(sentMsg) };
  return {
    content,
    author: { id: 'user-123', bot: false },
    channelId: 'chan-456',
    attachments: { values: () => attachments[Symbol.iterator]() },
    reply: vi.fn().mockResolvedValue(thinkingMsg),
    _thinkingMsg: thinkingMsg,
  };
}

const IMG = (n = 1): FakeAttachment => ({
  url: `https://cdn.discordapp.com/uploaded${n}.png`,
  name: `uploaded${n}.png`,
  contentType: 'image/png',
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('createImageGenHandler', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('calls imageClient.generate with the message content as prompt', async () => {
    const client = makeClient();
    const handler = createImageGenHandler(client);
    const ctx = makeCtx();
    const message = makeMessage('a futuristic city at night');

    await handler(message as any, ctx);

    expect(client.generate).toHaveBeenCalledWith({
      prompt: 'a futuristic city at night',
      model: 'gpt-image-1',
      size: '1024x1024',
    });
  });

  it('replies with a thinking message then edits it with the generated image', async () => {
    const client = makeClient();
    const handler = createImageGenHandler(client);
    const ctx = makeCtx();
    const message = makeMessage('a dragon');

    await handler(message as any, ctx);

    expect(message.reply).toHaveBeenCalledWith(expect.stringContaining('Generating'));
    expect(message._thinkingMsg.edit).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Done') })
    );
  });

  it('resets session on !reset command', async () => {
    const client = makeClient();
    const handler = createImageGenHandler(client);
    const ctx = makeCtx();
    const message = makeMessage('!reset');

    await handler(message as any, ctx);

    expect(ctx.sessionStore.delete).toHaveBeenCalledWith('user-123', 'chan-456');
    expect(message.reply).toHaveBeenCalledWith(expect.stringContaining('reset'));
  });

  it('calls imageClient.edit when image attachment present', async () => {
    stubFetchImage();
    const client = makeClient();
    const handler = createImageGenHandler(client);
    const ctx = makeCtx();
    const message = makeMessage('add fire', [IMG(1)]);

    await handler(message as any, ctx);

    expect(client.edit).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'add fire', model: 'gpt-image-1' })
    );
  });
});
