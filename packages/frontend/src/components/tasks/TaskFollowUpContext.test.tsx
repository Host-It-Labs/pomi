import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TaskFollowUpContext } from './TaskFollowUpContext';

describe('TaskFollowUpContext', () => {
  it('keeps a generated follow-up visibly inside its parent context', () => {
    render(<TaskFollowUpContext parentTitle="Review the launch" />);

    expect(screen.getByTestId('task-follow-up-context')).toHaveTextContent(
      'Follow-up for Review the launch'
    );
  });
});
