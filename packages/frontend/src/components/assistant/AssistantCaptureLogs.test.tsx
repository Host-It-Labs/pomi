import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../toast/ToastContext';
import { useAuthStore } from '../../stores/authStore';
import { apiClient } from '../../utils/apiClient';
import * as userActions from '../../utils/userActionQueue';
import { AssistantCaptureLogs } from './AssistantCaptureLogs';

vi.mock('../../utils/userActionQueue', { spy: true });

describe('AssistantCaptureLogs', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: { id: 'admin-1', username: 'admin', isAdmin: true } as never,
    });
    vi.spyOn(apiClient.assistant, 'debugStatus').mockResolvedValue({
      status: 200,
      body: { enabled: true },
    } as never);
    vi.spyOn(apiClient.assistant, 'debugLogs').mockResolvedValue({
      status: 200,
      body: [
        {
          id: 'capture-1',
          kind: 'taskCapture',
          source: 'typed',
          status: 'succeeded',
          userPrompt: 'Plan the release tomorrow',
          processedOutput: { tasks: [{ title: 'Plan the release' }] },
          invalidParserOutput: null,
          resolutionNotes: [],
          timings: { modelRequestMs: 120, totalMs: 145 },
          modelCalls: [],
          flagged: false,
          contentTruncated: false,
          error: null,
          createdAt: '2026-09-12T10:00:00.000Z',
        },
      ],
    } as never);
  });

  it('shows concise retained input, output, and timings', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <AssistantCaptureLogs />
      </ToastProvider>
    );

    await user.click(await screen.findByRole('button', { name: /Typed/ }));
    expect(screen.getByText('Plan the release tomorrow')).toBeVisible();
    expect(screen.getByText('Plan the release')).toBeVisible();
    expect(screen.getByText(/Model request: 120ms/)).toBeVisible();
  });

  it('requires confirmation and deletes retained rows when disabled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(userActions, 'submitUserMutation').mockResolvedValue({
      status: 200,
      body: { enabled: false },
    } as never);
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <AssistantCaptureLogs />
      </ToastProvider>
    );

    await user.click(
      await screen.findByRole('button', { name: 'Turn off and delete' })
    );
    await waitFor(() =>
      expect(screen.getByText('No AI debug logs.')).toBeVisible()
    );
    expect(window.confirm).toHaveBeenCalled();
    expect(userActions.submitUserMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: {
          operation: 'updateDebugStatus',
          payload: { enabled: false },
        },
      })
    );
  });

  it('restores the visible row position after refresh', async () => {
    const initialResponse = (await apiClient.assistant.debugLogs()) as {
      status: 200;
      body: Array<Record<string, unknown>>;
    };
    vi.spyOn(apiClient.assistant, 'debugLogs')
      .mockResolvedValueOnce(initialResponse as never)
      .mockResolvedValueOnce({
        ...initialResponse,
        body: [...initialResponse.body],
      } as never);
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 120,
      bottom: 160,
      left: 0,
      right: 400,
      width: 400,
      height: 40,
      x: 0,
      y: 120,
      toJSON: () => ({}),
    });
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <AssistantCaptureLogs />
      </ToastProvider>
    );

    await screen.findByRole('button', { name: /Typed/ });
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(scrollBy).toHaveBeenCalledWith({ top: 0 }));
  });
});
