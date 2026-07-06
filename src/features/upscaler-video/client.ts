import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { UpscalerClient } from '../upscaler/client';

export interface VideoUpscalerOptions {
  /** Reuses the same Real-ESRGAN (upscayl-bin) client already used for image upscaling. */
  upscaler: UpscalerClient;
  ffmpegPath: string;
  ffprobePath: string;
  maxDurationSec: number;
}

interface ProbeResult {
  durationSec: number;
  fps: string;
  hasAudio: boolean;
}

function runCmd(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args);
    let stdout = '';
    const stderrChunks: string[] = [];

    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk; });
    proc.stderr.on('data', (chunk: Buffer) => { stderrChunks.push(chunk.toString()); });

    proc.on('error', (err: Error) => {
      reject(new Error(`Failed to spawn ${bin}: ${err.message}`));
    });

    proc.on('close', (code: number | null) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        const detail = stderrChunks.join('').trim().slice(-2000);
        reject(new Error(`${bin} exited with code ${code}${detail ? `. stderr: ${detail}` : ''}`));
      }
    });
  });
}

export class VideoUpscalerClient {
  constructor(private readonly opts: VideoUpscalerOptions) {}

  private async probe(inputPath: string): Promise<ProbeResult> {
    const stdout = await runCmd(this.opts.ffprobePath, [
      '-v', 'error',
      '-show_entries', 'format=duration:stream=codec_type,r_frame_rate',
      '-of', 'json',
      inputPath,
    ]);
    const data = JSON.parse(stdout);
    const streams: Array<{ codec_type: string; r_frame_rate?: string }> = data.streams ?? [];
    const videoStream = streams.find((s) => s.codec_type === 'video');
    return {
      durationSec: parseFloat(data.format?.duration ?? '0'),
      fps: videoStream?.r_frame_rate ?? '30/1',
      hasAudio: streams.some((s) => s.codec_type === 'audio'),
    };
  }

  /**
   * Upscale the video at `inputPath`, writing the result to `outputPath`.
   * Pipeline: ffmpeg extract frames -> Real-ESRGAN upscale each frame -> ffmpeg
   * reassemble video (+ original audio, if any). Frames are processed sequentially
   * since Real-ESRGAN via MoltenVK is GPU-bound — parallel calls would just contend.
   */
  async upscaleVideo(inputPath: string, outputPath: string): Promise<void> {
    const { ffmpegPath, maxDurationSec, upscaler } = this.opts;
    const { durationSec, fps, hasAudio } = await this.probe(inputPath);

    if (durationSec > maxDurationSec) {
      throw new Error(
        `Video dài ${durationSec.toFixed(1)}s, vượt giới hạn ${maxDurationSec}s cho upscale video.`,
      );
    }

    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-upscale-'));
    const rawDir = path.join(workDir, 'raw');
    const upscaledDir = path.join(workDir, 'upscaled');
    fs.mkdirSync(rawDir);
    fs.mkdirSync(upscaledDir);
    const audioPath = path.join(workDir, 'audio.m4a');

    try {
      // 1. Extract frames as PNG
      await runCmd(ffmpegPath, ['-y', '-i', inputPath, path.join(rawDir, 'frame-%06d.png')]);

      // 2. Extract original audio (best-effort — some containers/codecs can't stream-copy)
      let audioExtracted = false;
      if (hasAudio) {
        try {
          await runCmd(ffmpegPath, ['-y', '-i', inputPath, '-vn', '-acodec', 'copy', audioPath]);
          audioExtracted = true;
        } catch {
          // Skip audio rather than fail the whole job
        }
      }

      // 3. Upscale each frame with the same Real-ESRGAN client used for images
      const frames = fs.readdirSync(rawDir).sort();
      if (frames.length === 0) throw new Error('Không tách được frame nào từ video.');
      for (const frame of frames) {
        await upscaler.upscale(path.join(rawDir, frame), path.join(upscaledDir, frame));
      }

      // 4. Reassemble video, re-muxing original audio if we have it
      await runCmd(ffmpegPath, [
        '-y',
        '-framerate', fps,
        '-i', path.join(upscaledDir, 'frame-%06d.png'),
        ...(audioExtracted ? ['-i', audioPath] : []),
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        ...(audioExtracted ? ['-c:a', 'aac', '-shortest'] : []),
        outputPath,
      ]);
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }
}
