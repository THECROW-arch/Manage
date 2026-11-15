import { supabase } from '../supabaseClient';

// Prevents concurrent duplicate dispatches for the same user, cycle, and period
const inFlightDispatches = new Map();

/**
 * Escapes HTML special characters to prevent injection inside email templates.
 * @param {string} raw - Raw text string.
 * @returns {string} HTML-safe string.
 */
function escapeHtml(raw) {
    return String(raw ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Parses the stored `last_reminder_period` value from `public.profiles` into a
 * `{ daily, monthly, yearly }` map while remaining backwards-compatible with plain period strings.
 * @param {string|object|null} raw - Raw column or state value.
 * @returns {{daily?: string, monthly?: string, yearly?: string}} Cycle-to-period map.
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
 * Builds the subject, plain-text body, and HTML body for a cycle-specific recurring expense reminder email.
 * @param {object} params - Template parameters.
 * @param {string} params.username - Recipient's display name.
 * @param {string} params.periodKey - Active period identifier ("2026-11-12", "2026-11", or "2026").
 * @param {'daily'|'monthly'|'yearly'} [params.recurrenceCycle='monthly'] - Recurrence cycle for this email batch.
 * @param {Array<object>} params.pendingExpenses - Active recurring expenses for this cycle.
 * @param {Function} params.formatCurrency - Currency formatting function.
 * @returns {{subject: string, textBody: string, htmlBody: string}} Formatted email payload.
 */
export function buildRecurringReminderEmail({
    username,
    periodKey,
    recurrenceCycle = 'monthly',
    pendingExpenses,
    formatCurrency
}) {
    const safeUser = escapeHtml(username || 'Member');
    const safePeriod = escapeHtml(periodKey);
    const cycleTitle =
        recurrenceCycle === 'daily'
            ? 'Daily'
            : recurrenceCycle === 'yearly'
                ? 'Yearly'
                : 'Monthly';

    const totalDue = pendingExpenses.reduce((sum, exp) => sum + (parseFloat(exp.cost) || 0), 0);
    const formattedTotal = formatCurrency ? formatCurrency(totalDue) : `${totalDue.toFixed(2)}`;

    const subject = `MANAGED ${cycleTitle} Reminder: ${pendingExpenses.length} ${cycleTitle} Recurring Expense${pendingExpenses.length === 1 ? '' : 's'} for ${periodKey}`;

    const textLines = pendingExpenses.map(
        (exp, idx) =>
            `${idx + 1}. ${exp.name} — ${formatCurrency ? formatCurrency(exp.cost) : exp.cost} (${exp.category || 'Category'} • ${cycleTitle})`
    );

    const textBody = [
        `Hi @${username || 'Member'},`,
        '',
        `Here is your automatic ${cycleTitle.toLowerCase()} recurring expense reminder for ${periodKey} (${pendingExpenses.length} item${pendingExpenses.length === 1 ? '' : 's'} totaling ${formattedTotal}):`,
        '',
        ...textLines,
        '',
        'Open your MANAGED Cash Flow dashboard to review, confirm, or skip any item for this period.'
    ].join('\n');

    const rowsHtml = pendingExpenses
        .map((exp) => {
            const name = escapeHtml(exp.name);
            const cat = escapeHtml(exp.category || 'Category');
            const freq = escapeHtml((exp.recurrenceType || recurrenceCycle).toUpperCase());
            const cost = escapeHtml(formatCurrency ? formatCurrency(exp.cost) : String(exp.cost));
            return `
              <tr>
                <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-weight:700;color:#111827;">${name}</td>
                <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#4b5563;">${cat}</td>
                <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#047857;font-size:11px;font-weight:700;">${freq}</td>
                <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;color:#111827;">${cost}</td>
              </tr>`;
        })
        .join('');

    const htmlBody = `
      <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;">
        <div style="margin-bottom:16px;">
          <span style="display:inline-block;padding:4px 10px;border-radius:9999px;background:#ecfdf5;color:#047857;font-size:11px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;">
            MANAGED • ${escapeHtml(cycleTitle)} Recurring Reminder
          </span>
        </div>
        <h2 style="margin:0 0 8px;font-size:20px;color:#111827;">Hi @${safeUser},</h2>
        <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#4b5563;">
          You have <strong>${pendingExpenses.length}</strong> ${escapeHtml(cycleTitle.toLowerCase())} recurring expense${pendingExpenses.length === 1 ? '' : 's'} totaling <strong>${escapeHtml(formattedTotal)}</strong> scheduled for <strong>${safePeriod}</strong>:
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px;">
          <thead>
            <tr style="background:#f9fafb;text-align:left;font-size:11px;text-transform:uppercase;color:#6b7280;">
              <th style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">Expense</th>
              <th style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">Category</th>
              <th style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">Cycle</th>
              <th style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">Amount</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        <p style="margin:0;font-size:12px;color:#6b7280;">
          Open your MANAGED Cash Flow tab to review or skip any recurring item for this ${escapeHtml(cycleTitle.toLowerCase())} period.
        </p>
      </div>
    `;

    return { subject, textBody, htmlBody };
}

/**
 * Checks Supabase across devices to see if a reminder for the given cycle and period was already sent.
 * Distinguishes 'sent', 'not_sent', and 'unverified' so a failed lookup is never treated
 * as permission to send. Preserves a positive result when either source confirms delivery.
 * @param {string} userId - Authenticated user UUID.
 * @param {'daily'|'monthly'|'yearly'} recurrenceCycle - Recurrence cycle.
 * @param {string} periodKey - Active period identifier ("2026-11-12", "2026-11", or "2026").
 * @returns {Promise<{state: 'sent' | 'not_sent' | 'unverified', currentMap?: object, error?: string}>} Verification result.
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
 * Automatically dispatches a cycle-specific recurring expense reminder email (daily, monthly, or yearly).
 * Deduplicates concurrent in-flight requests, logs attempts in public.email_reminder_queue,
 * and persists the updated cycle map in public.profiles.last_reminder_period across devices.
 * @param {object} params - Dispatch parameters.
 * @returns {Promise<{ok: boolean, status?: string, serializedMap?: string, alreadySent?: boolean, retryable?: boolean, error?: string}>} Dispatch result.
 */
export async function sendRecurringExpenseReminderEmail({
    userId,
    recipientEmail,
    username,
    periodKey,
    recurrenceCycle = 'monthly',
    pendingExpenses,
    formatCurrency,
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

        const { subject, textBody, htmlBody } = buildRecurringReminderEmail({
            username,
            periodKey,
            recurrenceCycle,
            pendingExpenses,
            formatCurrency
        });

        let deliveryStatus;
        let deliveryError = null;

        try {
            const webhookUrl = import.meta.env?.VITE_EMAIL_WEBHOOK_URL;
            if (webhookUrl) {
                const resp = await fetch(webhookUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        to: recipientEmail,
                        subject,
                        text: textBody,
                        html: htmlBody,
                        periodKey
                    })
                });
                if (resp.ok) {
                    deliveryStatus = 'sent';
                } else {
                    deliveryStatus = 'failed';
                    deliveryError = `Email webhook failed with status ${resp.status}.`;
                }
            } else {
                const { error: fnError } = await supabase.functions.invoke('send-recurring-reminder', {
                    body: {
                        to: recipientEmail,
                        subject,
                        text: textBody,
                        html: htmlBody,
                        periodKey
                    }
                });
                if (!fnError) {
                    deliveryStatus = 'sent';
                } else {
                    deliveryStatus = 'failed';
                    deliveryError = fnError.message || 'Failed to invoke send-recurring-reminder Edge Function.';
                }
            }
        } catch (err) {
            deliveryStatus = 'failed';
            deliveryError = err.message || 'Network error while dispatching reminder email.';
        }

        let queueInserted = false;
        try {
            const { error: dbError } = await supabase.from('email_reminder_queue').insert([
                {
                    user_id: userId,
                    recipient_email: recipientEmail,
                    period_key: periodKey,
                    subject,
                    html_body: htmlBody,
                    text_body: textBody,
                    expense_count: pendingExpenses.length,
                    status: deliveryStatus
                }
            ]);

            if (dbError) {
                console.warn('Could not write to email_reminder_queue:', dbError.message);
            } else {
                queueInserted = true;
            }
        } catch (dbErr) {
            console.warn('Failed to log email reminder attempt:', dbErr);
        }

        if (deliveryStatus !== 'sent') {
            return {
                ok: false,
                status: 'failed',
                error: deliveryError || 'Failed to deliver reminder email.'
            };
        }

        const updatedMap = { ...existingMap, [recurrenceCycle]: periodKey };
        const serializedMap = JSON.stringify(updatedMap);

        let profileUpdated = false;
        try {
            const { data: updatedRows, error: profileUpdateError } = await supabase
                .from('profiles')
                .update({ last_reminder_period: serializedMap })
                .eq('user_id', userId)
                .select('user_id');

            if (!profileUpdateError && Array.isArray(updatedRows) && updatedRows.length > 0) {
                profileUpdated = true;
            } else {
                const { error: upsertError } = await supabase
                    .from('profiles')
                    .upsert(
                        { user_id: userId, last_reminder_period: serializedMap },
                        { onConflict: 'user_id' }
                    );
                if (upsertError) {
                    console.warn('Could not persist last_reminder_period to profile:', upsertError.message);
                } else {
                    profileUpdated = true;
                }
            }
        } catch (profileErr) {
            console.warn('Failed to update profile last_reminder_period:', profileErr);
        }

        if (!profileUpdated && !queueInserted) {
            return {
                ok: false,
                status: 'persistence_failed',
                error: 'Email was sent, but the sent-period record could not be saved to Supabase.'
            };
        }

        try {
            localStorage.setItem(`managed_last_reminder_${userId}_${recurrenceCycle}`, periodKey);
            localStorage.setItem(`managed_last_reminder_${userId}`, serializedMap);
        } catch {
            // Ignore storage quota errors
        }

        return { ok: true, status: 'sent', serializedMap };
    })();

    inFlightDispatches.set(dispatchKey, dispatchPromise);
    try {
        return await dispatchPromise;
    } finally {
        inFlightDispatches.delete(dispatchKey);
    }
}