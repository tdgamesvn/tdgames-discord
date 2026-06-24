/**
 * @deprecated This file is a compatibility shim. The implementation has moved to
 * src/features/image-gen/handler.ts. This shim will be removed in Task 8 when
 * bot.ts is replaced by the Feature Registry entrypoint.
 */
import type { Message } from 'discord.js';
import type { ImageClient } from '../features/image-gen/client';
import type { SessionStore } from '../shared/sessionStore';
import type { ChannelPromptStore } from '../shared/channelPromptStore';
import type { ErrorReporter } from '../shared/errorReporter';
import type { StatsStore } from '../shared/statsStore';

export interface ImageHandlerDeps {
  imageClient: ImageClient;
  sessionStore: SessionStore;
  channelPromptStore: ChannelPromptStore;
  imageModel: string;
  imageSize: string;
  errorReporter?: ErrorReporter;
  statsStore?: StatsStore;
}

// This function is mocked in tests and will be removed in Task 8.
// It should not be called in production — use createImageGenFeature instead.
export async function handleImageMessage(
  _message: Message,
  _deps: ImageHandlerDeps,
): Promise<void> {
  throw new Error('handleImageMessage is deprecated — use createImageGenFeature instead');
}
