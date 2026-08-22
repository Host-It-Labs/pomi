import './styles.css';

type PlatformId = 'macos' | 'windows' | 'linux' | 'ios' | 'android' | 'other';
type TimerMode = 'work' | 'break';
type IntentionId = 'debug' | 'read' | 'inbox' | 'focus' | 'plan' | 'write';
type StatisticId = 'work' | 'break' | 'long-break';
type StatisticMetric = 'hours' | 'count';

type DownloadTarget = {
  id: PlatformId;
  label: string;
  buttonLabel: string;
  url: string | null;
};

const configuredUrl = (value: unknown) => {
  const candidate = typeof value === 'string' ? value.trim() : '';
  if (!candidate) return null;

  if (candidate.startsWith('/')) return candidate;

  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? candidate
      : null;
  } catch {
    return null;
  }
};

const githubUrl = 'https://github.com/NeoHuncho/pomi';
const releasesUrl = `${githubUrl}/releases/latest`;
const selfHostingUrl = `${githubUrl}/blob/main/docs/self-hosting.md`;
const privacyUrl =
  configuredUrl(import.meta.env.VITE_PRIVACY_URL) ??
  `${githubUrl}/blob/main/docs/privacy.md`;
const configuredTermsUrl = configuredUrl(import.meta.env.VITE_TERMS_URL);
const legalUrl = configuredTermsUrl ?? `${githubUrl}/blob/main/LICENSE`;
const legalLabel = configuredTermsUrl ? 'Terms' : 'License';

const appStoreUrl = configuredUrl(import.meta.env.VITE_APP_STORE_URL);
const playStoreUrl = configuredUrl(import.meta.env.VITE_PLAY_STORE_URL);

const icon = (content: string) => `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${content}</svg>
`;

const icons = {
  arrow: icon(
    '<path d="M5 12h14m-6-6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'
  ),
  check: icon(
    '<path d="m6.5 12.5 3.2 3.2 7.8-8.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
  ),
  pause: icon(
    '<path d="M8.5 6.5v11m7-11v11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'
  ),
  play: icon(
    '<path d="m9 7 8 5-8 5V7Z" fill="currentColor" stroke="currentColor" stroke-linejoin="round"/>'
  ),
  forward: icon(
    '<path d="m7 7 6 5-6 5V7Zm7 0 6 5-6 5V7Z" fill="currentColor"/>'
  ),
  reset: icon(
    '<path d="M6.3 8.2A7 7 0 1 1 5 14m1.3-5.8V4.7m0 3.5H2.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'
  ),
  pin: icon(
    '<path d="m14 4 6 6-2.3 1.1-3.4 3.5.4 3.1-1.1 1.1-8.4-8.4 1.1-1.1 3.1.4 3.5-3.5L14 4ZM5 19l4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
  ),
  server: icon(
    '<rect x="4" y="4" width="16" height="6" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="4" y="14" width="16" height="6" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 7h.01M8 17h.01M12 7h5M12 17h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
  ),
  github: icon(
    '<path d="M12 2.8a9.4 9.4 0 0 0-3 18.3c.5.1.7-.2.7-.5v-1.8c-2.8.6-3.4-1.2-3.4-1.2-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 0 1.6 1.1 1.6 1.1.9 1.6 2.4 1.1 3 .9.1-.7.4-1.1.7-1.4-2.3-.3-4.6-1.1-4.6-4.7 0-1 .4-1.9 1-2.6-.1-.3-.4-1.3.1-2.6 0 0 .8-.3 2.7 1a9.2 9.2 0 0 1 4.9 0c1.9-1.3 2.7-1 2.7-1 .5 1.3.2 2.3.1 2.6.6.7 1 1.6 1 2.6 0 3.6-2.3 4.4-4.6 4.7.4.3.7 1 .7 1.9v2.9c0 .3.2.6.7.5a9.4 9.4 0 0 0-3-18.3Z" fill="currentColor"/>'
  ),
  chevron: icon(
    '<path d="m8 10 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'
  ),
};

const logo = (className = '') => `
  <img class="pomi-logo ${className}" src="/pomi-icon.png" alt="" width="512" height="512" />
`;

const detectPlatform = (): PlatformId => {
  const navigatorWithData = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const platform =
    navigatorWithData.userAgentData?.platform ??
    navigator.platform ??
    navigator.userAgent;
  const userAgent = navigator.userAgent;

  if (/android/i.test(userAgent)) return 'android';
  if (
    /iphone|ipad|ipod/i.test(userAgent) ||
    (/mac/i.test(platform) && navigator.maxTouchPoints > 1)
  ) {
    return 'ios';
  }
  if (/mac/i.test(platform)) return 'macos';
  if (/win/i.test(platform)) return 'windows';
  if (/linux/i.test(platform)) return 'linux';
  return 'other';
};

const downloads: DownloadTarget[] = [
  {
    id: 'macos',
    label: 'macOS',
    buttonLabel: 'Download for Mac',
    url:
      configuredUrl(import.meta.env.VITE_MACOS_DOWNLOAD_URL) ??
      appStoreUrl ??
      releasesUrl,
  },
  {
    id: 'windows',
    label: 'Windows',
    buttonLabel: 'Download for Windows',
    url:
      configuredUrl(import.meta.env.VITE_WINDOWS_DOWNLOAD_URL) ?? releasesUrl,
  },
  {
    id: 'linux',
    label: 'Linux',
    buttonLabel: 'Download for Linux',
    url: configuredUrl(import.meta.env.VITE_LINUX_DOWNLOAD_URL) ?? releasesUrl,
  },
  {
    id: 'ios',
    label: 'iPhone & iPad',
    buttonLabel: 'Download for iPhone',
    url: appStoreUrl,
  },
  {
    id: 'android',
    label: 'Android',
    buttonLabel: 'Download for Android',
    url: playStoreUrl,
  },
];

const currentPlatform = detectPlatform();
const currentDownload = downloads.find(
  download => download.id === currentPlatform
) ?? {
  id: 'other' as const,
  label: 'your device',
  buttonLabel: 'Download Pomi',
  url: releasesUrl,
};

const downloadLink = (
  target: DownloadTarget,
  className = 'device-menu-link'
) =>
  target.url
    ? `<a class="${className}" href="${target.url}" target="_blank" rel="noreferrer"><span>${target.label}</span>${icons.arrow}</a>`
    : `<span class="${className} is-unavailable" aria-disabled="true"><span>${target.label}<small>Coming soon</small></span></span>`;

const currentDownloadButton = currentDownload.url
  ? `<a class="button button-primary current-download" href="${currentDownload.url}" target="_blank" rel="noreferrer">
      <span>${currentDownload.buttonLabel}</span>${icons.arrow}
    </a>`
  : `<span class="button button-primary button-disabled current-download" aria-disabled="true">
      <span>${currentDownload.buttonLabel}</span><small>Coming soon</small>
    </span>`;

const deviceDownloads = `
  <div class="device-downloads">
    ${currentDownloadButton}
    <details class="device-menu">
      <summary class="button button-secondary">Other devices ${icons.chevron}</summary>
      <div class="device-menu-popover">
        <p>Get Pomi elsewhere</p>
        ${downloads
          .filter(download => download.id !== currentDownload.id)
          .map(download => downloadLink(download))
          .join('')}
      </div>
    </details>
  </div>
`;

const headerInstallMenu = `
  <details class="header-install-menu">
    <summary class="header-install-button">Install ${icons.chevron}</summary>
    <div class="device-menu-popover header-install-popover">
      <p>Install Pomi</p>
      ${[
        currentDownload,
        ...downloads.filter(download => download.id !== currentDownload.id),
      ]
        .map(download => downloadLink(download, 'device-menu-link'))
        .join('')}
    </div>
  </details>
`;

const intentions: Array<{
  id: IntentionId;
  emoji: string;
  label: string;
  count: string;
  countValue: number;
}> = [
  {
    id: 'debug',
    emoji: '🐛',
    label: 'Debug',
    count: '4 Timers today',
    countValue: 4,
  },
  {
    id: 'read',
    emoji: '📚',
    label: 'Read',
    count: '2 Timers today',
    countValue: 2,
  },
  {
    id: 'inbox',
    emoji: '📬',
    label: 'Inbox',
    count: '1 Timer today',
    countValue: 1,
  },
  {
    id: 'focus',
    emoji: '🎯',
    label: 'Focus',
    count: 'No Timers today',
    countValue: 0,
  },
  {
    id: 'plan',
    emoji: '🗺️',
    label: 'Plan',
    count: '3 Timers this week',
    countValue: 3,
  },
  {
    id: 'write',
    emoji: '✍️',
    label: 'Write',
    count: '1 Timer today',
    countValue: 1,
  },
];

const tasks = [
  {
    id: 'regression',
    title: 'Investigate the timer regression',
    meta: 'Urgent · Debug',
    pinned: true,
  },
  {
    id: 'notifications',
    title: 'Verify notification recovery',
    meta: 'High · Debug',
    pinned: false,
  },
  {
    id: 'empty-state',
    title: 'Refine the Tasks empty state',
    meta: 'Today · Design',
    pinned: false,
  },
  {
    id: 'roadmap',
    title: 'Review roadmap assumptions',
    meta: 'Focus · Work',
    pinned: false,
  },
];

const intentionButtons = (surface: string) =>
  intentions
    .slice(0, 3)
    .map(
      intention => `
        <button class="mock-intention" type="button" data-intention="${intention.id}" aria-pressed="${intention.id === 'debug'}">
          <span>${intention.emoji}</span><b>${intention.label}</b>
          <small>${intention.count.replace(' today', '')}</small>
          <i>${surface === 'phone' ? '' : '0'}</i>
        </button>
      `
    )
    .join('');

const mockTaskRows = (limit: number) =>
  tasks
    .slice(0, limit)
    .map(
      task => `
        <button class="mock-task" type="button" data-task-id="${task.id}" aria-pressed="false">
          <span class="mock-task-check">${icons.check}</span>
          <span class="mock-task-copy"><b>${task.title}</b><small>${task.meta}</small></span>
          ${task.pinned ? `<span class="mock-task-pin">${icons.pin}</span>` : ''}
        </button>
      `
    )
    .join('');

const timerAction = (
  action: 'reset' | 'pause' | 'skip',
  label: string,
  actionIcon: string,
  className = ''
) => `
  <button class="mock-action ${className}" type="button" data-timer-action="${action}" aria-label="${label}" title="${label}">
    <span data-action-icon>${actionIcon}</span>
  </button>
`;

const timerRing = () => `
  <div class="mock-timer-ring">
    <svg viewBox="0 0 320 320" aria-hidden="true">
      <circle class="timer-track" cx="160" cy="160" r="136"></circle>
      <circle class="timer-progress" data-shared-progress cx="160" cy="160" r="136"></circle>
    </svg>
    <button class="mock-timer-copy" type="button" data-timer-toggle aria-label="Pause timer">
      <span data-current-intention>🐛 Debug</span>
      <strong data-shared-time>18:42</strong>
      <small data-timer-mode>Work timer</small>
    </button>
    <div class="mock-timer-actions">
      ${timerAction('reset', 'Reset timer', icons.reset)}
      ${timerAction('pause', 'Pause timer', icons.pause, 'is-primary')}
      ${timerAction('skip', 'Skip to Break', icons.forward)}
    </div>
  </div>
`;

const appPreview = (surface: 'desktop' | 'phone') => `
  <div class="mock-app mock-app-${surface}">
    <div class="mock-app-header">
      <span>${logo('mock-app-logo')}<b>Pomi</b></span>
      <span class="mock-sync-dot"><i></i>Synced</span>
    </div>
    <div class="mock-intentions" aria-label="Choose an intention">
      ${intentionButtons(surface)}
    </div>
    <div class="mock-timer-stage">
      ${timerRing()}
    </div>
    <div class="mock-tasks">
      <p><span>Tasks</span><small>${surface === 'phone' ? '4 visible' : '3 visible'}</small></p>
      <div>${mockTaskRows(surface === 'phone' ? 4 : 3)}</div>
    </div>
  </div>
`;

const heroDevices = `
  <div class="device-orbit interactive-orbit">
    <div class="device-layer hero-laptop" data-device="laptop">
      <div class="laptop-device">
        <div class="laptop-screen">
          <div class="desktop-wallpaper">
            <div class="desktop-menu-bar"><span>Pomi&nbsp;&nbsp; File&nbsp;&nbsp; Edit</span><time>09:41</time></div>
            <div class="desktop-app-window">
              <div class="desktop-window-bar">
                <span><i></i><i></i><i></i></span><b>Pomi</b>
              </div>
              ${appPreview('desktop')}
            </div>
            <div class="desktop-dock" aria-hidden="true">
              <i class="dock-finder"></i>
              <i class="dock-browser"></i>
              <i class="dock-pomi"></i>
              <i class="dock-notes"></i>
              <i class="dock-settings"></i>
              <i class="dock-trash"></i>
            </div>
          </div>
        </div>
        <div class="laptop-hinge"></div>
        <div class="laptop-base"><span></span></div>
      </div>
    </div>

    <div class="device-layer hero-phone" data-device="phone">
      <div class="phone-device-v2">
        <span class="phone-island-v2"></span>
        ${appPreview('phone')}
      </div>
    </div>

    <div class="device-layer hero-watch" data-device="watch">
      <div class="watch-device-v2">
        <span class="watch-crown-v2"></span>
        <div class="watch-face-v2">
          <small data-timer-mode>Work</small>
          <strong data-shared-time>18:42</strong>
          <span data-current-intention>🐛 Debug</span>
          <div class="watch-actions-v2">
            ${timerAction('pause', 'Pause timer', icons.pause, 'is-primary')}
            ${timerAction('skip', 'Skip to Break', icons.forward)}
          </div>
        </div>
      </div>
    </div>
  </div>
`;

const taskMotif = `
  <div class="task-motif interactive-motif" data-task-panel-view="intention">
    <div class="task-demo-header">
      <div class="task-mode-toggle" role="group" aria-label="Task mode">
        <button class="is-current" type="button" data-task-view="intention" aria-pressed="true">Intention</button>
        <button type="button" data-task-view="general" aria-pressed="false">General</button>
      </div>
      <span><b>3</b> visible</span>
    </div>
    <div class="task-stack" aria-label="Interactive task list">
      ${tasks
        .slice(0, 3)
        .map(
          (task, index) => `
            <button class="editorial-task task-${['one', 'two', 'three'][index]}" type="button" data-task-id="${task.id}" data-priority="${index === 0 ? 'urgent' : index === 1 ? 'high' : 'normal'}" data-pinned="${task.pinned}" data-overdue="${index === 2}" aria-pressed="false">
              <span class="editorial-check">${icons.check}</span>
              <span class="editorial-task-copy"><small>${task.meta}</small><strong>${task.title}</strong></span>
              <em>${index === 0 ? 'Urgent' : index === 1 ? 'Due today' : 'High'}</em>
              <span class="task-row-actions">${task.pinned ? `<i class="is-pinned">${icons.pin}</i>` : `<i>${icons.pin}</i>`}<i class="task-edit-mark">•••</i></span>
            </button>
          `
        )
        .join('')}
    </div>
    <div class="task-demo-footer"><span>Click a row to complete it</span><span>3–5 Tasks stay beside the Timer</span></div>
  </div>
`;

const heatmapLevels = [0, 1, 3, 1, 0, 2, 4, 2, 1, 3, 0, 2, 1, 0];
const heatmapMonths = ['August 2026', 'July 2026', 'June 2026'];
const heatmap = heatmapMonths
  .map(
    (month, monthIndex) => `
      <section class="heatmap-month">
        <p>${month}</p>
        <div class="heatmap-calendar">
          ${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(day => `<span>${day}</span>`).join('')}
          ${Array.from({ length: 35 }, (_, index) => {
            const level =
              heatmapLevels[
                (index * 5 + monthIndex * 3 + Math.floor(index / 7)) %
                  heatmapLevels.length
              ];
            return `<i data-heatmap-cell data-level="${level}" title="${month.split(' ')[0]} ${index + 1}: ${level === 0 ? 'No activity' : `${level * 25} minutes`}"></i>`;
          }).join('')}
        </div>
      </section>
    `
  )
  .join('');

const statisticsMotif = `
  <div class="statistics-motif interactive-statistics">
    <div class="statistics-demo-header">
      <span><b>Timer statistics</b><small>Last 12 weeks</small></span>
    </div>
    <div class="statistics-filter-card">
      <div class="statistics-type" role="group" aria-label="Timer type">
        <button class="is-current" type="button" data-statistic="work" aria-pressed="true">Work</button>
        <button type="button" data-statistic="break" aria-pressed="false">Break</button>
        <button type="button" data-statistic="long-break" aria-pressed="false">Long break</button>
      </div>
      <div class="statistics-metric" role="group" aria-label="Measure">
        <button class="is-current" type="button" data-statistic-metric="hours" aria-pressed="true">Hours</button>
        <button type="button" data-statistic-metric="count" aria-pressed="false">Count</button>
      </div>
    </div>
    <div class="statistics-period-strip" data-statistic-periods aria-live="polite">
      ${[
        ['Today', '2h 25m', '+12%'],
        ['Week', '14h 10m', '+25%'],
        ['Month', '48h 35m', '+8%'],
        ['Year', '214h', '+31%'],
      ]
        .map(
          ([label, value, change], index) => `
            <article>
              <span>${label}</span>
              <strong ${index === 1 ? 'data-statistic-total' : ''} data-period-value="${index}">${value}</strong>
              <small data-period-change="${index}">${change}</small>
            </article>
          `
        )
        .join('')}
    </div>
    <section class="activity-field">
      <header><b>Activity</b><small data-activity-unit>Hours</small></header>
      <div class="calendar-heatmap" data-heatmap>${heatmap}</div>
      <div class="heatmap-legend"><span>Less</span><i data-level="0"></i><i data-level="1"></i><i data-level="2"></i><i data-level="3"></i><i data-level="4"></i><span>More</span></div>
    </section>
    <section class="ranking-card">
      <header>
        <b>Ranking</b>
        <div class="ranking-period" role="group" aria-label="Ranking period">
          <button type="button" data-ranking-period="today" aria-pressed="false">Today</button>
          <button class="is-current" type="button" data-ranking-period="week" aria-pressed="true">Week</button>
          <button type="button" data-ranking-period="month" aria-pressed="false">Month</button>
          <button type="button" data-ranking-period="year" aria-pressed="false">Year</button>
        </div>
      </header>
      <div class="ranking-lines" data-rankings>
        <p><span><i>1</i> 📚 Read</span><small>4h 10m</small><b style="--rank: 100%"></b></p>
        <p><span><i>2</i> 🐛 Debug</span><small>3h 20m</small><b style="--rank: 78%"></b></p>
        <p><span><i>3</i> 🏋️ Workout</span><small>1h 40m</small><b style="--rank: 42%"></b></p>
      </div>
    </section>
  </div>
`;

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <a class="skip-link" href="#main">Skip to content</a>

  <header class="sticky-header">
    <div class="site-header shell">
      <a class="brand" href="#top" aria-label="Pomi home">${logo()}<span>Pomi</span></a>
      <div class="header-actions">
        <span class="header-docs" aria-disabled="true">Docs</span>
        ${headerInstallMenu}
      </div>
    </div>
  </header>

  <main id="main">
    <section class="hero hero-v2 shell" id="top">
      <div class="hero-copy">
        <p class="eyebrow"><span></span> Focus with intention</p>
        <h1>Make time for what matters.</h1>
        <p class="hero-lead">Choose an Intention, start a Timer, and keep the right Tasks close—wherever you focus.</p>
        <div class="hero-proof" aria-label="Pomi availability">
          <span>Source available</span><i></i><span>Run locally</span><i></i><span>Docker ready</span>
        </div>
      </div>
      <figure class="hero-stage" aria-label="Interactive Pomi timer running on a laptop, phone, and watch">
        ${heroDevices}
        <figcaption>Try it: pause any device or press <kbd>Esc</kbd> for a Break timer</figcaption>
      </figure>
      <div class="hero-actions-panel">
        ${deviceDownloads}
        <p class="interaction-note"><span class="live-dot"></span><b data-timer-status>Work timer running</b> — every screen stays in sync.</p>
      </div>
    </section>

    <section class="source-proof-section" id="self-host">
      <div class="shell source-proof-layout">
        <div class="source-proof-copy">
          <p class="eyebrow"><span></span> Source available · self-hostable</p>
          <h2>Run Pomi on your own terms.</h2>
          <p>Inspect the public source, run Pomi locally, or self-host the full stack with Docker. Noncommercial use is covered by the PolyForm Noncommercial License.</p>
          <div class="source-actions">
            <a class="button button-primary" href="${githubUrl}" target="_blank" rel="noreferrer">${icons.github}<span>View source</span></a>
            <a class="button button-secondary" href="${selfHostingUrl}" target="_blank" rel="noreferrer"><span>Self-hosting guide</span>${icons.arrow}</a>
          </div>
        </div>
        <div class="docker-terminal" aria-label="Example Docker self-hosting command">
          <div class="terminal-bar"><span><i></i><i></i><i></i></span><b>pomi / self-host</b></div>
          <div class="terminal-body">
            <p><span>$</span> git clone github.com/NeoHuncho/pomi.git</p>
            <p><span>$</span> cp packages/backend/.env.production.example pomi.env</p>
            <p class="terminal-command"><span>$</span> docker compose --env-file pomi.env \\<br />&nbsp;&nbsp;-f packages/backend/docker-compose.yml up -d --build</p>
            <div class="terminal-health"><i></i><span>backend</span><b>healthy</b><small>127.0.0.1:3000</small></div>
          </div>
        </div>
      </div>
    </section>

    <section class="intentions-band" id="intentions">
      <div class="shell intentions-layout">
        <div class="section-copy">
          <p class="eyebrow"><span></span> Intentions</p>
          <h2>Name what this Timer is for.</h2>
          <p>An Intention connects a Timer to the work behind it. Pick one here and watch it change across every device above.</p>
          <p class="demo-hint">Interactive demo · choose an Intention</p>
        </div>
        <div class="intention-sequence" aria-label="Choose a Pomi Intention">
          <div class="intention-demo-header">
            <span><b>Work Timer</b><small>Choose an Intention</small></span>
            <span class="intention-page">1 / 1</span>
          </div>
          <div class="intention-grid">
            ${intentions
              .map(
                (intention, index) => `
                  <button class="intention-card ${intention.id === 'debug' ? 'is-current' : ''}" type="button" data-intention="${intention.id}" aria-pressed="${intention.id === 'debug'}">
                    <span class="intention-card-emoji"><i>${intention.emoji}</i>${intention.countValue > 0 ? `<em>${intention.countValue}</em>` : ''}</span>
                    <span class="intention-card-copy"><b>${intention.label}</b><small>${intention.count}</small></span>
                    <kbd>${index + 1}</kbd>
                  </button>
                `
              )
              .join('')}
          </div>
          <div class="intention-demo-footer"><span>Selected Intentions stay with the Timer</span><i></i><span>6 available</span></div>
        </div>
      </div>
    </section>

    <section class="editorial-section shell" id="tasks">
      <div class="section-copy">
        <p class="eyebrow"><span></span> Tasks</p>
        <h2>The next Task stays beside the Timer.</h2>
        <p>Pin the work that matters now. The Timer view keeps three to five matching Tasks close without turning focus into project management.</p>
        <ul class="feature-list">
          <li>${icons.check}<span>Due dates, recurrence, and priority</span></li>
          <li>${icons.check}<span>Intention and General task modes</span></li>
          <li>${icons.check}<span>Click a demo Task to complete it</span></li>
        </ul>
      </div>
      ${taskMotif}
    </section>

    <section class="editorial-section statistics-section shell" id="statistics">
      ${statisticsMotif}
      <div class="section-copy">
        <p class="eyebrow"><span></span> Timer Statistics</p>
        <h2>See where the Timers went.</h2>
        <p>Switch between Work, Break, and Long break to explore hours, activity, and the Intentions that received your attention.</p>
        <p class="demo-hint">Interactive demo · change the Timer type</p>
      </div>
    </section>

    <section class="pricing-section shell" id="download">
      <div class="pricing-copy">
        <p class="eyebrow"><span></span> Choose your setup</p>
        <h2>Hosted by Pomi, or hosted by you.</h2>
        <p>Use the managed service across every device, or run the source-available stack on infrastructure you control.</p>
      </div>

      <article class="price-card">
        <div class="price-card-heading"><span>Hosted Pomi</span><small>All devices</small></div>
        <p class="price"><sup>$</sup><strong>24</strong><span>.99<small>per year</small></span></p>
        <p class="equivalent">About $2.08/month</p>
        <ul>
          <li>${icons.check}<span>Timer state across your devices</span></li>
          <li>${icons.check}<span>Native Timer and Task notifications</span></li>
          <li>${icons.check}<span>Intentions, Tasks, and Statistics</span></li>
        </ul>
        <div class="price-actions">
          ${currentDownloadButton.replace(' current-download', '')}
        </div>
        <p class="monthly">Or $2.99/month.</p>
      </article>

      <article class="self-host-card">
        <span class="server-icon">${icons.server}</span>
        <p class="eyebrow"><span></span> Your server</p>
        <h3>Self-host Pomi</h3>
        <p>Run the backend, PostgreSQL, and Redis with Docker, then point every Pomi app at your own HTTPS endpoint.</p>
        <a href="${selfHostingUrl}" target="_blank" rel="noreferrer">Read the self-hosting guide ${icons.arrow}</a>
      </article>
    </section>
  </main>

  <footer class="site-footer shell">
    <a class="brand" href="#top" aria-label="Pomi home">${logo()}<span>Pomi</span></a>
    <p>Work, Break, and Long-break Timers with Intentions and Tasks.</p>
    <nav aria-label="Footer navigation">
      <a href="${privacyUrl}" target="_blank" rel="noreferrer">Privacy</a>
      <a href="${legalUrl}" target="_blank" rel="noreferrer">${legalLabel}</a>
      <a href="${githubUrl}" target="_blank" rel="noreferrer">GitHub</a>
    </nav>
    <span>© ${new Date().getFullYear()} Pomi</span>
  </footer>

  <div class="sr-only" role="status" aria-live="polite" data-demo-announcement></div>
`;

const timerCircumference = 2 * Math.PI * 136;
const timerDurations: Record<TimerMode, number> = {
  work: 25 * 60,
  break: 5 * 60,
};
const timerState = {
  mode: 'work' as TimerMode,
  duration: timerDurations.work,
  remaining: 18 * 60 + 42,
  running: true,
  lastUpdatedAt: performance.now(),
};
let currentIntention: IntentionId = 'debug';
const completedTasks = new Set<string>();

const announce = (message: string) => {
  const region = document.querySelector<HTMLElement>(
    '[data-demo-announcement]'
  );
  if (region) region.textContent = message;
};

const formatTime = (secondsValue: number) => {
  const seconds = Math.max(0, Math.ceil(secondsValue));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds % 60).toString().padStart(2, '0')}`;
};

const renderTimer = () => {
  const label = formatTime(timerState.remaining);
  const progress =
    (timerState.remaining / timerState.duration) * timerCircumference;
  const modeLabel = timerState.mode === 'work' ? 'Work timer' : 'Break timer';
  const shortModeLabel = timerState.mode === 'work' ? 'Work' : 'Break';
  const status = `${modeLabel} ${timerState.running ? 'running' : 'paused'}`;

  document.body.dataset.timerTheme = timerState.mode;

  document
    .querySelectorAll<HTMLElement>('[data-shared-time]')
    .forEach(element => {
      element.textContent = label;
    });

  document
    .querySelectorAll<SVGCircleElement>('[data-shared-progress]')
    .forEach(element => {
      element.style.strokeDasharray = `${progress} ${timerCircumference}`;
    });

  document
    .querySelectorAll<HTMLElement>('[data-timer-mode]')
    .forEach(element => {
      element.textContent =
        element.closest('.watch-face-v2') === null ? modeLabel : shortModeLabel;
    });

  document
    .querySelectorAll<HTMLButtonElement>('[data-timer-action="pause"]')
    .forEach(button => {
      const labelText = timerState.running ? 'Pause timer' : 'Resume timer';
      button.setAttribute('aria-label', labelText);
      button.title = labelText;
      button.setAttribute('aria-pressed', String(!timerState.running));
      const actionIcon =
        button.querySelector<HTMLElement>('[data-action-icon]');
      if (actionIcon) {
        actionIcon.innerHTML = timerState.running ? icons.pause : icons.play;
      }
    });

  document
    .querySelectorAll<HTMLButtonElement>('[data-timer-action="skip"]')
    .forEach(button => {
      const target = timerState.mode === 'work' ? 'Break' : 'Work';
      button.setAttribute('aria-label', `Skip to ${target}`);
      button.title = `Skip to ${target}`;
    });

  document
    .querySelectorAll<HTMLElement>('[data-timer-toggle]')
    .forEach(element => {
      element.setAttribute(
        'aria-label',
        timerState.running ? 'Pause timer' : 'Resume timer'
      );
    });

  const statusElement = document.querySelector<HTMLElement>(
    '[data-timer-status]'
  );
  if (statusElement) statusElement.textContent = status;
};

const setTimerMode = (mode: TimerMode, shouldAnnounce = true) => {
  timerState.mode = mode;
  timerState.duration = timerDurations[mode];
  timerState.remaining = timerState.duration;
  timerState.running = true;
  timerState.lastUpdatedAt = performance.now();
  renderTimer();
  if (shouldAnnounce) {
    announce(`${mode === 'work' ? 'Work' : 'Break'} timer started.`);
  }
};

const runTimerAction = (action: string) => {
  timerState.lastUpdatedAt = performance.now();

  if (action === 'pause') {
    timerState.running = !timerState.running;
    announce(timerState.running ? 'Timer resumed.' : 'Timer paused.');
  } else if (action === 'reset') {
    timerState.remaining = timerState.duration;
    timerState.running = true;
    announce('Timer reset.');
  } else if (action === 'skip') {
    setTimerMode(timerState.mode === 'work' ? 'break' : 'work');
    return;
  }

  renderTimer();
};

const selectIntention = (id: IntentionId) => {
  const intention = intentions.find(item => item.id === id);
  if (!intention) return;

  currentIntention = id;
  document
    .querySelectorAll<HTMLButtonElement>('[data-intention]')
    .forEach(button => {
      const selected = button.dataset.intention === id;
      button.classList.toggle('is-current', selected);
      button.setAttribute('aria-pressed', String(selected));
    });

  document
    .querySelectorAll<HTMLElement>('[data-current-intention]')
    .forEach(element => {
      element.textContent = `${intention.emoji} ${intention.label}`;
    });

  announce(`${intention.label} Intention selected.`);
};

const toggleTask = (id: string) => {
  if (completedTasks.has(id)) {
    completedTasks.delete(id);
  } else {
    completedTasks.add(id);
  }
  const completed = completedTasks.has(id);

  document
    .querySelectorAll<HTMLButtonElement>(`[data-task-id="${id}"]`)
    .forEach(button => {
      button.classList.toggle('is-complete', completed);
      button.setAttribute('aria-pressed', String(completed));
    });

  const task = tasks.find(item => item.id === id);
  announce(
    `${task?.title ?? 'Task'} marked ${completed ? 'complete' : 'incomplete'}.`
  );
};

const statisticData: Record<
  StatisticId,
  {
    periods: Array<{
      label: string;
      hours: string;
      count: string;
      change: string;
    }>;
    levels: number[];
    rankings: Array<[string, string, string, string, number]>;
  }
> = {
  work: {
    periods: [
      { label: 'Today', hours: '2h 25m', count: '5', change: '+12%' },
      { label: 'Week', hours: '14h 10m', count: '28', change: '+25%' },
      { label: 'Month', hours: '48h 35m', count: '96', change: '+8%' },
      { label: 'Year', hours: '214h', count: '426', change: '+31%' },
    ],
    levels: [0, 1, 3, 1, 0, 2, 4, 2, 1, 3, 0, 2, 1, 0],
    rankings: [
      ['📚', 'Read', '4h 10m', '9', 100],
      ['🐛', 'Debug', '3h 20m', '7', 78],
      ['🏋️', 'Workout', '1h 40m', '4', 42],
    ],
  },
  break: {
    periods: [
      { label: 'Today', hours: '35m', count: '4', change: '+5%' },
      { label: 'Week', hours: '3h 35m', count: '21', change: '+8%' },
      { label: 'Month', hours: '12h 20m', count: '74', change: '+3%' },
      { label: 'Year', hours: '62h', count: '371', change: '+18%' },
    ],
    levels: [0, 1, 2, 0, 1, 3, 2, 1, 0, 2, 0, 1, 2, 1],
    rankings: [
      ['☕', 'Coffee', '1h 25m', '8', 100],
      ['🌿', 'Outside', '1h 05m', '6', 74],
      ['🧘', 'Reset', '45m', '4', 48],
    ],
  },
  'long-break': {
    periods: [
      { label: 'Today', hours: '0m', count: '0', change: '—' },
      { label: 'Week', hours: '1h 40m', count: '2', change: '+1' },
      { label: 'Month', hours: '6h 15m', count: '8', change: '+14%' },
      { label: 'Year', hours: '28h', count: '37', change: '+9%' },
    ],
    levels: [0, 0, 1, 0, 0, 2, 0, 0, 1, 0, 0, 3, 0, 1],
    rankings: [
      ['🥪', 'Lunch', '55m', '1', 100],
      ['🚶', 'Walk', '30m', '1', 58],
      ['📖', 'Offline', '15m', '1', 30],
    ],
  },
};

let currentStatistic: StatisticId = 'work';
let statisticMetric: StatisticMetric = 'hours';

const renderStatistic = () => {
  const data = statisticData[currentStatistic];
  const motif = document.querySelector<HTMLElement>('.interactive-statistics');
  if (motif) motif.dataset.statisticTheme = currentStatistic;

  data.periods.forEach((period, index) => {
    const value = document.querySelector<HTMLElement>(
      `[data-period-value="${index}"]`
    );
    const change = document.querySelector<HTMLElement>(
      `[data-period-change="${index}"]`
    );
    if (value) value.textContent = period[statisticMetric];
    if (change) change.textContent = period.change;
  });

  const activityUnit = document.querySelector<HTMLElement>(
    '[data-activity-unit]'
  );
  if (activityUnit) {
    activityUnit.textContent = statisticMetric === 'hours' ? 'Hours' : 'Timers';
  }

  document
    .querySelectorAll<HTMLElement>('[data-heatmap-cell]')
    .forEach((cell, index) => {
      cell.dataset.level = String(
        data.levels[(index * 5 + Math.floor(index / 7)) % data.levels.length]
      );
    });

  const rankings = document.querySelector<HTMLElement>('[data-rankings]');
  if (rankings) {
    rankings.innerHTML = data.rankings
      .map(
        ([emoji, label, hours, count, rank], index) => `
          <p><span><i>${index + 1}</i> ${emoji} ${label}</span><small>${statisticMetric === 'hours' ? hours : `${count} Timers`}</small><b style="--rank: ${rank}%"></b></p>
        `
      )
      .join('');
  }
};

const selectStatistic = (id: StatisticId) => {
  currentStatistic = id;

  document
    .querySelectorAll<HTMLButtonElement>('[data-statistic]')
    .forEach(button => {
      const selected = button.dataset.statistic === id;
      button.classList.toggle('is-current', selected);
      button.setAttribute('aria-pressed', String(selected));
    });

  renderStatistic();
  announce(`${id === 'long-break' ? 'Long break' : id} statistics selected.`);
};

const selectStatisticMetric = (metric: StatisticMetric) => {
  statisticMetric = metric;
  document
    .querySelectorAll<HTMLButtonElement>('[data-statistic-metric]')
    .forEach(button => {
      const selected = button.dataset.statisticMetric === metric;
      button.classList.toggle('is-current', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
  renderStatistic();
  announce(`Statistics now show ${metric}.`);
};

document.addEventListener('click', event => {
  const target = event.target as HTMLElement;

  const timerActionButton = target.closest<HTMLButtonElement>(
    '[data-timer-action]'
  );
  if (timerActionButton) {
    event.stopPropagation();
    runTimerAction(timerActionButton.dataset.timerAction ?? '');
    return;
  }

  const timerToggle = target.closest<HTMLElement>('[data-timer-toggle]');
  if (timerToggle) {
    runTimerAction('pause');
    return;
  }

  const intentionButton = target.closest<HTMLButtonElement>('[data-intention]');
  if (intentionButton?.dataset.intention) {
    selectIntention(intentionButton.dataset.intention as IntentionId);
    return;
  }

  const taskButton = target.closest<HTMLButtonElement>('[data-task-id]');
  if (taskButton?.dataset.taskId) {
    toggleTask(taskButton.dataset.taskId);
    return;
  }

  const statisticButton = target.closest<HTMLButtonElement>('[data-statistic]');
  if (statisticButton?.dataset.statistic) {
    selectStatistic(statisticButton.dataset.statistic as StatisticId);
    return;
  }

  const metricButton = target.closest<HTMLButtonElement>(
    '[data-statistic-metric]'
  );
  if (metricButton?.dataset.statisticMetric) {
    selectStatisticMetric(
      metricButton.dataset.statisticMetric as StatisticMetric
    );
    return;
  }

  const rankingPeriodButton = target.closest<HTMLButtonElement>(
    '[data-ranking-period]'
  );
  if (rankingPeriodButton) {
    document
      .querySelectorAll<HTMLButtonElement>('[data-ranking-period]')
      .forEach(button => {
        const selected = button === rankingPeriodButton;
        button.classList.toggle('is-current', selected);
        button.setAttribute('aria-pressed', String(selected));
      });
    announce(`${rankingPeriodButton.textContent?.trim()} ranking selected.`);
    return;
  }

  const taskViewButton = target.closest<HTMLButtonElement>('[data-task-view]');
  if (taskViewButton?.dataset.taskView) {
    const panel = document.querySelector<HTMLElement>('[data-task-panel-view]');
    if (panel) panel.dataset.taskPanelView = taskViewButton.dataset.taskView;
    document
      .querySelectorAll<HTMLButtonElement>('[data-task-view]')
      .forEach(button => {
        const selected = button === taskViewButton;
        button.classList.toggle('is-current', selected);
        button.setAttribute('aria-pressed', String(selected));
      });
    announce(`${taskViewButton.textContent?.trim()} Tasks selected.`);
  }
});

document.addEventListener('keydown', event => {
  const target = event.target as HTMLElement;
  const isTyping =
    target.matches('input, textarea, select') ||
    target.getAttribute('contenteditable') === 'true';

  if (event.key === 'Escape' && !isTyping) {
    event.preventDefault();
    setTimerMode('break');
  }

  if (
    (event.key === 'Enter' || event.key === ' ') &&
    target.matches('[data-timer-toggle]')
  ) {
    event.preventDefault();
    runTimerAction('pause');
  }
});

window.setInterval(() => {
  const now = performance.now();
  const elapsed = (now - timerState.lastUpdatedAt) / 1000;
  timerState.lastUpdatedAt = now;

  if (timerState.running) {
    timerState.remaining = Math.max(0, timerState.remaining - elapsed);
    if (timerState.remaining === 0) {
      timerState.running = false;
      announce('Timer complete.');
    }
  }

  renderTimer();
}, 250);

selectIntention(currentIntention);
renderStatistic();
renderTimer();
