import type { Message } from 'discord.js';
import type { FeatureRouter } from './core/router';
import type { QueueManager } from './core/queue';
import type { FeatureContext } from './core/types';

const MAX_SEEN_IDS = 500;
const seenMessageIds = new Set<string>();

function isDuplicate(id: string): boolean {
  if (seenMessageIds.has(id)) return true;
  seenMessageIds.add(id);
  if (seenMessageIds.size > MAX_SEEN_IDS) {
    const [oldest] = seenMessageIds;
    seenMessageIds.delete(oldest);
  }
  return false;
}

export function createMessageHandler(
  router: FeatureRouter,
  queueManager: QueueManager,
  ctx: FeatureContext,
) {
  return async (message: Message): Promise<void> => {
    if (message.author.bot) return;
    if (isDuplicate(message.id)) return;

    const feature = router.resolve(message.channelId);
    if (!feature) return;

    const enqueued = queueManager.enqueue(
      message.channelId,
      () => feature.handler(message, ctx),
    );

    if (!enqueued) {
      await message.reply('⏳ Channel đang bận, vui lòng thử lại sau ít phút.');
    }
  };
}
