import { useCallback, useReducer, useState } from 'react';
import { acknowledgePurchase } from '@choochmeque/tauri-plugin-iap-api';
import { Login, type SessionData } from '../Login';
import { Paywall } from '../Paywall';
import { useBillingStore } from '../../stores/billingStore';
import { useSystemStore } from '../../stores/systemStore';
import {
  clearStoredBackendUrl,
  getStoredBackendUrl,
} from '../../utils/backendUrlStorage';
import { useI18n } from '../../i18n';
import { AccessShell } from './AccessShell';
import { initialAccessFlowState, reduceAccessFlow } from './accessFlow';
import { ACCESS_FEATURE_COUNT, FeatureTour } from './FeatureTour';
import { SelfHostSetup } from './SelfHostSetup';
import { Welcome } from './Welcome';
import {
  clearPendingCheckout,
  readPendingCheckout,
  savePendingCheckout,
} from './pendingCheckoutStorage';
import {
  isCompletedCheckout,
  type PendingCheckoutPurchase,
  type PendingCheckoutState,
} from './checkoutTypes';

export function AccessCoordinator() {
  const { t } = useI18n();
  const claimCheckout = useBillingStore.use.claimCheckout();
  const loadSystemInfo = useSystemStore.use.loadSystemInfo();
  const clearSystemInfo = useSystemStore.use.clearSystemInfo();
  const [initialPendingCheckout] = useState(readPendingCheckout);
  const [flow, dispatch] = useReducer(reduceAccessFlow, {
    ...initialAccessFlowState,
    screen: isCompletedCheckout(initialPendingCheckout)
      ? 'login'
      : initialPendingCheckout
        ? 'payment'
        : 'welcome',
    authReason: isCompletedCheckout(initialPendingCheckout)
      ? 'purchase'
      : 'returning',
  });
  const [pendingCheckout, setPendingCheckout] =
    useState<PendingCheckoutState | null>(initialPendingCheckout);
  const [selfHostedUrl, setSelfHostedUrl] = useState(
    () => getStoredBackendUrl() ?? ''
  );

  const openHostedLogin = useCallback(
    (reason: 'returning' | 'purchase') => {
      clearStoredBackendUrl();
      clearSystemInfo();
      void loadSystemInfo();
      dispatch({ type: 'open-login', reason });
    },
    [clearSystemInfo, loadSystemInfo]
  );

  const handleCheckoutChanged = useCallback(
    (checkout: PendingCheckoutState) => {
      savePendingCheckout(checkout);
      setPendingCheckout(checkout);
    },
    []
  );

  const handlePurchased = useCallback(
    (purchase: PendingCheckoutPurchase) => {
      savePendingCheckout(purchase);
      setPendingCheckout(purchase);
      openHostedLogin('purchase');
    },
    [openHostedLogin]
  );

  const handleHostedSession = async (_session: SessionData) => {
    if (!isCompletedCheckout(pendingCheckout)) return;
    await claimCheckout(
      pendingCheckout.checkoutToken,
      pendingCheckout.purchase,
      pendingCheckout.platform
    );
    if (pendingCheckout.platform === 'android') {
      await acknowledgePurchase(pendingCheckout.purchase.purchaseToken);
    }
    clearPendingCheckout();
    setPendingCheckout(null);
  };

  if (flow.screen === 'welcome') {
    return (
      <Welcome
        onLogin={() => {
          if (isCompletedCheckout(pendingCheckout)) {
            openHostedLogin('purchase');
            return;
          }
          openHostedLogin('returning');
        }}
        onGetStarted={() => {
          clearStoredBackendUrl();
          clearSystemInfo();
          void loadSystemInfo();
          dispatch({ type: 'get-started' });
        }}
        onSelfHost={() => {
          dispatch({ type: 'open-self-host' });
        }}
      />
    );
  }

  if (flow.screen === 'features') {
    return (
      <FeatureTour
        index={flow.featureIndex}
        count={ACCESS_FEATURE_COUNT}
        onBack={() => dispatch({ type: 'previous' })}
        onNext={() =>
          dispatch({
            type: 'next-feature',
            featureCount: ACCESS_FEATURE_COUNT,
          })
        }
        onSkip={() => dispatch({ type: 'open-payment' })}
      />
    );
  }

  if (flow.screen === 'payment') {
    return (
      <AccessShell
        onBack={() => dispatch({ type: 'previous' })}
        backLabel={t('common.back')}
        badge={t('access.membership')}
      >
        <Paywall
          mode="pre-auth"
          resumeCheckout={pendingCheckout}
          onCheckoutChanged={handleCheckoutChanged}
          onPurchased={handlePurchased}
        />
      </AccessShell>
    );
  }

  if (flow.screen === 'self-host') {
    return (
      <AccessShell
        onBack={() => dispatch({ type: 'reset' })}
        backLabel={t('common.back')}
        badge={t('access.selfHost')}
      >
        <SelfHostSetup
          onReady={url => {
            setSelfHostedUrl(url);
            dispatch({ type: 'open-login', reason: 'returning' });
          }}
        />
      </AccessShell>
    );
  }

  const isSelfHosted = Boolean(getStoredBackendUrl());
  return (
    <AccessShell
      onBack={() => {
        if (isCompletedCheckout(pendingCheckout)) {
          dispatch({ type: 'open-payment' });
          return;
        }
        if (isSelfHosted) {
          dispatch({ type: 'open-self-host' });
          return;
        }
        dispatch({ type: 'reset' });
      }}
      backLabel={t('common.back')}
      badge={
        flow.authReason === 'purchase' && isCompletedCheckout(pendingCheckout)
          ? t('access.paymentComplete')
          : undefined
      }
    >
      <Login
        mode={isSelfHosted ? 'self-hosted' : 'hosted'}
        selfHostedUrl={selfHostedUrl}
        onSession={
          !isSelfHosted && isCompletedCheckout(pendingCheckout)
            ? handleHostedSession
            : undefined
        }
        onSelfHostRequested={
          isCompletedCheckout(pendingCheckout)
            ? undefined
            : () => dispatch({ type: 'open-self-host' })
        }
      />
    </AccessShell>
  );
}
