import { beforeEach, describe, expect, it } from 'vitest';
import { getConnectionStatusDisplayDelay } from './ConnectionStatus';
import { useConnectionStatusUiBase } from '../stores/connectionStatusUiStore';

describe('connection status presentation', () => {
  beforeEach(() => {
    useConnectionStatusUiBase.getState().reset();
  });

  it('keeps bootstrap quiet, grants resume grace, and bypasses it for blocked actions', () => {
    expect(
      getConnectionStatusDisplayDelay({
        isInitialConnection: true,
        isNetworkBlocked: false,
      })
    ).toBe(30_000);
    expect(
      getConnectionStatusDisplayDelay({
        isInitialConnection: false,
        isNetworkBlocked: false,
      })
    ).toBe(3_000);
    expect(
      getConnectionStatusDisplayDelay({
        isInitialConnection: false,
        isNetworkBlocked: true,
      })
    ).toBe(0);
  });

  it('restores the full status after a collapsed indicator is activated', () => {
    useConnectionStatusUiBase.getState().dismiss('offline');
    expect(useConnectionStatusUiBase.getState()).toMatchObject({
      isCollapsed: true,
      tone: 'offline',
    });

    useConnectionStatusUiBase.getState().restore();
    expect(useConnectionStatusUiBase.getState()).toMatchObject({
      isCollapsed: false,
      tone: 'offline',
    });
  });
});
