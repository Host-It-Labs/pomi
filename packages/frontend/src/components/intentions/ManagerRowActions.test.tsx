import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { stableFavoriteFirst } from '../../utils/favoriteFirst';
import { ManagerRowActions } from './ManagerRowActions';

describe('Intention and List manager row controls', () => {
  it('keeps favorites first without changing peer order', () => {
    const items = [
      { id: 'a', isFavorite: false },
      { id: 'b', isFavorite: true },
      { id: 'c', isFavorite: true },
      { id: 'd', isFavorite: false },
    ];
    expect(stableFavoriteFirst(items).map(item => item.id)).toEqual([
      'b',
      'c',
      'a',
      'd',
    ]);
  });

  it('exposes always-visible favorite and edit actions', () => {
    const onFavorite = vi.fn();
    const onEdit = vi.fn();
    render(
      <ManagerRowActions
        isFavorite={false}
        label="Release"
        onFavorite={onFavorite}
        onEdit={onEdit}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Favorite Release' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Release' }));
    expect(onFavorite).toHaveBeenCalledOnce();
    expect(onEdit).toHaveBeenCalledOnce();
    expect(
      screen.getByRole('button', { name: 'Favorite Release' }).parentElement
    ).toHaveAttribute('data-manager-controls', 'trailing');
  });
});
