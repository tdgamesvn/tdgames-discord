import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import type { CompressorClient } from '../src/features/compressor/client';
import type { FeatureContext } from '../src/core/types';

vi.mock('fs');

const FAKE_DOWNLOAD = Buffer.from('downloaded-file-data');

/** Build a fake Discord Message with either an image, a video, or no media attachment. */
function makeMessage(kind: 'image' | 'video' | 'none') {
  const attachment =
    kind === 'image'
      ? { contentType: 'image/png', url: 'https://cdn.discordapp.com/a/1/photo.png', name: 'photo.png' }
      : kind === 'video'
        ? { contentType: 'video/mp4', url: 'https://cdn.discordapp.com/a/1/clip.mp4', name: 'clip.mp4' }
        : null;

  const thinkingMsg = { edit: vi.fn().mockResolvedValue({}) };

  const message = {
    attachments: { values: () => (attachment ? [attachment] : []) },
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

describe('createCompressorHandler', () => {
  beforeEach(() => {
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.unlinkSync).mockImplementation(() => {});
    vi.mocked(fs.statSync).mockReturnValue({ size: 1000 } as fs.Stats);
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => FAKE_DOWNLOAD.buffer,
    }));
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('does nothing when message has no image or video attachment', async () => {
    const { createCompressorHandler } = await import('../src/features/compressor/handler');
    const client = { compressImage: vi.fn(), compressVideo: vi.fn() } as unknown as CompressorClient;
    const handler = createCompressorHandler(client);
    const message = makeMessage('none');

    await handler(message as never, makeCtx());

    expect(message.reply).not.toHaveBeenCalled();
    expect(client.compressImage).not.toHaveBeenCalled();
    expect(client.compressVideo).not.toHaveBeenCalled();
  });

  it('routes image attachments to compressImage', async () => {
    const { createCompressorHandler } = await import('../src/features/compressor/handler');
    const client = {
      compressImage: vi.fn().mockResolvedValue(undefined),
      compressVideo: vi.fn(),
    } as unknown as CompressorClient;
    const handler = createCompressorHandler(client);
    const message = makeMessage('image');

    await handler(message as never, makeCtx());

    expect(client.compressImage).toHaveBeenCalledTimes(1);
    expect(client.compressVideo).not.toHaveBeenCalled();
    expect(message.reply).toHaveBeenCalledWith(expect.stringContaining('Đang nén ảnh'));
  });

  it('routes video attachments to compressVideo', async () => {
    const { createCompressorHandler } = await import('../src/features/compressor/handler');
    const client = {
      compressImage: vi.fn(),
      compressVideo: vi.fn().mockResolvedValue(undefined),
    } as unknown as CompressorClient;
    const handler = createCompressorHandler(client);
    const message = makeMessage('video');

    await handler(message as never, makeCtx());

    expect(client.compressVideo).toHaveBeenCalledTimes(1);
    expect(client.compressImage).not.toHaveBeenCalled();
    expect(message.reply).toHaveBeenCalledWith(expect.stringContaining('Đang nén video'));
  });

  it('edits reply with ✅, size reduction and attachment on success', async () => {
    const { createCompressorHandler } = await import('../src/features/compressor/handler');
    vi.mocked(fs.statSync)
      .mockReturnValueOnce({ size: 2_000_000 } as fs.Stats) // input
      .mockReturnValueOnce({ size: 500_000 } as fs.Stats); // output
    const client = {
      compressImage: vi.fn().mockResolvedValue(undefined),
      compressVideo: vi.fn(),
    } as unknown as CompressorClient;
    const handler = createCompressorHandler(client);
    const message = makeMessage('image');

    await handler(message as never, makeCtx());

    expect(message._thinking.edit).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('✅'),
        files: expect.any(Array),
      }),
    );
    const callArg = message._thinking.edit.mock.calls[0][0];
    expect(callArg.content).toMatch(/75%/);
  });

  it('edits reply with ❌ and reports error when compression fails', async () => {
    const { createCompressorHandler } = await import('../src/features/compressor/handler');
    const err = new Error('ffmpeg crashed');
    const client = {
      compressImage: vi.fn().mockRejectedValue(err),
      compressVideo: vi.fn(),
    } as unknown as CompressorClient;
    const handler = createCompressorHandler(client);
    const message = makeMessage('image');
    const ctx = makeCtx();

    await handler(message as never, ctx);

    expect(message._thinking.edit).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('❌') }),
    );
    expect(ctx.errorReporter.report).toHaveBeenCalledWith(
      err,
      expect.objectContaining({ source: 'compressorHandler' }),
    );
  });

  it('cleans up both temp files in finally — even on failure', async () => {
    const { createCompressorHandler } = await import('../src/features/compressor/handler');
    const client = {
      compressImage: vi.fn().mockRejectedValue(new Error('crash')),
      compressVideo: vi.fn(),
    } as unknown as CompressorClient;
    const handler = createCompressorHandler(client);
    const message = makeMessage('image');

    await handler(message as never, makeCtx());

    expect(fs.unlinkSync).toHaveBeenCalledTimes(2);
  });
});
