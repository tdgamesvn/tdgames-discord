import { spawn } from 'child_process';
import * as fs from 'fs';

export interface UpscalerOptions {
  binPath: string;
  modelsPath: string;
  model: string;
  scale: number;
  format?: 'png' | 'jpg' | 'webp';
}

export class UpscalerClient {
  constructor(private readonly opts: UpscalerOptions) {}

  /**
   * Upscale the image at `inputPath`, writing the result to `outputPath`.
   * Resolves on success, rejects with a descriptive error on failure.
   */
  async upscale(inputPath: string, outputPath: string): Promise<void> {
    const { binPath, modelsPath, model, scale, format = 'png' } = this.opts;

    if (!fs.existsSync(binPath)) {
      throw new Error(`upscayl-bin not found at: ${binPath}`);
    }

    const args = [
      '-i', inputPath,
      '-o', outputPath,
      '-m', modelsPath,
      '-n', model,
      '-s', String(scale),
      '-f', format,
    ];

    return new Promise((resolve, reject) => {
      const proc = spawn(binPath, args);
      const stderrChunks: string[] = [];

      proc.stderr.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk.toString());
      });

      proc.on('error', (err: Error) => {
        reject(new Error(`Failed to spawn upscayl-bin: ${err.message}`));
      });

      proc.on('close', (code: number | null) => {
        if (code === 0) {
          resolve();
        } else {
          const detail = stderrChunks.join('').trim();
          reject(new Error(
            `upscayl-bin exited with code ${code}${detail ? `. stderr: ${detail}` : ''}`,
          ));
        }
      });
    });
  }
}
