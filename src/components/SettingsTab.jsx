import { useState, useEffect, useRef } from 'react';
import { getToday, getCurrentMonth } from '../utils/constants';
import { useTranslation } from 'react-i18next';
import { supabase } from '../supabaseClient';
import {
  startProCheckoutSession,
  cancelProSubscription,
  requestProSubscriptionRefund
} from '../utils/billingService';

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

/**
- Renders the user account preferences, subscription ($6.99/mo), 1-click cancellation & 2-hour refund controls,
- theme toggle, baseline salary configuration, global currency/language selectors,
- custom-scoped Excel data export controls, and advanced security settings.
- @param {Object} props - Component properties
 */
export default function SettingsTab({
  theme,
  setTheme,
  salary,
  setSalary,
  handleUpdateProfile,
  currencyMode,
  setCurrencyMode,
  setCurrency,
  customCurrency,
  setCustomCurrency,
  exportScope,
  setExportScope,
  exportMonth,
  setExportMonth,
  exportDate,
  setExportDate,
  handleExportData,
  emailRemindersEnabled = true,
  setEmailRemindersEnabled,
  userEmail = '',
  userId = '',
  subscriptionTier = 'free',
  setSubscriptionTier,
  userRole = 'customer',
  subscriptionStatus = 'free',
  setSubscriptionStatus,
  subscriptionPeriodEnd = null,
  setSubscriptionPeriodEnd,
  cancelAtPeriodEnd = false,
  setCancelAtPeriodEnd,
  subscriptionStartedAt = null,
  setSubscriptionStartedAt,
  proFeaturesUsed = false,
  setProFeaturesUsed,
  hasClaimedRefund = false,
  setHasClaimedRefund,
  onConfirmProForUser,
  onClearConfirmedProForUser
}) {
  const { t, i18n } = useTranslation();
  const [isProcessingDanger, setIsProcessingDanger] = useState(false);
  // --- Phase 9: Security State ---
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMsg, setPasswordMsg] = useState({ text: '', type: '' });
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);

  // --- Subscription & Billing State (Scoped per account without setState in useEffect) ---
  const activeAccountIdentity = `${userId || ''}:${userEmail || ''}`;
  const [billingState, setBillingState] = useState({
    account: activeAccountIdentity,
    busy: false,
    msg: { text: '', type: '' }
  });

  const isBillingBusy =
    billingState.account === activeAccountIdentity ? billingState.busy : false;
  const billingMsg =
    billingState.account === activeAccountIdentity
      ? billingState.msg
      : { text: '', type: '' };

  const activeAccountRef = useRef(activeAccountIdentity);
  const billingOpIdRef = useRef(0);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Invalidate any in-flight billing operations when account changes or logs out
  useEffect(() => {
    activeAccountRef.current = activeAccountIdentity;
    billingOpIdRef.current += 1;
  }, [activeAccountIdentity]);

  const isRoleGrantedPro = ['owner', 'dev', 'special'].includes(userRole);
  const isPaidPro = subscriptionTier === 'pro';
  const formattedPeriodEnd = subscriptionPeriodEnd
    ? new Date(subscriptionPeriodEnd).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      })
    : null;

  // Evaluate 2-Hour Unused Refund Eligibility
  const startedAtMs = subscriptionStartedAt ? Date.parse(subscriptionStartedAt) : NaN;
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    if (!isPaidPro || !Number.isFinite(startedAtMs)) return;
    const intervalId = setInterval(() => {
      setNowTick(Date.now());
    }, 15000);
    return () => clearInterval(intervalId);
  }, [isPaidPro, startedAtMs]);

  const isWithinTwoHours =
    Number.isFinite(startedAtMs) && nowTick - startedAtMs >= 0 && nowTick - startedAtMs <= TWO_HOURS_MS;
  const minutesLeftForRefund = isWithinTwoHours
    ? Math.max(1, Math.ceil((TWO_HOURS_MS - (nowTick - startedAtMs)) / 60000))
    : 0;
  const isResumingRefundCancel =
    subscriptionStatus === 'refund_cancel_pending' ||
    subscriptionStatus === 'refund_finalize_pending';
  const isRefundPendingProvider = subscriptionStatus === 'refund_pending';
  const isRefundEligible =
    !isRefundPendingProvider &&
    (isResumingRefundCancel ||
      (isPaidPro && isWithinTwoHours && !proFeaturesUsed && !hasClaimedRefund));

  /**
- Starts a MANAGED Pro checkout session or sandbox upgrade.
   */
  const handleUpgradeClick = async () => {
    if (isBillingBusy) return;
    const originAccount = activeAccountRef.current;
    const originUserId = userId;
    const opId = ++billingOpIdRef.current;

    setBillingState({
      account: originAccount,
      busy: true,
      msg: { text: '', type: '' }
    });

    const isSameActiveAccount = (res) =>
      activeAccountRef.current === originAccount &&
      (!originUserId || window.__activeUserId === originUserId) &&
      !res?.staleAccount &&
      (!originUserId || !res?.userId || res.userId === originUserId);

    const canUpdateLocalUI = () =>
      isMountedRef.current &&
      activeAccountRef.current === originAccount &&
      billingOpIdRef.current === opId;

    try {
      const res = await startProCheckoutSession(originUserId);
      if (!isSameActiveAccount(res)) {
        return;
      }

      if (!res?.ok) {
        if (canUpdateLocalUI()) {
          setBillingState({
            account: originAccount,
            busy: false,
            msg: {
              text: res?.error || t('err_checkout_start', 'Unable to start checkout session right now.'),
              type: 'error'
            }
          });
        }
        return;
      }

      if (res.checkoutUrl) {
        window.location.assign(res.checkoutUrl);
        return;
      }

      if (res.simulated) {
        onConfirmProForUser?.(originUserId);
        setSubscriptionTier?.('pro');
        setSubscriptionStatus?.(res.subscriptionStatus || 'active');
        setSubscriptionStartedAt?.(res.subscriptionStartedAt || new Date().toISOString());
        setProFeaturesUsed?.(false);
        setSubscriptionPeriodEnd?.(res.subscriptionPeriodEnd || null);
        setCancelAtPeriodEnd?.(false);

        if (canUpdateLocalUI()) {
          setBillingState({
            account: originAccount,
            busy: false,
            msg: {
              text: t('succ_pro_activated', 'MANAGED Pro activated! Your workspace now has full Pro access.'),
              type: 'success'
            }
          });
        }
      }
    } catch (err) {
      if (!canUpdateLocalUI()) return;
      console.error('Upgrade failed:', err);
      setBillingState({
        account: originAccount,
        busy: false,
        msg: {
          text: t('err_checkout_unexpected', 'An unexpected error occurred while starting checkout.'),
          type: 'error'
        }
      });
    } finally {
      if (canUpdateLocalUI()) {
        setBillingState((prev) =>
          prev.account === originAccount ? { ...prev, busy: false } : prev
        );
      }
    }
  };

  /**
- 1-Click subscription cancellation: immediately stops future recurring billing
- while keeping Pro features active until the end of the current paid period.
   */
  const handleOneClickCancel = async () => {
    if (isBillingBusy || !isPaidPro || cancelAtPeriodEnd) return;
    const originAccount = activeAccountRef.current;
    const originUserId = userId;
    const opId = ++billingOpIdRef.current;

    setBillingState({
      account: originAccount,
      busy: true,
      msg: { text: '', type: '' }
    });

    const isSameActiveAccount = (res) =>
      activeAccountRef.current === originAccount &&
      (!originUserId || window.__activeUserId === originUserId) &&
      !res?.staleAccount &&
      (!originUserId || !res?.userId || res.userId === originUserId);

    const canUpdateLocalUI = () =>
      isMountedRef.current &&
      activeAccountRef.current === originAccount &&
      billingOpIdRef.current === opId;

    try {
      const res = await cancelProSubscription(originUserId);
      if (!isSameActiveAccount(res)) {
        return;
      }

      if (!res?.ok) {
        if (canUpdateLocalUI()) {
          setBillingState({
            account: originAccount,
            busy: false,
            msg: {
              text: res?.error || t('err_cancel_sub', 'Could not cancel subscription right now. Please try again.'),
              type: 'error'
            }
          });
        }
        return;
      }

      setSubscriptionStatus?.(res.subscriptionStatus || 'canceled_pending_expiry');
      if (res.subscriptionPeriodEnd) {
        setSubscriptionPeriodEnd?.(res.subscriptionPeriodEnd);
      }
      setCancelAtPeriodEnd?.(true);

      if (canUpdateLocalUI()) {
        const endStr = res.subscriptionPeriodEnd
          ? new Date(res.subscriptionPeriodEnd).toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'short',
              day: 'numeric'
            })
          : 'the end of your billing period';

        setBillingState({
          account: originAccount,
          busy: false,
          msg: {
            text: t(
              'succ_sub_canceled',
              `Recurring billing has been stopped immediately. You will not be charged again, and your Pro features remain active until ${endStr}.`
            ),
            type: 'success'
          }
        });
      }
    } catch (err) {
      if (!canUpdateLocalUI()) return;
      console.error('Cancel subscription failed:', err);
      setBillingState({
        account: originAccount,
        busy: false,
        msg: {
          text: t('err_cancel_unexpected', 'An unexpected error occurred while canceling your subscription.'),
          type: 'error'
        }
      });
    } finally {
      if (canUpdateLocalUI()) {
        setBillingState((prev) =>
          prev.account === originAccount ? { ...prev, busy: false } : prev
        );
      }
    }
  };

  /**
- 2-Hour Unused Refund handler: verifies eligibility on the server, issues a full refund,
- and immediately revokes MANAGED Pro access back to the Free Tier.
   */
  const handleRequestRefund = async () => {
    if (isBillingBusy || !isRefundEligible) return;
    if (
      !window.confirm(
        t(
          'confirm_2h_refund',
          'Request a full refund under the 2-Hour Unused Refund Policy? Your payment will be refunded and your workspace will immediately return to the Free Tier (one-time per account).'
        )
      )
    ) {
      return;
    }

    const originAccount = activeAccountRef.current;
    const originUserId = userId;
    const opId = ++billingOpIdRef.current;

    setBillingState({
      account: originAccount,
      busy: true,
      msg: { text: '', type: '' }
    });

    const isSameActiveAccount = (res) =>
      activeAccountRef.current === originAccount &&
      (!originUserId || window.__activeUserId === originUserId) &&
      !res?.staleAccount &&
      (!originUserId || !res?.userId || res.userId === originUserId);

    const canUpdateLocalUI = () =>
      isMountedRef.current &&
      activeAccountRef.current === originAccount &&
      billingOpIdRef.current === opId;

    try {
      const res = await requestProSubscriptionRefund(originUserId, {
        isRecovery: isResumingRefundCancel
      });
      if (!isSameActiveAccount(res)) {
        return;
      }

      if (!res?.ok) {
        if (res?.subscriptionStatus) {
          setSubscriptionStatus?.(res.subscriptionStatus);
        }
        if (res?.retryableCancel || res?.retryableFinalize) {
          setHasClaimedRefund?.(true);
        }
        if (canUpdateLocalUI()) {
          setBillingState({
            account: originAccount,
            busy: false,
            msg: {
              text: res?.error || t('err_refund_sub', 'Could not process your refund request right now.'),
              type: res?.pending ? 'success' : 'error'
            }
          });
        }
        return;
      }

      // Immediately revoke Pro state on App
      onClearConfirmedProForUser?.(originUserId);
      setSubscriptionTier?.('free');
      setSubscriptionStatus?.('refunded');
      setSubscriptionPeriodEnd?.(null);
      setCancelAtPeriodEnd?.(false);
      setHasClaimedRefund?.(true);

      if (canUpdateLocalUI()) {
        setBillingState({
          account: originAccount,
          busy: false,
          msg: {
            text: t(
              'succ_sub_refunded',
              'Your subscription has been refunded and your workspace has returned to the Free Tier.'
            ),
            type: 'success'
          }
        });
      }
    } catch (err) {
      if (!canUpdateLocalUI()) return;
      console.error('Refund subscription failed:', err);
      setBillingState({
        account: originAccount,
        busy: false,
        msg: {
          text: t('err_refund_unexpected', 'An unexpected error occurred while processing your refund.'),
          type: 'error'
        }
      });
    } finally {
      if (canUpdateLocalUI()) {
        setBillingState((prev) =>
          prev.account === originAccount ? { ...prev, busy: false } : prev
        );
      }
    }
  };

  /**
- Handles updating the user's password via Supabase Auth.
   */
  const handleUpdatePassword = async (e) => {
    e.preventDefault();
    setPasswordMsg({ text: '', type: '' });

    if (newPassword.length < 6) {
      setPasswordMsg({ text: t('err_password_short', 'Password must be at least 6 characters.'), type: 'error' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMsg({ text: t('err_password_mismatch', 'Passwords do not match.'), type: 'error' });
      return;
    }

    setIsUpdatingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setIsUpdatingPassword(false);

    if (error) {
      setPasswordMsg({ text: error.message, type: 'error' });
    } else {
      setNewPassword('');
      setConfirmPassword('');
      setPasswordMsg({ text: t('succ_password_update', 'Password updated successfully.'), type: 'success' });
      setTimeout(() => setPasswordMsg({ text: '', type: '' }), 4000);
    }
  };

  /**
- Triggers an atomic hard deletion of all user financial data via Supabase RPC,
- with reconciliation if an ambiguous network drop occurs after server commit.
   */
  const handleWipeData = async () => {
    if (!window.confirm(t('confirm_wipe_data', 'WARNING: This will permanently delete all your financial data, expenses, and history. This action cannot be undone. Are you absolutely sure?'))) {
      return;
    }

    const originAccount = activeAccountRef.current;
    const originUserId = userId;
    setIsProcessingDanger(true);

    const finalizeClientWipe = (uid) => {
      if (uid) {
        try {
          localStorage.removeItem(`managed_monthly_boosts_${uid}`);
          localStorage.removeItem(`managed_wealth_objectives_${uid}`);
          localStorage.removeItem(`managed_expense_meta_${uid}`);
          localStorage.removeItem(`managed_unsynced_expense_meta_${uid}`);
          localStorage.removeItem(`managed_last_expense_${uid}`);
          localStorage.removeItem(`managed_last_reminder_${uid}`);
          localStorage.removeItem(`managed_last_reminder_${uid}_daily`);
          localStorage.removeItem(`managed_last_reminder_${uid}_monthly`);
          localStorage.removeItem(`managed_last_reminder_${uid}_yearly`);
        } catch {
          // Ignore storage cleanup errors
        }
      }
      alert(t('succ_data_wiped', 'All financial data has been successfully wiped.'));
      window.location.reload();
    };

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const uid = session.user.id;
      if ((originUserId && uid !== originUserId) || window.__activeUserId !== uid) return;

      const { error } = await supabase.rpc('wipe_user_financial_data');
      if (window.__activeUserId !== uid || activeAccountRef.current !== originAccount) return;

      if (error) {
        // Reconcile whether the RPC committed before an ambiguous network drop
        const [expCheck, adjCheck, bunCheck, sheetCheck, closedCheck] = await Promise.all([
          supabase.from('expenses').select('id').eq('user_id', uid).limit(1),
          supabase.from('asset_adjustments').select('id').eq('user_id', uid).limit(1),
          supabase.from('bundles').select('id').eq('user_id', uid).limit(1),
          supabase.from('sandbox_sheets').select('id').eq('user_id', uid).limit(1),
          supabase.from('closed_months').select('id').eq('user_id', uid).limit(1)
        ]);
        if (window.__activeUserId !== uid || activeAccountRef.current !== originAccount) return;

        const allVerifiedEmpty =
          !expCheck.error &&
          !adjCheck.error &&
          !bunCheck.error &&
          !sheetCheck.error &&
          !closedCheck.error &&
          expCheck.data.length === 0 &&
          adjCheck.data.length === 0 &&
          bunCheck.data.length === 0 &&
          sheetCheck.data.length === 0 &&
          closedCheck.data.length === 0;

        if (allVerifiedEmpty) {
          finalizeClientWipe(uid);
          return;
        }

        console.error('Atomic wipe failed:', error);
        alert(t('err_data_wipe_partial', 'Failed to wipe financial data. No records were deleted. Please try again.'));
        return;
      }

      finalizeClientWipe(uid);
    } catch (error) {
      if (originUserId && window.__activeUserId === originUserId && activeAccountRef.current === originAccount) {
        console.error(error);
        alert(t('err_data_wipe', 'An error occurred while wiping data.'));
      }
    } finally {
      if (isMountedRef.current && activeAccountRef.current === originAccount) {
        setIsProcessingDanger(false);
      }
    }
  };

  /**
- Triggers permanent account deletion via Supabase RPC.
   */
  const handleDeleteAccount = async () => {
    if (!window.confirm(t('confirm_delete_account', 'DANGER: This will permanently delete your entire account, profile, and all associated data. You will be logged out immediately. Are you sure?'))) {
      return;
    }

    setIsProcessingDanger(true);

    try {
      const { error } = await supabase.rpc('delete_user_account');

      if (error) {
        console.error(error);
        alert(t('err_account_delete', 'Failed to delete account. Ensure the database RPC is configured.'));
      } else {
        await supabase.auth.signOut();
        window.location.reload();
      }
    } finally {
      setIsProcessingDanger(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8 pb-12">
      {/* --- Subscription, 1-Click Cancellation & 2-Hour Unused Refund (Settings -> Subscription) --- */}
      <div
        id="subscription"
        className="bg-white dark:bg-zinc-900 rounded-md p-6 border border-gray-200 dark:border-zinc-800 shadow-sm space-y-4"
      >
        <div className="flex items-center justify-between border-b border-gray-100 dark:border-zinc-800 pb-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">
              {t('subscription_heading', 'Subscription')}
            </h2>
            <p className="text-xs text-gray-500 dark:text-zinc-400">
              {t('subscription_subhead', 'Manage your MANAGED plan, 1-click cancellation, and refund eligibility.')}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span
              className={`px-3 py-1 rounded-full text-xs font-extrabold uppercase tracking-wider ${
                isPaidPro || isRoleGrantedPro
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-500/30'
                  : 'bg-gray-100 text-gray-700 dark:bg-zinc-800 dark:text-zinc-300 border border-gray-200 dark:border-zinc-700'
              }`}
            >
              {isPaidPro
                ? cancelAtPeriodEnd
                  ? t('plan_pro_canceling', 'MANAGED Pro (Cancels at Period End)')
                  : t('plan_pro', 'MANAGED Pro')
                : isRoleGrantedPro
                  ? t('plan_pro_role', `MANAGED Pro (${userRole})`)
                  : t('plan_free', 'Free Tier')}
            </span>
            {!isRoleGrantedPro && (
              <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                {t('pro_price_badge', 'MANAGED Pro: $6.99 / month (tax excluded)')}
              </span>
            )}
          </div>
        </div>

        {billingMsg.text && (
          <div
            className={`p-3 rounded-md text-xs font-semibold ${
              billingMsg.type === 'error'
                ? 'bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800'
                : 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
            }`}
          >
            {billingMsg.text}
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1">
          <div className="space-y-1.5 text-xs text-gray-600 dark:text-zinc-400">
            {isPaidPro ? (
              <>
                {cancelAtPeriodEnd || subscriptionStatus === 'canceled_pending_expiry' ? (
                  <p>
                    {t(
                      'sub_canceled_notice',
                      `Recurring billing ($6.99/mo) is stopped. You will not be charged again, and your Pro features remain active until ${formattedPeriodEnd || 'the end of your current billing period'}.`
                    )}
                  </p>
                ) : (
                  <p>
                    {t(
                      'sub_active_notice',
                      `Your MANAGED Pro subscription ($6.99/month, tax excluded) is active${formattedPeriodEnd ? ` (renews on ${formattedPeriodEnd})` : ''}. You can cancel with one click at any time.`
                    )}
                  </p>
                )}

                {isRefundEligible ? (
                  <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                    {t('sub_refund_eligible_notice', {
                      minutes: minutesLeftForRefund,
                      defaultValue: `2-Hour Unused Refund eligible (${minutesLeftForRefund} min remaining • 0 Pro features used).`
                    })}
                  </p>
                ) : (
                  <p className="text-[11px] text-gray-400 dark:text-zinc-500">
                    {hasClaimedRefund
                      ? t('sub_refund_locked_claimed', '2-hour refund unavailable: one-time account refund was already claimed.')
                      : proFeaturesUsed
                        ? t('sub_refund_locked_used', '2-hour refund unavailable: MANAGED Pro features have been used during this billing cycle.')
                        : t('sub_refund_locked_expired', '2-hour unused refund window has closed. Standard 1-click cancellation remains available.')}
                  </p>
                )}
              </>
            ) : isRoleGrantedPro ? (
              <p>
                {t(
                  'sub_role_notice',
                  'Your account role grants complimentary MANAGED Pro features with no recurring billing.'
                )}
              </p>
            ) : (
              <p>
                {t(
                  'sub_free_notice',
                  'Upgrade to MANAGED Pro for $6.99/month (tax excluded) to unlock Formal & Visual Excel Audits, unlimited Custom Categories, unlimited Sterling AI commands, multi-sheet Sandboxes, and multi-goal Wealth Objectives. Includes 1-click cancellation anytime and a 2-Hour Unused Refund Policy.'
                )}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {isPaidPro ? (
              <>
                {!cancelAtPeriodEnd && !isResumingRefundCancel && (
                  <button
                    type="button"
                    onClick={handleOneClickCancel}
                    disabled={isBillingBusy}
                    className="px-4 py-2 bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-500/20 border border-rose-200 dark:border-rose-500/30 rounded-md text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isBillingBusy
                      ? t('canceling_sub', 'Processing...')
                      : t('cancel_subscription_btn', 'Cancel Subscription')}
                  </button>
                )}
                {isRefundEligible && (
                  <button
                    type="button"
                    onClick={handleRequestRefund}
                    disabled={isBillingBusy}
                    className="px-3.5 py-2 bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-500/20 border border-amber-300 dark:border-amber-500/30 rounded-md text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isBillingBusy
                      ? t('processing', 'Processing...')
                      : isResumingRefundCancel
                        ? t('finish_refund_cancel_btn', 'Complete Refund Cancellation')
                        : t('request_2h_refund_btn', 'Request 2-Hour Refund')}
                  </button>
                )}
              </>
            ) : (
              <>
                {isResumingRefundCancel && (
                  <button
                    type="button"
                    onClick={handleRequestRefund}
                    disabled={isBillingBusy}
                    className="px-3.5 py-2 bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-500/20 border border-amber-300 dark:border-amber-500/30 rounded-md text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isBillingBusy
                      ? t('processing', 'Processing...')
                      : t('finish_refund_cancel_btn', 'Complete Refund Cancellation')}
                  </button>
                )}
                {!isRoleGrantedPro && !isResumingRefundCancel && !isRefundPendingProvider && (
                  <button
                    type="button"
                    onClick={handleUpgradeClick}
                    disabled={isBillingBusy}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-xs font-bold transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isBillingBusy
                      ? t('starting_checkout', 'Starting Checkout...')
                      : t('upgrade_pro_btn', 'Upgrade to MANAGED Pro — $6.99/mo')}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* --- Existing Account Preferences --- */}
      <div className="bg-white dark:bg-zinc-900 rounded-md p-6 border border-gray-200 dark:border-zinc-800 shadow-sm space-y-6">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white border-b border-gray-100 dark:border-zinc-800 pb-3">
          {t('account_preferences')}
        </h2>

        <div className="flex items-center justify-between pb-6 border-b border-gray-100 dark:border-zinc-800">
          <div>
            <h3 className="text-sm font-bold text-gray-900 dark:text-zinc-200">{t('theme_preference')}</h3>
            <p className="text-xs text-gray-500 dark:text-zinc-500">{t('theme_desc')}</p>
          </div>
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="px-4 py-2 rounded-md bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 text-gray-800 dark:text-zinc-200 text-sm font-bold transition-all border border-gray-300 dark:border-zinc-700 flex items-center gap-2"
          >
            {theme === 'dark' ? (
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-4 h-4 text-amber-400">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-4 h-4 text-emerald-600">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
              </svg>
            )}
            {theme === 'dark' ? t('light_mode') : t('dark_mode')}
          </button>
        </div>

        <div className="pb-6 border-b border-gray-100 dark:border-zinc-800">
          <label className="block text-sm font-bold text-gray-900 dark:text-zinc-200 mb-1">
            {t('monthly_net_salary')}
          </label>
          <p className="text-xs text-gray-500 dark:text-zinc-500 mb-3">
            {t('salary_desc')}
          </p>
          <input
            type="number"
            value={salary}
            onChange={(e) => setSalary(e.target.value)}
            onBlur={handleUpdateProfile}
            placeholder={t('enter_amount')}
            className="w-full sm:w-64 px-3 py-2 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500 font-semibold"
          />
        </div>

        <div className="pb-2 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-sm font-bold text-gray-900 dark:text-zinc-200 mb-1">{t('global_currency')}</h3>
              <p className="text-xs text-gray-500 dark:text-zinc-500 mb-3">{t('currency_desc')}</p>
              <div className="flex gap-4">
                <select
                  value={currencyMode}
                  onChange={(e) => {
                    const m = e.target.value;
                    setCurrencyMode(m);
                    setCurrency(m === 'none' ? '' : m === 'custom' ? customCurrency : m);
                  }}
                  className="px-3 py-2 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-300 text-sm focus:outline-none focus:border-emerald-500 w-full"
                >
                  <option value="$">$ (USD)</option>
                  <option value="€">€ (Euro)</option>
                  <option value="£">£ (GBP)</option>
                  <option value="MAD">MAD</option>
                  <option value="none">{t('none')}</option>
                  <option value="custom">{t('custom')}</option>
                </select>

                {currencyMode === 'custom' && (
                  <input
                    type="text"
                    value={customCurrency}
                    onChange={(e) => {
                      setCustomCurrency(e.target.value);
                      setCurrency(e.target.value);
                    }}
                    placeholder="Sym"
                    maxLength="5"
                    className="w-24 px-3 py-2 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500 text-center text-sm"
                  />
                )}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-bold text-gray-900 dark:text-zinc-200 mb-1">{t('app_language')}</h3>
              <p className="text-xs text-gray-500 dark:text-zinc-500 mb-3">{t('language_desc')}</p>
              <select
                value={i18n.resolvedLanguage || 'en'}
                onChange={(e) => i18n.changeLanguage(e.target.value)}
                className="w-full px-3 py-2 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-300 text-sm focus:outline-none focus:border-emerald-500"
              >
                <option value="en">English</option>
                <option value="fr">Français</option>
                <option value="es">Español</option>
                <option value="ar">العربية (Arabic)</option>
              </select>
            </div>
          </div>
        </div>

        <div className="pt-6 border-t border-gray-100 dark:border-zinc-800">
          <h3 className="text-sm font-bold text-gray-900 dark:text-zinc-200 mb-1">
            {t('data_portability')}
          </h3>
          <p className="text-xs text-gray-500 dark:text-zinc-500 mb-4">
            {t('export_desc')}
          </p>

          <div className="bg-gray-50 dark:bg-zinc-950 p-4 rounded-md border border-gray-200 dark:border-zinc-800 space-y-4">
            <div className="flex gap-2">
              <button
                onClick={() => setExportScope('month')}
                className={`flex-1 py-2 text-xs font-bold rounded-md transition-all ${exportScope === 'month'
                  ? 'bg-emerald-600 text-white shadow'
                  : 'bg-white dark:bg-zinc-900 text-gray-600 dark:text-zinc-400 border border-gray-200 dark:border-zinc-800'
                  }`}
              >
                {t('whole_month_report')}
              </button>
              <button
                onClick={() => setExportScope('day')}
                className={`flex-1 py-2 text-xs font-bold rounded-md transition-all ${exportScope === 'day'
                  ? 'bg-emerald-600 text-white shadow'
                  : 'bg-white dark:bg-zinc-900 text-gray-600 dark:text-zinc-400 border border-gray-200 dark:border-zinc-800'
                  }`}
              >
                {t('specific_day_report')}
              </button>
            </div>

            {exportScope === 'month' ? (
              <div>
                <label className="block text-[10px] font-bold text-gray-400 dark:text-zinc-500 uppercase tracking-wider mb-1">
                  {t('select_month')} ({t('up_to')} {getCurrentMonth()})
                </label>
                <input
                  type="month"
                  value={exportMonth}
                  max={getCurrentMonth()}
                  onChange={(e) => setExportMonth(e.target.value)}
                  className="w-full sm:w-64 px-3 py-2 rounded-md bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-white text-sm font-semibold focus:outline-none focus:border-emerald-500"
                />
              </div>
            ) : (
              <div>
                <label className="block text-[10px] font-bold text-gray-400 dark:text-zinc-500 uppercase tracking-wider mb-1">
                  {t('select_date')} ({t('up_to')} {getToday()})
                </label>
                <input
                  type="date"
                  value={exportDate}
                  max={getToday()}
                  onChange={(e) => setExportDate(e.target.value)}
                  className="w-full sm:w-64 px-3 py-2 rounded-md bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-white text-sm font-semibold focus:outline-none focus:border-emerald-500"
                />
              </div>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-4 mt-4 w-full">
            <button
              onClick={() => handleExportData('formal')}
              className="flex-1 py-3 bg-gray-800 hover:bg-gray-900 text-white rounded-md text-sm font-bold transition-all shadow-md flex items-center justify-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-4 h-4 shrink-0">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
              {t('export_formal_btn')}
            </button>
            <button
              onClick={() => handleExportData('visual')}
              className="flex-1 py-3 bg-emerald-700 hover:bg-emerald-800 text-white rounded-md text-sm font-bold transition-all shadow-md flex items-center justify-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-4 h-4 shrink-0">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
              </svg>
              {t('export_visual_btn')}
            </button>
          </div>
        </div>
      </div>

      {/* --- Phase 9: Security & Authentication --- */}
      <div className="bg-white dark:bg-zinc-900 rounded-md p-6 border border-gray-200 dark:border-zinc-800 shadow-sm space-y-6">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white border-b border-gray-100 dark:border-zinc-800 pb-3">
          {t('security_auth', 'Security & Authentication')}
        </h2>

        <form onSubmit={handleUpdatePassword} className="space-y-4">
          <div>
            <h3 className="text-sm font-bold text-gray-900 dark:text-zinc-200 mb-1">{t('update_password', 'Update Password')}</h3>
            <p className="text-xs text-gray-500 dark:text-zinc-500 mb-4">{t('password_desc', 'Ensure your account stays secure by using a strong password.')}</p>

            {passwordMsg.text && (
              <div className={`mb-4 p-3 rounded-md text-xs font-semibold ${passwordMsg.type === 'error' ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
                {passwordMsg.text}
              </div>
            )}

            <div className="space-y-3 max-w-sm">
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={t('new_password', 'New Password')}
                className="w-full px-3 py-2 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-700 text-sm focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 text-gray-900 dark:text-white"
                required
              />
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={t('confirm_password', 'Confirm New Password')}
                className="w-full px-3 py-2 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-700 text-sm focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 text-gray-900 dark:text-white"
                required
              />
              <button
                type="submit"
                disabled={isUpdatingPassword}
                className="w-full py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-md text-sm font-bold transition-all shadow-md disabled:opacity-50"
              >
                {isUpdatingPassword ? t('updating', 'Updating...') : t('save_password', 'Save Password')}
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* --- Phase 9: Danger Zone --- */}
      <div className="bg-white dark:bg-zinc-900 rounded-md p-6 border border-rose-200 dark:border-rose-900/50 shadow-sm space-y-6 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-1 h-full bg-rose-500"></div>
        <h2 className="text-lg font-bold text-rose-600 dark:text-rose-500 border-b border-gray-100 dark:border-zinc-800 pb-3">
          {t('danger_zone', 'Danger Zone')}
        </h2>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-gray-100 dark:border-zinc-800">
          <div>
            <h3 className="text-sm font-bold text-gray-900 dark:text-zinc-200">{t('wipe_financial_data', 'Wipe Financial Data')}</h3>
            <p className="text-xs text-gray-500 dark:text-zinc-500 mt-1 max-w-sm">
              {t('wipe_data_desc', 'Permanently delete all expenses, assets, bundles, and history. Your categories and profile will remain.')}
            </p>
          </div>
          <button
            onClick={handleWipeData}
            disabled={isProcessingDanger}
            className="px-4 py-2 bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-500/20 border border-rose-200 dark:border-rose-500/30 rounded-md text-sm font-bold transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isProcessingDanger ? t('processing', 'Processing...') : t('wipe_data_btn', 'Wipe Data')}
          </button>
        </div>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-bold text-gray-900 dark:text-zinc-200">{t('delete_account', 'Delete Account')}</h3>
            <p className="text-xs text-gray-500 dark:text-zinc-500 mt-1 max-w-sm">
              {t('delete_account_desc', 'Permanently delete your profile and all associated data. This action cannot be reversed.')}
            </p>
          </div>
          <button
            onClick={handleDeleteAccount}
            disabled={isProcessingDanger}
            className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-md text-sm font-bold transition-colors shadow-md whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isProcessingDanger ? t('processing', 'Processing...') : t('delete_account_btn', 'Delete Account')}
          </button>
        </div>
      </div>

      {/* Automatic Recurring Expense Email Reminders (Daily, Monthly & Yearly) */}
      <div className="bg-white dark:bg-zinc-900 p-6 rounded-lg border border-gray-200 dark:border-zinc-800 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-gray-900 dark:text-white">
              {t('email_reminders_title', 'Automatic Recurring Expense Reminders')}
            </h3>
            <p className="text-xs text-gray-500 dark:text-zinc-400 mt-1">
              {t('email_reminders_desc', {
                email: userEmail || 'your account email',
                defaultValue: `Automatically receive daily, monthly, and yearly email reminders at ${userEmail || 'your account email'} for recurring expenses that match each cycle.`
              })}
            </p>
          </div>
          {setEmailRemindersEnabled && (
            <label className="inline-flex items-center gap-2 cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={Boolean(emailRemindersEnabled)}
                onChange={(e) => setEmailRemindersEnabled(e.target.checked)}
                className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
              />
              <span className="text-xs font-bold text-gray-800 dark:text-zinc-200">
                {t('email_reminders_enabled_label', 'Enable Email Reminders')}
              </span>
            </label>
          )}
        </div>
      </div>
    </div>
  );
}