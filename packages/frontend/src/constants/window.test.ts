import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COLLAPSED_HEIGHT,
  EXPANDED_HEIGHT,
  getMinimizedWindowHeight,
  MINIMIZED_TASKS_CONTENT_HEIGHT,
  MINIMIZED_TASKS_HEIGHT,
  MINIMIZED_TASKS_ROW_CLEARANCE,
} from './window';

describe('minimized window geometry', () => {
  it('keeps the compact height when the mini Task view is hidden', () => {
    expect(getMinimizedWindowHeight(false)).toBe(COLLAPSED_HEIGHT);
  });

  it('adds only the accepted Task-row clearance when the mini Task view is shown', () => {
    expect(MINIMIZED_TASKS_ROW_CLEARANCE).toBe(10);
    expect(MINIMIZED_TASKS_HEIGHT).toBe(
      MINIMIZED_TASKS_CONTENT_HEIGHT + MINIMIZED_TASKS_ROW_CLEARANCE
    );
    expect(getMinimizedWindowHeight(true)).toBe(MINIMIZED_TASKS_HEIGHT);
  });
});

describe('desktop startup geometry', () => {
  it.each(['tauri.conf.json', 'tauri.dev.conf.json'])(
    'boots %s at the expanded size',
    fileName => {
      const config = JSON.parse(
        readFileSync(`packages/frontend/src-tauri/${fileName}`, 'utf8')
      ) as { app: { windows: Array<{ width: number; height: number }> } };

      expect(config.app.windows[0]).toMatchObject({
        width: 440,
        height: EXPANDED_HEIGHT,
      });
    }
  );
});
