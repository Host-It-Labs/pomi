import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PaginationControls } from './PaginationControls';
import { TaskModeToggle } from './TaskModeToggle';
import { Modal } from './ui/Modal';
import { CompletionButton } from './tasks/CompletionButton';

describe('shared UI behavior', () => {
  it('normalizes pagination and disables terminal controls', () => {
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    render(
      <PaginationControls
        pageIndex={99}
        pageCount={3}
        onPrevious={onPrevious}
        onNext={onNext}
        previousLabel="Previous"
        nextLabel="Next"
      />
    );

    expect(screen.getByText('3/3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(onPrevious).toHaveBeenCalledOnce();
  });

  it('keeps disabled Intention mode inert', () => {
    const onModeChange = vi.fn();
    render(
      <TaskModeToggle
        mode="general"
        onModeChange={onModeChange}
        isIntentionDisabled
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Current intentions' }));
    expect(onModeChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'All tasks' }));
    expect(onModeChange).toHaveBeenCalledWith('general');
  });

  it('locks scrolling and closes only through enabled paths', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Modal
        isOpen
        title="Editor"
        onClose={onClose}
        closeOnBackdropClick={false}
        closeOnEscape
      >
        Content
      </Modal>
    );

    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();

    rerender(
      <Modal
        isOpen={false}
        title="Editor"
        onClose={onClose}
        closeOnBackdropClick={false}
        closeOnEscape
      >
        Content
      </Modal>
    );
    expect(document.body.style.overflow).toBe('');
  });

  it('preserves document scroll position while a modal is open', () => {
    document.documentElement.scrollTop = 420;
    document.body.scrollTop = 420;
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      value: 420,
    });

    const { unmount } = render(
      <Modal
        isOpen
        title="Editor"
        onClose={vi.fn()}
        closeOnEscape
        closeOnBackdropClick={false}
      >
        Content
      </Modal>
    );

    expect(document.documentElement.scrollTop).toBe(420);
    unmount();
    expect(document.documentElement.scrollTop).toBe(420);
  });

  it('exposes the animated completion and undo states accessibly', () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <CompletionButton
        label="Ship release"
        isCompleted={false}
        isCompleting
        onClick={onClick}
      />
    );

    const completing = screen.getByRole('button', {
      name: 'Undo Ship release',
    });
    expect(completing).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(completing);
    expect(onClick).toHaveBeenCalledOnce();

    rerender(
      <CompletionButton label="Ship release" isCompleted onClick={onClick} />
    );
    expect(
      screen.getByRole('button', { name: 'Undo Ship release' })
    ).toBeVisible();
  });
});
