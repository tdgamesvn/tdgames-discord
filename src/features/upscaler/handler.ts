import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AttachmentBuilder, type Message } from 'discord.js';
import type { UpscalerClient } from './client';
import type { FeatureContext } from '../../core/types';

export function createUpscalerHandler(
  client: UpscalerClient,
): (message: Message, ctx: FeatureContext) => Promise<void> {
  return async (message, ctx) => {
    const { errorReporter, config } = ctx;

    // Only process messages that contain at least one image attachment
    const imageAttachment = [...message.attachments.values()].find(
      (a) => a.contentType?.startsWith('image/') ?? false,
    );
    if (!imageAttachment) return;

    // Send "working" placeholder so the user sees immediate feedback
    const thinkingMsg = await message.reply('⏳ Đang upscale ảnh...');

    // Build unique temp file paths — avoids collisions under concurrent requests
    const uid = `upscayl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ext = path.extname(imageAttachment.name ?? 'image.png') || '.png';
    const inputPath = path.join(os.tmpdir(), `${uid}-input${ext}`);
    const outputPath = path.join(os.tmpdir(), `${uid}-output.png`);

    try {
      // ── 1. Download the Discord attachment ──────────────────────────────────
      const resp = await fetch(imageAttachment.url);
      if (!resp.ok) throw new Error(`Failed to download image: HTTP ${resp.status}`);
      const buffer = Buffer.from(await resp.arrayBuffer());
      fs.writeFileSync(inputPath, buffer);

      // ── 2. Run upscayl-bin ─────────────────────────────────────────────────
      await client.upscale(inputPath, outputPath);

      // ── 3. Upload result ────────────────────────────────────────────────────
      const resultBuffer = fs.readFileSync(outputPath);
      const attachment = new AttachmentBuilder(resultBuffer, { name: 'upscaled.png' });

      const { scale, model } = config.upscaler;
      await thinkingMsg.edit({
        content: `✅ Xong! (${scale}x · ${model})`,
        files: [attachment],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      await thinkingMsg.edit({ content: `❌ Upscale thất bại: ${msg}` });
      await errorReporter?.report(err, {
        source: 'upscalerHandler',
        userId: message.author.id,
        channelId: message.channelId,
      });
    } finally {
      // ── 4. Cleanup temp files (ignore ENOENT — file may not have been written) ──
      for (const p of [inputPath, outputPath]) {
        try { fs.unlinkSync(p); } catch { /* ignore */ }
      }
    }
  };
}
