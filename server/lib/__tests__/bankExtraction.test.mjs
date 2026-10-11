import { describe, expect, it, vi } from 'vitest';
import { enqueueRead, MAX_QUEUED_READS, readStatementsIn, runRead, settled, startRead } from '../bankExtraction.mjs';

const ok = { ok: true, statement: { bankName: 'Barclays' }, transactions: [{ lineNo: 0 }], dropped: 0 };

function deps(overrides = {}) {
  return {
    claimStatement: vi.fn(async () => ({ id: 'bst_1', claimed: true })),
    failStatement: vi.fn(async () => {}),
    saveStatement: vi.fn(async () => {}),
    readUpload: vi.fn(async (id) => ({ fileName: `${id}.jpg`, contentType: 'image/jpeg', content: Buffer.from(id) })),
    extractStatement: vi.fn(async () => ok),
    env: { ANTHROPIC_API_KEY: 'sk-test' },
    ...overrides,
  };
}

describe('runRead', () => {
  it('loads every page in order, reads them together, and stores the result', async () => {
    const d = deps();
    expect(await runRead('bst_1', ['inu_a', 'inu_b'], d)).toEqual({ status: 'extracted' });
    const parts = d.extractStatement.mock.calls[0][0].parts;
    expect(parts.map((p) => [p.fileName, p.mediaType])).toEqual([['inu_a.jpg', 'image/jpeg'], ['inu_b.jpg', 'image/jpeg']]);
    expect(d.saveStatement).toHaveBeenCalledWith('bst_1', ok, 'claude-sonnet-5-5');
    expect(d.failStatement).not.toHaveBeenCalled();
  });

  it('ends the claim as failed — with the reason — when a page is missing, the read fails, or anything throws', async () => {
    const missing = deps({ readUpload: vi.fn(async () => null) });
    expect(await runRead('bst_1', ['inu_a'], missing)).toEqual({ status: 'failed' });
    expect(missing.failStatement).toHaveBeenCalledWith('bst_1', 'A page of that document is missing.');
    expect(missing.extractStatement).not.toHaveBeenCalled();

    const unread = deps({ extractStatement: vi.fn(async () => ({ ok: false, error: 'too_long', message: 'Too long.' })) });
    expect(await runRead('bst_1', ['inu_a'], unread)).toEqual({ status: 'failed' });
    expect(unread.failStatement).toHaveBeenCalledWith('bst_1', 'Too long.');
    expect(unread.saveStatement).not.toHaveBeenCalled();

    vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = deps({ saveStatement: vi.fn(async () => Promise.reject(new Error('db down'))) });
    expect(await runRead('bst_1', ['inu_a'], broken)).toEqual({ status: 'failed' });
    expect(broken.failStatement).toHaveBeenCalledWith('bst_1', 'The statement could not be read.');
  });
});

describe('startRead', () => {
  it('claims the document first, answers "reading" at once, and reads it from the queue', async () => {
    const d = deps();
    expect(await startRead(['inu_a'], d)).toEqual({ id: 'bst_1', status: 'reading' });
    expect(d.claimStatement).toHaveBeenCalledWith(['inu_a']);
    await settled();
    expect(d.saveStatement).toHaveBeenCalledTimes(1);
  });

  it('does nothing without an API key, and reads nothing twice', async () => {
    const none = deps({ env: {} });
    expect(await startRead(['inu_a'], none)).toEqual({ status: 'not_configured' });
    expect(none.claimStatement).not.toHaveBeenCalled();

    const done = deps({ claimStatement: vi.fn(async () => ({ id: 'bst_9', claimed: false, status: 'extracted' })) });
    expect(await startRead(['inu_a'], done)).toEqual({ id: 'bst_9', status: 'extracted' });
    await settled();
    expect(done.extractStatement).not.toHaveBeenCalled();
  });

  it('reads one statement at a time, in the order asked', async () => {
    const order = [];
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const d = deps({
      extractStatement: vi.fn(async ({ parts }) => {
        order.push(`start ${parts[0].fileName}`);
        await gate;
        order.push(`end ${parts[0].fileName}`);
        return ok;
      }),
    });
    await startRead(['inu_a'], d);
    await startRead(['inu_b'], d);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(order).toEqual(['start inu_a.jpg']);
    release();
    await settled();
    expect(order).toEqual(['start inu_a.jpg', 'end inu_a.jpg', 'start inu_b.jpg', 'end inu_b.jpg']);
  });

  it('declines, and says so on the claim, once too many are waiting', async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    for (let i = 0; i < MAX_QUEUED_READS; i += 1) expect(enqueueRead(() => gate)).toBe(true);
    const d = deps();
    expect(await startRead(['inu_late'], d)).toEqual({ id: 'bst_1', status: 'busy' });
    expect(d.failStatement).toHaveBeenCalledWith('bst_1', expect.stringContaining('Too many'));
    release();
    await settled();
  });
});

describe('readStatementsIn', () => {
  const doc = (documentType, uploadIds) => ({ documentType, uploadIds });

  it('starts a read for each bank statement a share was found to hold, and nothing else', async () => {
    const d = deps({ claimStatement: vi.fn(async (ids) => ({ id: `bst_${ids[0]}`, claimed: true })) });
    await readStatementsIn({ read: true, documents: [doc('Bank statement', ['inu_1', 'inu_2']), doc('VAT notice', ['inu_3']), doc('Bank statement', ['inu_4']), doc('Bank statement', [])] }, d);
    expect(d.claimStatement.mock.calls.map((c) => c[0])).toEqual([['inu_1', 'inu_2'], ['inu_4']]);
    await settled();
  });

  it('does nothing for a share nothing could read, and never lets a failure escape', async () => {
    const d = deps();
    await readStatementsIn({ read: false, documents: [doc('Bank statement', ['inu_1'])] }, d);
    await readStatementsIn(undefined, d);
    expect(d.claimStatement).not.toHaveBeenCalled();

    vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = deps({ claimStatement: vi.fn(async () => Promise.reject(new Error('db down'))) });
    await expect(readStatementsIn({ read: true, documents: [doc('Bank statement', ['inu_1'])] }, broken)).resolves.toBeUndefined();
  });
});
