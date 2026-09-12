import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tabs } from '../Tabs';

const options = [
  { value: 'overview', label: 'Overview' },
  { value: 'requests', label: 'Information requests', count: 3 },
  { value: 'comms', label: 'Communications', count: 12 },
  { value: 'activity', label: 'Activity', count: 40 },
] as const;

/** jsdom has no layout: give the strip the geometry a phone would. */
function layout(el: HTMLElement, geometry: { scrollWidth: number; clientWidth: number; scrollLeft: number }) {
  for (const [key, value] of Object.entries(geometry)) Object.defineProperty(el, key, { configurable: true, writable: true, value });
}

describe('Tabs', () => {
  it('selects a tab on click', async () => {
    const onChange = vi.fn();
    render(<Tabs value="overview" onChange={onChange} options={[...options]} />);
    await userEvent.setup().click(screen.getByRole('tab', { name: /Communications/ }));
    expect(onChange).toHaveBeenCalledWith('comms');
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows no cue when every tab fits', () => {
    render(<Tabs value="overview" onChange={() => {}} options={[...options]} />);
    const list = screen.getByRole('tablist');
    layout(list, { scrollWidth: 400, clientWidth: 400, scrollLeft: 0 });
    act(() => {
      fireEvent(window, new Event('resize'));
    });
    expect(list).not.toHaveAttribute('data-overflow');
    expect(screen.queryByTestId('tabs-fade-right')).toBeNull();
    expect(screen.queryByTestId('tabs-fade-left')).toBeNull();
  });

  it('fades the edge that has more tabs behind it, following the scroll position', () => {
    render(<Tabs value="overview" onChange={() => {}} options={[...options]} />);
    const list = screen.getByRole('tablist');

    layout(list, { scrollWidth: 600, clientWidth: 300, scrollLeft: 0 });
    act(() => {
      fireEvent(window, new Event('resize'));
    });
    expect(list).toHaveAttribute('data-overflow', 'right');
    expect(screen.getByTestId('tabs-fade-right')).toBeInTheDocument();
    expect(screen.queryByTestId('tabs-fade-left')).toBeNull();

    layout(list, { scrollWidth: 600, clientWidth: 300, scrollLeft: 150 });
    act(() => {
      fireEvent.scroll(list);
    });
    expect(list).toHaveAttribute('data-overflow', 'both');
    expect(screen.getByTestId('tabs-fade-left')).toBeInTheDocument();
    expect(screen.getByTestId('tabs-fade-right')).toBeInTheDocument();

    layout(list, { scrollWidth: 600, clientWidth: 300, scrollLeft: 300 });
    act(() => {
      fireEvent.scroll(list);
    });
    expect(list).toHaveAttribute('data-overflow', 'left');
    expect(screen.queryByTestId('tabs-fade-right')).toBeNull();
  });

  it('keeps the selected tab in view when the selection changes', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const { rerender } = render(<Tabs value="overview" onChange={() => {}} options={[...options]} />);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    rerender(<Tabs value="activity" onChange={() => {}} options={[...options]} />);
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest', inline: 'nearest' });
  });
});
