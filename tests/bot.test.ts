import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('discord.js', () => ({}));

import { createMessageHandler } from '../src/bot';
import type { FeatureRouter } from '../src/core/router';
import type { QueueManager } from '../src/core/queue';
import type { FeatureContext } from '../src/core/types';
import type { Feature } from '../src/core/types';

// ─── Helpers ────────────────────────────────────────────────────────────────

let _msgCounter = 0;

function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: `msg-${++_msgCounter}`,
    author: { id: 'user-123', bot: false },
    channelId: 'chan-image',
    content: 'a sunset',
    reply: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
}

function makeFeature(channelIds: string[]): Feature {
  return {
    id: 'test-feature',
    channelIds: new Set(channelIds),
    handler: vi.fn().mockResolvedValue(undefined),
  };
}

function makeRouter(feature?: Feature): FeatureRouter {
  return {
    resolve: vi.fn().mockReturnValue(feature),
    register: vi.fn(),
    registeredChannelIds: new Set(feature ? [...feature.channelIds] : []),
  } as unknown as FeatureRouter;
}

function makeQueueManager(enqueues = true): QueueManager {
  return {
    enqueue: vi.fn().mockReturnValue(enqueues),
    getPendingCount: vi.fn().mockReturnValue(0),
  } as unknown as QueueManager;
}

function makeCtx(): FeatureContext {
  // bot.ts calls ctx.db.prepare() at construction time for cross-process dedup.
  // Mock a minimal better-sqlite3 Statement: run() returns { changes: 1 } = "claimed OK".
  const mockStatement = { run: vi.fn().mockReturnValue({ changes: 1 }) };
  return {
    db: { prepare: vi.fn().mockReturnValue(mockStatement) },
  } as unknown as FeatureContext;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('createMessageHandler', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('ignores messages from bots', async () => {
    const qm = makeQueueManager();
    const router = makeRouter();
    const handler = createMessageHandler(router, qm, makeCtx());
    await handler(makeMessage({ author: { id: 'bot-1', bot: true } }) as any);
    expect(qm.enqueue).not.toHaveBeenCalled();
  });

  it('ignores messages in unregistered channels (router returns undefined)', async () => {
    const qm = makeQueueManager();
    const router = makeRouter(undefined); // resolve returns undefined
    const handler = createMessageHandler(router, qm, makeCtx());
    await handler(makeMessage({ channelId: 'chan-unknown' }) as any);
    expect(qm.enqueue).not.toHaveBeenCalled();
  });

  it('enqueues task for valid message in registered channel', async () => {
    const feature = makeFeature(['chan-image']);
    const qm = makeQueueManager();
    const router = makeRouter(feature);
    const handler = createMessageHandler(router, qm, makeCtx());
    await handler(makeMessage({ channelId: 'chan-image' }) as any);
    expect(qm.enqueue).toHaveBeenCalledWith('chan-image', expect.any(Function));
  });

  it('does not reply when successfully enqueued', async () => {
    const feature = makeFeature(['chan-image']);
    const qm = makeQueueManager(true);
    const router = makeRouter(feature);
    const handler = createMessageHandler(router, qm, makeCtx());
    const message = makeMessage({ channelId: 'chan-image' });
    await handler(message as any);
    expect(message.reply).not.toHaveBeenCalled();
  });

  it('replies with busy notice when queue is full', async () => {
    const feature = makeFeature(['chan-image']);
    const qm = makeQueueManager(false);
    const router = makeRouter(feature);
    const handler = createMessageHandler(router, qm, makeCtx());
    const message = makeMessage({ channelId: 'chan-image' });
    await handler(message as any);
    expect(message.reply).toHaveBeenCalledWith(expect.stringMatching(/bận|busy/i));
  });

  it('calls feature.handler with (message, ctx) when enqueued task executes', async () => {
    const feature = makeFeature(['chan-image']);
    let capturedTask: (() => Promise<void>) | undefined;
    const qm = {
      enqueue: vi.fn().mockImplementation((_ch: string, task: () => Promise<void>) => {
        capturedTask = task;
        return true;
      }),
    } as unknown as QueueManager;
    const ctx = makeCtx();
    const router = makeRouter(feature);
    const handler = createMessageHandler(router, qm, ctx);
    const message = makeMessage({ channelId: 'chan-image' });

    await handler(message as any);
    expect(capturedTask).toBeDefined();
    await capturedTask!();

    expect(feature.handler).toHaveBeenCalledWith(message, ctx);
  });

  it('skips duplicate message IDs', async () => {
    const feature = makeFeature(['chan-image']);
    const qm = makeQueueManager();
    const router = makeRouter(feature);
    const handler = createMessageHandler(router, qm, makeCtx());
    const message = makeMessage({ channelId: 'chan-image', id: 'same-id-99' });

    await handler(message as any);
    await handler(message as any); // duplicate

    expect(qm.enqueue).toHaveBeenCalledTimes(1);
  });
});
