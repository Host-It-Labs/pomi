export type AccessScreen =
  | 'welcome'
  | 'features'
  | 'payment'
  | 'login'
  | 'self-host';

export type AccessFlowState = {
  screen: AccessScreen;
  featureIndex: number;
  authReason: 'returning' | 'purchase';
};

export type AccessFlowAction =
  | { type: 'open-login'; reason: 'returning' | 'purchase' }
  | { type: 'get-started' }
  | { type: 'next-feature'; featureCount: number }
  | { type: 'previous' }
  | { type: 'open-self-host' }
  | { type: 'open-payment' }
  | { type: 'reset' };

export const initialAccessFlowState: AccessFlowState = {
  screen: 'welcome',
  featureIndex: 0,
  authReason: 'returning',
};

export function reduceAccessFlow(
  state: AccessFlowState,
  action: AccessFlowAction
): AccessFlowState {
  switch (action.type) {
    case 'open-login':
      return { ...state, screen: 'login', authReason: action.reason };
    case 'get-started':
      return { ...state, screen: 'features', featureIndex: 0 };
    case 'next-feature':
      return state.featureIndex >= action.featureCount - 1
        ? { ...state, screen: 'payment' }
        : { ...state, featureIndex: state.featureIndex + 1 };
    case 'previous':
      if (state.screen === 'features' && state.featureIndex > 0) {
        return { ...state, featureIndex: state.featureIndex - 1 };
      }
      if (state.screen === 'payment') {
        return { ...state, screen: 'features' };
      }
      return initialAccessFlowState;
    case 'open-self-host':
      return { ...initialAccessFlowState, screen: 'self-host' };
    case 'open-payment':
      return { ...state, screen: 'payment' };
    case 'reset':
      return initialAccessFlowState;
  }
}
