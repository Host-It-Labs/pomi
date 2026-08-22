import { describe, expect, it } from 'vitest';
import { initialAccessFlowState, reduceAccessFlow } from './accessFlow';

describe('access flow', () => {
  it('moves Get started through the feature tour to payment', () => {
    let state = reduceAccessFlow(initialAccessFlowState, {
      type: 'get-started',
    });
    expect(state).toMatchObject({ screen: 'features', featureIndex: 0 });

    state = reduceAccessFlow(state, {
      type: 'next-feature',
      featureCount: 3,
    });
    expect(state).toMatchObject({ screen: 'features', featureIndex: 1 });

    state = reduceAccessFlow(state, {
      type: 'next-feature',
      featureCount: 3,
    });
    state = reduceAccessFlow(state, {
      type: 'next-feature',
      featureCount: 3,
    });
    expect(state.screen).toBe('payment');
  });

  it('keeps returning login and self-hosting separate from onboarding', () => {
    expect(
      reduceAccessFlow(initialAccessFlowState, {
        type: 'open-login',
        reason: 'returning',
      })
    ).toMatchObject({ screen: 'login', authReason: 'returning' });

    expect(
      reduceAccessFlow(initialAccessFlowState, { type: 'open-self-host' })
    ).toMatchObject({ screen: 'self-host', authReason: 'returning' });
  });
});
