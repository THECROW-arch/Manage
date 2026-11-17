import { supabase } from '../supabaseClient';

export function hasPendingLocalProUsage(userId) {
    if (!userId || typeof window === 'undefined') return false;
    try {
        return window.localStorage?.getItem(`managed_pending_pro_used_${userId}`) === 'true';
    } catch {
        return false;
    }
}

async function extractFunctionInvokeError(error, fallbackMessage, userId) {
    let parsedBody = null;
    try {
        const ctx = error?.context;
        if (ctx && typeof ctx.json === 'function') {
            parsedBody = await ctx.json();
        } else if (ctx && typeof ctx.text === 'function') {
            const rawText = await ctx.text();
            parsedBody = rawText ? JSON.parse(rawText) : null;
        }
    } catch {
        parsedBody = null;
    }

    if (parsedBody && typeof parsedBody === 'object') {
        return {
            ok: false,
            ...parsedBody,
            error: parsedBody.error || error?.message || fallbackMessage,
            userId
        };
    }

    return {
        ok: false,
        error: error?.message || fallbackMessage,
        userId
    };
}

/**
 * Initiates a Pro subscription checkout session or Sandbox upgrade via the billing-manager Edge Function.
 * Confirms that the originating user session is still active before returning the result.
 */
export async function startProCheckoutSession(expectedUserId) {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token;
    const originUserId = sessionData?.session?.user?.id || '';

    if (!accessToken || !originUserId) {
        return { ok: false, error: 'Please sign in before upgrading your subscription.' };
    }
    if (expectedUserId && expectedUserId !== originUserId) {
        return { ok: false, staleAccount: true, error: 'Active account changed.' };
    }

    const returnUrl = `${window.location.origin}/?checkout=success`;
    const { data, error } = await supabase.functions.invoke('billing-manager', {
        body: { action: 'create_checkout', returnUrl },
        headers: { Authorization: `Bearer ${accessToken}` }
    });

    const { data: latestSessionData } = await supabase.auth.getSession();
    const latestUserId = latestSessionData?.session?.user?.id || '';
    if (latestUserId !== originUserId) {
        return { ok: false, staleAccount: true, error: 'Account changed while checkout was pending.' };
    }

    if (error) {
        return extractFunctionInvokeError(error, 'Could not start checkout session.', originUserId);
    }

    return { ...(data || { ok: false, error: 'Empty response from billing service.' }), userId: originUserId };
}

/**
 * Cancels an active MANAGED Pro subscription with one click, stopping future recurring charges
 * immediately while keeping Pro features active through the end of the current paid period.
 */
export async function cancelProSubscription(expectedUserId) {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token;
    const originUserId = sessionData?.session?.user?.id || '';

    if (!accessToken || !originUserId) {
        return { ok: false, error: 'Please sign in to manage your subscription.' };
    }
    if (expectedUserId && expectedUserId !== originUserId) {
        return { ok: false, staleAccount: true, error: 'Active account changed.' };
    }

    const { data, error } = await supabase.functions.invoke('billing-manager', {
        body: { action: 'cancel_subscription' },
        headers: { Authorization: `Bearer ${accessToken}` }
    });

    const { data: latestSessionData } = await supabase.auth.getSession();
    const latestUserId = latestSessionData?.session?.user?.id || '';
    if (latestUserId !== originUserId) {
        return { ok: false, staleAccount: true, error: 'Account changed while cancellation was pending.' };
    }

    if (error) {
        return extractFunctionInvokeError(error, 'Could not cancel subscription.', originUserId);
    }

    return { ...(data || { ok: false, error: 'Empty response from billing service.' }), userId: originUserId };
}

/**
 * Requests a full refund under the 2-Hour Unused Pro Refund Policy (or completes a pending refund recovery).
 * Flushes any pending local Pro usage to the server first so fresh refunds see accurate usage while
 * recovery retries (refund_cancel_pending / refund_finalize_pending) are never blocked.
 */
export async function requestProSubscriptionRefund(expectedUserId, options = {}) {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token;
    const originUserId = sessionData?.session?.user?.id || '';

    if (!accessToken || !originUserId) {
        return { ok: false, error: 'Please sign in to request a subscription refund.' };
    }
    if (expectedUserId && expectedUserId !== originUserId) {
        return { ok: false, staleAccount: true, error: 'Active account changed.' };
    }

    const isRecovery = Boolean(options?.isRecovery);

    if (hasPendingLocalProUsage(originUserId)) {
        const { error: rpcErr } = await supabase.rpc('mark_pro_feature_used');
        if (!rpcErr) {
            try {
                window.localStorage?.removeItem(`managed_pending_pro_used_${originUserId}`);
            } catch {
                // Ignore storage errors
            }
        } else if (!isRecovery) {
            return {
                ok: false,
                userId: originUserId,
                error: 'Refund ineligible: MANAGED Pro features have already been used during this subscription. You can still cancel recurring billing with one click.'
            };
        }
    }

    const { data, error } = await supabase.functions.invoke('billing-manager', {
        body: { action: 'request_refund' },
        headers: { Authorization: `Bearer ${accessToken}` }
    });

    const { data: latestSessionData } = await supabase.auth.getSession();
    const latestUserId = latestSessionData?.session?.user?.id || '';
    if (latestUserId !== originUserId) {
        return { ok: false, staleAccount: true, error: 'Account changed while refund request was pending.' };
    }

    if (error) {
        return extractFunctionInvokeError(error, 'Could not process refund request.', originUserId);
    }

    return { ...(data || { ok: false, error: 'Empty response from billing service.' }), userId: originUserId };
}