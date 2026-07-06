import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AttachmentBuilder, type Message } from 'discord.js';
import type { VideoUpscalerClient } from './client';
import type { FeatureContext } from '../../core/types';

export function createUpscalerVideoHandler(
  client: VideoUpscalerClient,
): (message: Message, ctx: FeatureContext) => Promise<void> {
  return async (message, ctx) => {
    const { errorReporter } = ctx;

    // Only process messages that contain at least one video attachment
    const videoAttachment = [...message.attachments.values()].find(
      (a) => a.contentType?.startsWith('video/') ?? false,
    );
    if (!videoAttachment) return;

    const thinkingMsg = await message.reply('⏳ Đang upscale video... (có thể mất vài phút)');

    const uid = `video-upscale-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ext = path.extname(videoAttachment.name ?? 'video.mp4') || '.mp4';
    const inputPath = path.join(os.tmpdir(), `${uid}-input${ext}`);
    const outputPath = path.join(os.tmpdir(), `${uid}-output.mp4`);

    try {
      // 1. Download the Discord attachment
      const resp = await fetch(videoAttachment.url);
      if (!resp.ok) throw new Error(`Failed to download video: HTTP ${resp.status}`);
      fs.writeFileSync(inputPath, Buffer.from(await resp.arrayBuffer()));

      // 2. Extract frames -> upscale each -> reassemble
      await client.upscaleVideo(inputPath, outputPath);

      // 3. Upload result (attach by path — avoids buffering the whole video in memory)
      const attachment = new AttachmentBuilder(outputPath, { name: 'upscaled.mp4' });
      await thinkingMsg.edit({ content: '✅ Xong!', files: [attachment] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      await thinkingMsg.edit({ content: `❌ Upscale video thất bại: ${msg}` });
      await errorReporter?.report(err, {
        source: 'upscalerVideoHandler',
        userId: message.author.id,
        channelId: message.channelId,
      });
    } finally {
      for (const p of [inputPath, outputPath]) {
        try { fs.unlinkSync(p); } catch { /* ignore */ }
      }
    }
  };
}
