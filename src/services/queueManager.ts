import PQueue from 'p-queue';

export class QueueManager {
  private queues: Map<string, PQueue> = new Map();
  private maxPending: number;

  constructor(maxPending: number) {
    this.maxPending = maxPending;
  }

  private getQueue(channelId: string): PQueue {
    if (!this.queues.has(channelId)) {
      this.queues.set(channelId, new PQueue({ concurrency: 1, timeout: 90_000 }));
    }
    return this.queues.get(channelId)!;
  }

  /**
   * Enqueue a task for a channel.
   * Returns false if the channel's pending queue is full (>= maxPending).
   * `size` = tasks waiting to run (does NOT include the currently running task).
   */
  enqueue(channelId: string, task: () => Promise<void>): boolean {
    const queue = this.getQueue(channelId);

    // queue.size = waiting (not yet started); queue.pending = currently running (0 or 1)
    if (queue.size >= this.maxPending) return false;

    queue.add(task).catch(() => {
      // Errors are handled inside the task itself; swallow here to prevent
      // unhandled rejection from leaking out of p-queue
    });

    return true;
  }

  getPendingCount(channelId: string): number {
    const queue = this.queues.get(channelId);
    if (!queue) return 0;
    return queue.size; // waiting tasks (excludes currently running)
  }
}
