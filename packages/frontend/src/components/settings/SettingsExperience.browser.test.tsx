import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../App.css';
import {
  SettingsControlGroup,
  SettingsSectionFrame,
  SettingsStickySearch,
} from './SettingsExperience';
import { TaskPriorityMultiSelect } from './TaskPriorityMultiSelect';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  root?.unmount();
  host?.remove();
  document.body.querySelector('[role="menu"]')?.remove();
  root = null;
  host = null;
});

function mount(content: React.ReactNode, width = 380) {
  host = document.createElement('div');
  host.style.width = `${width}px`;
  document.body.append(host);
  root = createRoot(host);
  root.render(content);
}

describe('Settings experience browser layout', () => {
  it('keeps the compact Settings frame vertical and unclipped', async () => {
    mount(
      <SettingsSectionFrame title="Tasks" icon={<span>T</span>}>
        <SettingsControlGroup title="Essentials">
          <button type="button">Task notifications</button>
        </SettingsControlGroup>
        <SettingsControlGroup title="Personalize">
          <button type="button">Import Tasks</button>
        </SettingsControlGroup>
      </SettingsSectionFrame>
    );

    await vi.waitFor(() =>
      expect(host?.querySelector('h2')?.textContent).toBe('Tasks')
    );
    expect(host!.scrollWidth).toBeLessThanOrEqual(host!.clientWidth);
    expect(
      Array.from(host!.querySelectorAll('h3')).map(node => node.textContent)
    ).toEqual(['Essentials', 'Personalize']);
  });

  it('keeps only Settings search sticky', async () => {
    mount(
      <>
        <header data-testid="page-header">Settings</header>
        <SettingsStickySearch isDesktop={false} isIos={false}>
          <input type="search" aria-label="Search" />
        </SettingsStickySearch>
      </>
    );

    await vi.waitFor(() =>
      expect(host?.querySelector('[data-settings-search]')).toBeTruthy()
    );
    const header = host!.querySelector(
      '[data-testid="page-header"]'
    ) as HTMLElement;
    const navigation = host!.querySelector(
      '[data-settings-search]'
    ) as HTMLElement;
    expect(getComputedStyle(header).position).toBe('static');
    expect(getComputedStyle(navigation).position).toBe('sticky');
  });

  it('portals the checkable priority menu outside clipped content', async () => {
    mount(
      <div style={{ overflow: 'hidden', height: 90 }}>
        <TaskPriorityMultiSelect value={['urgent']} onChange={vi.fn()} />
      </div>
    );

    await vi.waitFor(() =>
      expect(
        host?.querySelector('[aria-label="Task reminder priorities"]')
      ).toBeTruthy()
    );
    (
      host!.querySelector(
        '[aria-label="Task reminder priorities"]'
      ) as HTMLButtonElement
    ).click();

    await vi.waitFor(() =>
      expect(document.body.querySelector('[role="menu"]')).toBeTruthy()
    );
    const menu = document.body.querySelector('[role="menu"]') as HTMLElement;
    expect(host!.contains(menu)).toBe(false);
    expect(menu.querySelectorAll('input[type="checkbox"]')).toHaveLength(4);
  });
});
