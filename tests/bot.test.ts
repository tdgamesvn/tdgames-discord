import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock discord.js before any import that pulls it in
vi.mock('discord.js', () => ({}));

// Mock imageHandler so tests don't need real API
vi.mock('../src/handlers/imageHandler', () => ({
  handleImageMessage: vi.fn().mockResolvedValue(undefined),
}));

import { createMessageHandler } from '../src/bot';
import { handleImageMessage } from '../src/handlers/imageHandler';
import type { BotDeps } from '../src/bot';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    author: { id: 'user-123', bot: false },
    channelId: 'chan-allowed',
    content: 'a sunset over mountains',
    reply: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
}

function makeDeps(overrides: Partial<BotDeps> = {}): BotDeps {
  return {
    allowedChannelIds: new Set(['chan-allowed']),
    queueManager: {
      enqueue: vi.fn().mockReturnValue(true),
      getPendingCount: vi.fn().mockReturnValue(0),
    } as unknown as BotDeps['queueManager'],
    sessionStore: {} as BotDeps['sessionStore'],
    imageClient: {} as BotDeps['imageClient'],
    imageModel: 'gpt-image-1',
    imageSize: '1024x1024',
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('createMessageHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ignores messages from bots', async () => {
    const deps = makeDeps();
    const handler = createMessageHandler(deps);
    const message = makeMessage({ author: { id: 'bot-456', bot: true } });

    await handler(message as any);

    expect(deps.queueManager.enqueue).not.toHaveBeenCalled();
    expect(message.reply).not.toHaveBeenCalled();
  });

  it('ignores messages from channels not in allowedChannelIds', async () => {
    const deps = makeDeps();
    const handler = createMessageHandler(deps);
    const message = makeMessage({ channelId: 'chan-blocked' });

    await handler(message as any);

    expect(deps.queueManager.enqueue).not.toHaveBeenCalled();
    expect(message.reply).not.toHaveBeenCalled();
  });

  it('enqueues task for valid message in allowed channel', async () => {
    const deps = makeDeps();
    const handler = createMessageHandler(deps);
    const message = makeMessage();

    await handler(message as any);

    expect(deps.queueManager.enqueue).toHaveBeenCalledWith(
      'chan-allowed',
      expect.any(Function)
    );
  });

  it('does not reply when successfully enqueued', async () => {
    const deps = makeDeps();
    const handler = createMessageHandler(deps);
    const message = makeMessage();

    await handler(message as any);

    expect(message.reply).not.toHaveBeenCalled();
  });

  it('replies with busy notice when queue is full', async () => {
    const deps = makeDeps({
      queueManager: {
        enqueue: vi.fn().mockReturnValue(false),
        getPendingCount: vi.fn().mockReturnValue(0),
      } as unknown as BotDeps['queueManager'],
    });
    const handler = createMessageHandler(deps);
    const message = makeMessage();

    await handler(message as any);

    expect(message.reply).toHaveBeenCalledWith(
      expect.stringMatching(/busy/i)
    );
  });

  it('calls handleImageMessage when enqueued task executes', async () => {
    let capturedTask: (() => Promise<void>) | undefined;
    const deps = makeDeps({
      queueManager: {
        enqueue: vi.fn().mockImplementation((_channelId: string, task: () => Promise<void>) => {
          capturedTask = task;
          return true;
        }),
        getPendingCount: vi.fn().mockReturnValue(0),
      } as unknown as BotDeps['queueManager'],
    });
    const handler = createMessageHandler(deps);
    const message = makeMessage();

    await handler(message as any);

    expect(capturedTask).toBeDefined();
    await capturedTask!();

    expect(handleImageMessage).toHaveBeenCalledWith(
      message,
      expect.objectContaining({
        imageModel: 'gpt-image-1',
        imageSize: '1024x1024',
      })
    );
  });
});
