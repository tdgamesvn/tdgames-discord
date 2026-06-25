import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as childProcess from 'child_process';
import * as fs from 'fs';

vi.mock('child_process');
vi.mock('fs');

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
  binPath: '/usr/local/bin/upscayl-bin',
  modelsPath: '/path/to/models',
  model: 'upscayl-standard-4x',
  scale: 4,
  format: 'png' as const,
};

describe('UpscalerClient', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('throws immediately when binary is not found', async () => {
    const { UpscalerClient } = await import('../src/features/upscaler/client');
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const client = new UpscalerClient({ ...OPTS, binPath: '/nonexistent/upscayl-bin' });
    await expect(client.upscale('/tmp/in.png', '/tmp/out.png')).rejects.toThrow(
      'upscayl-bin not found at: /nonexistent/upscayl-bin',
    );
    expect(childProcess.spawn).not.toHaveBeenCalled();
  });

  it('spawns upscayl-bin with correct arguments', async () => {
    const { UpscalerClient } = await import('../src/features/upscaler/client');
    const proc = makeProc();
    vi.mocked(childProcess.spawn).mockReturnValue(proc as ReturnType<typeof childProcess.spawn>);

    const client = new UpscalerClient(OPTS);
    const promise = client.upscale('/tmp/input.png', '/tmp/output.png');
    proc.simulateClose(0);
    await promise;

    expect(childProcess.spawn).toHaveBeenCalledWith('/usr/local/bin/upscayl-bin', [
      '-i', '/tmp/input.png',
      '-o', '/tmp/output.png',
      '-m', '/path/to/models',
      '-n', 'upscayl-standard-4x',
      '-s', '4',
      '-f', 'png',
    ]);
  });

  it('resolves when process exits with code 0', async () => {
    const { UpscalerClient } = await import('../src/features/upscaler/client');
    const proc = makeProc();
    vi.mocked(childProcess.spawn).mockReturnValue(proc as ReturnType<typeof childProcess.spawn>);

    const client = new UpscalerClient(OPTS);
    const promise = client.upscale('/tmp/input.png', '/tmp/output.png');
    proc.simulateClose(0);

    await expect(promise).resolves.toBeUndefined();
  });

  it('rejects when process exits with non-zero code', async () => {
    const { UpscalerClient } = await import('../src/features/upscaler/client');
    const proc = makeProc();
    vi.mocked(childProcess.spawn).mockReturnValue(proc as ReturnType<typeof childProcess.spawn>);

    const client = new UpscalerClient(OPTS);
    const promise = client.upscale('/tmp/input.png', '/tmp/output.png');
    proc.simulateClose(1);

    await expect(promise).rejects.toThrow('upscayl-bin exited with code 1');
  });

  it('rejects when spawn emits an error event', async () => {
    const { UpscalerClient } = await import('../src/features/upscaler/client');
    const proc = makeProc();
    vi.mocked(childProcess.spawn).mockReturnValue(proc as ReturnType<typeof childProcess.spawn>);

    const client = new UpscalerClient(OPTS);
    const promise = client.upscale('/tmp/input.png', '/tmp/output.png');
    proc.simulateError(new Error('ENOENT binary missing'));

    await expect(promise).rejects.toThrow('ENOENT binary missing');
  });
});
