import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock AttachmentBuilder from discord.js before importing handler
vi.mock('discord.js', () => ({
  AttachmentBuilder: vi.fn().mockImplementation((buffer: Buffer, opts: object) => ({
    _buffer: buffer,
    _opts: opts,
  })),
}));

import { handleImageMessage } from '../src/handlers/imageHandler';
import type { ImageHandlerDeps } from '../src/handlers/imageHandler';
import type { SessionStore } from '../src/services/sessionStore';
import type { ImageClient } from '../src/services/imageClient';
import type { ChannelPromptStore } from '../src/services/channelPromptStore';

// ─── Helpers ────────────────────────────────────────────────────────────────

// Stub fetch to return a fake image buffer (used when handler downloads an image)
function stubFetchImage() {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: async () => Buffer.from('fake-downloaded-img').buffer,
  }));
}

function makeDeps(overrides: Partial<ImageHandlerDeps> = {}): ImageHandlerDeps {
  const imageClient = {
    generate: vi.fn().mockResolvedValue({ buffer: Buffer.from('fake-img') }),
    edit: vi.fn().mockResolvedValue({ buffer: Buffer.from('fake-edited-img') }),
  } as unknown as ImageClient;

  const sessionStore = {
    get: vi.fn().mockReturnValue(null),
    upsert: vi.fn(),
    delete: vi.fn(),
    getLastImageUrl: vi.fn().mockReturnValue(null),
  } as unknown as SessionStore;

  const channelPromptStore = {
    get: vi.fn().mockReturnValue(null),
    set: vi.fn(),
    delete: vi.fn(),
    list: vi.fn().mockReturnValue([]),
  } as unknown as ChannelPromptStore;

  return {
    imageClient,
    sessionStore,
    channelPromptStore,
    imageModel: 'gpt-image-1',
    imageSize: '1024x1024',
    ...overrides,
  };
}

type FakeAttachment = { url: string; name: string; contentType: string };

function makeMessage(content: string, attachments: FakeAttachment[] = []) {
  const sentMsg = {
    // attachments on the bot's reply (for CDN URL extraction)
    attachments: { first: () => ({ url: 'https://cdn.discordapp.com/image.png' }) },
  };
  const thinkingMsg = {
    edit: vi.fn().mockResolvedValue(sentMsg),
  };
  return {
    content,
    author: { id: 'user-123', bot: false },
    channelId: 'chan-456',
    // Simulate Discord Collection.values() — handler spreads this then filters
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

describe('handleImageMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls imageClient.generate with the message content as prompt', async () => {
    const deps = makeDeps();
    const message = makeMessage('a futuristic city at night');

    await handleImageMessage(message as any, deps);

    expect(deps.imageClient.generate).toHaveBeenCalledWith({
      prompt: 'a futuristic city at night',
      model: 'gpt-image-1',
      size: '1024x1024',
    });
  });

  it('replies with a thinking message then edits it with the generated image', async () => {
    const deps = makeDeps();
    const message = makeMessage('a dragon');

    await handleImageMessage(message as any, deps);

    expect(message.reply).toHaveBeenCalledWith(expect.stringContaining('Generating'));
    expect(message._thinkingMsg.edit).toHaveBeenCalledWith(
      expect.objectContaining({ files: expect.any(Array) })
    );
  });

  it('saves user prompt and bot image url to session history', async () => {
    const deps = makeDeps();
    const message = makeMessage('a cat');

    await handleImageMessage(message as any, deps);

    expect(deps.sessionStore.upsert).toHaveBeenCalledWith(
      'user-123',
      'chan-456',
      expect.arrayContaining([
        { role: 'user', prompt: 'a cat' },
        { role: 'bot', prompt: 'a cat', imageUrl: 'https://cdn.discordapp.com/image.png' },
      ])
    );
  });

  it('appends to existing session history instead of overwriting', async () => {
    // Session has a previous bot image → handler will use edit mode → needs fetch for download
    stubFetchImage();

    const existingHistory = [
      { role: 'user' as const, prompt: 'old prompt' },
      { role: 'bot' as const, prompt: 'old prompt', imageUrl: 'https://old.url/img.png' },
    ];
    const sessionStore = {
      get: vi.fn().mockReturnValue({ userId: 'user-123', channelId: 'chan-456', history: existingHistory, updatedAt: Date.now() }),
      upsert: vi.fn(),
      delete: vi.fn(),
    } as unknown as SessionStore;

    const deps = makeDeps({ sessionStore });
    const message = makeMessage('new prompt');

    await handleImageMessage(message as any, deps);

    const [, , savedHistory] = (sessionStore.upsert as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(savedHistory).toHaveLength(4);
    expect(savedHistory[0]).toEqual({ role: 'user', prompt: 'old prompt' });
    expect(savedHistory[2]).toEqual({ role: 'user', prompt: 'new prompt' });
  });

  it('calls imageClient.edit when message has a single image attachment', async () => {
    stubFetchImage();
    const deps = makeDeps();
    const message = makeMessage('change pose', [IMG()]);

    await handleImageMessage(message as any, deps);

    expect(deps.imageClient.edit).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'change pose',
        images: [expect.objectContaining({ name: 'uploaded1.png' })],
      })
    );
    expect(deps.imageClient.generate).not.toHaveBeenCalled();
  });

  it('passes ALL images when user uploads multiple attachments', async () => {
    stubFetchImage();
    const deps = makeDeps();
    const message = makeMessage('blend these two', [IMG(1), IMG(2)]);

    await handleImageMessage(message as any, deps);

    expect(deps.imageClient.edit).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'blend these two',
        images: expect.arrayContaining([
          expect.objectContaining({ name: 'uploaded1.png' }),
          expect.objectContaining({ name: 'uploaded2.png' }),
        ]),
      })
    );
    const call = (deps.imageClient.edit as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.images).toHaveLength(2);
  });

  it('shows multi-image label when 2+ attachments', async () => {
    stubFetchImage();
    const deps = makeDeps();
    const message = makeMessage('style transfer', [IMG(1), IMG(2), IMG(3)]);

    await handleImageMessage(message as any, deps);

    expect(message.reply).toHaveBeenCalledWith(expect.stringContaining('3 images'));
  });

  it('edits the thinking message with an error notice when generate fails', async () => {
    const imageClient = {
      generate: vi.fn().mockRejectedValue(new Error('API down')),
    } as unknown as ImageClient;
    const deps = makeDeps({ imageClient });
    const message = makeMessage('a robot');

    await handleImageMessage(message as any, deps);

    expect(message._thinkingMsg.edit).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('❌') })
    );
    expect(deps.sessionStore.upsert).not.toHaveBeenCalled();
  });

  it('deletes session and confirms on !reset command', async () => {
    const deps = makeDeps();
    const message = makeMessage('!reset');

    await handleImageMessage(message as any, deps);

    expect(deps.sessionStore.delete).toHaveBeenCalledWith('user-123', 'chan-456');
    expect(message.reply).toHaveBeenCalledWith(expect.stringContaining('reset'));
    expect(deps.imageClient.generate).not.toHaveBeenCalled();
  });

  it('ignores case for !reset command', async () => {
    const deps = makeDeps();
    const message = makeMessage('  !RESET  ');

    await handleImageMessage(message as any, deps);

    expect(deps.sessionStore.delete).toHaveBeenCalledWith('user-123', 'chan-456');
    expect(deps.imageClient.generate).not.toHaveBeenCalled();
  });

  it('prepends system prompt to generate call when channelPromptStore returns a prompt', async () => {
    const channelPromptStore = {
      get: vi.fn().mockReturnValue('photorealistic style'),
      set: vi.fn(),
      delete: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    } as unknown as ChannelPromptStore;

    const deps = makeDeps({ channelPromptStore });
    const message = makeMessage('a mountain lake');

    await handleImageMessage(message as any, deps);

    expect(deps.imageClient.generate).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'photorealistic style. a mountain lake' })
    );
  });
});
