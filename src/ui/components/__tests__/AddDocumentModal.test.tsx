import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AddDocumentModal, MAX_PAGES } from '../AddDocumentModal';
import { takePendingShare } from '../../../application/pendingShare';

const onClose = vi.fn();

function Where() {
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname}${location.search}`}</p>;
}

function renderModal(open = true) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <AddDocumentModal open={open} onClose={onClose} />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

const photo = (name = 'page.jpg') => new File([new Uint8Array([0xff, 0xd8, 0xff])], name, { type: 'image/jpeg' });

describe('AddDocumentModal', () => {
  beforeEach(() => {
    onClose.mockReset();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() }));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders nothing while closed, and nothing can be sent until something is added', async () => {
    const { unmount } = renderModal(false);
    expect(screen.queryByTestId('add-document')).toBeNull();
    unmount();
    renderModal();
    expect(screen.getByTestId('add-document-send')).toBeDisabled();
    expect(screen.getByTestId('add-document-camera-input')).toHaveAttribute('capture', 'environment');
    expect(screen.getByTestId('add-document-camera-input')).toHaveAttribute('accept', 'image/*');
  });

  it('collects photographed pages in order, lets one be removed, and offers the next page', async () => {
    const user = userEvent.setup();
    renderModal();
    expect(screen.getByTestId('add-document-camera')).toHaveTextContent('Take a photo');
    await user.upload(screen.getByTestId('add-document-camera-input'), photo('one.jpg'));
    await user.upload(screen.getByTestId('add-document-camera-input'), photo('two.jpg'));
    await user.upload(screen.getByTestId('add-document-file-input'), [photo('three.jpg'), new File(['%PDF-1.7'], 'statement.pdf', { type: 'application/pdf' })]);
    expect(screen.getByTestId('add-document-pages').children).toHaveLength(4);
    expect(screen.getByTestId('add-document-camera')).toHaveTextContent('Photograph the next page');
    expect(screen.getByTestId('add-document-send')).toHaveTextContent('Send 4 pages');

    await user.click(screen.getByRole('button', { name: 'Remove page 2' }));
    expect(screen.getByTestId('add-document-pages').children).toHaveLength(3);
    expect(screen.getByTestId('add-document-send')).toHaveTextContent('Send 3 pages');
  });

  it('names what the app cannot read instead of adding it', async () => {
    // The picker's own filter would stop an .xlsx being chosen; some phones' pickers ignore it.
    const user = userEvent.setup({ applyAccept: false });
    renderModal();
    await user.upload(screen.getByTestId('add-document-file-input'), [photo('ok.jpg'), new File(['x'], 'sheet.xlsx', { type: 'application/vnd.ms-excel' })]);
    expect(screen.getByTestId('add-document-pages').children).toHaveLength(1);
    expect(screen.getByTestId('add-document-problem')).toHaveTextContent('sheet.xlsx');
  });

  it('stops at ten pages and says so', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.upload(screen.getByTestId('add-document-file-input'), Array.from({ length: MAX_PAGES + 2 }, (_, i) => photo(`p${i}.jpg`)));
    expect(screen.getByTestId('add-document-pages').children).toHaveLength(MAX_PAGES);
    expect(screen.getByTestId('add-document-problem')).toHaveTextContent('only the first 10 were added');
    expect(screen.getByTestId('add-document-camera')).toBeDisabled();
    expect(screen.getByTestId('add-document-files')).toBeDisabled();
  });

  it('hands the pages and any message to the share page, and closes', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.upload(screen.getByTestId('add-document-camera-input'), photo('letter.jpg'));
    await user.type(screen.getByTestId('add-document-text'), 'This came with it');
    await user.click(screen.getByTestId('add-document-send'));

    expect(onClose).toHaveBeenCalled();
    const where = screen.getByTestId('where').textContent ?? '';
    expect(where).toMatch(/^\/share\?id=app_/);
    const share = takePendingShare(where.split('id=')[1]);
    expect(share?.files.map((f) => f.name)).toEqual(['letter.jpg']);
    expect(share?.text).toBe('This came with it');
  });

  it('can send just a pasted message', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByTestId('add-document-text'), 'new address: 1 High St');
    expect(screen.getByTestId('add-document-send')).toBeEnabled();
    await user.click(screen.getByTestId('add-document-send'));
    expect(takePendingShare((screen.getByTestId('where').textContent ?? '').split('id=')[1])).toEqual({ files: [], text: 'new address: 1 High St' });
  });

  it('starts empty every time it is opened', async () => {
    const user = userEvent.setup();
    const view = renderModal();
    await user.upload(screen.getByTestId('add-document-camera-input'), photo());
    view.rerender(
      <MemoryRouter>
        <AddDocumentModal open={false} onClose={onClose} />
      </MemoryRouter>,
    );
    view.rerender(
      <MemoryRouter>
        <AddDocumentModal open onClose={onClose} />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId('add-document-pages')).toBeNull();
  });
});
