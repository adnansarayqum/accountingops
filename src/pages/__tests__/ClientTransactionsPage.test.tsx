import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ClientTransactionsPage } from '../ClientTransactionsPage';
import { configureRepository, useAppStore } from '../../application/store';
import { MemoryRepository } from '../../application/persistence/memoryRepository';
import { buildFixtureData } from '../../testing/fixtures';
import { getBankStatements, requestStatementRead, setTransactionCategory } from '../../integrations/bank';
import type { BankStatement, BankTransaction } from '../../domain/rules/bankStatements';

vi.mock('../../integrations/bank', () => ({
  getBankStatements: vi.fn(),
  requestStatementRead: vi.fn(),
  setTransactionCategory: vi.fn(),
}));

const get = vi.mocked(getBankStatements);
const read = vi.mocked(requestStatementRead);
const setCategory = vi.mocked(setTransactionCategory);
const today = '2026-09-11';

const tx = (id: string, date: string, description: string, amount: number, category = 'Other / unsure'): BankTransaction => ({ id, lineNo: 0, date, description, amount, balance: null, category, categorySource: 'ai' });
const statement = (id: string, start: string, end: string, opening: number, closing: number, transactions: BankTransaction[], overrides: Partial<BankStatement> = {}): BankStatement => ({
  id,
  sourceUploadId: `inu_${id}`,
  uploadIds: [`inu_${id}`],
  status: 'extracted',
  error: null,
  bankName: 'Barclays',
  accountName: 'ABC LTD',
  accountLast4: '5678',
  periodStart: start,
  periodEnd: end,
  openingBalance: opening,
  closingBalance: closing,
  droppedLines: 0,
  transactions,
  ...overrides,
});

const JAN = statement('jan', '2026-01-01', '2026-01-31', 100, 1304.4, [tx('t1', '2026-01-05', 'ACME LTD FASTER PAYMENT', 1250, 'Sales / income'), tx('t2', '2026-01-09', 'STAPLES UK', -45.6, 'Office costs')]);
const APR = statement('apr', '2026-04-01', '2026-04-30', 1304.4, 1204.4, [tx('t3', '2026-04-02', 'RENT', -100, 'Rent & rates')]);

function addStatementDocs(...ids: string[]) {
  const data = structuredClone(buildFixtureData(today));
  data.documents.push(
    ...ids.map((id, i) => ({ id: `doc_${id}`, practiceId: data.practice.id, clientId: 'cl_abc', fileName: `${id}-statement.pdf`, documentType: 'Bank statement', receivedAt: `2026-09-0${i + 1}T10:00:00.000Z`, source: 'inbox' as const, sizeKb: 100, intakeUploadIds: [`inu_${id}`] })),
  );
  useAppStore.setState({ data, today, ready: true, currentUserId: 'u_adnan', toasts: [], loadFailed: false });
}

function renderPage(clientId = 'cl_abc') {
  return render(
    <MemoryRouter initialEntries={[`/clients/${clientId}/transactions`]}>
      <Routes>
        <Route path="/clients/:clientId/transactions" element={<ClientTransactionsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ClientTransactionsPage', () => {
  beforeEach(() => {
    configureRepository(new MemoryRepository());
    get.mockReset();
    read.mockReset();
    setCategory.mockReset();
    setCategory.mockResolvedValue(true);
  });
  afterEach(() => cleanup());

  it('says so for a client that does not exist', () => {
    addStatementDocs();
    renderPage('cl_gone');
    expect(screen.getByText('Client not found')).toBeInTheDocument();
  });

  it('says there is nothing yet for a client with no bank statements', async () => {
    addStatementDocs();
    get.mockResolvedValue({ statements: [], canRead: true });
    renderPage();
    expect(await screen.findByText('No bank statements yet')).toBeInTheDocument();
  });

  it('says it needs the signed-in app when there is no server to ask', async () => {
    addStatementDocs('jan');
    get.mockResolvedValue(null);
    renderPage();
    expect(await screen.findByText('Needs the signed-in app')).toBeInTheDocument();
  });

  it('lists each statement with whether it adds up, and shows its transactions with totals', async () => {
    addStatementDocs('jan');
    get.mockResolvedValue({ statements: [JAN], canRead: true });
    renderPage();
    const row = await screen.findByTestId('statement-doc_jan');
    expect(row).toHaveTextContent('jan-statement.pdf');
    expect(row).toHaveTextContent('Barclays ••••5678');
    expect(row).toHaveTextContent('2 transactions');
    expect(within(row).getByText('Adds up')).toBeInTheDocument();

    expect(get).toHaveBeenCalledWith(['inu_jan']);
    expect(screen.getByTestId('tx-t1')).toHaveTextContent('ACME LTD FASTER PAYMENT');
    expect(screen.getByTestId('tx-t1')).toHaveTextContent('£1,250.00');
    expect(screen.getByTestId('tx-t2')).toHaveTextContent('-£45.60');
    expect(screen.getByText(/in £1,250.00 · out £45.60/)).toBeInTheDocument();
    expect(screen.getByTestId('statement-checks')).toHaveTextContent('All clear');
    expect(screen.getByTestId('tx-by-category')).toHaveTextContent('Sales / income');
  });

  it('reports a missing month and a statement that does not add up', async () => {
    addStatementDocs('jan', 'apr');
    get.mockResolvedValue({ statements: [JAN, { ...APR, closingBalance: 5000 }], canRead: true });
    renderPage();
    const checks = await screen.findByTestId('statement-checks');
    expect(checks).toHaveTextContent('Needs a look');
    expect(checks).toHaveTextContent('Missing: nothing covers 1 Feb 2026 – 31 Mar 2026');
    expect(within(await screen.findByTestId('statement-doc_apr')).getByText(/Off by £3,795.60/)).toBeInTheDocument();
    expect(screen.getByTestId('problem-apr')).toHaveTextContent('short of the closing balance');
  });

  it('shows a statement being read, and offers to read one that failed or was never read', async () => {
    addStatementDocs('jan', 'apr', 'new');
    get.mockResolvedValue({ statements: [{ ...JAN, status: 'reading', transactions: [] }, { ...APR, status: 'failed', error: 'That statement is too long to read in one go.', transactions: [] }], canRead: true });
    read.mockResolvedValue({ ok: true, status: 'reading' });
    const user = userEvent.setup();
    renderPage();
    expect(await within(await screen.findByTestId('statement-doc_jan')).findByText(/Reading/)).toBeInTheDocument();
    expect(screen.getByTestId('statement-doc_apr')).toHaveTextContent('too long to read in one go');
    expect(screen.queryByTestId('read-doc_jan')).toBeNull();

    await user.click(screen.getByTestId('read-doc_new'));
    expect(read).toHaveBeenCalledWith(['inu_new']);
    await user.click(screen.getByTestId('read-doc_apr'));
    expect(read).toHaveBeenCalledWith(['inu_apr']);
    expect(get.mock.calls.length).toBeGreaterThan(2); // asked again after each
  });

  it('explains a refused read, and offers nothing when the server cannot read at all', async () => {
    addStatementDocs('new');
    get.mockResolvedValue({ statements: [], canRead: true });
    read.mockResolvedValue({ ok: false, error: 'rate_limited' });
    const user = userEvent.setup();
    const { unmount } = renderPage();
    await user.click(await screen.findByTestId('read-doc_new'));
    await waitFor(() => expect(useAppStore.getState().toasts[0]).toMatchObject({ title: "Couldn't read that statement", tone: 'error' }));
    unmount();

    get.mockResolvedValue({ statements: [], canRead: false });
    renderPage();
    expect(await screen.findByText(/no AI key on the server/)).toBeInTheDocument();
    expect(screen.queryByTestId('read-doc_new')).toBeNull();
  });

  it('filters by search text, category and account', async () => {
    addStatementDocs('jan', 'other');
    const other = statement('other', '2026-01-01', '2026-01-31', 0, 10, [tx('t9', '2026-01-20', 'OTHER ACCOUNT LINE', 10)], { accountLast4: '9999' });
    get.mockResolvedValue({ statements: [JAN, other], canRead: true });
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('tx-list');
    expect(screen.getByTestId('tx-list').children).toHaveLength(3);

    await user.type(screen.getByTestId('tx-search'), 'staples');
    expect(screen.getByTestId('tx-list').children).toHaveLength(1);
    await user.clear(screen.getByTestId('tx-search'));

    await user.selectOptions(screen.getByTestId('tx-category-filter'), 'Sales / income');
    expect(screen.getByTestId('tx-list').children).toHaveLength(1);
    expect(screen.getByTestId('tx-t1')).toBeInTheDocument();
    await user.selectOptions(screen.getByTestId('tx-category-filter'), 'all');

    await user.selectOptions(screen.getByTestId('tx-account-filter'), 'Barclays ••••9999');
    expect(screen.getByTestId('tx-list').children).toHaveLength(1);
    expect(screen.getByTestId('tx-t9')).toBeInTheDocument();

    await user.selectOptions(screen.getByTestId('tx-account-filter'), 'all');
    await user.type(screen.getByTestId('tx-search'), 'zzz');
    expect(screen.getByText('Nothing matches.')).toBeInTheDocument();
  });

  it('changes a category at once, saves it, and puts it back with a message if saving fails', async () => {
    addStatementDocs('jan');
    get.mockResolvedValue({ statements: [JAN], canRead: true });
    const user = userEvent.setup();
    renderPage();
    const select = await screen.findByTestId('tx-category-t2');
    await user.selectOptions(select, 'Travel & motor');
    expect(setCategory).toHaveBeenCalledWith('t2', 'Travel & motor');
    expect(select).toHaveValue('Travel & motor');
    expect(select).toHaveAttribute('title', 'Set by a person');

    setCategory.mockResolvedValue(false);
    await user.selectOptions(select, 'VAT');
    await waitFor(() => expect(useAppStore.getState().toasts.some((t) => t.title === "Couldn't change the category")).toBe(true));
    // Back to what it was — including that a person had chosen it.
    expect(select).toHaveValue('Travel & motor');
    expect(select).toHaveAttribute('title', 'Set by a person');
  });

  it('exports the lines shown in each format, as a download', async () => {
    addStatementDocs('jan');
    get.mockResolvedValue({ statements: [JAN], canRead: true });
    const blobs: Blob[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn((b: Blob) => (blobs.push(b), 'blob:x')), revokeObjectURL: vi.fn() }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('tx-list');

    await user.type(screen.getByTestId('tx-search'), 'staples');
    await user.click(screen.getByTestId('export-xero'));
    expect(click).toHaveBeenCalledTimes(1);
    expect(blobs).toHaveLength(1);
    expect(blobs[0].type).toBe('text/csv;charset=utf-8');
    await user.click(screen.getByTestId('export-quickbooks'));
    expect(blobs).toHaveLength(2);
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({ title: 'Exported', description: '1 transaction as QuickBooks.' });
    click.mockRestore();
    vi.unstubAllGlobals();
  });

  it('shows the first two hundred lines and the rest on request', async () => {
    addStatementDocs('jan');
    const many = statement('jan', '2026-01-01', '2026-01-31', 0, -250, Array.from({ length: 250 }, (_, i) => tx(`m${i}`, '2026-01-15', `Line ${i}`, -1)));
    get.mockResolvedValue({ statements: [many], canRead: true });
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('tx-list');
    expect(screen.getByTestId('tx-list').children).toHaveLength(200);
    await user.click(screen.getByTestId('tx-show-more'));
    expect(screen.getByTestId('tx-list').children).toHaveLength(250);
    expect(screen.queryByTestId('tx-show-more')).toBeNull();
  });
});
