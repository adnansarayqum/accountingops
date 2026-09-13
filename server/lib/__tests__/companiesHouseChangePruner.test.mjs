import { describe, expect, it, vi } from 'vitest';
import { CompaniesHouseChangePruner } from '../companiesHouseChangePruner.mjs';

/** A fake timer harness: start() runs a tick immediately, then fire() advances one interval at a time. */
function harness(prune, options = {}) {
  let scheduled = null;
  const pruner = new CompaniesHouseChangePruner({
    prune,
    setInterval: (fn, ms) => {
      scheduled = fn;
      return { ms };
    },
    clearInterval: () => {
      scheduled = null;
    },
    ...options,
  });
  return { pruner, fire: () => scheduled?.() };
}

describe('CompaniesHouseChangePruner', () => {
  it('prunes once immediately on start, not only on the first interval', async () => {
    const prune = vi.fn(async () => 3);
    const { pruner } = harness(prune);
    pruner.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(prune).toHaveBeenCalledTimes(1);
    expect(pruner.stats.deleted).toBe(3);
  });

  it('runs again on every subsequent interval, not just once at boot', async () => {
    const prune = vi.fn(async () => 0);
    const { pruner, fire } = harness(prune);
    pruner.start();
    await Promise.resolve();
    await fire();
    await fire();
    expect(prune).toHaveBeenCalledTimes(3);
    expect(pruner.stats.ticks).toBe(3);
  });

  it('passes its retention window through to the prune function', async () => {
    const prune = vi.fn(async () => 0);
    const { pruner } = harness(prune, { olderThanDays: 45 });
    pruner.start();
    await Promise.resolve();
    expect(prune).toHaveBeenCalledWith(45);
  });

  it('logs the failure and keeps the timer running rather than taking the process down with it', async () => {
    const prune = vi.fn(async () => {
      throw new Error('db down');
    });
    const { pruner, fire } = harness(prune);
    pruner.start();
    await Promise.resolve();
    await fire();
    expect(pruner.stats.failed).toBe(2);
    expect(pruner.stats.ticks).toBe(2);
  });

  it('does not double-schedule when started twice', () => {
    const prune = vi.fn(async () => 0);
    const { pruner } = harness(prune);
    pruner.start();
    pruner.start();
    expect(prune).toHaveBeenCalledTimes(1);
  });

  it('stops cleanly, leaving no timer behind', async () => {
    const prune = vi.fn(async () => 0);
    const { pruner, fire } = harness(prune);
    pruner.start();
    await Promise.resolve();
    pruner.stop();
    // A stopped pruner has no scheduled callback to fire.
    expect(await fire()).toBeUndefined();
  });
});
