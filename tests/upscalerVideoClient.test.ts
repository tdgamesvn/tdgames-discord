import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as childProcess from 'child_process';
import * as fs from 'fs';
import type { UpscalerClient } from '../src/features/upscaler/client';

vi.mock('child_process');
vi.mock('fs');

/** Fake spawn'd process that auto-emits stdout data then 'close' asynchronously. */
function makeAutoProc(stdout = '', code = 0) {
  return {
    stdout: {
      on: (event: string, cb: (chunk: Buffer) => void) => {
        if (event === 'data') queueMicrotask(() => cb(Buffer.from(stdout)));
      },
    },
    stderr: { on: vi.fn() },
    on: (event: string, cb: (code: number) => void) => {
      if (event === 'close') queueMicrotask(() => queueMicrotask(() => cb(code)));
    },
  };
}

const PROBE_JSON = JSON.stringify({
  format: { duration: '5.0' },
  streams: [
    { codec_type: 'video', r_frame_rate: '30/1' },
    { codec_type: 'audio' },
  ],
});

const OPTS_BASE = {
  ffmpegPath: 'ffmpeg',
  ffprobePath: 'ffprobe',
  maxDurationSec: 20,
};

function makeUpscaler() {
  return { upscale: vi.fn().mockResolvedValue(undefined) } as unknown as UpscalerClient;
}

describe('VideoUpscalerClient', () => {
  beforeEach(() => {
    vi.mocked(fs.mkdtempSync).mockReturnValue('/tmp/video-upscale-xyz');
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined as never);
    vi.mocked(fs.rmSync).mockImplementation(() => undefined);
    vi.mocked(childProcess.spawn).mockImplementation(
      (bin: string) =>
        (bin === 'ffprobe' ? makeAutoProc(PROBE_JSON, 0) : makeAutoProc('', 0)) as ReturnType<
          typeof childProcess.spawn
        >,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('rejects when video duration exceeds maxDurationSec — without extracting frames', async () => {
    const { VideoUpscalerClient } = await import('../src/features/upscaler-video/client');
    const upscaler = makeUpscaler();
    const client = new VideoUpscalerClient({ ...OPTS_BASE, maxDurationSec: 2, upscaler });

    await expect(client.upscaleVideo('/tmp/in.mp4', '/tmp/out.mp4')).rejects.toThrow(
      /vượt giới hạn 2s/,
    );
    expect(upscaler.upscale).not.toHaveBeenCalled();
  });

  it('upscales every extracted frame with the shared image upscaler client', async () => {
    vi.mocked(fs.readdirSync).mockReturnValue(['frame-000001.png', 'frame-000002.png'] as never);
    const { VideoUpscalerClient } = await import('../src/features/upscaler-video/client');
    const upscaler = makeUpscaler();
    const client = new VideoUpscalerClient({ ...OPTS_BASE, upscaler });

    await client.upscaleVideo('/tmp/in.mp4', '/tmp/out.mp4');

    expect(upscaler.upscale).toHaveBeenCalledTimes(2);
  });

  it('throws when no frames were extracted from the video', async () => {
    vi.mocked(fs.readdirSync).mockReturnValue([] as never);
    const { VideoUpscalerClient } = await import('../src/features/upscaler-video/client');
    const upscaler = makeUpscaler();
    const client = new VideoUpscalerClient({ ...OPTS_BASE, upscaler });

    await expect(client.upscaleVideo('/tmp/in.mp4', '/tmp/out.mp4')).rejects.toThrow(
      'Không tách được frame nào từ video.',
    );
  });

  it('cleans up the temp work dir even when upscaling a frame fails', async () => {
    vi.mocked(fs.readdirSync).mockReturnValue(['frame-000001.png'] as never);
    const { VideoUpscalerClient } = await import('../src/features/upscaler-video/client');
    const upscaler = {
      upscale: vi.fn().mockRejectedValue(new Error('gpu crash')),
    } as unknown as UpscalerClient;
    const client = new VideoUpscalerClient({ ...OPTS_BASE, upscaler });

    await expect(client.upscaleVideo('/tmp/in.mp4', '/tmp/out.mp4')).rejects.toThrow('gpu crash');
    expect(fs.rmSync).toHaveBeenCalledWith('/tmp/video-upscale-xyz', {
      recursive: true,
      force: true,
    });
  });
});
