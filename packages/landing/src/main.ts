import './styles.css';

const configuredUrl = (value: unknown) => {
  const url = typeof value === 'string' ? value.trim() : '';
  return url.length > 0 ? url : null;
};

const appStoreUrl = configuredUrl(import.meta.env.VITE_APP_STORE_URL);
const playStoreUrl = configuredUrl(import.meta.env.VITE_PLAY_STORE_URL);
const privacyUrl = configuredUrl(import.meta.env.VITE_PRIVACY_URL);
const termsUrl = configuredUrl(import.meta.env.VITE_TERMS_URL);
const githubUrl = 'https://github.com/NeoHuncho/pomi';
const runningTime = '18:42';

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
  forward: icon(
    '<path d="m7 7 6 5-6 5V7Zm7 0 6 5-6 5V7Z" fill="currentColor"/>'
  ),
  pin: icon(
    '<path d="m14 4 6 6-2.3 1.1-3.4 3.5.4 3.1-1.1 1.1-8.4-8.4 1.1-1.1 3.1.4 3.5-3.5L14 4ZM5 19l4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
  ),
  server: icon(
    '<rect x="4" y="4" width="16" height="6" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="4" y="14" width="16" height="6" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 7h.01M8 17h.01M12 7h5M12 17h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
  ),
};

const logo = (className = '') => `
  <img class="pomi-logo ${className}" src="/pomi-icon.png" alt="" width="512" height="512" />
`;

const storeAction = (
  label: string,
  url: string | null,
  variant: 'primary' | 'secondary' = 'primary'
) =>
  url
    ? `<a class="button button-${variant}" href="${url}"><span>${label}</span>${icons.arrow}</a>`
    : `<span class="button button-${variant} button-disabled" aria-disabled="true"><span>${label}</span><small>Coming soon</small></span>`;

const legalLink = (label: string, url: string | null) =>
  url ? `<a href="${url}">${label}</a>` : `<span>${label}</span>`;

const timerRing = (className: string, compact = false) => `
  <div class="${className}">
    <svg viewBox="0 0 240 240" aria-hidden="true">
      <circle class="timer-track" cx="120" cy="120" r="102"></circle>
      <circle class="timer-progress" data-shared-progress cx="120" cy="120" r="102"></circle>
    </svg>
    <div class="timer-copy">
      <span>🐛 Debug</span>
      <strong data-shared-time>${runningTime}</strong>
      ${compact ? '' : '<small>Work Timer</small>'}
    </div>
  </div>
`;

const heroDevices = `
  <div class="device-orbit" aria-hidden="true">
    <div class="desktop-device">
      <div class="desktop-topbar">
        <span>${logo('device-logo')}<b>Pomi</b></span>
      </div>
      <div class="desktop-body">
        <div class="desktop-intentions">
          <span class="is-current"><i>🐛</i><b>Debug</b></span>
          <span><i>📚</i><b>Read</b></span>
          <span><i>📬</i><b>Inbox</b></span>
          <span><i>🎯</i><b>Focus</b></span>
        </div>
        ${timerRing('desktop-timer')}
        <div class="desktop-actions"><span>${icons.pause}</span><span>${icons.forward}</span></div>
        <div class="desktop-tasks">
          <p><i></i><span><b>Investigate the timer regression</b><small>🐛 Debug · Urgent</small></span>${icons.pin}</p>
          <p><i></i><span><b>Verify notification recovery</b><small>🐛 Debug · High</small></span></p>
        </div>
      </div>
    </div>

    <div class="phone-device">
      <span class="phone-island"></span>
      <div class="phone-brand">${logo('phone-logo')}<b>Work</b></div>
      ${timerRing('phone-timer', true)}
      <div class="phone-actions"><span>${icons.pause}</span><span>${icons.forward}</span></div>
      <div class="phone-task"><i></i><span><b>Timer regression</b><small>🐛 Debug · Urgent</small></span></div>
    </div>

    <div class="watch-device">
      <span class="watch-crown"></span>
      <div class="watch-face">
        <small>Work</small>
        <strong data-shared-time>${runningTime}</strong>
        <div class="watch-actions"><span>${icons.pause}</span><span>${icons.forward}</span></div>
      </div>
    </div>
  </div>
`;

const taskMotif = `
  <div class="task-motif" aria-hidden="true">
    <div class="motif-word">Tasks</div>
    <div class="task-stack">
      <article class="editorial-task task-one">
        <span class="editorial-check"></span>
        <div><small>🐛 Debug · Work</small><strong>Investigate the timer regression</strong></div>
        <em>Urgent</em>
        <i>${icons.pin}</i>
      </article>
      <article class="editorial-task task-two">
        <span class="editorial-check"></span>
        <div><small>🎯 Focus · Work</small><strong>Review roadmap assumptions</strong></div>
        <em>Due today</em>
      </article>
      <article class="editorial-task task-three">
        <span class="editorial-check"></span>
        <div><small>📚 Read · Work</small><strong>Refine the Tasks empty state</strong></div>
        <em>High</em>
      </article>
    </div>
    <div class="task-axis"><span>Pinned first</span><i></i><span>Up to three beside the Timer</span></div>
  </div>
`;

const heatmap = Array.from({ length: 84 }, (_, index) => {
  const levels = [0, 1, 3, 1, 0, 2, 4, 2, 1, 3, 0, 2, 1, 0];
  return `<i data-level="${levels[(index * 5 + Math.floor(index / 7)) % levels.length]}"></i>`;
}).join('');

const statisticsMotif = `
  <div class="statistics-motif" aria-hidden="true">
    <div class="statistics-type"><span>Work</span><span>Break</span><span>Long break</span></div>
    <div class="statistics-number">
      <span>This week</span>
      <strong>14<small>h</small> 10<small>m</small></strong>
      <em>+25% from last week</em>
    </div>
    <div class="activity-field">
      <p><span>Timer activity</span><small>May — August</small></p>
      <div class="heatmap">${heatmap}</div>
    </div>
    <div class="ranking-lines">
      <p class="rank-read"><span>01&nbsp;&nbsp; 📚 Read</span><b></b><small>4h 10m</small></p>
      <p class="rank-debug"><span>02&nbsp;&nbsp; 🐛 Debug</span><b></b><small>3h 20m</small></p>
      <p class="rank-workout"><span>03&nbsp;&nbsp; 🏋️ Workout</span><b></b><small>1h 40m</small></p>
    </div>
  </div>
`;

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <a class="skip-link" href="#main">Skip to content</a>

  <header class="site-header shell">
    <a class="brand" href="#top" aria-label="Pomi home">${logo()}<span>Pomi</span></a>
    <nav aria-label="Primary navigation">
      <a href="#intentions">Intentions</a>
      <a href="#tasks">Tasks</a>
      <a href="#statistics">Statistics</a>
      <a href="#pricing">Pricing</a>
    </nav>
    <a class="header-link" href="#pricing">Get Pomi ${icons.arrow}</a>
  </header>

  <main id="main">
    <section class="hero shell" id="top">
      <div class="hero-copy">
        <p class="eyebrow"><span></span> Pomi</p>
        <h1>A Timer with a reason.</h1>
        <p class="hero-lead">Choose an Intention, start a Work Timer, and keep the matching Tasks close—on desktop, phone, Apple Watch, and Wear OS.</p>
      </div>
      <figure class="hero-stage" role="img" aria-label="One running Pomi Work Timer on desktop, phone, and Apple Watch">
        ${heroDevices}
        <figcaption>One running Work Timer across your devices</figcaption>
      </figure>
      <div class="hero-actions-panel">
        <div class="store-actions" aria-label="Download Pomi">
          ${storeAction('App Store', appStoreUrl)}
          ${storeAction('Google Play', playStoreUrl, 'secondary')}
        </div>
        <p class="plan-note">Hosted Pomi: $2.99/month or $24.99/year. <a href="#self-host">Self-hosting is free.</a></p>
      </div>
    </section>

    <section class="intentions-band" id="intentions">
      <div class="shell intentions-layout">
        <div class="section-copy">
          <p class="eyebrow"><span></span> Intentions</p>
          <h2>Name what this Timer is for.</h2>
          <p>An Intention connects a Timer to the work behind it. Parent Intentions can lead to active Sub-intentions; completed Timers remain visible in Statistics.</p>
        </div>
        <div class="intention-sequence" aria-label="Example Pomi Intentions">
          <span><i>🐛</i><b>Debug</b><small>4 Timers today</small></span>
          <span><i>📚</i><b>Read</b><small>2 Timers today</small></span>
          <span><i>📬</i><b>Inbox</b><small>1 Timer today</small></span>
          <span><i>🎯</i><b>Focus</b><small>No Timers today</small></span>
        </div>
      </div>
    </section>

    <section class="editorial-section shell" id="tasks">
      <div class="section-copy">
        <p class="eyebrow"><span></span> Tasks</p>
        <h2>The next Task stays beside the Timer.</h2>
        <p>Pin the work that matters now. Filter by Work, Break, or Long break, attach an Intention, and keep up to three matching Tasks visible while the Timer runs.</p>
        <ul class="feature-list">
          <li>${icons.check}<span>Due dates, recurrence, and priority</span></li>
          <li>${icons.check}<span>Intention and General task modes</span></li>
          <li>${icons.check}<span>Task reminders from Pomi Settings</span></li>
        </ul>
      </div>
      ${taskMotif}
    </section>

    <section class="editorial-section statistics-section shell" id="statistics">
      ${statisticsMotif}
      <div class="section-copy">
        <p class="eyebrow"><span></span> Timer Statistics</p>
        <h2>See where the Timers went.</h2>
        <p>Filter Work, Break, and Long break history. Compare hours or count, scan activity over time, and rank the Intentions that received your attention.</p>
      </div>
    </section>

    <section class="pricing-section shell" id="pricing">
      <div class="pricing-copy">
        <p class="eyebrow"><span></span> Hosted Pomi</p>
        <h2>One subscription for every Pomi device.</h2>
        <p>Subscribe before signing in. Your hosted account then unlocks Pomi on phone, desktop, Apple Watch, and Wear OS.</p>
      </div>

      <article class="price-card">
        <div class="price-card-heading"><span>Yearly</span><small>Best value</small></div>
        <p class="price"><sup>$</sup><strong>24</strong><span>.99<small>per year</small></span></p>
        <p class="equivalent">About $2.08/month</p>
        <ul>
          <li>${icons.check}<span>Timer state across your devices</span></li>
          <li>${icons.check}<span>Native Timer and Task notifications</span></li>
          <li>${icons.check}<span>Intentions, Tasks, and Statistics</span></li>
        </ul>
        <div class="price-actions">
          ${storeAction('App Store', appStoreUrl)}
          ${storeAction('Google Play', playStoreUrl, 'secondary')}
        </div>
        <p class="monthly">Or $2.99/month.</p>
      </article>

      <article class="self-host-card" id="self-host">
        <span class="server-icon">${icons.server}</span>
        <p class="eyebrow"><span></span> Your server</p>
        <h3>Self-host Pomi</h3>
        <p>Choose <strong>Self host</strong> on Pomi’s first screen, enter your server URL, then sign in to your own Pomi server. No subscription is required.</p>
        <a href="${githubUrl}" target="_blank" rel="noreferrer">Self-hosting on GitHub ${icons.arrow}</a>
      </article>
    </section>
  </main>

  <footer class="site-footer shell">
    <a class="brand" href="#top" aria-label="Pomi home">${logo()}<span>Pomi</span></a>
    <p>Work, Break, and Long-break Timers with Intentions and Tasks.</p>
    <nav aria-label="Footer navigation">
      ${legalLink('Privacy', privacyUrl)}
      ${legalLink('Terms', termsUrl)}
      <a href="${githubUrl}" target="_blank" rel="noreferrer">GitHub</a>
    </nav>
    <span>© ${new Date().getFullYear()} Pomi</span>
  </footer>
`;

const sharedTimerDurationSeconds = 25 * 60;
const sharedTimerInitialSeconds = 18 * 60 + 42;
const sharedTimerStartedAt = Date.now();
const timerCircumference = 2 * Math.PI * 102;

const renderSharedTimer = () => {
  const elapsedSeconds = Math.floor((Date.now() - sharedTimerStartedAt) / 1000);
  const remainingSeconds = Math.max(
    0,
    sharedTimerInitialSeconds - elapsedSeconds
  );
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const label = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  const progress =
    (remainingSeconds / sharedTimerDurationSeconds) * timerCircumference;

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
};

renderSharedTimer();
window.setInterval(renderSharedTimer, 250);
