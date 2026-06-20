import { describe, it, expect, vi, beforeEach } from 'vitest';

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

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeDeps(overrides: Partial<ImageHandlerDeps> = {}): ImageHandlerDeps {
  const imageClient = {
    generate: vi.fn().mockResolvedValue({ buffer: Buffer.from('fake-img') }),
  } as unknown as ImageClient;

  const sessionStore = {
    get: vi.fn().mockReturnValue(null),
    upsert: vi.fn(),
    delete: vi.fn(),
    getLastImageUrl: vi.fn().mockReturnValue(null),
  } as unknown as SessionStore;

  return {
    imageClient,
    sessionStore,
    imageModel: 'gpt-image-1',
    imageSize: '1024x1024',
    ...overrides,
  };
}

function makeMessage(content: string) {
  const sentMsg = {
    attachments: { first: () => ({ url: 'https://cdn.discordapp.com/image.png' }) },
  };
  const thinkingMsg = {
    edit: vi.fn().mockResolvedValue(sentMsg),
  };
  return {
    content,
    author: { id: 'user-123', bot: false },
    channelId: 'chan-456',
    reply: vi.fn().mockResolvedValue(thinkingMsg),
    _thinkingMsg: thinkingMsg,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('handleImageMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    const existingHistory = [
      { role: 'user' as const, prompt: 'old prompt' },
      { role: 'bot' as const, prompt: 'old prompt', imageUrl: 'https://old.url/img.png' },
    ];
    const sessionStore = {
      get: vi.fn().mockReturnValue({ userId: 'user-123', channelId: 'chan-456', history: existingHistory, updatedAt: Date.now() }),
      upsert: vi.fn(),
      delete: vi.fn(),
      getLastImageUrl: vi.fn().mockReturnValue(null),
    } as unknown as SessionStore;

    const deps = makeDeps({ sessionStore });
    const message = makeMessage('new prompt');

    await handleImageMessage(message as any, deps);

    const [, , savedHistory] = (sessionStore.upsert as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(savedHistory).toHaveLength(4);
    expect(savedHistory[0]).toEqual({ role: 'user', prompt: 'old prompt' });
    expect(savedHistory[2]).toEqual({ role: 'user', prompt: 'new prompt' });
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
});
