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
    HttpResponse.json({ items: logs, nextCursor: null })
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

  it('appends cursor pages without duplicating an overlapping log', async () => {
    const secondLog = {
      ...log,
      id: 'work-log-2',
      intentionTitle: 'Second log',
      intentions: [
        { slug: 'second', title: 'Second log', emoji: '✌️', type: 'work' },
      ],
    };
    server.use(
      http.get('http://localhost:3000/work-timer-logs', ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor');
        return HttpResponse.json(
          cursor
            ? { items: [log, secondLog], nextCursor: null }
            : { items: [log], nextCursor: 'next-page' }
        );
      })
    );
    render(<WorkTimerLogsModal isOpen onClose={vi.fn()} />);

    await screen.findByText('Deep work');
    const scroll = screen.getByTestId('work-timer-logs-scroll');
    Object.defineProperties(scroll, {
      scrollHeight: { configurable: true, value: 100 },
      scrollTop: { configurable: true, value: 80 },
      clientHeight: { configurable: true, value: 20 },
    });
    fireEvent.scroll(scroll);

    await screen.findByText('Second log');
    expect(screen.getAllByTestId('work-timer-log-row')).toHaveLength(2);
  });

  it('ignores an obsolete response after the modal is closed and reopened', async () => {
    let resolveFirst: ((response: Response) => void) | undefined;
    let requestCount = 0;
    server.use(
      http.get('http://localhost:3000/work-timer-logs', async () => {
        requestCount += 1;
        if (requestCount === 1) {
          return new Promise<Response>(resolve => {
            resolveFirst = resolve;
          });
        }
        return HttpResponse.json({
          items: [
            {
              ...log,
              id: 'fresh-log',
              intentionTitle: 'Fresh log',
              intentions: [{ slug: 'fresh', title: 'Fresh log', type: 'work' }],
            },
          ],
          nextCursor: null,
        });
      })
    );
    const { rerender } = render(
      <WorkTimerLogsModal isOpen onClose={vi.fn()} />
    );

    await waitFor(() => expect(requestCount).toBe(1));
    rerender(<WorkTimerLogsModal isOpen={false} onClose={vi.fn()} />);
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: 'Logs' })
      ).not.toBeInTheDocument()
    );
    rerender(<WorkTimerLogsModal isOpen onClose={vi.fn()} />);
    await screen.findByText('Fresh log');

    resolveFirst?.(
      HttpResponse.json({
        items: [
          {
            ...log,
            id: 'stale-log',
            intentionTitle: 'Stale log',
            intentions: [{ slug: 'stale', title: 'Stale log', type: 'work' }],
          },
        ],
        nextCursor: null,
      })
    );
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(screen.queryByText('Stale log')).not.toBeInTheDocument();
    expect(screen.getByText('Fresh log')).toBeInTheDocument();
  });
});
