import { supabase } from '../supabaseClient';

// Prevents concurrent duplicate dispatches for the same user, cycle, and period
const inFlightDispatches = new Map();

/**
- Parses the stored `last_reminder_period` value from `public.profiles` into a
- `{ daily, monthly, yearly }` map while remaining backwards-compatible with plain period strings.
- @param {string|object|null} raw - Raw column or state value.
- @returns {{daily?: string, monthly?: string, yearly?: string}} Cycle-to-period map.
 */
export function parseReminderPeriodMap(raw) {
    if (!raw) return {};
    if (typeof raw === 'object' && !Array.isArray(raw)) {
        return { ...raw };
    }
    const str = String(raw).trim();
    if (!str) return {};
    if (str.startsWith('{')) {
        try {
            const parsed = JSON.parse(str);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed;
            }
        } catch {
            // Fall through to legacy string handling
        }
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return { daily: str };
    if (/^\d{4}-\d{2}$/.test(str)) return { monthly: str };
    if (/^\d{4}$/.test(str)) return { yearly: str };
    return { monthly: str };
}

/**
- Checks Supabase across devices to see if a reminder for the given cycle and period was already sent.
- Distinguishes 'sent', 'not_sent', and 'unverified' so a failed lookup is never treated
- as permission to send. Preserves a positive result when either source confirms delivery.
- @param {string} userId - Authenticated user UUID.
- @param {'daily'|'monthly'|'yearly'} recurrenceCycle - Recurrence cycle.
- @param {string} periodKey - Active period identifier ("2026-11-12", "2026-11", or "2026").
- @returns {Promise<{state: 'sent' | 'not_sent' | 'unverified', currentMap?: object, error?: string}>} Verification result.
 */
async function checkReminderDeliveryStatus(userId, recurrenceCycle, periodKey) {
    try {
        const [profileRes, queueRes] = await Promise.all([
            supabase
                .from('profiles')
                .select('last_reminder_period')
                .eq('user_id', userId)
                .maybeSingle(),
            supabase
                .from('email_reminder_queue')
                .select('id')
                .eq('user_id', userId)
                .eq('period_key', periodKey)
                .eq('status', 'sent')
                .limit(1)
        ]);

        const currentMap = !profileRes.error
            ? parseReminderPeriodMap(profileRes.data?.last_reminder_period)
            : {};

        const profileConfirmed =
            !profileRes.error && currentMap[recurrenceCycle] === periodKey;
        const queueConfirmed =
            !queueRes.error && Array.isArray(queueRes.data) && queueRes.data.length > 0;

        if (profileConfirmed || queueConfirmed) {
            return { state: 'sent', currentMap };
        }

        if (profileRes.error || queueRes.error) {
            const errMsg =
                profileRes.error?.message ||
                queueRes.error?.message ||
                'Unable to verify reminder delivery status.';
            console.warn('Could not verify cross-device reminder status:', errMsg);
            return { state: 'unverified', currentMap, error: errMsg };
        }

        return { state: 'not_sent', currentMap };
    } catch (err) {
        const errMsg = err?.message || 'Network error while verifying reminder status.';
        console.warn('Could not verify cross-device reminder status:', err);
        return { state: 'unverified', currentMap: {}, error: errMsg };
    }
}

/**
- Dispatches a cycle-specific recurring expense reminder email (daily, monthly, or yearly)
- through the authenticated `send-recurring-reminder` Edge Function, which renders the HTML
- template server-side and enforces an atomic `email_reminder_queue` lock and rate limit.
- @param {object} params - Dispatch parameters.
- @returns {Promise<{ok: boolean, status?: string, serializedMap?: string, alreadySent?: boolean, retryable?: boolean, error?: string}>} Dispatch result.
 */
export async function sendRecurringExpenseReminderEmail({
    userId,
    recipientEmail,
    username,
    periodKey,
    recurrenceCycle = 'monthly',
    pendingExpenses,
    onlyIfNotSent = true
}) {
    if (!userId || !recipientEmail) {
        return { ok: false, error: 'Missing authenticated user email.' };
    }
    if (!Array.isArray(pendingExpenses) || pendingExpenses.length === 0) {
        return { ok: false, error: 'No recurring expenses require confirmation for this period.' };
    }

    const dispatchKey = `${userId}_${recurrenceCycle}_${periodKey}`;
    if (inFlightDispatches.has(dispatchKey)) {
        return inFlightDispatches.get(dispatchKey);
    }

    const dispatchPromise = (async () => {
        let existingMap = {};

        if (onlyIfNotSent) {
            const verification = await checkReminderDeliveryStatus(userId, recurrenceCycle, periodKey);
            existingMap = verification.currentMap || {};

            if (verification.state === 'sent') {
                const updatedMap = { ...existingMap, [recurrenceCycle]: periodKey };
                const serializedMap = JSON.stringify(updatedMap);
                try {
                    localStorage.setItem(`managed_last_reminder_${userId}_${recurrenceCycle}`, periodKey);
                    localStorage.setItem(`managed_last_reminder_${userId}`, serializedMap);
                } catch {
                    // Ignore localStorage quota errors
                }
                return { ok: true, status: 'already_sent', alreadySent: true, serializedMap };
            }
            if (verification.state === 'unverified') {
                return {
                    ok: false,
                    status: 'verification_failed',
                    retryable: true,
                    error: verification.error || 'Could not verify whether reminder was already sent.'
                };
            }
        }

        const structuredExpenses = pendingExpenses.slice(0, 50).map((exp) => ({
            name: String(exp.name || '').trim().slice(0, 120),
            cost: Number(exp.cost) || 0,
            category: String(exp.category || 'Category').trim().slice(0, 60),
            recurrenceType: exp.recurrenceType || recurrenceCycle
        }));

        const { data, error: fnError } = await supabase.functions.invoke('send-recurring-reminder', {
            body: {
                to: recipientEmail,
                username,
                periodKey,
                recurrenceCycle,
                pendingExpenses: structuredExpenses
            }
        });

        if (fnError || !data?.ok) {
            return {
                ok: false,
                status: 'failed',
                retryable: true,
                error: data?.error || fnError?.message || 'Failed to deliver reminder email.'
            };
        }

        const serializedMap =
            data.serializedMap ||
            JSON.stringify({ ...existingMap, [recurrenceCycle]: periodKey });

        try {
            localStorage.setItem(`managed_last_reminder_${userId}_${recurrenceCycle}`, periodKey);
            localStorage.setItem(`managed_last_reminder_${userId}`, serializedMap);
        } catch {
            // Ignore storage quota errors
        }

        return {
            ok: true,
            status: data.alreadySent ? 'already_sent' : 'sent',
            alreadySent: Boolean(data.alreadySent),
            serializedMap
        };
    })();

    inFlightDispatches.set(dispatchKey, dispatchPromise);
    try {
        return await dispatchPromise;
    } finally {
        inFlightDispatches.delete(dispatchKey);
    }
}