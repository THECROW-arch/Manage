import { supabase } from '../supabaseClient';

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
        return { ok: false, error: error.message || 'Could not start checkout session.' };
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
        return { ok: false, error: error.message || 'Could not cancel subscription.' };
    }

    return { ...(data || { ok: false, error: 'Empty response from billing service.' }), userId: originUserId };
}

/**
 * Requests a full refund under the 2-Hour Unused Pro Refund Policy.
 * Requires <= 2 hours since subscription activation, zero Pro feature usage, and no prior refund on the account.
 */
export async function requestProSubscriptionRefund(expectedUserId) {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token;
    const originUserId = sessionData?.session?.user?.id || '';

    if (!accessToken || !originUserId) {
        return { ok: false, error: 'Please sign in to request a subscription refund.' };
    }
    if (expectedUserId && expectedUserId !== originUserId) {
        return { ok: false, staleAccount: true, error: 'Active account changed.' };
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
        return { ok: false, error: error.message || 'Could not process refund request.' };
    }

    return { ...(data || { ok: false, error: 'Empty response from billing service.' }), userId: originUserId };
}