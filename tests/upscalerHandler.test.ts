import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import type { UpscalerClient } from '../src/features/upscaler/client';
import type { VideoUpscalerClient } from '../src/features/upscaler-video/client';
import type { FeatureContext } from '../src/core/types';

vi.mock('fs');

const FAKE_DOWNLOAD = Buffer.from('downloaded-file-data');
const FAKE_UPSCALED = Buffer.from('upscaled-image-data');

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

describe('createUpscalerHandler (auto-detect image/video, shared channel)', () => {
  beforeEach(() => {
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.readFileSync).mockReturnValue(FAKE_UPSCALED);
    vi.mocked(fs.unlinkSync).mockImplementation(() => {});
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
    const { createUpscalerHandler } = await import('../src/features/upscaler/handler');
    const imageClient = { upscale: vi.fn() } as unknown as UpscalerClient;
    const videoClient = { upscaleVideo: vi.fn() } as unknown as VideoUpscalerClient;
    const handler = createUpscalerHandler(imageClient, videoClient);
    const message = makeMessage('none');

    await handler(message as never, makeCtx());

    expect(message.reply).not.toHaveBeenCalled();
    expect(imageClient.upscale).not.toHaveBeenCalled();
    expect(videoClient.upscaleVideo).not.toHaveBeenCalled();
  });

  it('routes image attachments to the image client and mentions scale/model', async () => {
    const { createUpscalerHandler } = await import('../src/features/upscaler/handler');
    const imageClient = { upscale: vi.fn().mockResolvedValue(undefined) } as unknown as UpscalerClient;
    const videoClient = { upscaleVideo: vi.fn() } as unknown as VideoUpscalerClient;
    const handler = createUpscalerHandler(imageClient, videoClient);
    const message = makeMessage('image');

    await handler(message as never, makeCtx());

    expect(message.reply).toHaveBeenCalledWith('⏳ Đang upscale ảnh...');
    expect(imageClient.upscale).toHaveBeenCalledTimes(1);
    expect(videoClient.upscaleVideo).not.toHaveBeenCalled();
    const callArg = message._thinking.edit.mock.calls[0][0];
    expect(callArg.content).toContain('✅');
    expect(callArg.content).toContain('4x');
    expect(callArg.content).toContain('upscayl-standard-4x');
  });

  it('routes video attachments to the video client', async () => {
    const { createUpscalerHandler } = await import('../src/features/upscaler/handler');
    const imageClient = { upscale: vi.fn() } as unknown as UpscalerClient;
    const videoClient = { upscaleVideo: vi.fn().mockResolvedValue(undefined) } as unknown as VideoUpscalerClient;
    const handler = createUpscalerHandler(imageClient, videoClient);
    const message = makeMessage('video');

    await handler(message as never, makeCtx());

    expect(message.reply).toHaveBeenCalledWith(expect.stringContaining('Đang upscale video'));
    expect(videoClient.upscaleVideo).toHaveBeenCalledTimes(1);
    expect(imageClient.upscale).not.toHaveBeenCalled();
    const callArg = message._thinking.edit.mock.calls[0][0];
    expect(callArg.content).toContain('✅');
    expect(callArg.files).toEqual(expect.any(Array));
  });

  it('edits reply with ❌ and reports error when image upscale fails', async () => {
    const { createUpscalerHandler } = await import('../src/features/upscaler/handler');
    const err = new Error('upscayl-bin exited with code 1');
    const imageClient = { upscale: vi.fn().mockRejectedValue(err) } as unknown as UpscalerClient;
    const videoClient = { upscaleVideo: vi.fn() } as unknown as VideoUpscalerClient;
    const handler = createUpscalerHandler(imageClient, videoClient);
    const message = makeMessage('image');
    const ctx = makeCtx();

    await handler(message as never, ctx);

    expect(message._thinking.edit).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('❌') }),
    );
    expect(ctx.errorReporter.report).toHaveBeenCalledWith(
      err,
      expect.objectContaining({ source: 'upscalerHandler' }),
    );
  });

  it('edits reply with ❌ and reports error when video upscale fails', async () => {
    const { createUpscalerHandler } = await import('../src/features/upscaler/handler');
    const err = new Error('ffmpeg crashed');
    const imageClient = { upscale: vi.fn() } as unknown as UpscalerClient;
    const videoClient = { upscaleVideo: vi.fn().mockRejectedValue(err) } as unknown as VideoUpscalerClient;
    const handler = createUpscalerHandler(imageClient, videoClient);
    const message = makeMessage('video');
    const ctx = makeCtx();

    await handler(message as never, ctx);

    expect(message._thinking.edit).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('❌') }),
    );
    expect(ctx.errorReporter.report).toHaveBeenCalledWith(
      err,
      expect.objectContaining({ source: 'upscalerHandler' }),
    );
  });

  it('cleans up both temp files in finally — even on failure', async () => {
    const { createUpscalerHandler } = await import('../src/features/upscaler/handler');
    const imageClient = { upscale: vi.fn().mockRejectedValue(new Error('crash')) } as unknown as UpscalerClient;
    const videoClient = { upscaleVideo: vi.fn() } as unknown as VideoUpscalerClient;
    const handler = createUpscalerHandler(imageClient, videoClient);
    const message = makeMessage('image');

    await handler(message as never, makeCtx());

    expect(fs.unlinkSync).toHaveBeenCalledTimes(2);
  });
});
