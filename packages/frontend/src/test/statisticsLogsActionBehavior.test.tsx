import type { Intention, WorkTimerLog } from '@pomi/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const mocks = vi.hoisted(() => ({
  clearTimerHistory: vi.fn(),
  onLogsMutated: vi.fn(),
}));

vi.mock('../stores/timerStore', () => ({
  useTimerStore: {
    use: { clearTimerHistory: () => mocks.clearTimerHistory },
  },
}));

vi.mock('../utils/userActionQueue', () => ({
  submitUserMutation: async ({
    payload,
    successStatus,
  }: {
    payload: { operation: string; logId: string };
    successStatus?: number;
  }) => {
    const response = await fetch(
      `http://localhost:3000/work-timer-logs/${payload.logId}`,
      { method: payload.operation === 'delete' ? 'DELETE' : 'PATCH' }
    );
    return { status: successStatus ?? response.status };
  },
}));

import {
  formatWorkTimerLogTimestamp,
  WorkTimerLogsModal,
} from '../pages/statistics/WorkTimerLogsModal';

const log: WorkTimerLog = {
  id: 'work-log-1',
  type: 'work',
  intention: 'deep-work',
  intentionTitle: 'Deep work',
  intentionEmoji: '🎯',
  intentions: [
    { slug: 'deep-work', title: 'Deep work', emoji: '🎯', type: 'work' },
  ],
  duration: 25 * 60_000,
  completedAt: Date.UTC(2026, 6, 26, 10, 0),
  date: '2026-07-26',
};

let logs: WorkTimerLog[] = [];
const intention: Intention = {
  id: 'intention-1',
  userId: 'user-1',
  slug: 'deep-work',
  title: 'Deep work',
  emoji: '🎯',
  type: 'work',
  parentIntentionId: null,
  hasCustomDuration: false,
  customDuration: null,
  keepScreenAwake: false,
  isHabit: false,
  isArchived: false,
  isFavorite: false,
  allowsTasks: true,
  description: null,
  vacationDefault: false,
  usageCount: 1,
  createdAt: '2026-07-26T08:00:00.000Z',
  updatedAt: '2026-07-26T08:00:00.000Z',
};

const server = setupServer(
  http.get('http://localhost:3000/work-timer-logs', () =>
    HttpResponse.json(logs)
  ),
  http.get('http://localhost:3000/intentions', () =>
    HttpResponse.json([intention])
  ),
  http.delete('http://localhost:3000/work-timer-logs/:id', ({ params }) => {
    logs = logs.filter(logEntry => logEntry.id !== params.id);
    return new HttpResponse(null, { status: 204 });
  })
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  logs = [log];
  mocks.clearTimerHistory.mockReset();
  mocks.onLogsMutated.mockReset();
});

describe('statistics work-log behavior migrated from legacy Playwright documentation', () => {
  it('formats the complete log timestamp with the active locale', () => {
    const timestamp = Date.UTC(2026, 6, 26, 10, 0);

    expect(formatWorkTimerLogTimestamp(timestamp, 'fr-FR')).toBe(
      new Intl.DateTimeFormat('fr-FR', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(timestamp))
    );
    expect(formatWorkTimerLogTimestamp(timestamp, 'fr-FR')).not.toMatch(
      /\b(?:AM|PM)\b/
    );
  });

  it('loads recorded work, opens its editor, and lets Escape close only that editor', async () => {
    render(
      <WorkTimerLogsModal
        isOpen
        onClose={vi.fn()}
        onLogsMutated={mocks.onLogsMutated}
      />
    );

    const row = await screen.findByTestId('work-timer-log-row');
    expect(row).toHaveAccessibleName('Edit log Deep work');
    expect(row).toHaveTextContent('25m');

    await userEvent.setup().click(row);
    expect(await screen.findByTestId('work-timer-log-editor')).toBeVisible();
    await waitFor(() =>
      expect(
        screen.getByTestId('work-timer-log-intention-dropdown')
      ).toBeEnabled()
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() =>
      expect(
        screen.queryByTestId('work-timer-log-editor')
      ).not.toBeInTheDocument()
    );
    expect(screen.getByRole('heading', { name: 'Logs' })).toBeVisible();
  });

  it('deletes a selected recorded log, refreshes Timer history, and reports the confirmed change', async () => {
    render(
      <WorkTimerLogsModal
        isOpen
        onClose={vi.fn()}
        onLogsMutated={mocks.onLogsMutated}
      />
    );
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('work-timer-log-row'));
    await waitFor(() =>
      expect(
        screen.getByTestId('work-timer-log-intention-dropdown')
      ).toBeEnabled()
    );
    await user.click(screen.getByTestId('work-timer-log-delete'));
    expect(screen.getByTestId('work-timer-log-delete-confirm')).toBeVisible();
    await user.click(screen.getByTestId('work-timer-log-confirm-delete'));

    await waitFor(() =>
      expect(screen.queryByTestId('work-timer-log-row')).not.toBeInTheDocument()
    );
    expect(mocks.clearTimerHistory).toHaveBeenCalledOnce();
    expect(mocks.onLogsMutated).toHaveBeenCalledOnce();
  });
});
