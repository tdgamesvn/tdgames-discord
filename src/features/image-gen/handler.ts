import { AttachmentBuilder, Message } from 'discord.js';
import type { ImageClient } from './client';
import type { HistoryEntry } from '../../shared/sessionStore';
import type { FeatureContext } from '../../core/types';

// ─── Ratio → size mapping for gpt-image-2 ────────────────────────────────────
// gpt-image-2 supports: 1024x1024 | 1536x1024 | 1024x1536

const RATIO_MAP: Record<string, string> = {
  // Square
  '1:1': '1024x1024',
  'square': '1024x1024',
  'vuong': '1024x1024',
  // Landscape (closest to 16:9, 3:2, 4:3)
  '16:9': '1536x1024',
  '3:2': '1536x1024',
  '4:3': '1536x1024',
  'landscape': '1536x1024',
  'ngang': '1536x1024',
  'wide': '1536x1024',
  // Portrait (2:3, 3:4, 9:16)
  '2:3': '1024x1536',
  '3:4': '1024x1536',
  '9:16': '1024x1536',
  'portrait': '1024x1536',
  'doc': '1024x1536',
  'dọc': '1024x1536',
  'tall': '1024x1536',
};

// ─── Auto-detect aspect ratio from prompt content ────────────────────────────
// When IMAGE_SIZE=auto and no --ratio flag, analyze the prompt to pick the best
// aspect ratio. Falls back to square (1024x1024) when no strong signal is found.

const PORTRAIT_KEYWORDS = [
  // Vietnamese
  'chân dung', 'nhân vật', 'người', 'cô gái', 'chàng trai', 'avatar',
  'selfie', 'khuôn mặt', 'nửa người', 'toàn thân', 'chibi',
  'poster phim', 'bìa sách', 'story', 'tin',
  // English
  'portrait', 'character', 'person', 'face', 'headshot', 'full body',
  'half body', 'upper body', 'mugshot', 'profile pic',
  'movie poster', 'book cover', 'phone wallpaper',
];

const LANDSCAPE_KEYWORDS = [
  // Vietnamese
  'phong cảnh', 'toàn cảnh', 'bối cảnh', 'cảnh', 'banner', 'nền',
  'background', 'bìa', 'cover', 'màn hình', 'desktop', 'wallpaper',
  'panorama', 'sân khấu', 'thành phố', 'biển', 'núi', 'rừng',
  'game scene', 'battlefield', 'trận chiến',
  // English
  'landscape', 'scene', 'scenery', 'panoramic', 'wide shot',
  'establishing shot', 'environment', 'cityscape', 'skyline',
  'battlefield', 'arena', 'stadium', 'thumbnail', 'header',
];

function autoDetectSize(prompt: string): string {
  const lower = prompt.toLowerCase();

  let portraitScore = 0;
  let landscapeScore = 0;

  for (const kw of PORTRAIT_KEYWORDS) {
    if (lower.includes(kw)) portraitScore++;
  }
  for (const kw of LANDSCAPE_KEYWORDS) {
    if (lower.includes(kw)) landscapeScore++;
  }

  if (portraitScore > landscapeScore) return '1024x1536';
  if (landscapeScore > portraitScore) return '1536x1024';
  return '1024x1024'; // default: square
}

/**
 * Parse --ratio flag from prompt.
 * Returns { prompt: cleaned prompt, size: resolved size }.
 * Example: "vẽ con rồng --ratio 16:9" → { prompt: "vẽ con rồng", size: "1536x1024" }
 *
 * When defaultSize is "auto", the size is determined by analyzing the prompt
 * content (portrait vs landscape vs square) — unless --ratio overrides it.
 */
function parseRatio(raw: string, defaultSize: string): { prompt: string; size: string } {
  const match = raw.match(/--ratio\s+(\S+)/i);
  if (!match) {
    const size = defaultSize === 'auto' ? autoDetectSize(raw) : defaultSize;
    return { prompt: raw, size };
  }

  const key = match[1].toLowerCase();
  const size = RATIO_MAP[key] ?? (defaultSize === 'auto' ? '1024x1024' : defaultSize);
  const prompt = raw.replace(match[0], '').trim();
  return { prompt, size };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Download a URL and return its buffer. */
async function fetchBuffer(url: string): Promise<Buffer> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to download image: ${resp.status}`);
  return Buffer.from(await resp.arrayBuffer());
}

/** Get last bot-generated imageUrl from session history. */
function lastBotImageUrl(history: HistoryEntry[]): string | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    if (entry.role === 'bot' && entry.imageUrl) return entry.imageUrl;
  }
  return null;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export function createImageGenHandler(
  imageClient: ImageClient,
): (message: Message, ctx: FeatureContext) => Promise<void> {
  return async (message, ctx) => {
    const { sessionStore, channelPromptStore, errorReporter, statsStore, config } = ctx;
    const imageModel = config.imageGen.model;
    const imageSize = config.imageGen.size;
    const userId = message.author.id;
    const channelId = message.channelId;
    const rawContent = message.content.trim();

    // Handle !reset command (case-insensitive)
    if (rawContent.toLowerCase() === '!reset') {
      sessionStore.delete(userId, channelId);
      await message.reply('✅ Session has been reset.');
      return;
    }

    // Parse --ratio flag from prompt
    const { prompt, size } = parseRatio(rawContent, imageSize);

    // Get system prompt for this channel (if any)
    const systemPrompt = channelPromptStore.get(channelId);
    const finalPrompt = systemPrompt ? `${systemPrompt}. ${prompt}` : prompt;

    // ── Determine mode: edit or generate ──────────────────────────────────────
    // Priority: (1) user-uploaded attachments (all of them) → (2) last bot image in session → (3) generate new

    // Collect ALL image attachments from the message (multi-image support)
    const imageAttachments = [...message.attachments.values()].filter(
      (a) => a.contentType?.startsWith('image/') ?? false
    );

    const session = sessionStore.get(userId, channelId);
    const sessionImageUrl = session ? lastBotImageUrl(session.history) : null;

    const hasUploads = imageAttachments.length > 0;
    const isEditMode = hasUploads || Boolean(sessionImageUrl);

    const modeLabel = hasUploads
      ? imageAttachments.length > 1
        ? `🖼️ Editing ${imageAttachments.length} images...`
        : '🖼️ Editing your image...'
      : sessionImageUrl
        ? '🖼️ Refining previous image...'
        : '⏳ Generating your image...';

    // Send thinking placeholder
    const thinkingMsg = await message.reply(modeLabel);

    try {
      let result;

      if (isEditMode) {
        let images: Array<{ buffer: Buffer; name: string }>;

        if (hasUploads) {
          // Download ALL uploaded images in parallel
          images = await Promise.all(
            imageAttachments.map(async (a) => ({
              buffer: await fetchBuffer(a.url),
              name: a.name ?? 'image.png',
            }))
          );
        } else {
          // Fall back to last bot-generated image from session
          images = [{ buffer: await fetchBuffer(sessionImageUrl!), name: 'image.png' }];
        }

        result = await imageClient.edit({
          images,
          prompt: finalPrompt,
          model: imageModel,
          size,
        });
      } else {
        result = await imageClient.generate({ prompt: finalPrompt, model: imageModel, size });
      }

      // Build discord attachment
      const attachment = new AttachmentBuilder(result.buffer, { name: 'image.png' });

      // Edit placeholder: clear status text and attach image
      const sentMsg = await thinkingMsg.edit({
        content: `✅ Done! \`${size}\`${imageSize === 'auto' ? ' (auto)' : ''}`,
        files: [attachment],
      });

      // Retrieve the CDN URL Discord assigned
      const imageUrl = sentMsg.attachments.first()?.url ?? '';

      // Append to session history
      const existing = sessionStore.get(userId, channelId);
      const history: HistoryEntry[] = existing ? [...existing.history] : [];
      history.push({ role: 'user', prompt });
      history.push({ role: 'bot', prompt, imageUrl });

      sessionStore.upsert(userId, channelId, history);

      // Track usage stats (CLIProxy vs OpenAI fallback)
      if (result.usedFallback) {
        statsStore?.increment('image_openai');
      } else {
        statsStore?.increment(isEditMode ? 'edit' : 'generate');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      await thinkingMsg.edit({
        content: `❌ Failed to generate image: ${msg}`,
      });
      // Notify error channel (no-op if errorReporter not configured)
      await errorReporter?.report(err, {
        source: 'imageHandler',
        userId,
        channelId,
        prompt: finalPrompt.slice(0, 200),
      });
    }
  };
}
