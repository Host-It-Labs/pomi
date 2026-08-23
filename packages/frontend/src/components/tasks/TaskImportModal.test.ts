import type { Intention } from '@pomi/shared';
import { describe, expect, it } from 'vitest';
import { getTaskEligibleImportIntentions } from './TaskImportModal';
import { normalizeVikunjaDescription } from './vikunjaDescription';

describe('Task import Intention filtering', () => {
  it('removes a disabled Parent and every child in its tree', () => {
    const enabled = {
      id: 'enabled',
      slug: 'enabled',
      title: 'Enabled',
      parentIntentionId: null,
      isArchived: false,
      allowsTasks: true,
    } as Intention;
    const disabled = {
      ...enabled,
      id: 'disabled',
      slug: 'disabled',
      title: 'Disabled',
      allowsTasks: false,
    } as Intention;
    const disabledChild = {
      ...enabled,
      id: 'disabled-child',
      slug: 'disabled-child',
      title: 'Disabled child',
      parentIntentionId: disabled.id,
    } as Intention;

    expect(
      getTaskEligibleImportIntentions([enabled, disabled, disabledChild]).map(
        intention => intention.id
      )
    ).toEqual(['enabled']);
  });
});

describe('Vikunja description import', () => {
  it('converts nested HTML with the browser parser', () => {
    expect(
      normalizeVikunjaDescription(
        '<h2>Plan <strong>now</strong></h2><p>First<br>second <em>soon</em></p><ul><li>One<ul><li>Nested</li></ul></li><li>Two</li></ul>'
      )
    ).toBe('## Plan **now**\n\nFirst\nsecond *soon*\n\n- One\n- Nested\n- Two');
  });

  it('drops executable and styling elements, including spaced end tags', () => {
    expect(
      normalizeVikunjaDescription(
        '<p>Safe<script>alert(1)</script ><style>body{display:none}</style></p><template>hidden</template>'
      )
    ).toBe('Safe');
  });

  it('decodes entities as inert text', () => {
    expect(
      normalizeVikunjaDescription('<p>&lt;safe&gt; &amp; &#x1f642;</p>')
    ).toBe('<safe> & 🙂');
    expect(normalizeVikunjaDescription('R&amp;D **plan**')).toBe(
      'R&D **plan**'
    );
  });

  it('keeps only credential-free HTTP links', () => {
    expect(
      normalizeVikunjaDescription(
        '<p><a href="jav&#x61;script:alert(1)">Bad</a> <a href="data:text/html,hello">Data</a> <a href="https://example.com/path">Safe</a> <a href="https://user:secret@example.com/">Credentials</a></p>'
      )
    ).toBe('Bad Data [Safe](https://example.com/path) Credentials');
  });
});
