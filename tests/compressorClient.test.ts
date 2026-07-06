import { describe, it, expect, vi, afterEach } from 'vitest';
import * as childProcess from 'child_process';

vi.mock('child_process');

// Helper: build a mock spawn process with controllable close/error events
function makeProc() {
  const procCallbacks: Record<string, (...args: unknown[]) => void> = {};
  const proc = {
    stderr: { on: vi.fn() },
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      procCallbacks[event] = cb;
    }),
    simulateClose: (code: number) => procCallbacks['close']?.(code),
    simulateError: (err: Error) => procCallbacks['error']?.(err),
  };
  return proc;
}

const OPTS = {
  ffmpegPath: 'ffmpeg',
  imageQuality: 85,
  videoCrf: 23,
  videoPreset: 'medium',
};

describe('CompressorClient', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('compresses an image by spawning ffmpeg with WebP quality args', async () => {
    const { CompressorClient } = await import('../src/features/compressor/client');
    const proc = makeProc();
    vi.mocked(childProcess.spawn).mockReturnValue(proc as ReturnType<typeof childProcess.spawn>);

    const client = new CompressorClient(OPTS);
    const promise = client.compressImage('/tmp/in.png', '/tmp/out.webp');
    proc.simulateClose(0);
    await promise;

    expect(childProcess.spawn).toHaveBeenCalledWith('ffmpeg', [
      '-y', '-i', '/tmp/in.png',
      '-quality', '85',
      '/tmp/out.webp',
    ]);
  });

  it('compresses a video by spawning ffmpeg with CRF/preset args', async () => {
    const { CompressorClient } = await import('../src/features/compressor/client');
    const proc = makeProc();
    vi.mocked(childProcess.spawn).mockReturnValue(proc as ReturnType<typeof childProcess.spawn>);

    const client = new CompressorClient(OPTS);
    const promise = client.compressVideo('/tmp/in.mp4', '/tmp/out.mp4');
    proc.simulateClose(0);
    await promise;

    expect(childProcess.spawn).toHaveBeenCalledWith('ffmpeg', [
      '-y', '-i', '/tmp/in.mp4',
      '-c:v', 'libx264', '-crf', '23', '-preset', 'medium',
      '-c:a', 'aac', '-b:a', '128k',
      '/tmp/out.mp4',
    ]);
  });

  it('resolves when ffmpeg exits with code 0', async () => {
    const { CompressorClient } = await import('../src/features/compressor/client');
    const proc = makeProc();
    vi.mocked(childProcess.spawn).mockReturnValue(proc as ReturnType<typeof childProcess.spawn>);

    const client = new CompressorClient(OPTS);
    const promise = client.compressImage('/tmp/in.png', '/tmp/out.webp');
    proc.simulateClose(0);

    await expect(promise).resolves.toBeUndefined();
  });

  it('rejects when ffmpeg exits with non-zero code', async () => {
    const { CompressorClient } = await import('../src/features/compressor/client');
    const proc = makeProc();
    vi.mocked(childProcess.spawn).mockReturnValue(proc as ReturnType<typeof childProcess.spawn>);

    const client = new CompressorClient(OPTS);
    const promise = client.compressVideo('/tmp/in.mp4', '/tmp/out.mp4');
    proc.simulateClose(1);

    await expect(promise).rejects.toThrow('ffmpeg exited with code 1');
  });

  it('rejects when spawn emits an error event', async () => {
    const { CompressorClient } = await import('../src/features/compressor/client');
    const proc = makeProc();
    vi.mocked(childProcess.spawn).mockReturnValue(proc as ReturnType<typeof childProcess.spawn>);

    const client = new CompressorClient(OPTS);
    const promise = client.compressImage('/tmp/in.png', '/tmp/out.webp');
    proc.simulateError(new Error('ENOENT ffmpeg missing'));

    await expect(promise).rejects.toThrow('ENOENT ffmpeg missing');
  });
});
