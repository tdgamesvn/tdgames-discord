import { AttachmentBuilder, Message } from 'discord.js';
import type { ImageClient } from '../services/imageClient';
import type { SessionStore, HistoryEntry } from '../services/sessionStore';

export interface ImageHandlerDeps {
  imageClient: ImageClient;
  sessionStore: SessionStore;
  imageModel: string;
  imageSize: string;
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

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function handleImageMessage(
  message: Message,
  deps: ImageHandlerDeps
): Promise<void> {
  const { imageClient, sessionStore, imageModel, imageSize } = deps;
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

  // Send thinking placeholder
  const thinkingMsg = await message.reply('⏳ Generating your image...');

  try {
    // Call image API
    const result = await imageClient.generate({
      prompt,
      model: imageModel,
      size,
    });

    // Build discord attachment
    const attachment = new AttachmentBuilder(result.buffer, { name: 'image.png' });

    // Edit placeholder: clear ⏳ text and attach image
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
  }
}
