import { Message } from 'discord.js';
import type { ChatClient, ChatMessage, ChatMessageContentPart } from './client';
import type { HistoryEntry } from '../../shared/sessionStore';
import type { FeatureContext } from '../../core/types';

// MIME types recognised as images for vision
const IMAGE_MIME_RE = /^image\//i;

// Discord message content limit
const DISCORD_MAX_LENGTH = 2000;

/**
 * Split a long message into chunks that fit Discord's 2000-char limit.
 * Tries to split on newlines to keep formatting intact.
 */
function splitMessage(text: string): string[] {
  if (text.length <= DISCORD_MAX_LENGTH) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= DISCORD_MAX_LENGTH) {
      chunks.push(remaining);
      break;
    }

    // Try to find a good split point (newline) within the limit
    let splitAt = remaining.lastIndexOf('\n', DISCORD_MAX_LENGTH);
    if (splitAt <= 0 || splitAt < DISCORD_MAX_LENGTH * 0.5) {
      // No good newline — try space
      splitAt = remaining.lastIndexOf(' ', DISCORD_MAX_LENGTH);
    }
    if (splitAt <= 0) {
      // Hard split at limit
      splitAt = DISCORD_MAX_LENGTH;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}

/**
 * Build multipart content for the current user message.
 * If no images: returns plain string.
 * If images present: returns content-part array (text + image_url parts).
 */
function buildCurrentContent(
  text: string,
  imageUrls: string[],
): string | ChatMessageContentPart[] {
  if (imageUrls.length === 0) return text;

  const parts: ChatMessageContentPart[] = [];
  if (text) {
    parts.push({ type: 'text', text });
  }
  for (const url of imageUrls) {
    parts.push({ type: 'image_url', image_url: { url, detail: 'auto' } });
  }
  return parts;
}

/**
 * Build OpenAI-compatible messages array from session history.
 */
function buildMessages(
  systemPrompt: string | null,
  history: HistoryEntry[],
  currentContent: string | ChatMessageContentPart[],
): ChatMessage[] {
  const messages: ChatMessage[] = [];

  // System prompt
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }

  // Conversation history (text-only — image URLs may have expired)
  for (const entry of history) {
    if (entry.role === 'user') {
      messages.push({ role: 'user', content: entry.prompt });
    } else if (entry.role === 'assistant') {
      messages.push({ role: 'assistant', content: (entry as { role: 'assistant'; content: string }).content });
    }
    // Skip 'bot' entries (from image handler) — they don't apply here
  }

  // Current user message (may include image parts)
  messages.push({ role: 'user', content: currentContent });

  return messages;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export function createTextChatHandler(
  chatClient: ChatClient,
): (message: Message, ctx: FeatureContext) => Promise<void> {
  return async (message, ctx) => {
    const { sessionStore, channelPromptStore, errorReporter, statsStore, config } = ctx;
    const chatModel = config.textChat.model;
    const userId = message.author.id;
    const channelId = message.channelId;
    const rawContent = message.content.trim();

    // Collect image attachments (Discord CDN URLs)
    const imageUrls = [...message.attachments.values()]
      .filter((a) => a.contentType && IMAGE_MIME_RE.test(a.contentType))
      .map((a) => a.url);

    const hasImages = imageUrls.length > 0;

    // Ignore empty messages with no images
    if (!rawContent && !hasImages) return;

    console.log(
      `[TextChat] Processing from user=${userId} channel=${channelId}` +
      ` text=${rawContent.length} images=${imageUrls.length}`,
    );

    // Handle !reset command (case-insensitive, text-only)
    if (!hasImages && rawContent.toLowerCase() === '!reset') {
      sessionStore.delete(userId, channelId);
      await message.reply('✅ Session has been reset.');
      return;
    }

    // Get system prompt for this channel (if any)
    const systemPrompt = channelPromptStore.get(channelId);

    // Load session history
    const session = sessionStore.get(userId, channelId);
    const history: HistoryEntry[] = session ? [...session.history] : [];

    // Build current message content (text + images if any)
    const currentContent = buildCurrentContent(rawContent, imageUrls);

    // Build messages for chat completion
    const messages = buildMessages(systemPrompt, history, currentContent);

    // Show typing indicator
    try {
      if ('sendTyping' in message.channel) {
        await message.channel.sendTyping();
      }
    } catch {
      // Typing indicator is best-effort
    }

    try {
      const result = await chatClient.complete({
        model: chatModel,
        messages,
      });

      const responseText = result.content.trim();

      // Split long responses to fit Discord's message limit
      const chunks = splitMessage(responseText);

      // Reply with first chunk, send rest as follow-ups
      await message.reply(chunks[0]);
      for (let i = 1; i < chunks.length; i++) {
        if ('send' in message.channel) {
          await message.channel.send(chunks[i]);
        }
      }

      // Append to session history (store text-only; image URLs expire so don't persist them)
      const historyPrompt = hasImages
        ? [rawContent, `[${imageUrls.length} ảnh]`].filter(Boolean).join(' ')
        : rawContent;
      history.push({ role: 'user', prompt: historyPrompt });
      history.push({ role: 'assistant', content: responseText } as HistoryEntry);

      sessionStore.upsert(userId, channelId, history);

      // Track usage stats (CLIProxy vs OpenAI fallback)
      statsStore?.increment(result.usedFallback ? 'text_openai' : 'text_cliproxy');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      await message.reply(`❌ Error: ${msg}`);

      // Notify error channel
      await errorReporter?.report(err, {
        source: 'textChatHandler',
        userId,
        channelId,
        prompt: rawContent.slice(0, 200),
        images: String(imageUrls.length),
      });
    }
  };
}
