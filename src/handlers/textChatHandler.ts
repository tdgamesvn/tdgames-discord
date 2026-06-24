import { Message } from 'discord.js';
import type { ChatClient, ChatMessage } from '../services/chatClient';
import type { SessionStore, HistoryEntry } from '../services/sessionStore';
import type { ChannelPromptStore } from '../services/channelPromptStore';
import type { ErrorReporter } from '../services/errorReporter';

export interface TextChatHandlerDeps {
  chatClient: ChatClient;
  sessionStore: SessionStore;
  channelPromptStore: ChannelPromptStore;
  chatModel: string;
  errorReporter?: ErrorReporter;
}

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
 * Build OpenAI-compatible messages array from session history.
 */
function buildMessages(
  systemPrompt: string | null,
  history: HistoryEntry[],
  currentPrompt: string,
): ChatMessage[] {
  const messages: ChatMessage[] = [];

  // System prompt
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }

  // Conversation history
  for (const entry of history) {
    if (entry.role === 'user') {
      messages.push({ role: 'user', content: entry.prompt });
    } else if (entry.role === 'assistant') {
      messages.push({ role: 'assistant', content: (entry as { role: 'assistant'; content: string }).content });
    }
    // Skip 'bot' entries (from image handler) — they don't apply here
  }

  // Current user message
  messages.push({ role: 'user', content: currentPrompt });

  return messages;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function handleTextChat(
  message: Message,
  deps: TextChatHandlerDeps,
): Promise<void> {
  const { chatClient, sessionStore, channelPromptStore, chatModel, errorReporter } = deps;
  const userId = message.author.id;
  const channelId = message.channelId;
  const rawContent = message.content.trim();

  // Ignore empty messages
  if (!rawContent) return;

  // Handle !reset command (case-insensitive)
  if (rawContent.toLowerCase() === '!reset') {
    sessionStore.delete(userId, channelId);
    await message.reply('✅ Session has been reset.');
    return;
  }

  // Get system prompt for this channel (if any)
  const systemPrompt = channelPromptStore.get(channelId);

  // Load session history
  const session = sessionStore.get(userId, channelId);
  const history: HistoryEntry[] = session ? [...session.history] : [];

  // Build messages for chat completion
  const messages = buildMessages(systemPrompt, history, rawContent);

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

    // Append to session history
    history.push({ role: 'user', prompt: rawContent });
    history.push({ role: 'assistant', content: responseText } as HistoryEntry);

    sessionStore.upsert(userId, channelId, history);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    await message.reply(`❌ Error: ${msg}`);

    // Notify error channel
    await errorReporter?.report(err, {
      source: 'textChatHandler',
      userId,
      channelId,
      prompt: rawContent.slice(0, 200),
    });
  }
}
