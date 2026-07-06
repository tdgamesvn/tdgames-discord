import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AttachmentBuilder, type Message } from 'discord.js';
import type { UpscalerClient } from './client';
import type { VideoUpscalerClient } from '../upscaler-video/client';
import type { FeatureContext } from '../../core/types';

export function createUpscalerHandler(
  imageClient: UpscalerClient,
  videoClient: VideoUpscalerClient,
): (message: Message, ctx: FeatureContext) => Promise<void> {
  return async (message, ctx) => {
    const { errorReporter, config } = ctx;

    // Auto-detect: same channel handles both — route by the first image/video attachment found
    const attachment = [...message.attachments.values()].find(
      (a) => (a.contentType?.startsWith('image/') || a.contentType?.startsWith('video/')) ?? false,
    );
    if (!attachment) return;

    const isVideo = attachment.contentType!.startsWith('video/');
    const thinkingMsg = await message.reply(
      isVideo ? '⏳ Đang upscale video... (có thể mất vài phút)' : '⏳ Đang upscale ảnh...',
    );

    // Build unique temp file paths — avoids collisions under concurrent requests
    const uid = `upscayl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const inExt = path.extname(attachment.name ?? '') || (isVideo ? '.mp4' : '.png');
    const inputPath = path.join(os.tmpdir(), `${uid}-input${inExt}`);
    const outputPath = path.join(os.tmpdir(), `${uid}-output${isVideo ? '.mp4' : '.png'}`);

    try {
      // 1. Download the Discord attachment
      const resp = await fetch(attachment.url);
      if (!resp.ok) throw new Error(`Failed to download file: HTTP ${resp.status}`);
      fs.writeFileSync(inputPath, Buffer.from(await resp.arrayBuffer()));

      // 2. Upscale — route by detected media type
      if (isVideo) {
        await videoClient.upscaleVideo(inputPath, outputPath);
        const attachmentOut = new AttachmentBuilder(outputPath, { name: 'upscaled.mp4' });
        await thinkingMsg.edit({ content: '✅ Xong!', files: [attachmentOut] });
      } else {
        await imageClient.upscale(inputPath, outputPath);
        const resultBuffer = fs.readFileSync(outputPath);
        const attachmentOut = new AttachmentBuilder(resultBuffer, { name: 'upscaled.png' });
        const { scale, model } = config.upscaler;
        await thinkingMsg.edit({ content: `✅ Xong! (${scale}x · ${model})`, files: [attachmentOut] });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      await thinkingMsg.edit({ content: `❌ Upscale thất bại: ${msg}` });
      await errorReporter?.report(err, {
        source: 'upscalerHandler',
        userId: message.author.id,
        channelId: message.channelId,
      });
    } finally {
      // 3. Cleanup temp files (ignore ENOENT — file may not have been written)
      for (const p of [inputPath, outputPath]) {
        try { fs.unlinkSync(p); } catch { /* ignore */ }
      }
    }
  };
}
