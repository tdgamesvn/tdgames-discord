import { Message } from 'discord.js';
import { handleImageMessage } from './handlers/imageHandler';
import { handleTextChat } from './handlers/textChatHandler';
import type { ImageHandlerDeps } from './handlers/imageHandler';
import type { TextChatHandlerDeps } from './handlers/textChatHandler';
import type { QueueManager } from './services/queueManager';
import type { ErrorReporter } from './services/errorReporter';

export interface BotDeps extends ImageHandlerDeps, TextChatHandlerDeps {
  allowedChannelIds: Set<string>;
  textChannelIds: Set<string>;
  queueManager: QueueManager;
  errorReporter?: ErrorReporter;
}

// ─── Message-ID deduplication ────────────────────────────────────────────────
// Defense-in-depth against Discord delivering the same gateway event twice
// (can happen on reconnects or during a brief multi-instance overlap).
// Keeps the last MAX_SEEN_IDS message IDs in memory; evicts oldest on overflow.

const MAX_SEEN_IDS = 500;
const seenMessageIds = new Set<string>();

function isDuplicate(messageId: string): boolean {
  if (seenMessageIds.has(messageId)) return true;
  seenMessageIds.add(messageId);
  if (seenMessageIds.size > MAX_SEEN_IDS) {
    // Evict the oldest entry (insertion-order iteration)
    const [oldest] = seenMessageIds;
    seenMessageIds.delete(oldest);
  }
  return false;
}

/**
 * Creates the Discord messageCreate handler.
 * Extracted as a pure function so it can be unit-tested without a real Discord client.
 */
export function createMessageHandler(deps: BotDeps) {
  return async (message: Message): Promise<void> => {
    // Ignore messages from bots (including ourselves)
    if (message.author.bot) return;

    // Channel guard — only respond in explicitly allowed channels
    if (!deps.allowedChannelIds.has(message.channelId)) return;

    // Deduplication guard — skip if this message ID was already seen
    if (isDuplicate(message.id)) {
      console.warn(`[dedup] Skipping duplicate message ${message.id}`);
      return;
    }

    // Route to appropriate handler based on channel type
    const isTextChannel = deps.textChannelIds.has(message.channelId);
    const handler = isTextChannel
      ? () => handleTextChat(message, deps)
      : () => handleImageMessage(message, deps);

    // Enqueue the work; returns false when the channel queue is full
    const enqueued = deps.queueManager.enqueue(
      message.channelId,
      handler,
    );

    if (!enqueued) {
      await message.reply(
        '⏳ Channel is busy — please wait a moment and try again.'
      );
    }
  };
}
