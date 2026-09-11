import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { NewClientPage } from '../NewClientPage';
import { configureRepository, useAppStore } from '../../application/store';
import { MemoryRepository } from '../../application/persistence/memoryRepository';
import { buildFixtureData } from '../../testing/fixtures';

const today = '2026-09-11';

describe('NewClientPage validation', () => {
  beforeEach(() => {
    configureRepository(new MemoryRepository());
    useAppStore.setState({ data: buildFixtureData(today), today, ready: true, currentUserId: 'u_adnan' });
  });

  it('moves focus to the first invalid field and links each error to its input', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <NewClientPage />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Create client' }));

    const name = screen.getByLabelText('Client / company name');
    expect(name).toHaveFocus();
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAttribute('aria-describedby', 'nc-name-error');
    expect(document.getElementById('nc-name-error')).toHaveTextContent('Enter the client or company name.');

    const email = screen.getByLabelText('Email');
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(document.getElementById('nc-email-error')).toHaveTextContent("doesn't look right");

    // A field with nothing wrong carries no invalid state at all.
    expect(screen.getByLabelText('Mobile')).not.toHaveAttribute('aria-invalid');
  });
});
