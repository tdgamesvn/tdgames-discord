import { Message } from 'discord.js';
import { handleImageMessage } from './handlers/imageHandler';
import type { ImageHandlerDeps } from './handlers/imageHandler';
import type { QueueManager } from './services/queueManager';
import type { ErrorReporter } from './services/errorReporter';

export interface BotDeps extends ImageHandlerDeps {
  allowedChannelIds: Set<string>;
  queueManager: QueueManager;
  errorReporter?: ErrorReporter;
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

    // Enqueue the work; returns false when the channel queue is full
    const enqueued = deps.queueManager.enqueue(
      message.channelId,
      () => handleImageMessage(message, deps)
    );

    if (!enqueued) {
      await message.reply(
        '⏳ Channel is busy — please wait a moment and try again.'
      );
    }
  };
}
