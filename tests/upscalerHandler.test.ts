import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import type { UpscalerClient } from '../src/features/upscaler/client';
import type { FeatureContext } from '../src/core/types';

vi.mock('fs');

const FAKE_DOWNLOAD = Buffer.from('downloaded-image-data');
const FAKE_UPSCALED = Buffer.from('upscaled-image-data');

/** Build a fake Discord Message. Returns the message + the thinking reply stub. */
function makeMessage(hasImage = true) {
  const attachment = hasImage
    ? {
        contentType: 'image/png',
        url: 'https://cdn.discordapp.com/attachments/1/2/photo.png',
        name: 'photo.png',
      }
    : null;

  const thinkingMsg = { edit: vi.fn().mockResolvedValue({}) };

  const message = {
    attachments: { values: () => (hasImage ? [attachment] : []) },
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
    config: {
      upscaler: {
        scale: 4,
        model: 'upscayl-standard-4x',
        channelIds: new Set(['chan-456']),
        binPath: '/Applications/Upscayl.app/Contents/Resources/bin/upscayl-bin',
        modelsPath: '/Applications/Upscayl.app/Contents/Resources/models',
      },
    } as never,
    errorReporter: { report: vi.fn().mockResolvedValue(undefined) } as never,
    statsStore: {} as never,
    sessionStore: {} as never,
    channelPromptStore: {} as never,
  };
}

describe('createUpscalerHandler', () => {
  beforeEach(() => {
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.readFileSync).mockReturnValue(FAKE_UPSCALED);
    vi.mocked(fs.unlinkSync).mockImplementation(() => {});
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('does nothing when message has no image attachment', async () => {
    const { createUpscalerHandler } = await import('../src/features/upscaler/handler');
    const client = { upscale: vi.fn() } as unknown as UpscalerClient;
    const handler = createUpscalerHandler(client);
    const message = makeMessage(false);

    await handler(message as never, makeCtx());

    expect(message.reply).not.toHaveBeenCalled();
    expect(client.upscale).not.toHaveBeenCalled();
  });

  it('sends ⏳ placeholder reply immediately', async () => {
    const { createUpscalerHandler } = await import('../src/features/upscaler/handler');
    const client = { upscale: vi.fn().mockResolvedValue(undefined) } as unknown as UpscalerClient;
    const handler = createUpscalerHandler(client);
    const message = makeMessage(true);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => FAKE_DOWNLOAD.buffer,
    }));

    await handler(message as never, makeCtx());

    expect(message.reply).toHaveBeenCalledWith('⏳ Đang upscale ảnh...');
  });

  it('edits reply with ✅ and attachment on success', async () => {
    const { createUpscalerHandler } = await import('../src/features/upscaler/handler');
    const client = { upscale: vi.fn().mockResolvedValue(undefined) } as unknown as UpscalerClient;
    const handler = createUpscalerHandler(client);
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
    // The content should mention scale and model
    const callArg = message._thinking.edit.mock.calls[0][0];
    expect(callArg.content).toContain('4x');
    expect(callArg.content).toContain('upscayl-standard-4x');
  });

  it('edits reply with ❌ when upscale fails', async () => {
    const { createUpscalerHandler } = await import('../src/features/upscaler/handler');
    const client = {
      upscale: vi.fn().mockRejectedValue(new Error('upscayl-bin exited with code 1')),
    } as unknown as UpscalerClient;
    const handler = createUpscalerHandler(client);
    const message = makeMessage(true);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => FAKE_DOWNLOAD.buffer,
    }));

    await handler(message as never, makeCtx());

    expect(message._thinking.edit).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('❌') }),
    );
  });

  it('reports error to errorReporter on failure', async () => {
    const { createUpscalerHandler } = await import('../src/features/upscaler/handler');
    const err = new Error('binary crashed');
    const client = { upscale: vi.fn().mockRejectedValue(err) } as unknown as UpscalerClient;
    const handler = createUpscalerHandler(client);
    const message = makeMessage(true);
    const ctx = makeCtx();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => FAKE_DOWNLOAD.buffer,
    }));

    await handler(message as never, ctx);

    expect(ctx.errorReporter.report).toHaveBeenCalledWith(
      err,
      expect.objectContaining({ source: 'upscalerHandler' }),
    );
  });

  it('cleans up both temp files in finally — even on failure', async () => {
    const { createUpscalerHandler } = await import('../src/features/upscaler/handler');
    const client = {
      upscale: vi.fn().mockRejectedValue(new Error('crash')),
    } as unknown as UpscalerClient;
    const handler = createUpscalerHandler(client);
    const message = makeMessage(true);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => FAKE_DOWNLOAD.buffer,
    }));

    await handler(message as never, makeCtx());

    // unlinkSync called for input AND output paths
    expect(fs.unlinkSync).toHaveBeenCalledTimes(2);
  });
});
