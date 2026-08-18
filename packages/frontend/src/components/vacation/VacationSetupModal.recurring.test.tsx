import type { Intention, Task } from '@pomi/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { submitUserMutation } from '../../utils/userActionQueue';
import { VacationSetupModal } from './VacationSetupModal';
import {
  VACATION_COVERAGE_INSTRUCTIONS,
  VACATION_MODE_EFFECT,
} from '../../constants/vacation';

const mocks = vi.hoisted(() => ({
  intentionsList: vi.fn(),
  listsList: vi.fn(),
  tasksList: vi.fn(),
  listItems: vi.fn(),
}));

vi.mock('../../stores/preferencesStore', () => ({
  usePreferencesStore: {
    use: {
      preferences: () => ({ vacationCoverageConfigured: false }),
    },
  },
}));

vi.mock('../../utils/apiClient', () => ({
  apiClient: {
    intentions: { list: mocks.intentionsList },
    lists: { list: mocks.listsList, items: mocks.listItems },
    tasks: { list: mocks.tasksList },
  },
}));

vi.mock('../../utils/userActionQueue', () => ({
  submitUserMutation: vi.fn(async () => undefined),
}));

describe('VacationSetupModal recurring selection', () => {
  beforeEach(() => {
    vi.mocked(submitUserMutation).mockClear();
    mocks.intentionsList.mockResolvedValue({
      status: 200,
      body: [
        intention('planning', 'Planning', '📅'),
        intention('empty', 'Empty', '🌱'),
      ],
    });
    mocks.listsList.mockResolvedValue({ status: 200, body: [] });
    mocks.tasksList.mockResolvedValue({
      status: 200,
      body: [
        task('weekly', 'Weekly review', 'FREQ=WEEKLY'),
        task('once', 'Book hotel', null),
        task('general-daily', 'Water plants', 'FREQ=DAILY', null),
        task('general-once', 'Buy sunscreen', null, null),
      ],
    });
    mocks.listItems.mockResolvedValue({ status: 200, body: [] });
  });

  it('explains what Vacation mode shifts and how coverage is selected', async () => {
    render(<VacationSetupModal isOpen onClose={vi.fn()} />);

    expect(await screen.findByText(VACATION_MODE_EFFECT)).toBeVisible();
    expect(screen.getByText(VACATION_COVERAGE_INSTRUCTIONS)).toBeVisible();
  });

  it('keeps recurring grouping after individual changes and puts empty Intentions last', async () => {
    render(<VacationSetupModal isOpen onClose={vi.fn()} />);

    const recurringButton = await screen.findByRole('button', {
      name: 'Show only recurring Tasks for Planning',
    });
    await waitFor(() => expect(recurringButton).toBeEnabled());
    fireEvent.click(recurringButton);

    const weekly = screen.getByRole('checkbox', { name: 'Weekly review' });
    const once = screen.getByRole('checkbox', { name: 'Book hotel' });
    expect(weekly).toBeChecked();
    expect(once).not.toBeChecked();
    expect(screen.getByText('Recurring', { selector: 'p' })).toBeVisible();
    expect(screen.getByText('Not recurring', { selector: 'p' })).toBeVisible();
    expect(
      weekly.compareDocumentPosition(once) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    fireEvent.click(weekly);

    expect(weekly).not.toBeChecked();
    expect(screen.getByText('Recurring', { selector: 'p' })).toBeVisible();
    expect(screen.getByText('Not recurring', { selector: 'p' })).toBeVisible();
    expect(recurringButton).toHaveTextContent('Only');
    expect(recurringButton).toHaveClass('bg-cyan-500/15');

    const emptyHeading = screen.getByRole('heading', {
      name: 'No active Tasks',
    });
    const emptyIntention = screen.getByText('🌱 Empty');
    expect(emptyIntention.closest('[aria-disabled="true"]')).toBeTruthy();
    expect(
      once.compareDocumentPosition(emptyHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Save coverage' }));

    await waitFor(() => expect(submitUserMutation).toHaveBeenCalledOnce());
    expect(submitUserMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          intentionSlugs: ['planning'],
          excludedItemIds: expect.arrayContaining(['weekly', 'once']),
        }),
      })
    );
  });

  it('deselects and reselects every Task with its Intention', async () => {
    render(<VacationSetupModal isOpen onClose={vi.fn()} />);

    const expand = await screen.findByRole('button', {
      name: 'Expand 📅 Planning',
    });
    fireEvent.click(expand);

    const intention = screen.getByRole('checkbox', {
      name: 'Include 📅 Planning',
    });
    const weekly = screen.getByRole('checkbox', { name: 'Weekly review' });
    const once = screen.getByRole('checkbox', { name: 'Book hotel' });

    fireEvent.click(intention);
    expect(weekly).not.toBeChecked();
    expect(once).not.toBeChecked();

    fireEvent.click(intention);
    expect(weekly).toBeChecked();
    expect(once).toBeChecked();
  });

  it('toggles recurring-only selection for Tasks without an Intention', async () => {
    render(<VacationSetupModal isOpen onClose={vi.fn()} />);

    const planning = await screen.findByText('📅 Planning');
    const general = screen.getByText('Tasks without an Intention');
    expect(
      planning.compareDocumentPosition(general) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    const recurringButton = screen.getByRole('button', {
      name: 'Show only recurring Tasks for Tasks without an Intention',
    });
    fireEvent.click(recurringButton);

    const recurring = screen.getByRole('checkbox', { name: 'Water plants' });
    const oneOff = screen.getByRole('checkbox', { name: 'Buy sunscreen' });
    expect(recurring).toBeChecked();
    expect(oneOff).not.toBeChecked();
    expect(recurringButton).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(recurring);
    expect(recurring).not.toBeChecked();
    expect(screen.getAllByText('Recurring', { selector: 'p' })).toHaveLength(1);
    expect(recurringButton).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(recurringButton);
    expect(
      screen.getByRole('checkbox', { name: 'Water plants' })
    ).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: 'Buy sunscreen' })
    ).toBeChecked();
    expect(recurringButton).toHaveAttribute('aria-pressed', 'false');
  });
});

function intention(slug: string, title: string, emoji: string) {
  return {
    id: `intention-${slug}`,
    slug,
    title,
    emoji,
    isArchived: false,
    parentIntentionId: null,
    vacationDefault: false,
  } as Intention;
}

function task(
  id: string,
  title: string,
  recurrenceRule: string | null,
  intentionSlug: string | null = 'planning'
) {
  return {
    id,
    title,
    intentionSlug,
    recurrenceRule,
    vacationEligible: false,
  } as Task;
}
