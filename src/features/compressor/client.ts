import { spawn } from 'child_process';

export interface CompressorOptions {
  ffmpegPath: string;
  /** WebP lossy quality, 0-100 — higher keeps more detail at the cost of size. */
  imageQuality: number;
  /** libx264 CRF, 0-51 — lower means higher quality (and bigger file). */
  videoCrf: number;
  /** ffmpeg encoder preset — trades encode speed for compression efficiency. */
  videoPreset: string;
}

function run(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args);
    const stderrChunks: string[] = [];

    proc.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk.toString());
    });

    proc.on('error', (err: Error) => {
      reject(new Error(`Failed to spawn ${bin}: ${err.message}`));
    });

    proc.on('close', (code: number | null) => {
      if (code === 0) {
        resolve();
      } else {
        const detail = stderrChunks.join('').trim().slice(-2000);
        reject(new Error(`${bin} exited with code ${code}${detail ? `. stderr: ${detail}` : ''}`));
      }
    });
  });
}

export class CompressorClient {
  constructor(private readonly opts: CompressorOptions) {}

  /** Recompresses an image as lossy WebP — big size reduction, quality-tunable. */
  async compressImage(inputPath: string, outputPath: string): Promise<void> {
    const { ffmpegPath, imageQuality } = this.opts;
    return run(ffmpegPath, ['-y', '-i', inputPath, '-quality', String(imageQuality), outputPath]);
  }

  /** Recompresses a video as H.264 at a fixed CRF — keeps audio, re-encodes AAC. */
  async compressVideo(inputPath: string, outputPath: string): Promise<void> {
    const { ffmpegPath, videoCrf, videoPreset } = this.opts;
    return run(ffmpegPath, [
      '-y', '-i', inputPath,
      '-c:v', 'libx264', '-crf', String(videoCrf), '-preset', videoPreset,
      '-c:a', 'aac', '-b:a', '128k',
      outputPath,
    ]);
  }
}
