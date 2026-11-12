import { supabase } from '../supabaseClient';

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
 * Builds the subject, plain-text body, and HTML body for a recurring expense confirmation email.
 * @param {object} params - Template parameters.
 * @param {string} params.username - Recipient's display name.
 * @param {string} params.periodKey - Active period identifier (e.g. "2026-11").
 * @param {Array<object>} params.pendingExpenses - Unconfirmed recurring expenses for the period.
 * @param {Function} params.formatCurrency - Currency formatting function.
 * @returns {{subject: string, textBody: string, htmlBody: string}} Formatted email payload.
 */
export function buildRecurringReminderEmail({ username, periodKey, pendingExpenses, formatCurrency }) {
    const safeUser = escapeHtml(username || 'Member');
    const safePeriod = escapeHtml(periodKey);
    const totalDue = pendingExpenses.reduce((sum, exp) => sum + (parseFloat(exp.cost) || 0), 0);
    const formattedTotal = formatCurrency ? formatCurrency(totalDue) : `${totalDue.toFixed(2)}`;

    const subject = `MANAGED Reminder: ${pendingExpenses.length} Recurring Expense${pendingExpenses.length === 1 ? '' : 's'} to Confirm for ${periodKey}`;

    const textLines = pendingExpenses.map(
        (exp, idx) =>
            `${idx + 1}. ${exp.name} — ${formatCurrency ? formatCurrency(exp.cost) : exp.cost} (${exp.category || 'Category'} • ${exp.recurrenceType || 'monthly'})`
    );

    const textBody = [
        `Hi @${username || 'Member'},`,
        '',
        `You have ${pendingExpenses.length} recurring expense${pendingExpenses.length === 1 ? '' : 's'} totaling ${formattedTotal} awaiting confirmation or skip review in your ${periodKey} MANAGED ledger:`,
        '',
        ...textLines,
        '',
        'Open your MANAGED Cash Flow dashboard to confirm or skip these items for the current period.'
    ].join('\n');

    const rowsHtml = pendingExpenses
        .map((exp) => {
            const name = escapeHtml(exp.name);
            const cat = escapeHtml(exp.category || 'Category');
            const freq = escapeHtml((exp.recurrenceType || 'monthly').toUpperCase());
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
            MANAGED • Recurring Expense Reminder
          </span>
        </div>
        <h2 style="margin:0 0 8px;font-size:20px;color:#111827;">Hi @${safeUser},</h2>
        <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#4b5563;">
          You have <strong>${pendingExpenses.length}</strong> recurring expense${pendingExpenses.length === 1 ? '' : 's'} totaling <strong>${escapeHtml(formattedTotal)}</strong> ready to confirm or skip for <strong>${safePeriod}</strong>:
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
          Open your MANAGED Cash Flow tab to mark each recurring item as <strong>Confirmed</strong> or <strong>Skipped</strong> for this period.
        </p>
      </div>
    `;

    return { subject, textBody, htmlBody };
}

/**
 * Checks Supabase across devices to see if a reminder for the given period was already sent.
 * @param {string} userId - Authenticated user UUID.
 * @param {string} periodKey - Active period identifier (e.g. "2026-11").
 * @returns {Promise<boolean>} True if a reminder has already been sent for this period.
 */
async function hasAlreadySentReminderForPeriod(userId, periodKey) {
    try {
        const [{ data: profileData }, { data: queueData }] = await Promise.all([
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

        if (profileData?.last_reminder_period === periodKey) return true;
        if (Array.isArray(queueData) && queueData.length > 0) return true;
    } catch (err) {
        console.warn('Could not verify cross-device reminder status:', err);
    }
    return false;
}

/**
 * Dispatches a recurring expense confirmation reminder email to the authenticated user.
 * Logs every attempt in Supabase (public.email_reminder_queue) so failures stay auditable,
 * persists last_reminder_period in public.profiles across devices, and returns ok: false
 * whenever delivery or period persistence does not succeed.
 * @param {object} params - Dispatch parameters.
 * @returns {Promise<{ok: boolean, status?: string, alreadySent?: boolean, error?: string}>} Dispatch result.
 */
export async function sendRecurringExpenseReminderEmail({
    userId,
    recipientEmail,
    username,
    periodKey,
    pendingExpenses,
    formatCurrency,
    onlyIfNotSent = false
}) {
    if (!userId || !recipientEmail) {
        return { ok: false, error: 'Missing authenticated user email.' };
    }
    if (!Array.isArray(pendingExpenses) || pendingExpenses.length === 0) {
        return { ok: false, error: 'No recurring expenses require confirmation for this period.' };
    }

    if (onlyIfNotSent) {
        const alreadySent = await hasAlreadySentReminderForPeriod(userId, periodKey);
        if (alreadySent) {
            try {
                localStorage.setItem(`managed_last_reminder_${userId}`, periodKey);
            } catch {
                // Ignore localStorage quota errors
            }
            return { ok: true, status: 'already_sent', alreadySent: true };
        }
    }

    const { subject, textBody, htmlBody } = buildRecurringReminderEmail({
        username,
        periodKey,
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

    // Always insert the audit row into email_reminder_queue so both sent and failed attempts are recorded
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

    // Persist the sent period in Supabase profiles across devices
    let profileUpdated = false;
    try {
        const { error: profileUpdateError } = await supabase
            .from('profiles')
            .upsert(
                { user_id: userId, last_reminder_period: periodKey },
                { onConflict: 'user_id' }
            );

        if (profileUpdateError) {
            console.warn('Could not persist last_reminder_period to profile:', profileUpdateError.message);
        } else {
            profileUpdated = true;
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
        localStorage.setItem(`managed_last_reminder_${userId}`, periodKey);
    } catch {
        // Ignore storage quota errors
    }

    return { ok: true, status: 'sent' };
}