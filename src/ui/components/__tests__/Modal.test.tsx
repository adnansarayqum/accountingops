import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from '../Modal';

function Harness({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <>
      <button type="button">Open dialog</button>
      <Modal open={open} onClose={onClose} title="Send reminder">
        <input aria-label="To" />
        <button type="button">Send</button>
      </Modal>
    </>
  );
}

describe('Modal', () => {
  it('moves focus in on open, keeps Tab inside, and closes on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness open onClose={onClose} />);

    expect(screen.getByLabelText('To')).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Send' })).toHaveFocus();
    // Off the end wraps to the first focusable inside the dialog (its close button), never out to the page.
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Send' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Open dialog' })).not.toHaveFocus();

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('hands focus back to where it came from when it closes', () => {
    const { rerender } = render(<Harness open={false} onClose={() => {}} />);
    const trigger = screen.getByRole('button', { name: 'Open dialog' });
    trigger.focus();
    rerender(<Harness open onClose={() => {}} />);
    expect(screen.getByLabelText('To')).toHaveFocus();
    rerender(<Harness open={false} onClose={() => {}} />);
    expect(trigger).toHaveFocus();
  });
});
