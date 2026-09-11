import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NotFoundPage } from '../NotFoundPage';

describe('NotFoundPage', () => {
  it('has a level-one heading and names itself in the tab title, then restores the title', () => {
    document.title = 'Practice Today';
    const { unmount } = render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1, name: "That page doesn't exist" })).toBeInTheDocument();
    expect(document.title).toMatch(/^Page not found/);
    unmount();
    expect(document.title).toBe('Practice Today');
  });
});
