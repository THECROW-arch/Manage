import { supabase } from '../supabaseClient';

/**
 * Initiates a Pro subscription checkout session or Sandbox upgrade via the billing-manager Edge Function.
 */
export async function startProCheckoutSession() {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token;
    if (!accessToken) {
        return { ok: false, error: 'Please sign in before upgrading your subscription.' };
    }

    const returnUrl = `${window.location.origin}/?checkout=success`;
    const { data, error } = await supabase.functions.invoke('billing-manager', {
        body: { action: 'create_checkout', returnUrl },
        headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (error) {
        return { ok: false, error: error.message || 'Could not start checkout session.' };
    }

    return data || { ok: false, error: 'Empty response from billing service.' };
}

/**
 * Cancels an active MANAGED Pro subscription with one click, stopping future recurring charges
 * immediately while keeping Pro features active through the end of the current paid period.
 */
export async function cancelProSubscription() {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token;
    if (!accessToken) {
        return { ok: false, error: 'Please sign in to manage your subscription.' };
    }

    const { data, error } = await supabase.functions.invoke('billing-manager', {
        body: { action: 'cancel_subscription' },
        headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (error) {
        return { ok: false, error: error.message || 'Could not cancel subscription.' };
    }

    return data || { ok: false, error: 'Empty response from billing service.' };
}