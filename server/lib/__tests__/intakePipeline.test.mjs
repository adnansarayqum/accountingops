import { describe, expect, it, vi } from 'vitest';
import { processBatch } from '../intakePipeline.mjs';

const snapshot = {
  clients: [
    { id: 'cl_acme', name: 'Acme Ltd' },
    { id: 'cl_khan', name: 'Khan Consulting' },
  ],
  identifiers: [{ id: 'i1', clientId: 'cl_acme', kind: 'company_number', value: '08654123', sensitive: false }],
};

const parts = [
  { fileName: 'p1.jpg', contentType: 'image/jpeg', bytes: Buffer.alloc(1024, 1) },
  { fileName: 'p2.jpg', contentType: 'image/jpeg', bytes: Buffer.alloc(2048, 2) },
  { fileName: 'Shared text.txt', contentType: 'text/plain', bytes: Buffer.from('hello') },
];

const read = (partIndexes, overrides = {}) => ({
  parts: partIndexes,
  documentType: 'Bank statement',
  reference: null,
  letterDate: null,
  period: 'Jan 2026',
  identifiers: { companyNumber: null, utr: null, vatNumber: null, payeReference: null },
  clientId: null,
  confidence: 0,
  rationale: 'From the name.',
  summary: 'A statement',
  ...overrides,
});

function deps(overrides = {}) {
  const queued = [];
  return {
    queued,
    deps: {
      findDuplicateBatch: vi.fn(async () => null),
      saveBatch: vi.fn(async ({ parts: p }) => p.map((_, i) => `inu_${i}`)),
      queueDocument: vi.fn(async (row) => {
        queued.push(row);
        return `ina_${queued.length}`;
      }),
      readBatch: vi.fn(async () => [
        read([0, 1], { identifiers: { companyNumber: '8654123', utr: '12345 67890' }, facts: { deadline: '2027-01-31', service: 'corporation_tax', penaltyAmount: null } }),
        read([2], { documentType: 'Message from the client', clientId: 'cl_khan', confidence: 0.5, facts: { deadline: 'soon', clientDetails: { email: 'nope' } } }),
      ]),
      readPracticeSnapshot: vi.fn(async () => snapshot),
      env: { ANTHROPIC_API_KEY: 'sk-test' },
      ...overrides,
    },
  };
}

describe('processBatch', () => {
  it('stores every part, then files each document it found — confident ones filed, the rest with their best guess', async () => {
    const { deps: d, queued } = deps();
    const result = await processBatch({ parts, userId: 'u_ray', source: 'share', holdMinutes: 10 }, d);

    expect(d.saveBatch).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u_ray', source: 'share', parts }));
    expect(d.saveBatch.mock.invocationCallOrder[0]).toBeLessThan(d.readBatch.mock.invocationCallOrder[0]);
    expect(result.read).toBe(true);
    expect(result.documents).toHaveLength(2);

    expect(result.documents[0]).toMatchObject({ filed: true, clientId: 'cl_acme', clientName: 'Acme Ltd', uploadIds: ['inu_0', 'inu_1'], fileName: 'p1.jpg (+1 more page)', summary: 'A statement', candidates: [] });
    expect(queued[0]).toMatchObject({ batchId: result.batchId, uploadIds: ['inu_0', 'inu_1'], filed: true, holdMinutes: 10, sizeBytes: 3072, suggestion: { clientId: 'cl_acme', documentType: 'Bank statement', summary: 'A statement' } });

    expect(result.documents[1]).toMatchObject({ filed: false, clientId: 'cl_khan', candidates: [{ id: 'cl_khan', name: 'Khan Consulting' }], documentType: 'Message from the client' });
    expect(queued[1]).toMatchObject({ filed: false, uploadIds: ['inu_2'] });
  });

  it('queues each document’s facts sanitised, and none when nothing usable was said', async () => {
    const { deps: d, queued } = deps();
    await processBatch({ parts, userId: 'u_ray', source: 'share' }, d);
    expect(queued[0].facts).toMatchObject({ deadline: '2027-01-31', service: 'corporation_tax', utr: '1234567890', penaltyAmount: null });
    expect(queued[1].facts).toBeNull();
  });

  it('refuses a share it has already had, before storing or reading anything', async () => {
    const { deps: d } = deps({ findDuplicateBatch: vi.fn(async () => 'inb_earlier') });
    expect(await processBatch({ parts, userId: 'u_ray', source: 'share' }, d)).toEqual({ duplicate: true });
    expect(d.saveBatch).not.toHaveBeenCalled();
    expect(d.readBatch).not.toHaveBeenCalled();
  });

  it('without an API key, stores and queues every part unread, without calling the model', async () => {
    const { deps: d, queued } = deps({ env: {} });
    const result = await processBatch({ parts, userId: 'u_ray', source: 'share' }, d);
    expect(d.readBatch).not.toHaveBeenCalled();
    expect(result.read).toBe(false);
    expect(queued.map((q) => q.uploadIds)).toEqual([['inu_0'], ['inu_1'], ['inu_2']]);
    expect(queued.every((q) => q.filed === false && q.suggestion.clientId === null && q.facts === null)).toBe(true);
  });

  it('when the read fails, still queues every part unread', async () => {
    const { deps: d, queued } = deps({ readBatch: vi.fn(async () => null) });
    const result = await processBatch({ parts, userId: 'u_ray', source: 'share' }, d);
    expect(result.read).toBe(false);
    expect(queued).toHaveLength(3);
    expect(queued[0].suggestion).toMatchObject({ documentType: 'Other', confidence: 0 });
  });
});
