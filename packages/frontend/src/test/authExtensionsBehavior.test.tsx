import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { ToastProvider } from '../components/toast/ToastContext';
import { Login } from '../pages/Login';
import { SessionConfigModal } from '../pages/extensions/SessionConfigModal';
import { useAuthStoreBase } from '../stores/authStore';
import { useUiStore } from '../stores/uiStore';
import { setLanguage } from '../i18n';

const server = setupServer(
  http.get('http://localhost:3000/system', () =>
    HttpResponse.json({
      hostingMode: 'self-hosted',
      selfHosted: true,
      requiresAdminBootstrapToken: false,
    })
  ),
  http.get('https://self-hosted.example/system', () =>
    HttpResponse.json({
      hostingMode: 'self-hosted',
      selfHosted: true,
      requiresAdminBootstrapToken: false,
    })
  )
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  useAuthStoreBase.setState({
    user: null,
    token: null,
    isAuthenticated: false,
    hasExplicitlySignedOut: false,
  });
  useUiStore.setState({ activeTab: 'timer', hasLoggedIn: false });
  setLanguage('en', { persist: false });
});
afterAll(() => server.close());

const renderLogin = () =>
  render(
    <ToastProvider>
      <Login />
    </ToastProvider>
  );

describe('authentication behavior migrated from legacy Playwright documentation', () => {
  it('documents required credentials before sending a session request', async () => {
    const sessions = vi.fn();
    server.use(
      http.post('http://localhost:3000/sessions', () => {
        sessions();
        return HttpResponse.json({});
      })
    );
    renderLogin();

    const continueButton = screen.getByRole('button', {
      name: 'Continue',
    }) as HTMLButtonElement;
    fireEvent.submit(continueButton.form!);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Username and password are required'
    );
    expect(sessions).not.toHaveBeenCalled();
  });

  it('sends credentials to the REST sessions endpoint and records the confirmed session', async () => {
    const requestBodies: unknown[] = [];
    server.use(
      http.post('http://localhost:3000/sessions', async ({ request }) => {
        requestBodies.push(await request.json());
        return HttpResponse.json({
          user: {
            id: 'user-1',
            username: 'documented-user',
            createdAt: '2026-01-01T00:00:00.000Z',
            isAdmin: false,
          },
          token: 'confirmed-token',
          isNewUser: true,
          language: 'en',
        });
      })
    );
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText('Username'), 'documented-user');
    await user.type(screen.getByLabelText('Password'), 'safe-password');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() =>
      expect(useAuthStoreBase.getState()).toMatchObject({
        token: 'confirmed-token',
        isAuthenticated: true,
        user: { username: 'documented-user' },
      })
    );
    expect(requestBodies).toEqual([
      {
        username: 'documented-user',
        password: 'safe-password',
        language: 'en',
        platform: 'web',
      },
    ]);
    expect(useUiStore.getState()).toMatchObject({
      activeTab: 'timer',
      hasLoggedIn: true,
    });
  });

  it('uses the selected first-run language when creating an account', async () => {
    const requestBodies: unknown[] = [];
    server.use(
      http.post('http://localhost:3000/sessions', async ({ request }) => {
        requestBodies.push(await request.json());
        return HttpResponse.json({
          user: {
            id: 'user-fr',
            username: 'fr-user',
            createdAt: '2026-01-01T00:00:00.000Z',
            isAdmin: false,
          },
          token: 'fr-token',
          isNewUser: true,
          language: 'fr',
        });
      })
    );
    const user = userEvent.setup();
    renderLogin();

    await user.selectOptions(screen.getByLabelText('Language'), 'fr');
    expect(
      screen.getByRole('heading', { name: 'Bienvenue sur Pomi' })
    ).toBeVisible();
    await user.type(screen.getByLabelText("Nom d'utilisateur"), 'fr-user');
    await user.type(screen.getByLabelText('Mot de passe'), 'safe-password');
    await user.click(screen.getByRole('button', { name: 'Continuer' }));

    await waitFor(() =>
      expect(useAuthStoreBase.getState()).toMatchObject({
        token: 'fr-token',
        isAuthenticated: true,
      })
    );
    expect(requestBodies).toEqual([
      {
        username: 'fr-user',
        password: 'safe-password',
        language: 'fr',
        platform: 'web',
      },
    ]);
  });

  it('retries a legacy self-hosted backend without the language field', async () => {
    const requestBodies: unknown[] = [];
    server.use(
      http.post('http://localhost:3000/sessions', async ({ request }) => {
        const body = await request.json();
        requestBodies.push(body);
        if (typeof body === 'object' && body && 'language' in body) {
          return HttpResponse.json(
            {
              statusCode: 400,
              message: ['property language should not exist'],
              error: 'Bad Request',
            },
            { status: 400 }
          );
        }

        return HttpResponse.json({
          user: {
            id: 'legacy-user',
            username: 'legacy-user',
            createdAt: '2026-01-01T00:00:00.000Z',
            isAdmin: false,
          },
          token: 'legacy-token',
          isNewUser: true,
        });
      })
    );
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText('Username'), 'legacy-user');
    await user.type(screen.getByLabelText('Password'), 'safe-password');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() =>
      expect(useAuthStoreBase.getState()).toMatchObject({
        token: 'legacy-token',
        isAuthenticated: true,
      })
    );
    expect(requestBodies).toEqual([
      {
        username: 'legacy-user',
        password: 'safe-password',
        language: 'en',
        platform: 'web',
      },
      { username: 'legacy-user', password: 'safe-password' },
    ]);
  });

  it('disables submission while authentication is pending and surfaces server errors', async () => {
    let resolveRequest: ((response: Response) => void) | undefined;
    server.use(
      http.post(
        'http://localhost:3000/sessions',
        () =>
          new Promise<Response>(resolve => {
            resolveRequest = resolve;
          })
      )
    );
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText('Username'), 'pending-user');
    await user.type(screen.getByLabelText('Password'), 'safe-password');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(
      await screen.findByRole('button', { name: 'Authenticating...' })
    ).toBeDisabled();

    resolveRequest?.(
      HttpResponse.json(
        { message: 'Invalid credentials', language: 'en' },
        { status: 400 }
      )
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Invalid credentials'
    );
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });

  it('surfaces the new-account password validation message', async () => {
    server.use(
      http.post('http://localhost:3000/sessions', () =>
        HttpResponse.json(
          {
            message:
              'Password must be at least 12 characters and contain a non-whitespace character',
          },
          { status: 400 }
        )
      )
    );
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText('Username'), 'new-user');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Password must be at least 12 characters and contain a non-whitespace character'
    );
  });

  it('persists a normalized self-hosted URL and clears it when returning to hosted service', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.click(screen.getByRole('button', { name: 'I am self-hosting' }));
    await user.type(
      screen.getByPlaceholderText('https://pomi.yourdomain.com'),
      ' https://self-hosted.example/ '
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(localStorage.getItem('pomi-backend-url')).toBe(
      'https://self-hosted.example'
    );
    expect(screen.getByText(/Using self-hosted backend/)).toHaveTextContent(
      'https://self-hosted.example'
    );
    await user.click(
      screen.getByRole('button', { name: 'Use hosted service instead' })
    );
    expect(localStorage.getItem('pomi-backend-url')).toBeNull();
  });
});

describe('feature setup behavior migrated from legacy Playwright documentation', () => {
  it('requires valid Session setup and saves the normalized timer configuration before leaving setup', async () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<SessionConfigModal isOpen onClose={onClose} onSave={onSave} />);

    const workTimers = screen.getByPlaceholderText('4');
    await user.clear(workTimers);
    await user.type(workTimers, '11');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      screen.getByText('Work timers per session must be between 1 and 10')
    ).toBeVisible();
    expect(onSave).not.toHaveBeenCalled();

    await user.clear(workTimers);
    await user.type(workTimers, '3');
    const longBreakDuration = screen.getByPlaceholderText('15');
    await user.clear(longBreakDuration);
    await user.type(longBreakDuration, '20');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith({
      pomodorosCount: 3,
      hasLongBreak: true,
      longBreakDuration: 20 * 60 * 1000,
      autoStartBreak: false,
    });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
