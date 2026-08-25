import { describe, expect, it, vi } from 'vitest';
import { DescriptionsService } from '../../src/descriptions/descriptions.service';

describe('DescriptionsService destination filtering', () => {
  it('omits task-disabled Parent trees while retaining Lists', async () => {
    const disabledParent = {
      id: 'disabled-parent',
      slug: 'disabled',
      title: 'Disabled',
      allowsTasks: false,
      parentIntention: null,
    };
    const intentions = [
      disabledParent,
      {
        id: 'disabled-child',
        slug: 'disabled-child',
        title: 'Disabled child',
        allowsTasks: true,
        parentIntention: disabledParent,
      },
      {
        id: 'enabled',
        slug: 'enabled',
        title: 'Enabled',
        allowsTasks: true,
        parentIntention: null,
      },
    ];
    const requestJson = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        descriptions: [
          { kind: 'intention', id: 'enabled', description: 'Enabled work.' },
          { kind: 'list', id: 'list-1', description: 'Launch items.' },
        ],
      }),
      costUsd: 0.001,
    });
    const service = new DescriptionsService(
      { find: vi.fn().mockResolvedValue(intentions) } as never,
      {
        find: vi
          .fn()
          .mockResolvedValue([
            { id: 'list-1', title: 'Launch', isArchived: false },
          ]),
      } as never,
      { find: vi.fn().mockResolvedValue([]) } as never,
      {
        prepareRequest: vi.fn().mockResolvedValue({
          preferences: { destinationDescriptionsEnabled: true },
          settings: { textModel: 'model' },
          today: '2026-07-31',
        }),
        requestJson,
      } as never
    );

    const result = await service.generate('user-1');
    const messages = requestJson.mock.calls[0][2] as Array<{ content: string }>;
    expect(messages[1].content).toContain('enabled');
    expect(messages[1].content).toContain('list-1');
    expect(messages[1].content).not.toContain('disabled-child');
    expect(result.drafts.map(draft => draft.id)).toEqual(['enabled', 'list-1']);
  });

  it('uses Task and contextual follow-up titles as Intention examples', async () => {
    const requestJson = vi.fn().mockResolvedValue({
      content: JSON.stringify({ descriptions: [] }),
      costUsd: 0.001,
    });
    const service = new DescriptionsService(
      {
        find: vi.fn().mockResolvedValue([
          {
            id: 'planning',
            slug: 'planning',
            title: 'Planning',
            allowsTasks: true,
            parentIntention: null,
          },
        ]),
      } as never,
      { find: vi.fn().mockResolvedValue([]) } as never,
      {
        find: vi.fn().mockResolvedValue([
          {
            itemKind: 'task',
            intentionSlug: 'planning',
            title: 'Plan the release',
          },
          {
            itemKind: 'followUp',
            intentionSlug: 'planning',
            title: 'Share the release notes',
          },
          {
            itemKind: 'followUpTemplate',
            intentionSlug: 'planning',
            title: 'Hidden follow-up definition',
          },
        ]),
      } as never,
      {
        prepareRequest: vi.fn().mockResolvedValue({
          preferences: { destinationDescriptionsEnabled: true },
          settings: { textModel: 'model' },
          today: '2026-08-23',
        }),
        requestJson,
      } as never
    );

    await service.generate('user-1');

    const messages = requestJson.mock.calls[0][2] as Array<{ content: string }>;
    const destinations = JSON.parse(messages[1].content) as Array<{
      id: string;
      titles: string[];
    }>;
    expect(destinations).toEqual([
      {
        kind: 'intention',
        id: 'planning',
        title: 'Planning',
        titles: ['Plan the release', 'Share the release notes'],
      },
    ]);
  });
});
