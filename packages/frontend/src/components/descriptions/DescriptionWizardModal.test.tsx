import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DescriptionWizardModal } from './DescriptionWizardModal';

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  listIntentions: vi.fn(),
  listLists: vi.fn(),
}));

vi.mock('../../utils/apiClient', () => ({
  apiClient: {
    descriptions: { generate: mocks.generate },
    intentions: { list: mocks.listIntentions },
    lists: { list: mocks.listLists },
  },
}));

vi.mock('../../utils/userActionQueue', () => ({
  submitUserMutation: vi.fn(),
}));

describe('DescriptionWizardModal', () => {
  beforeEach(() => {
    mocks.generate.mockReset();
    mocks.listIntentions.mockResolvedValue({ status: 200, body: [] });
    mocks.listLists.mockResolvedValue({ status: 200, body: [] });
    mocks.generate.mockResolvedValue({ status: 200, body: { drafts: [] } });
  });

  it('offers manual editing without making an AI request', async () => {
    render(<DescriptionWizardModal isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Write manually/i }));

    await waitFor(() => expect(mocks.listIntentions).toHaveBeenCalledOnce());
    expect(mocks.listLists).toHaveBeenCalledOnce();
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(
      screen.getByText('No draftable destinations were found.')
    ).toBeVisible();
  });

  it('labels and calls the optional AI generation path', async () => {
    render(<DescriptionWizardModal isOpen onClose={vi.fn()} />);

    fireEvent.click(
      screen.getByRole('button', { name: /Generate drafts with AI/i })
    );

    await waitFor(() => expect(mocks.generate).toHaveBeenCalledOnce());
  });
});
