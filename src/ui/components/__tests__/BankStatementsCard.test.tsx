import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BankStatementsCard } from '../BankStatementsCard';
import { configureRepository, useAppStore } from '../../../application/store';
import { MemoryRepository } from '../../../application/persistence/memoryRepository';
import { buildFixtureData } from '../../../testing/fixtures';
import { getBankStatements } from '../../../integrations/bank';
import type { BankStatement } from '../../../domain/rules/bankStatements';

vi.mock('../../../integrations/bank', () => ({ getBankStatements: vi.fn() }));

const get = vi.mocked(getBankStatements);
const today = '2026-09-11';
const statement = (id: string, status: BankStatement['status'], start: string, end: string): BankStatement => ({
  id,
  sourceUploadId: `inu_${id}`,
  uploadIds: [`inu_${id}`],
  status,
  error: null,
  bankName: 'Barclays',
  accountName: null,
  accountLast4: '5678',
  periodStart: start,
  periodEnd: end,
  openingBalance: 0,
  closingBalance: 10,
  droppedLines: 0,
  transactions: status === 'extracted' ? [{ id: `t_${id}`, lineNo: 0, date: start, description: 'x', amount: 10, balance: null, category: 'VAT', categorySource: 'ai' }] : [],
});

function setUp(authMode: 'local' | 'server', docIds: string[]) {
  const data = structuredClone(buildFixtureData(today));
  data.documents.push(...docIds.map((id) => ({ id: `doc_${id}`, practiceId: data.practice.id, clientId: 'cl_abc', fileName: `${id}.pdf`, documentType: 'Bank statement', receivedAt: '2026-09-01T10:00:00.000Z', source: 'inbox' as const, sizeKb: 1, intakeUploadIds: [`inu_${id}`] })));
  useAppStore.setState({ data, today, ready: true, currentUserId: 'u_adnan', authMode, toasts: [], loadFailed: false });
}

const renderCard = () =>
  render(
    <MemoryRouter>
      <BankStatementsCard clientId="cl_abc" />
    </MemoryRouter>,
  );

describe('BankStatementsCard', () => {
  beforeEach(() => {
    configureRepository(new MemoryRepository());
    get.mockReset();
  });
  afterEach(() => {
    cleanup();
    useAppStore.setState({ authMode: 'local' });
  });

  it('renders nothing in the browser-only mode, or for a client with no bank statement', async () => {
    setUp('local', ['jan']);
    get.mockResolvedValue({ statements: [], canRead: true });
    const { container, unmount } = renderCard();
    expect(container).toBeEmptyDOMElement();
    unmount();
    setUp('server', []);
    const second = renderCard();
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(second.container).toBeEmptyDOMElement();
  });

  it('counts what was received, read and found, says whether it checks out, and links to the transactions', async () => {
    setUp('server', ['jan', 'feb', 'mar']);
    get.mockResolvedValue({ statements: [statement('jan', 'extracted', '2026-01-01', '2026-01-31'), statement('feb', 'extracted', '2026-02-01', '2026-02-28'), statement('mar', 'reading', '2026-03-01', '2026-03-31')], canRead: true });
    renderCard();
    const card = await screen.findByTestId('bank-statements-card');
    expect(card).toHaveTextContent('3 statements received · 2 read · 1 reading · 2 transactions');
    // Each month opens at 0 and closes at 10, so Feb opens at a different balance than Jan closed at.
    expect(card).toHaveTextContent('Needs a look');
    expect(screen.getByTestId('bank-transactions-open').closest('a')).toHaveAttribute('href', '/clients/cl_abc/transactions');
  });
});
