import { AttachmentBuilder, Message } from 'discord.js';
import type { ImageClient } from '../services/imageClient';
import type { SessionStore, HistoryEntry } from '../services/sessionStore';

export interface ImageHandlerDeps {
  imageClient: ImageClient;
  sessionStore: SessionStore;
  imageModel: string;
  imageSize: string;
}

export async function handleImageMessage(
  message: Message,
  deps: ImageHandlerDeps
): Promise<void> {
  const { imageClient, sessionStore, imageModel, imageSize } = deps;
  const userId = message.author.id;
  const channelId = message.channelId;
  const content = message.content.trim();

  // Handle !reset command (case-insensitive)
  if (content.toLowerCase() === '!reset') {
    sessionStore.delete(userId, channelId);
    await message.reply('✅ Session has been reset.');
    return;
  }

  // Send thinking placeholder
  const thinkingMsg = await message.reply('⏳ Generating your image...');

  try {
    // Call image API
    const result = await imageClient.generate({
      prompt: content,
      model: imageModel,
      size: imageSize,
    });

    // Build discord attachment
    const attachment = new AttachmentBuilder(result.buffer, { name: 'image.png' });

    // Replace thinking message with the image
    const sentMsg = await thinkingMsg.edit({ files: [attachment] });

    // Retrieve the CDN URL Discord assigned
    const imageUrl = sentMsg.attachments.first()?.url ?? '';

    // Append to session history
    const existing = sessionStore.get(userId, channelId);
    const history: HistoryEntry[] = existing ? [...existing.history] : [];
    history.push({ role: 'user', prompt: content });
    history.push({ role: 'bot', prompt: content, imageUrl });

    sessionStore.upsert(userId, channelId, history);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    await thinkingMsg.edit({
      content: `❌ Failed to generate image: ${msg}`,
    });
  }
}
