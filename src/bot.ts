import type { Message } from 'discord.js';
import type { FeatureRouter } from './core/router';
import type { QueueManager } from './core/queue';
import type { FeatureContext } from './core/types';

const MAX_SEEN_IDS = 500;
const seenMessageIds = new Set<string>();

/**
 * Fast in-process dedup — prevents the same event from being handled twice
 * within one process (e.g. discord.js internal re-fire on reconnect).
 */
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
  // Prepared once — used for cross-process atomic claim
  const claimMessage = ctx.db.prepare(
    'INSERT OR IGNORE INTO processed_messages (message_id, processed_at) VALUES (?, ?)',
  );

  return async (message: Message): Promise<void> => {
    if (message.author.bot) return;

    // Layer 1: in-process fast-path (no DB hit for obvious intra-process duplicates)
    if (isDuplicate(message.id)) return;

    // Layer 2: cross-process dedup via SQLite atomic INSERT.
    // If another bot instance already claimed this message_id, changes === 0 → skip.
    const claim = claimMessage.run(message.id, Date.now());
    if (claim.changes === 0) return;

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
