import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../App.css';
import { AdvancedSkipInlineStrip } from './AdvancedSkipInlineStrip';
import { TaskRecurrenceFields } from './tasks/TaskRecurrenceFields';
import { TimeRemainingCircle } from '../pages/timer/TimeRemainingCircle';

let host: HTMLDivElement | null = null;

afterEach(() => {
  host?.remove();
  host = null;
});

function expectOrderedWithoutOverlap(elements: Element[]) {
  const bounds = elements.map(element => element.getBoundingClientRect());
  bounds.forEach(bound => expect(bound.width).toBeGreaterThan(0));
  bounds.slice(1).forEach((bound, index) => {
    expect(bounds[index].right).toBeLessThanOrEqual(bound.left);
  });
}

describe('Task and Timer browser-component layout', () => {
  it('keeps recurrence controls usable in the compact desktop width', async () => {
    host = document.createElement('div');
    host.style.width = '280px';
    document.body.append(host);
    createRoot(host).render(
      <TaskRecurrenceFields
        interval="1.5"
        unit="WEEKLY"
        anchorMode="planned"
        onIntervalChange={vi.fn()}
        onUnitChange={vi.fn()}
        onAnchorModeChange={vi.fn()}
        intervalAriaLabel="Cadence"
        unitAriaLabel="Unit"
        compact
      />
    );

    await vi.waitFor(() => {
      expect(host?.querySelectorAll('input, select')).toHaveLength(2);
    });
    const controls = Array.from(host.querySelectorAll('input, select'));
    expectOrderedWithoutOverlap(controls);
    controls.forEach(control => {
      const bounds = control.getBoundingClientRect();
      expect(bounds.left).toBeGreaterThanOrEqual(
        host!.getBoundingClientRect().left
      );
      expect(bounds.right).toBeLessThanOrEqual(
        host!.getBoundingClientRect().right
      );
    });
  });

  it('fits every minimized advanced-skip action without collision', async () => {
    host = document.createElement('div');
    host.style.width = '380px';
    document.body.append(host);
    createRoot(host).render(
      <AdvancedSkipInlineStrip
        timer={
          {
            type: 'work',
            status: 'paused',
            duration: 300_000,
            remainingTime: 240_000,
            startTime: 0,
            isExtension: false,
          } as never
        }
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    await vi.waitFor(() => {
      expect(host?.querySelectorAll('button')).toHaveLength(4);
    });
    expectOrderedWithoutOverlap(Array.from(host.querySelectorAll('button')));
    expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
  });

  it('uses the five-percent-larger expanded mobile Timer circle', async () => {
    host = document.createElement('div');
    host.style.width = '390px';
    host.style.height = '844px';
    document.body.append(host);
    createRoot(host).render(<TimeRemainingCircle isExpanded />);

    await vi.waitFor(() =>
      expect(
        host?.querySelector('[data-testid="timer-circle-content"]')
      ).toBeTruthy()
    );
    const content = host.querySelector<HTMLElement>(
      '[data-testid="timer-circle-content"]'
    )!;
    expect(content.dataset.expandedScale).toBe('0.95');
    expect(getComputedStyle(content).scale).toBe('0.95');
    expect(content.getBoundingClientRect().width).toBeLessThanOrEqual(
      host.getBoundingClientRect().width
    );
  });
});
