import {
  acknowledgePurchase,
  getProducts,
  onPurchaseUpdated,
  purchase,
  PurchaseState,
  restorePurchases,
  type Product,
  type Purchase,
} from '@choochmeque/tauri-plugin-iap-api';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FaCheck, FaLock, FaRotate } from 'react-icons/fa6';
import { AppLogo } from '../components/brand/AppLogo';
import { Button } from '../components/ui/Button';
import { environmentVariables } from '../config/environmentVariables';
import { useBillingStore } from '../stores/billingStore';
import { useAuthStore } from '../stores/authStore';
import { isAndroid, isIos, isMac, isTauri } from '../utils/osUtils';
import { useI18n } from '../i18n';
import type {
  PendingCheckoutPurchase,
  PendingCheckoutState,
} from './access/checkoutTypes';

const PRODUCT_IDS = [
  environmentVariables.SUBSCRIPTION_MONTHLY_PRODUCT_ID,
  environmentVariables.SUBSCRIPTION_YEARLY_PRODUCT_ID,
];

type PurchaseVerificationResult = 'active' | 'inactive' | 'pending';

export function purchaseVerificationMessageKey(
  result: PurchaseVerificationResult,
  flow: 'buy' | 'restore'
): string | null {
  if (result === 'pending') return 'billing.purchasePending';
  if (result === 'inactive') {
    return flow === 'buy'
      ? 'billing.verificationFailed'
      : 'billing.nothingToRestore';
  }
  return null;
}

interface PaywallProps {
  mode?: 'authenticated' | 'pre-auth';
  resumeCheckout?: PendingCheckoutState | null;
  onCheckoutChanged?: (checkout: PendingCheckoutState) => void;
  onPurchased?: (purchase: PendingCheckoutPurchase) => void;
}

export function Paywall({
  mode = 'authenticated',
  resumeCheckout,
  onCheckoutChanged,
  onPurchased,
}: PaywallProps) {
  const { t } = useI18n();
  const user = useAuthStore.use.user();
  const signOut = useAuthStore.use.signOut();
  const syncPurchase = useBillingStore.use.syncPurchase();
  const createCheckout = useBillingStore.use.createCheckout();
  const verifyCheckoutPurchase = useBillingStore.use.verifyCheckoutPurchase();
  const error = useBillingStore.use.error();
  const [products, setProducts] = useState<Product[]>([]);
  const [hasLoadedProducts, setHasLoadedProducts] = useState(false);
  const [selectedId, setSelectedId] = useState(() =>
    resumeCheckout && PRODUCT_IDS.includes(resumeCheckout.productId)
      ? resumeCheckout.productId
      : PRODUCT_IDS[1]
  );
  const [isWorking, setIsWorking] = useState(false);
  const [storeMessage, setStoreMessage] = useState<string | null>(null);
  const isAppleStore = isIos || isMac;
  const nativeStoreAvailable = isTauri && (isAppleStore || isAndroid);
  const storePlatform = isAppleStore ? 'ios' : 'android';
  const completedPurchaseToken = useRef<string | null>(null);
  const checkoutStartedHere = useRef(false);
  const automaticRecoveryToken = useRef<string | null>(null);
  const resumeCheckoutRef = useRef(resumeCheckout);
  resumeCheckoutRef.current = resumeCheckout;

  useEffect(() => {
    if (!nativeStoreAvailable) return;
    let disposed = false;
    setHasLoadedProducts(false);
    void getProducts(PRODUCT_IDS, 'subs')
      .then(response => {
        if (disposed) return;
        const requestedProducts = response.products.filter(product =>
          PRODUCT_IDS.includes(product.productId)
        );
        setProducts(requestedProducts);
        setHasLoadedProducts(true);
        if (requestedProducts.length === 0) {
          setStoreMessage(t('billing.storeUnavailable'));
        }
      })
      .catch(() => {
        if (disposed) return;
        setProducts([]);
        setHasLoadedProducts(true);
        setStoreMessage(t('billing.storeUnavailable'));
      });
    return () => {
      disposed = true;
    };
  }, [nativeStoreAvailable, t]);

  const productsById = useMemo(
    () => new Map(products.map(product => [product.productId, product])),
    [products]
  );

  const updatePreAuthCheckout = useCallback(
    (checkout: PendingCheckoutState, storePurchase: Purchase) => {
      const updatedCheckout = { ...checkout, purchase: storePurchase };
      onCheckoutChanged?.(updatedCheckout);
      if (storePurchase.purchaseState !== PurchaseState.PURCHASED) {
        setStoreMessage(t('billing.purchasePending'));
        return;
      }
      if (completedPurchaseToken.current === storePurchase.purchaseToken)
        return;
      completedPurchaseToken.current = storePurchase.purchaseToken;
      onPurchased?.(updatedCheckout);
    },
    [onCheckoutChanged, onPurchased, t]
  );

  const recoverPendingCheckout = useCallback(
    async (checkout: PendingCheckoutState, reportMissing: boolean) => {
      try {
        const response = await restorePurchases('subs');
        const candidates = response.purchases
          .filter(
            item =>
              item.productId === checkout.productId &&
              item.purchaseState === PurchaseState.PURCHASED
          )
          .sort((left, right) => right.purchaseTime - left.purchaseTime);
        let lastVerificationError: unknown;
        for (const candidate of candidates) {
          if (!purchaseCanBelongToCheckout(candidate, checkout)) continue;
          try {
            await verifyCheckoutPurchase(
              checkout.checkoutToken,
              candidate,
              checkout.platform
            );
            updatePreAuthCheckout(checkout, candidate);
            return;
          } catch (verificationError) {
            lastVerificationError = verificationError;
          }
        }
        if (reportMissing) {
          setStoreMessage(
            lastVerificationError instanceof Error
              ? lastVerificationError.message
              : t('billing.purchaseStillPending')
          );
        }
      } catch (recoveryError) {
        if (reportMissing) {
          setStoreMessage(
            recoveryError instanceof Error
              ? recoveryError.message
              : t('billing.restoreFailed')
          );
        }
      }
    },
    [t, updatePreAuthCheckout, verifyCheckoutPurchase]
  );

  useEffect(() => {
    const checkout = resumeCheckoutRef.current;
    if (mode !== 'pre-auth' || !nativeStoreAvailable || !checkout) return;
    if (
      checkoutStartedHere.current ||
      automaticRecoveryToken.current === checkout.checkoutToken
    ) {
      return;
    }
    automaticRecoveryToken.current = checkout.checkoutToken;
    void recoverPendingCheckout(checkout, false);
  }, [
    mode,
    nativeStoreAvailable,
    recoverPendingCheckout,
    resumeCheckout?.checkoutToken,
  ]);

  useEffect(() => {
    if (
      mode !== 'pre-auth' ||
      !nativeStoreAvailable ||
      !resumeCheckoutRef.current
    ) {
      return;
    }
    let disposed = false;
    let unregister: (() => Promise<void>) | undefined;
    void onPurchaseUpdated(storePurchase => {
      const checkout = resumeCheckoutRef.current;
      if (
        disposed ||
        !checkout ||
        storePurchase.purchaseState !== PurchaseState.PURCHASED ||
        !purchaseCanBelongToCheckout(storePurchase, checkout)
      ) {
        return;
      }
      void verifyCheckoutPurchase(
        checkout.checkoutToken,
        storePurchase,
        checkout.platform
      )
        .then(() => {
          if (!disposed) updatePreAuthCheckout(checkout, storePurchase);
        })
        .catch(() => undefined);
    })
      .then(listener => {
        unregister = () => listener.unregister();
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      void unregister?.();
    };
  }, [
    mode,
    nativeStoreAvailable,
    resumeCheckout?.checkoutToken,
    updatePreAuthCheckout,
    verifyCheckoutPurchase,
  ]);

  const verify = async (
    storePurchase: Purchase
  ): Promise<PurchaseVerificationResult> => {
    if (storePurchase.purchaseState !== PurchaseState.PURCHASED) {
      return 'pending';
    }
    const entitlement = await syncPurchase(
      storePurchase,
      isAppleStore ? 'ios' : 'android'
    );
    if (entitlement.active && !isAppleStore) {
      await acknowledgePurchase(storePurchase.purchaseToken);
    }
    return entitlement.active ? 'active' : 'inactive';
  };

  const buy = async () => {
    if (!nativeStoreAvailable || (mode === 'authenticated' && !user)) return;
    const product = productsById.get(selectedId);
    if (!product) {
      setStoreMessage(t('billing.storeUnavailable'));
      return;
    }
    setIsWorking(true);
    setStoreMessage(null);
    try {
      let checkout: PendingCheckoutState | undefined;
      if (mode === 'pre-auth') {
        const resumedCheckout = resumeCheckoutRef.current;
        checkout =
          resumedCheckout?.productId === selectedId &&
          resumedCheckout.platform === storePlatform
            ? resumedCheckout
            : undefined;
        if (!checkout) {
          const createdCheckout = await createCheckout();
          checkout = {
            checkoutId: createdCheckout.checkoutId,
            checkoutToken: createdCheckout.checkoutToken,
            productId: selectedId,
            platform: storePlatform,
          };
        }
        checkoutStartedHere.current = true;
        onCheckoutChanged?.(checkout);
      }
      const accountId = checkout?.checkoutId ?? user?.id;
      if (!accountId) return;
      const storePurchase = await purchase(selectedId, 'subs', {
        appAccountToken: isAppleStore ? accountId : undefined,
        obfuscatedAccountId: isAndroid
          ? accountId.replace(/-/g, '')
          : undefined,
        offerToken: isAndroid
          ? product.subscriptionOfferDetails?.[0]?.offerToken
          : undefined,
      });
      if (mode === 'pre-auth' && checkout) {
        updatePreAuthCheckout(checkout, storePurchase);
        return;
      }
      const messageKey = purchaseVerificationMessageKey(
        await verify(storePurchase),
        'buy'
      );
      if (messageKey) setStoreMessage(t(messageKey));
    } catch (purchaseError) {
      setStoreMessage(
        purchaseError instanceof Error
          ? purchaseError.message
          : t('billing.purchaseFailed')
      );
    } finally {
      setIsWorking(false);
    }
  };

  const restore = async () => {
    if (!nativeStoreAvailable || mode === 'pre-auth') return;
    setIsWorking(true);
    setStoreMessage(null);
    try {
      const response = await restorePurchases('subs');
      const candidates = response.purchases
        .filter(
          item =>
            PRODUCT_IDS.includes(item.productId) &&
            item.purchaseState === PurchaseState.PURCHASED
        )
        .sort((left, right) => right.purchaseTime - left.purchaseTime);
      if (candidates.length === 0) {
        setStoreMessage(t('billing.nothingToRestore'));
      } else {
        let lastVerificationError: unknown;
        for (const candidate of candidates) {
          try {
            if ((await verify(candidate)) === 'active') return;
          } catch (verificationError) {
            lastVerificationError = verificationError;
          }
        }
        setStoreMessage(
          lastVerificationError instanceof Error
            ? lastVerificationError.message
            : t('billing.nothingToRestore')
        );
      }
    } catch (restoreError) {
      setStoreMessage(
        restoreError instanceof Error
          ? restoreError.message
          : t('billing.restoreFailed')
      );
    } finally {
      setIsWorking(false);
    }
  };

  const checkPendingPurchase = async () => {
    const checkout = resumeCheckoutRef.current;
    if (!checkout) return;
    setIsWorking(true);
    setStoreMessage(null);
    try {
      await recoverPendingCheckout(checkout, true);
    } finally {
      setIsWorking(false);
    }
  };

  const monthlyProduct = productsById.get(PRODUCT_IDS[0]);
  const yearlyProduct = productsById.get(PRODUCT_IDS[1]);
  const selectedProduct = productsById.get(selectedId);
  const monthlyPrice =
    monthlyProduct?.formattedPrice ??
    (hasLoadedProducts && !monthlyProduct
      ? t('billing.planUnavailable')
      : '$2.99');
  const yearlyPrice =
    yearlyProduct?.formattedPrice ??
    (hasLoadedProducts && !yearlyProduct
      ? t('billing.planUnavailable')
      : '$24.99');
  const isRetryingAndroidCheckout =
    mode === 'pre-auth' &&
    resumeCheckout?.platform === 'android' &&
    !resumeCheckout.purchase;

  const content = (
    <>
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-indigo-500/20 blur-3xl" />
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        <div className="mb-7 text-center">
          {mode === 'pre-auth' ? (
            <AppLogo className="mx-auto mb-4 h-12 w-12 rounded-2xl shadow-[0_0_40px_rgba(59,130,246,.18)]" />
          ) : (
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-indigo-400/20 bg-indigo-500/15 text-indigo-200 shadow-[0_0_40px_rgba(99,102,241,0.18)]">
              <FaLock />
            </div>
          )}
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-indigo-300">
            {t('billing.finalStep')}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            {t('billing.title')}
          </h1>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-slate-400">
            {t('billing.subtitle')}
          </p>
        </div>

        <div className="mb-6 grid gap-2.5 text-sm text-slate-300">
          {['sync', 'watch', 'notifications'].map(feature => (
            <div key={feature} className="flex items-center gap-3">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400/15 text-[10px] text-emerald-300">
                <FaCheck />
              </span>
              {t(`billing.feature.${feature}`)}
            </div>
          ))}
        </div>

        <div className="grid gap-3">
          <PlanCard
            title={t('billing.yearly')}
            price={yearlyPrice}
            cadence={t('billing.perYear')}
            badge={t('billing.bestValue')}
            available={Boolean(yearlyProduct)}
            selected={Boolean(yearlyProduct) && selectedId === PRODUCT_IDS[1]}
            onClick={() => setSelectedId(PRODUCT_IDS[1])}
          />
          <PlanCard
            title={t('billing.monthly')}
            price={monthlyPrice}
            cadence={t('billing.perMonth')}
            available={Boolean(monthlyProduct)}
            selected={Boolean(monthlyProduct) && selectedId === PRODUCT_IDS[0]}
            onClick={() => setSelectedId(PRODUCT_IDS[0])}
          />
        </div>

        <div className="mt-auto pt-6">
          {nativeStoreAvailable ? (
            <Button
              size="lg"
              className="w-full rounded-xl bg-indigo-500/80 py-3.5 text-white shadow-[0_14px_45px_rgba(79,70,229,0.25)] hover:bg-indigo-500"
              isLoading={isWorking}
              loadingText={t('billing.processing')}
              disabled={!selectedProduct}
              onClick={() => void buy()}
            >
              {t(
                isRetryingAndroidCheckout
                  ? 'billing.retryPurchase'
                  : 'billing.subscribe'
              )}
            </Button>
          ) : (
            <div className="rounded-xl border border-amber-300/15 bg-amber-300/5 px-4 py-3 text-center text-sm text-amber-100/80">
              {t('billing.mobileRequired')}
            </div>
          )}
          {(storeMessage || error) && (
            <p className="mt-3 text-center text-xs text-rose-300">
              {storeMessage || error}
            </p>
          )}
          {mode === 'authenticated' ? (
            <div className="mt-4 flex items-center justify-center gap-5">
              <button
                type="button"
                disabled={!nativeStoreAvailable || isWorking}
                onClick={() => void restore()}
                className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white disabled:opacity-40"
              >
                <FaRotate className="text-[10px]" />
                {t('billing.restore')}
              </button>
              <button
                type="button"
                onClick={() => void signOut()}
                className="text-xs text-slate-500 hover:text-white"
              >
                {t('common.logOut')}
              </button>
            </div>
          ) : (
            <div className="mt-4 text-center">
              <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
                {resumeCheckout ? (
                  <button
                    type="button"
                    disabled={isWorking}
                    onClick={() => void checkPendingPurchase()}
                    className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white disabled:opacity-40"
                  >
                    <FaRotate className="text-[10px]" />
                    {t('billing.checkPurchase')}
                  </button>
                ) : null}
              </div>
              <p className="mt-3 text-[11px] leading-5 text-slate-500">
                {t('billing.accountAfterPurchase')}
              </p>
            </div>
          )}
          <p className="mt-5 text-center text-[10px] leading-4 text-slate-600">
            {t('billing.terms')}
          </p>
        </div>
      </div>
    </>
  );

  if (mode === 'pre-auth') return content;

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-slate-950 px-5 pb-8 pt-[calc(env(safe-area-inset-top)+24px)] text-white">
      {content}
    </div>
  );
}

function PlanCard({
  title,
  price,
  cadence,
  badge,
  available,
  selected,
  onClick,
}: {
  title: string;
  price: string;
  cadence: string;
  badge?: string;
  available: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={!available}
      onClick={onClick}
      className={`relative flex items-center justify-between rounded-2xl border px-4 py-4 text-left transition ${
        selected
          ? 'border-indigo-400/60 bg-indigo-500/10 shadow-[inset_0_0_0_1px_rgba(129,140,248,0.15)]'
          : 'border-slate-800 bg-slate-900/55 hover:border-slate-700'
      } ${available ? '' : 'cursor-not-allowed opacity-55'}`}
    >
      <div>
        <div className="flex items-center gap-2">
          <span className="font-semibold">{title}</span>
          {badge && (
            <span className="rounded-full bg-indigo-400/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-200">
              {badge}
            </span>
          )}
        </div>
        <div className="mt-1 text-xs text-slate-500">{cadence}</div>
      </div>
      <div className="text-right">
        <span className="text-xl font-semibold tracking-tight">{price}</span>
      </div>
    </button>
  );
}

function purchaseCanBelongToCheckout(
  purchaseToCheck: Purchase,
  checkout: PendingCheckoutState
) {
  if (purchaseToCheck.productId !== checkout.productId) return false;
  if (checkout.purchase) {
    return (
      checkout.purchase.purchaseToken === purchaseToCheck.purchaseToken ||
      Boolean(
        checkout.platform === 'ios' &&
        checkout.purchase.originalId &&
        checkout.purchase.originalId === purchaseToCheck.originalId
      )
    );
  }
  if (checkout.platform === 'ios') {
    return (
      readAppleAccountToken(purchaseToCheck.jwsRepresentation) ===
      checkout.checkoutId
    );
  }
  // Google Play does not return the obfuscated account ID to the client. The
  // backend verifies every candidate against this checkout before it is saved.
  return true;
}

function readAppleAccountToken(jwsRepresentation?: string) {
  if (!jwsRepresentation) return null;
  try {
    const payload = jwsRepresentation.split('.')[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      '='
    );
    const decoded = JSON.parse(atob(padded)) as { appAccountToken?: unknown };
    return typeof decoded.appAccountToken === 'string'
      ? decoded.appAccountToken
      : null;
  } catch {
    return null;
  }
}
