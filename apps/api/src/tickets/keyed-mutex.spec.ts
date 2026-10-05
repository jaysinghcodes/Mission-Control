import { KeyedMutex } from './keyed-mutex';

/** Resolve after `ms` — used to make the FIRST job deliberately slow. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * KeyedMutex unit tests — the ordering guarantee behind QA finding B.
 * The scenario QA hit: an earlier request that happens to be slower must NOT
 * be able to commit after a later one for the same ticket.
 */
describe('KeyedMutex', () => {
  it('runs jobs for the same key strictly in call order, even if the first is slower', async () => {
    const mutex = new KeyedMutex();
    const log: string[] = [];
    const a = mutex.run('t1', async () => {
      await sleep(30); // slow first writer (the old race winner-by-accident)
      log.push('a');
    });
    const b = mutex.run('t1', async () => {
      log.push('b');
    });
    await Promise.all([a, b]);
    expect(log).toEqual(['a', 'b']);
  });

  it('does not serialize different keys against each other', async () => {
    const mutex = new KeyedMutex();
    const log: string[] = [];
    const slow = mutex.run('t1', async () => {
      await sleep(30);
      log.push('t1');
    });
    const fast = mutex.run('t2', async () => {
      log.push('t2');
    });
    await Promise.all([slow, fast]);
    expect(log).toEqual(['t2', 't1']);
  });

  it('a failing job rejects only its own caller and does not block the queue', async () => {
    const mutex = new KeyedMutex();
    const failed = mutex.run('t1', async () => {
      throw new Error('boom');
    });
    const next = mutex.run('t1', async () => 'ok');
    await expect(failed).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
  });

  it('cleans up keys once their queue drains', async () => {
    const mutex = new KeyedMutex();
    await Promise.all([
      mutex.run('t1', async () => 1),
      mutex.run('t1', async () => 2),
    ]);
    expect(mutex.activeKeys).toBe(0);
  });
});
