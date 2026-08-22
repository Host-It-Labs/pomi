import { describe, expect, it } from 'vitest';
import { TIMER_STATUSES } from './constants';
import type { WatchStatus } from './types';
import { buildWatchFaceSurfaceModel } from './watchSurface';

function status(overrides: Partial<WatchStatus>): WatchStatus {
  return {
    serverNowMs: 1_000,
    language: 'en',
    taskMode: 'intention',
    timer: null,
    assistant: {
      assistantEnabled: false,
      speechCaptureEnabled: false,
      aiTaskCaptureEnabled: false,
      assistantRecordingMaxMinutes: null,
      usageBudgetPeriod: 'monthly',
      usageBudgetCapUsd: null,
      usageBudgetUsedUsd: 0,
      usageBudgetRemainingUsd: null,
    },
    timerControls: {
      canStartOrResume: true,
      canPause: false,
      canAddFiveMinutes: false,
      canReset: false,
      canSkip: false,
      canStartLongBreak: false,
      requiresIntentionSelection: false,
      intentionRequireSelection: false,
      intentionMultiSelect: false,
      advancedSkip: false,
      sessionsEnabled: false,
    },
    tasks: [],
    totalVisibleTasks: 0,
    totalActiveTasks: 0,
    ...overrides,
  };
}

describe('buildWatchFaceSurfaceModel', () => {
  it('projects logged-in empty state into stable slots', () => {
    const model = buildWatchFaceSurfaceModel(status({}));

    expect(model.clock.slot).toBe('top');
    expect(model.timer).toMatchObject({
      slot: 'center',
      label: 'Start Timer',
      enabled: true,
      action: 'startOrResume',
      remainingTime: null,
      progress: 0,
    });
    expect(model.assistant).toMatchObject({
      slot: 'right',
      enabled: false,
      canRecord: false,
    });
    expect(model.tasks).toMatchObject({
      slot: 'left',
      enabled: false,
      visibleCount: 0,
      activeCount: 0,
    });
  });

  it('projects running timer, Assistant, and Tasks from confirmed status', () => {
    const model = buildWatchFaceSurfaceModel(
      status({
        timer: {
          id: 'timer',
          type: 'work',
          status: TIMER_STATUSES.RUNNING,
          duration: 60_000,
          remainingTime: 30_000,
          endsAtMs: 31_000,
          progress: 0.5,
          intentions: [],
          sessionPosition: null,
          sessionTotal: null,
          stackedSessions: null,
          isExtension: false,
        },
        assistant: {
          assistantEnabled: true,
          speechCaptureEnabled: true,
          aiTaskCaptureEnabled: true,
          assistantRecordingMaxMinutes: 5,
          usageBudgetPeriod: 'monthly',
          usageBudgetCapUsd: 10,
          usageBudgetUsedUsd: 1,
          usageBudgetRemainingUsd: 9,
        },
        timerControls: {
          ...status({}).timerControls,
          canStartOrResume: false,
          canPause: true,
        },
        tasks: [
          {
            id: 'task',
            title: 'Ship tests',
            dueDate: null,
            dueTime: null,
            priority: 'normal',
            timerType: 'work',
            intentionSlug: null,
            subIntentionSlug: null,
            intentionTitle: null,
            intentionEmoji: null,
            subIntentionTitle: null,
            subIntentionEmoji: null,
            followUpParent: null,
            isFocused: false,
            isLinkedToTimer: false,
            isOverdue: false,
          },
        ],
        totalVisibleTasks: 1,
        totalActiveTasks: 3,
      })
    );

    expect(model.timer).toMatchObject({
      label: 'Timer',
      action: 'pause',
      remainingTime: 30_000,
      progress: 0.5,
    });
    expect(model.assistant.enabled).toBe(true);
    expect(model.tasks).toMatchObject({
      enabled: true,
      visibleCount: 1,
      activeCount: 3,
    });
  });

  it('disables timer when confirmed controls reject its current action', () => {
    const model = buildWatchFaceSurfaceModel(
      status({
        timerControls: {
          ...status({}).timerControls,
          canStartOrResume: false,
        },
      })
    );

    expect(model.timer.action).toBeNull();
    expect(model.timer.enabled).toBe(false);
  });

  it('disables a running timer when pausing is unavailable', () => {
    const model = buildWatchFaceSurfaceModel(
      status({
        timer: {
          id: 'timer',
          type: 'work',
          status: TIMER_STATUSES.RUNNING,
          duration: 60_000,
          remainingTime: 30_000,
          endsAtMs: 31_000,
          progress: 0.5,
          intentions: [],
          sessionPosition: null,
          sessionTotal: null,
          stackedSessions: null,
          isExtension: false,
        },
        timerControls: {
          ...status({}).timerControls,
          canStartOrResume: false,
          canPause: false,
        },
      })
    );

    expect(model.timer.action).toBeNull();
    expect(model.timer.enabled).toBe(false);
  });
});
