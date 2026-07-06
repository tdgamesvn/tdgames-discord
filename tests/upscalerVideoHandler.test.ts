import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import type { VideoUpscalerClient } from '../src/features/upscaler-video/client';
import type { FeatureContext } from '../src/core/types';

vi.mock('fs');

const FAKE_DOWNLOAD = Buffer.from('downloaded-video-data');

function makeMessage(hasVideo = true) {
  const attachment = hasVideo
    ? {
        contentType: 'video/mp4',
        url: 'https://cdn.discordapp.com/attachments/1/2/clip.mp4',
        name: 'clip.mp4',
      }
    : null;

  const thinkingMsg = { edit: vi.fn().mockResolvedValue({}) };

  const message = {
    attachments: { values: () => (hasVideo ? [attachment] : []) },
    author: { id: 'user-123' },
    channelId: 'chan-456',
    reply: vi.fn().mockResolvedValue(thinkingMsg),
    _thinking: thinkingMsg,
  };
  return message;
}

function makeCtx(): FeatureContext {
  return {
    db: {} as never,
    config: {} as never,
    errorReporter: { report: vi.fn().mockResolvedValue(undefined) } as never,
    statsStore: {} as never,
    sessionStore: {} as never,
    channelPromptStore: {} as never,
  };
}

describe('createUpscalerVideoHandler', () => {
  beforeEach(() => {
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.unlinkSync).mockImplementation(() => {});
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('does nothing when message has no video attachment', async () => {
    const { createUpscalerVideoHandler } = await import('../src/features/upscaler-video/handler');
    const client = { upscaleVideo: vi.fn() } as unknown as VideoUpscalerClient;
    const handler = createUpscalerVideoHandler(client);
    const message = makeMessage(false);

    await handler(message as never, makeCtx());

    expect(message.reply).not.toHaveBeenCalled();
    expect(client.upscaleVideo).not.toHaveBeenCalled();
  });

  it('sends ⏳ placeholder reply immediately', async () => {
    const { createUpscalerVideoHandler } = await import('../src/features/upscaler-video/handler');
    const client = { upscaleVideo: vi.fn().mockResolvedValue(undefined) } as unknown as VideoUpscalerClient;
    const handler = createUpscalerVideoHandler(client);
    const message = makeMessage(true);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => FAKE_DOWNLOAD.buffer,
    }));

    await handler(message as never, makeCtx());

    expect(message.reply).toHaveBeenCalledWith(
      expect.stringContaining('⏳ Đang upscale video'),
    );
  });

  it('edits reply with ✅ and attachment on success', async () => {
    const { createUpscalerVideoHandler } = await import('../src/features/upscaler-video/handler');
    const client = { upscaleVideo: vi.fn().mockResolvedValue(undefined) } as unknown as VideoUpscalerClient;
    const handler = createUpscalerVideoHandler(client);
    const message = makeMessage(true);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => FAKE_DOWNLOAD.buffer,
    }));

    await handler(message as never, makeCtx());

    expect(message._thinking.edit).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('✅'),
        files: expect.any(Array),
      }),
    );
  });

  it('edits reply with ❌ and reports error when upscale fails', async () => {
    const { createUpscalerVideoHandler } = await import('../src/features/upscaler-video/handler');
    const err = new Error('ffmpeg crashed');
    const client = { upscaleVideo: vi.fn().mockRejectedValue(err) } as unknown as VideoUpscalerClient;
    const handler = createUpscalerVideoHandler(client);
    const message = makeMessage(true);
    const ctx = makeCtx();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => FAKE_DOWNLOAD.buffer,
    }));

    await handler(message as never, ctx);

    expect(message._thinking.edit).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('❌') }),
    );
    expect(ctx.errorReporter.report).toHaveBeenCalledWith(
      err,
      expect.objectContaining({ source: 'upscalerVideoHandler' }),
    );
  });

  it('cleans up both temp files in finally — even on failure', async () => {
    const { createUpscalerVideoHandler } = await import('../src/features/upscaler-video/handler');
    const client = {
      upscaleVideo: vi.fn().mockRejectedValue(new Error('crash')),
    } as unknown as VideoUpscalerClient;
    const handler = createUpscalerVideoHandler(client);
    const message = makeMessage(true);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => FAKE_DOWNLOAD.buffer,
    }));

    await handler(message as never, makeCtx());

    expect(fs.unlinkSync).toHaveBeenCalledTimes(2);
  });
});
