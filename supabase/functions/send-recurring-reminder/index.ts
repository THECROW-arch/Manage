export {};
// supabase/functions/send-recurring-reminder/index.ts
declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const VALID_CYCLES = new Set(["daily", "monthly", "yearly"]);
const MAX_EXPENSE_ITEMS = 250;
const MAX_REPLAY_AGE_MS = 23 * 60 * 60 * 1000;
const IN_FLIGHT_RECONCILE_WAIT_MS = 30 * 1000;

interface StructuredExpenseItem {
  name: string;
  cost: number;
  category: string;
  recurrenceType: "daily" | "monthly" | "yearly";
}

function escapeHtmlEntities(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripControlChars(raw: string): string {
  return raw.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
}

function sanitizeTagValue(rawTag: string): string {
  return rawTag.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

function isValidPeriodForCycle(cycle: string, periodKey: string): boolean {
  if (cycle === "daily") return /^\d{4}-\d{2}-\d{2}$/.test(periodKey);
  if (cycle === "monthly") return /^\d{4}-\d{2}$/.test(periodKey);
  if (cycle === "yearly") return /^\d{4}$/.test(periodKey);
  return false;
}

function parseReminderPeriodMap(raw: unknown): Record<string, string> {
  if (!raw) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (VALID_CYCLES.has(k) && typeof v === "string" && v.trim()) {
        out[k] = v.trim();
      }
    }
    return out;
  }
  const str = String(raw).trim();
  if (!str) return {};
  if (str.startsWith("{")) {
    try {
      const parsed = JSON.parse(str);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parseReminderPeriodMap(parsed);
      }
    } catch {
      // Fall through to legacy plain-string formats
    }
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return { daily: str };
  if (/^\d{4}-\d{2}$/.test(str)) return { monthly: str };
  if (/^\d{4}$/.test(str)) return { yearly: str };
  return {};
}

function formatServerCurrency(val: number, currencySymbol: string): string {
  const num = Number.isFinite(val) ? val : 0;
  const formatted = num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  if (!currencySymbol) return formatted;
  const isPrefix = ["$", "€", "£", "¥"].includes(currencySymbol);
  return isPrefix ? `${currencySymbol}${formatted}` : `${formatted} ${currencySymbol}`;
}

function renderServerReminderTemplate(params: {
  username: string;
  periodKey: string;
  recurrenceCycle: "daily" | "monthly" | "yearly";
  items: StructuredExpenseItem[];
  currencySymbol: string;
}): { subject: string; textBody: string; htmlBody: string } {
  const { username, periodKey, recurrenceCycle, items, currencySymbol } = params;
  const safeUserText = stripControlChars(username || "Member").slice(0, 40) || "Member";
  const safeUserHtml = escapeHtmlEntities(safeUserText);
  const safePeriodHtml = escapeHtmlEntities(periodKey);
  const cycleTitle =
    recurrenceCycle === "daily"
      ? "Daily"
      : recurrenceCycle === "yearly"
        ? "Yearly"
        : "Monthly";

  const totalDue = items.reduce((sum, item) => sum + item.cost, 0);
  const formattedTotal = formatServerCurrency(totalDue, currencySymbol);

  const subject = `MANAGED ${cycleTitle} Reminder: ${items.length} ${cycleTitle} Recurring Expense${items.length === 1 ? "" : "s"} for ${periodKey}`;

  const textLines = items.map(
    (item, idx) =>
      `${idx + 1}. ${item.name} — ${formatServerCurrency(item.cost, currencySymbol)} (${item.category} • ${cycleTitle})`
  );

  const textBody = [
    `Hi @${safeUserText},`,
    "",
    `Here is your automatic ${cycleTitle.toLowerCase()} recurring expense reminder for ${periodKey} (${items.length} item${items.length === 1 ? "" : "s"} totaling ${formattedTotal}):`,
    "",
    ...textLines,
    "",
    "Open your MANAGED Cash Flow dashboard to review, confirm, or skip any item for this period."
  ].join("\n");

  const rowsHtml = items
    .map((item) => {
      const name = escapeHtmlEntities(item.name);
      const cat = escapeHtmlEntities(item.category);
      const freq = escapeHtmlEntities(item.recurrenceType.toUpperCase());
      const cost = escapeHtmlEntities(formatServerCurrency(item.cost, currencySymbol));
      return `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-weight:700;color:#111827;">${name}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#4b5563;">${cat}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#047857;font-size:11px;font-weight:700;">${freq}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;color:#111827;">${cost}</td>
        </tr>`;
    })
    .join("");

  const htmlBody = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;">
      <div style="margin-bottom:16px;">
        <span style="display:inline-block;padding:4px 10px;border-radius:9999px;background:#ecfdf5;color:#047857;font-size:11px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;">
          MANAGED • ${escapeHtmlEntities(cycleTitle)} Recurring Reminder
        </span>
      </div>
      <h2 style="margin:0 0 8px;font-size:20px;color:#111827;">Hi @${safeUserHtml},</h2>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#4b5563;">
        You have <strong>${items.length}</strong> ${escapeHtmlEntities(cycleTitle.toLowerCase())} recurring expense${items.length === 1 ? "" : "s"} totaling <strong>${escapeHtmlEntities(formattedTotal)}</strong> scheduled for <strong>${safePeriodHtml}</strong>:
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
        Open your MANAGED Cash Flow tab to review or skip any recurring item for this ${escapeHtmlEntities(cycleTitle.toLowerCase())} period.
      </p>
    </div>
  `;

  return { subject, textBody, htmlBody };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    if (!authHeader || !supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header or Supabase environment configuration." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
      method: "GET",
      headers: {
        Authorization: authHeader,
        apikey: supabaseAnonKey
      }
    });

    if (!userResp.ok) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: invalid or expired user session." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const authUser = await userResp.json().catch(() => null);
    const userId = String(authUser?.id || "").trim();
    const authenticatedEmail = String(authUser?.email || "").trim().toLowerCase();

    if (!userId || !authenticatedEmail) {
      return new Response(
        JSON.stringify({ error: "Authenticated user does not have a verified email address." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let payload: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return new Response(
          JSON.stringify({ error: "Request body must be a valid JSON object." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      payload = parsed as Record<string, unknown>;
    } catch {
      return new Response(
        JSON.stringify({ error: "Malformed JSON in request body." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const requestedTo = String(payload.to || "").trim().toLowerCase();
    if (requestedTo && requestedTo !== authenticatedEmail) {
      return new Response(
        JSON.stringify({ error: "Forbidden: recipient email must match the authenticated user." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const rawCycle = String(payload.recurrenceCycle || "monthly").trim().toLowerCase();
    if (!VALID_CYCLES.has(rawCycle)) {
      return new Response(
        JSON.stringify({ error: "Invalid recurrenceCycle (expected daily, monthly, or yearly)." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const recurrenceCycle = rawCycle as "daily" | "monthly" | "yearly";

    const periodKey = String(payload.periodKey || "").trim();
    if (!isValidPeriodForCycle(recurrenceCycle, periodKey)) {
      return new Response(
        JSON.stringify({ error: "Invalid periodKey format for the specified recurrence cycle." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const rawExpenses = payload.pendingExpenses;
    if (!Array.isArray(rawExpenses) || rawExpenses.length === 0 || rawExpenses.length > MAX_EXPENSE_ITEMS) {
      return new Response(
        JSON.stringify({ error: `pendingExpenses must contain between 1 and ${MAX_EXPENSE_ITEMS} items.` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const sanitizedItems: StructuredExpenseItem[] = [];
    for (const rawItem of rawExpenses) {
      if (!rawItem || typeof rawItem !== "object") {
        return new Response(
          JSON.stringify({ error: "Invalid expense item structure in pendingExpenses." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const itemObj = rawItem as Record<string, unknown>;
      const cleanName = stripControlChars(String(itemObj.name || "")).slice(0, 120);
      const numericCost = Number(itemObj.cost);
      const cleanCategory = stripControlChars(String(itemObj.category || "Category")).slice(0, 60) || "Category";
      const itemCycleRaw = String(itemObj.recurrenceType || recurrenceCycle).trim().toLowerCase();
      const itemCycle = VALID_CYCLES.has(itemCycleRaw)
        ? (itemCycleRaw as "daily" | "monthly" | "yearly")
        : recurrenceCycle;

      if (!cleanName || !Number.isFinite(numericCost) || numericCost < 0 || numericCost > 1_000_000_000) {
        return new Response(
          JSON.stringify({ error: "Each expense item must include a valid name and non-negative cost." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      sanitizedItems.push({
        name: cleanName,
        cost: numericCost,
        category: cleanCategory,
        recurrenceType: itemCycle
      });
    }

    // 1. Load user profile preferences & reminder state
    const profileRes = await fetch(
      `${supabaseUrl}/rest/v1/profiles?user_id=eq.${encodeURIComponent(userId)}&select=username,currency,email_reminders_enabled,last_reminder_period`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`
        }
      }
    );

    if (!profileRes.ok) {
      return new Response(
        JSON.stringify({ error: "Could not verify profile reminder preferences." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const profileRows = await profileRes.json().catch(() => []);
    const profile = Array.isArray(profileRows) ? profileRows[0] : null;

    if (profile && profile.email_reminders_enabled === false) {
      return new Response(
        JSON.stringify({ error: "Automatic email reminders are disabled for this account." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const currentPeriodMap = parseReminderPeriodMap(profile?.last_reminder_period);
    if (currentPeriodMap[recurrenceCycle] === periodKey) {
      return new Response(
        JSON.stringify({
          ok: true,
          alreadySent: true,
          serializedMap: JSON.stringify(currentPeriodMap)
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Render HTML & plain-text email strictly on the server
    const displayUsername = stripControlChars(
      String(profile?.username || payload.username || authenticatedEmail.split("@")[0])
    ).slice(0, 40) || "Member";
    const currencySymbol =
      typeof profile?.currency === "string"
        ? stripControlChars(profile.currency).slice(0, 8)
        : "$";

    const rendered = renderServerReminderTemplate({
      username: displayUsername,
      periodKey,
      recurrenceCycle,
      items: sanitizedItems,
      currencySymbol
    });

    // 3. Atomically check hourly quota + claim (user_id, period_key) in one DB transaction
    const claimRpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/claim_reminder_delivery`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        p_user_id: userId,
        p_recipient_email: authUser.email,
        p_period_key: periodKey,
        p_subject: rendered.subject,
        p_html_body: rendered.htmlBody,
        p_text_body: rendered.textBody,
        p_expense_count: sanitizedItems.length
      })
    });

    if (!claimRpcRes.ok) {
      return new Response(
        JSON.stringify({ error: "Could not initialize atomic reminder delivery claim." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const claimData = (await claimRpcRes.json().catch(() => null)) as Record<string, unknown> | null;
    const claimStatus = String(claimData?.status || "");

    if (claimStatus === "already_sent") {
      const updatedMap = { ...currentPeriodMap, [recurrenceCycle]: periodKey };
      return new Response(
        JSON.stringify({
          ok: true,
          alreadySent: true,
          serializedMap: JSON.stringify(updatedMap)
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (claimStatus === "rate_limited") {
      return new Response(
        JSON.stringify({ error: "Hourly reminder email limit reached. Please try again later." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (claimStatus === "unresolved") {
      return new Response(JSON.stringify({ error: "Delivery remains unresolved and requires reconciliation; automatic replay is disabled." }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let queueRowId = "";
    let subjectToSend = rendered.subject;
    let htmlToSend = rendered.htmlBody;
    let textToSend = rendered.textBody;

    if (claimStatus === "in_progress") {
      const createdAtMs = claimData?.first_attempt_at ? Date.parse(String(claimData.first_attempt_at)) : NaN;
      const ageMs = Number.isFinite(createdAtMs) ? Date.now() - createdAtMs : Infinity;

      if (ageMs < IN_FLIGHT_RECONCILE_WAIT_MS || ageMs >= MAX_REPLAY_AGE_MS) {
        return new Response(
          JSON.stringify({ error: "A reminder for this period is already being processed." }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Preserve the existing claim and reconcile using the original stored payload & stable idempotency key
      queueRowId = String(claimData?.id || "");
      subjectToSend = String(claimData?.subject || rendered.subject);
      htmlToSend = String(claimData?.html_body || rendered.htmlBody);
      textToSend = String(claimData?.text_body || rendered.textBody);
    } else if (claimStatus === "claimed") {
      queueRowId = String(claimData?.id || "");
    }

    if (!queueRowId) {
      return new Response(
        JSON.stringify({ error: "Failed to obtain reminder queue lock ID." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Replay only within the bounded provider idempotency window.
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const fromAddress = Deno.env.get("REMINDER_FROM_EMAIL") || "MANAGED <onboarding@resend.dev>";

    if (!resendApiKey) {
      if (claimStatus === "claimed") {
        await fetch(
          `${supabaseUrl}/rest/v1/email_reminder_queue?id=eq.${encodeURIComponent(queueRowId)}&status=eq.processing`,
          {
            method: "DELETE",
            headers: {
              apikey: serviceRoleKey,
              Authorization: `Bearer ${serviceRoleKey}`
            }
          }
        );
      }
      return new Response(
        JSON.stringify({ error: "RESEND_API_KEY is not configured in Supabase Edge Function secrets." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const idempotencyKey = `reminder_${userId}_${sanitizeTagValue(periodKey)}`;
    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey
      },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        from: fromAddress,
        to: [authUser.email],
        subject: subjectToSend,
        html: htmlToSend,
        text: textToSend,
        tags: [{ name: "period", value: sanitizeTagValue(periodKey) }]
      })
    }).catch(() => null);

    if (!resendResponse || !resendResponse.ok) {
      const providerError = await resendResponse?.json().catch(() => ({}));
      const conflict = resendResponse?.status === 409 ||
        ['concurrent_idempotent_requests', 'invalid_idempotent_request'].includes(providerError?.name);
      if (providerError?.name === 'invalid_idempotent_request') {
        await fetch(`${supabaseUrl}/rest/v1/email_reminder_queue?id=eq.${encodeURIComponent(queueRowId)}`, {
          method: "PATCH",
          headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ replay_blocked: true })
        });
      }
      // An error on a replay cannot disprove an earlier ambiguous delivery.
      if (claimStatus === "claimed" && !conflict && resendResponse &&
          [400, 401, 403, 404, 422, 429].includes(resendResponse.status)) {
        await fetch(
          `${supabaseUrl}/rest/v1/email_reminder_queue?id=eq.${encodeURIComponent(queueRowId)}&status=eq.processing`,
          {
            method: "DELETE",
            headers: {
              apikey: serviceRoleKey,
              Authorization: `Bearer ${serviceRoleKey}`
            }
          }
        );
      }
      return new Response(
        JSON.stringify({ error: "Email delivery provider failed to process the reminder request." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const resultData = await resendResponse.json().catch(() => ({}));

    // 5. Mark queue row as 'sent' and merge with latest profile period map (fail closed)
    const queuePatchRes = await fetch(
      `${supabaseUrl}/rest/v1/email_reminder_queue?id=eq.${encodeURIComponent(queueRowId)}`,
      {
        method: "PATCH",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ status: "sent" })
      }
    );

    const latestProfileRes = await fetch(
      `${supabaseUrl}/rest/v1/profiles?user_id=eq.${encodeURIComponent(userId)}&select=last_reminder_period`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`
        }
      }
    );
    const latestRows = latestProfileRes.ok ? await latestProfileRes.json().catch(() => []) : [];
    const latestMap = parseReminderPeriodMap(
      Array.isArray(latestRows) ? latestRows[0]?.last_reminder_period : currentPeriodMap
    );
    const updatedMap = { ...currentPeriodMap, ...latestMap, [recurrenceCycle]: periodKey };
    const serializedMap = JSON.stringify(updatedMap);

    const profilePatchRes = await fetch(
      `${supabaseUrl}/rest/v1/profiles?user_id=eq.${encodeURIComponent(userId)}`,
      {
        method: "PATCH",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ last_reminder_period: serializedMap })
      }
    );

    if (!queuePatchRes.ok || !profilePatchRes.ok) {
      return new Response(
        JSON.stringify({
          error: "Reminder email was dispatched, but saving delivery confirmation state failed."
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        id: resultData?.id || null,
        serializedMap
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Unexpected error in send-recurring-reminder:", err);
    return new Response(
      JSON.stringify({ error: "Unexpected server error in send-recurring-reminder." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});