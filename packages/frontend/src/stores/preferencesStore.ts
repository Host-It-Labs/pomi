import { Preferences } from '@pomi/shared';
import { create } from 'zustand';
import { useAuthStoreBase } from './authStore';
import { apiClient } from '../utils/apiClient';
import { submitUserMutation } from '../utils/userActionQueue';
import { createSelectors } from './createSelectors';
import { normalizeLanguage, setLanguage, translateCurrent } from '../i18n';

type LocalizedPreferences = Preferences & { language?: string | null };

type preferencesStore = {
  preferences: Preferences | null;
  isLoading: boolean;
  hasLoaded: boolean;
  loadError: string | null;
  loadPreferences: (options?: { syncTimeZone?: boolean }) => Promise<void>;
  updatePreference: (key: string, value: any) => Promise<void>;
  updatePreferenceWithResult: (key: string, value: any) => Promise<boolean>;
  setPreferences: (preferences: Preferences) => void;
};

const initialPreferencesState = {
  preferences: null,
  isLoading: false,
  hasLoaded: false,
  loadError: null,
};

let loadPreferencesPromise: Promise<void> | null = null;

function getClientTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

const usePreferencesStoreBase = create<preferencesStore>((set, get) => ({
  ...initialPreferencesState,
  loadPreferences: async (options = {}) => {
    if (loadPreferencesPromise) {
      return loadPreferencesPromise;
    }

    loadPreferencesPromise = (async () => {
      set({ isLoading: true, loadError: null });

      try {
        const response = await apiClient.preferences.get();
        if (response.status === 200) {
          const timeZone = getClientTimeZone();
          const language = normalizeLanguage(
            (response.body as LocalizedPreferences).language
          );
          if (language) {
            setLanguage(language, { persist: true });
          }
          set({
            preferences: response.body,
            isLoading: false,
            hasLoaded: true,
            loadError: null,
          });
          if (
            options.syncTimeZone !== false &&
            response.body.timeZone !== timeZone
          ) {
            const updateResponse = await apiClient.preferences.update({
              body: { timeZone },
            });
            if (updateResponse.status === 200) {
              const language = normalizeLanguage(
                (updateResponse.body as LocalizedPreferences).language
              );
              if (language) {
                setLanguage(language, { persist: true });
              }
              set({
                preferences: updateResponse.body,
                hasLoaded: true,
                loadError: null,
              });
            }
          }
          return;
        }

        const errorBody = response.body as { message?: string } | null;
        set(state => ({
          isLoading: false,
          hasLoaded: state.hasLoaded,
          loadError:
            errorBody?.message || translateCurrent('settings.loadFailed'),
        }));
      } catch (error) {
        console.error('Failed to load preferences for store:', error);

        set(state => ({
          isLoading: false,
          hasLoaded: state.hasLoaded,
          loadError:
            error instanceof Error
              ? error.message
              : translateCurrent('settings.loadFailed'),
        }));
      } finally {
        loadPreferencesPromise = null;
      }
    })();

    return loadPreferencesPromise;
  },

  updatePreference: async (key, value) => {
    await get().updatePreferenceWithResult(key, value);
  },

  updatePreferenceWithResult: async (key, value) => {
    try {
      const body = { [key]: value };
      const result = await submitUserMutation({
        kind: 'preferences',
        label: translateCurrent('settings.update'),
        payload: { operation: 'update', updates: body },
      });
      const response =
        result &&
        typeof result === 'object' &&
        'status' in result &&
        'body' in result
          ? (result as { status: number; body: Preferences })
          : { status: 200, body: result as Preferences };

      if (response.status === 200) {
        const language = normalizeLanguage(
          (response.body as LocalizedPreferences).language
        );
        if (language) {
          setLanguage(language, { persist: true });
        }
        set({
          preferences: response.body,
          hasLoaded: true,
          loadError: null,
        });
        return true;
      }

      await get().loadPreferences();
      return false;
    } catch (error) {
      console.error(`Failed to update ${key} preference:`, error);
      await get().loadPreferences();
      return false;
    }
  },

  setPreferences: preferences => {
    const language = normalizeLanguage(
      (preferences as LocalizedPreferences).language
    );
    if (language) {
      setLanguage(language, { persist: true });
    }
    set({
      preferences,
      hasLoaded: true,
      loadError: null,
    });
  },
}));

export const usePreferencesStore = createSelectors(usePreferencesStoreBase);

useAuthStoreBase.subscribe((state, prevState) => {
  if (state.token === prevState.token) {
    return;
  }

  loadPreferencesPromise = null;
  usePreferencesStoreBase.setState(initialPreferencesState);
});
