import { AttachmentBuilder, Message } from 'discord.js';
import type { ImageClient } from '../services/imageClient';
import type { SessionStore, HistoryEntry } from '../services/sessionStore';
import type { ChannelPromptStore } from '../services/channelPromptStore';
import type { ErrorReporter } from '../services/errorReporter';

export interface ImageHandlerDeps {
  imageClient: ImageClient;
  sessionStore: SessionStore;
  channelPromptStore: ChannelPromptStore;
  imageModel: string;
  imageSize: string;
  errorReporter?: ErrorReporter;
}

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

/**
 * Parse --ratio flag from prompt.
 * Returns { prompt: cleaned prompt, size: resolved size }.
 * Example: "vẽ con rồng --ratio 16:9" → { prompt: "vẽ con rồng", size: "1536x1024" }
 */
function parseRatio(raw: string, defaultSize: string): { prompt: string; size: string } {
  const match = raw.match(/--ratio\s+(\S+)/i);
  if (!match) return { prompt: raw, size: defaultSize };

  const key = match[1].toLowerCase();
  const size = RATIO_MAP[key] ?? defaultSize;
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

export async function handleImageMessage(
  message: Message,
  deps: ImageHandlerDeps
): Promise<void> {
  const { imageClient, sessionStore, channelPromptStore, imageModel, imageSize, errorReporter } = deps;
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
  // Priority: (1) user-uploaded attachment → (2) last bot image in session → (3) generate new

  const imageAttachment = message.attachments.find(
    (a) => a.contentType?.startsWith('image/') ?? false
  );

  const session = sessionStore.get(userId, channelId);
  const sessionImageUrl = session ? lastBotImageUrl(session.history) : null;

  const isEditMode = Boolean(imageAttachment || sessionImageUrl);
  const modeLabel = imageAttachment
    ? '🖼️ Editing your image...'
    : sessionImageUrl
      ? '🖼️ Refining previous image...'
      : '⏳ Generating your image...';

  // Send thinking placeholder
  const thinkingMsg = await message.reply(modeLabel);

  try {
    let result;

    if (isEditMode) {
      // Download source image
      const sourceUrl = imageAttachment?.url ?? sessionImageUrl!;
      const imageName = imageAttachment?.name ?? 'image.png';
      const imageBuffer = await fetchBuffer(sourceUrl);

      result = await imageClient.edit({
        imageBuffer,
        imageName,
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
      content: `✅ Done! \`${size}\``,
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
}
