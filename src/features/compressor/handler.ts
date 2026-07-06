import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AttachmentBuilder, type Message } from 'discord.js';
import type { CompressorClient } from './client';
import type { FeatureContext } from '../../core/types';

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function createCompressorHandler(
  client: CompressorClient,
): (message: Message, ctx: FeatureContext) => Promise<void> {
  return async (message, ctx) => {
    const { errorReporter } = ctx;

    // Auto-detect: first attachment that's either an image or a video
    const attachment = [...message.attachments.values()].find(
      (a) => (a.contentType?.startsWith('image/') || a.contentType?.startsWith('video/')) ?? false,
    );
    if (!attachment) return;

    const isVideo = attachment.contentType!.startsWith('video/');
    const thinkingMsg = await message.reply(isVideo ? '⏳ Đang nén video...' : '⏳ Đang nén ảnh...');

    const uid = `compress-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const inExt = path.extname(attachment.name ?? '') || (isVideo ? '.mp4' : '.png');
    const outExt = isVideo ? '.mp4' : '.webp';
    const inputPath = path.join(os.tmpdir(), `${uid}-input${inExt}`);
    const outputPath = path.join(os.tmpdir(), `${uid}-output${outExt}`);

    try {
      // 1. Download the Discord attachment
      const resp = await fetch(attachment.url);
      if (!resp.ok) throw new Error(`Failed to download file: HTTP ${resp.status}`);
      fs.writeFileSync(inputPath, Buffer.from(await resp.arrayBuffer()));

      // 2. Compress — route by detected media type
      if (isVideo) await client.compressVideo(inputPath, outputPath);
      else await client.compressImage(inputPath, outputPath);

      // 3. Upload result, reporting size before/after
      const beforeSize = fs.statSync(inputPath).size;
      const afterSize = fs.statSync(outputPath).size;
      const reducedPct = beforeSize > 0 ? Math.round((1 - afterSize / beforeSize) * 100) : 0;
      const outName = isVideo ? 'compressed.mp4' : 'compressed.webp';
      const resultAttachment = new AttachmentBuilder(outputPath, { name: outName });

      await thinkingMsg.edit({
        content: `✅ Xong! (${fmtSize(beforeSize)} → ${fmtSize(afterSize)}, giảm ${reducedPct}%)`,
        files: [resultAttachment],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      await thinkingMsg.edit({ content: `❌ Nén thất bại: ${msg}` });
      await errorReporter?.report(err, {
        source: 'compressorHandler',
        userId: message.author.id,
        channelId: message.channelId,
      });
    } finally {
      // 4. Cleanup temp files (ignore ENOENT — file may not have been written)
      for (const p of [inputPath, outputPath]) {
        try { fs.unlinkSync(p); } catch { /* ignore */ }
      }
    }
  };
}
