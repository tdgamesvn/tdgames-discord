import { describe, it, expect } from 'vitest';
import { QueueManager } from '../src/core/queue';

describe('QueueManager', () => {
  it('accepts a task when queue is empty', () => {
    const qm = new QueueManager(5);
    let ran = false;
    const accepted = qm.enqueue('ch1', async () => { ran = true; });
    expect(accepted).toBe(true);
  });

  it('rejects a task when pending >= maxPending', async () => {
    const qm = new QueueManager(2);

    // Fill queue: 1 running + 2 pending = full
    // Since concurrency=1, first task runs immediately (pending=0),
    // 2nd queues (size=1), 3rd queues (size=2) → 4th should be rejected
    const noop = () => new Promise<void>((resolve) => setTimeout(resolve, 100));
    qm.enqueue('ch1', noop); // runs immediately
    qm.enqueue('ch1', noop); // size=1
    qm.enqueue('ch1', noop); // size=2 (= maxPending)
    const accepted = qm.enqueue('ch1', noop); // size would be 3 > maxPending → reject
    expect(accepted).toBe(false);
  });

  it('different channels have independent queues', () => {
    const qm = new QueueManager(1);
    const noop = () => new Promise<void>((resolve) => setTimeout(resolve, 100));
    qm.enqueue('ch1', noop); // ch1 running
    qm.enqueue('ch1', noop); // ch1 size=1 (full)
    const ch1Rejected = qm.enqueue('ch1', noop); // ch1 full → reject

    // ch2 is independent — should accept
    const ch2Accepted = qm.enqueue('ch2', noop);

    expect(ch1Rejected).toBe(false);
    expect(ch2Accepted).toBe(true);
  });

  it('getPendingCount returns 0 for unknown channel', () => {
    const qm = new QueueManager(5);
    expect(qm.getPendingCount('unknown')).toBe(0);
  });
});
