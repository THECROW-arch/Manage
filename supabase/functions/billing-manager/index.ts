export {};
// supabase/functions/billing-manager/index.ts
declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-signature, creem-signature, stripe-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

const ALLOWED_RETURN_ORIGINS = new Set([
  "https://sterlingmanagedapp.com",
  "https://www.sterlingmanagedapp.com",
  "https://app.sterlingmanagedapp.com",
  "http://localhost:5173",
  "http://localhost:4173",
  "http://127.0.0.1:5173"
]);

const SUPPORTED_LEMON_EVENTS = new Set([
  "subscription_created",
  "subscription_updated",
  "subscription_cancelled",
  "subscription_resumed",
  "subscription_expired",
  "subscription_paused",
  "subscription_unpaused",
  "order_refunded"
]);

const SUPPORTED_CREEM_EVENTS = new Set([
  "checkout.completed",
  "subscription.active",
  "subscription.paid",
  "subscription.canceled",
  "subscription.scheduled_cancel",
  "subscription.expired",
  "subscription.paused",
  "subscription.update",
  "refund.created"
]);

function sanitizeCheckoutReturnUrl(rawUrl: unknown): string {
  const fallback = "https://sterlingmanagedapp.com/?checkout=success";
  if (typeof rawUrl !== "string" || !rawUrl.trim()) return fallback;
  try {
    const parsed = new URL(rawUrl.trim());
    if (!ALLOWED_RETURN_ORIGINS.has(parsed.origin)) {
      return fallback;
    }
    return parsed.toString();
  } catch {
    return fallback;
  }
}

function timingSafeHexEqual(aHex: string, bHex: string): boolean {
  const a = aHex.trim().toLowerCase();
  const b = bHex.trim().toLowerCase();
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function computeHmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function parseFlexibleTimestamp(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    const ms = raw < 1e12 ? raw * 1000 : raw;
    return new Date(ms).toISOString();
  }
  const str = String(raw).trim();
  if (!str) return null;
  if (/^\d+$/.test(str)) {
    const num = Number(str);
    if (Number.isFinite(num) && num > 0) {
      const ms = num < 1e12 ? num * 1000 : num;
      return new Date(ms).toISOString();
    }
  }
  const parsed = Date.parse(str);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function pickValidTransactionId(...candidates: unknown[]): string {
  for (const cand of candidates) {
    if (!cand) continue;
    const raw =
      typeof cand === "object" && cand !== null
        ? (cand as Record<string, unknown>).id
        : cand;
    const str = String(raw || "").trim();
    if (str && !str.startsWith("ord_")) {
      return str;
    }
  }
  return "";
}

async function checkBillingEventRecorded(
  supabaseUrl: string,
  serviceRoleKey: string,
  eventId: string
): Promise<{ ok: boolean; exists: boolean }> {
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/billing_webhook_events?event_id=eq.${encodeURIComponent(eventId)}&select=event_id`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`
        }
      }
    );
    if (!res.ok) return { ok: false, exists: false };
    const rows = await res.json().catch(() => null);
    if (!Array.isArray(rows)) return { ok: false, exists: false };
    return { ok: true, exists: rows.length > 0 };
  } catch {
    return { ok: false, exists: false };
  }
}

async function recordBillingEvent(params: {
  supabaseUrl: string;
  serviceRoleKey: string;
  eventId: string;
  provider: string;
  eventType: string;
  userId: string;
}): Promise<boolean> {
  const { supabaseUrl, serviceRoleKey, eventId, provider, eventType, userId } = params;
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/billing_webhook_events`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        event_id: eventId,
        provider,
        event_type: eventType,
        user_id: userId
      })
    });
    return res.ok || res.status === 409;
  } catch {
    return false;
  }
}

/**
 * Atomically claims a billing event marker so concurrent requests cannot race.
 * Returns { ok: true, claimed: true } ONLY for the single caller that inserted the row,
 * and { ok: true, claimed: false } when another request already holds the lock (HTTP 409).
 */
async function claimBillingEventLock(params: {
  supabaseUrl: string;
  serviceRoleKey: string;
  eventId: string;
  provider: string;
  eventType: string;
  userId: string;
}): Promise<{ ok: boolean; claimed: boolean }> {
  const { supabaseUrl, serviceRoleKey, eventId, provider, eventType, userId } = params;
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/billing_webhook_events`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify({
        event_id: eventId,
        provider,
        event_type: eventType,
        user_id: userId
      })
    });
    if (res.status === 409) {
      return { ok: true, claimed: false };
    }
    if (!res.ok) {
      return { ok: false, claimed: false };
    }
    const rows = await res.json().catch(() => null);
    return { ok: true, claimed: Array.isArray(rows) && rows.length > 0 };
  } catch {
    return { ok: false, claimed: false };
  }
}

async function releaseBillingEventLock(
  supabaseUrl: string,
  serviceRoleKey: string,
  eventId: string
): Promise<void> {
  try {
    await fetch(
      `${supabaseUrl}/rest/v1/billing_webhook_events?event_id=eq.${encodeURIComponent(eventId)}`,
      {
        method: "DELETE",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`
        }
      }
    );
  } catch {
    // Ignore cleanup errors
  }
}

async function updateProfileBillingRow(params: {
  supabaseUrl: string;
  serviceRoleKey: string;
  userId: string;
  patchBody: Record<string, unknown>;
  minUpdatedAtIso?: string;
  subscriptionId?: string;
}): Promise<{ ok: boolean; updatedCount: number; status: number; error?: string }> {
  const { supabaseUrl, serviceRoleKey, userId, patchBody, minUpdatedAtIso, subscriptionId } = params;
  let query = `user_id=eq.${encodeURIComponent(userId)}`;
  if (subscriptionId) {
    query += `&subscription_id=eq.${encodeURIComponent(subscriptionId)}`;
  }
  if (minUpdatedAtIso) {
    query += `&or=(subscription_updated_at.is.null,subscription_updated_at.lte.${encodeURIComponent(minUpdatedAtIso)})`;
  }

  const patchRes = await fetch(`${supabaseUrl}/rest/v1/profiles?${query}`, {
    method: "PATCH",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify(patchBody)
  });

  if (!patchRes.ok) {
    const errText = await patchRes.text().catch(() => "Database write error");
    return {
      ok: false,
      updatedCount: 0,
      status: patchRes.status,
      error: errText || "Failed to persist profile billing update."
    };
  }

  const rows = await patchRes.json().catch(() => null);
  const updatedCount = Array.isArray(rows) ? rows.length : 0;
  return {
    ok: updatedCount > 0,
    updatedCount,
    status: patchRes.status,
    error: updatedCount === 0 ? "Target profile row was not updated." : undefined
  };
}

async function resolveCreemTransactionIdFromSubscription(
  creemBaseUrl: string,
  creemApiKey: string,
  subId: string
): Promise<string> {
  if (!creemApiKey || !subId) return "";
  try {
    const resp = await fetch(
      `${creemBaseUrl}/v1/subscriptions?subscription_id=${encodeURIComponent(subId)}`,
      {
        method: "GET",
        headers: {
          "x-api-key": creemApiKey,
          Accept: "application/json"
        }
      }
    );
    if (!resp.ok) return "";
    const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    return pickValidTransactionId(
      data.last_transaction_id,
      data.last_transaction,
      data.transaction_id,
      data.transaction
    );
  } catch {
    return "";
  }
}

/**
 * Server-side verification of whether the user has consumed Pro-only database capacity
 * (>3 categories, >1 sandbox sheet, or >1 wealth objective).
 * Fails closed (`ok: false`) if either REST query errors or returns non-array JSON.
 */
async function checkServerSideProCapacityUsed(params: {
  supabaseUrl: string;
  serviceRoleKey: string;
  userId: string;
  wealthObjectives: unknown;
}): Promise<{ ok: boolean; used: boolean }> {
  const { supabaseUrl, serviceRoleKey, userId, wealthObjectives } = params;
  if (Array.isArray(wealthObjectives) && wealthObjectives.length > 1) {
    return { ok: true, used: true };
  }

  try {
    const [catsRes, sheetsRes] = await Promise.all([
      fetch(
        `${supabaseUrl}/rest/v1/categories?user_id=eq.${encodeURIComponent(userId)}&select=id`,
        {
          headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`
          }
        }
      ),
      fetch(
        `${supabaseUrl}/rest/v1/sandbox_sheets?user_id=eq.${encodeURIComponent(userId)}&select=id`,
        {
          headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`
          }
        }
      )
    ]);

    if (!catsRes.ok || !sheetsRes.ok) {
      return { ok: false, used: false };
    }

    const [cats, sheets] = await Promise.all([
      catsRes.json().catch(() => null),
      sheetsRes.json().catch(() => null)
    ]);

    if (!Array.isArray(cats) || !Array.isArray(sheets)) {
      return { ok: false, used: false };
    }

    const used = cats.length > 3 || sheets.length > 1;
    return { ok: true, used };
  } catch {
    return { ok: false, used: false };
  }
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

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ error: "Missing Supabase server configuration." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const rawBody = await req.text();
  const creemApiKey = Deno.env.get("CREEM_API_KEY") || "";
  const creemProductId = Deno.env.get("CREEM_PRODUCT_ID") || "";
  const creemBaseUrl =
    Deno.env.get("CREEM_API_BASE_URL") ||
    (creemApiKey.startsWith("creem_test_") ? "https://test-api.creem.io" : "https://api.creem.io");

  // 1. WEBHOOK PATH: Verify HMAC-SHA256 signature (Creem or Lemon Squeezy)
  const creemSig = req.headers.get("creem-signature");
  const lemonSig = req.headers.get("x-signature");
  const incomingSig = creemSig || lemonSig;
  const webhookSecret = Deno.env.get("PAYMENT_WEBHOOK_SECRET") || "";

  if (incomingSig) {
    if (!webhookSecret) {
      return new Response(JSON.stringify({ error: "Webhook secret not configured." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const expectedHex = await computeHmacSha256Hex(webhookSecret, rawBody);
    if (!timingSafeHexEqual(incomingSig, expectedHex)) {
      return new Response(JSON.stringify({ error: "Invalid webhook signature." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    let eventPayload: Record<string, unknown>;
    try {
      const parsed = JSON.parse(rawBody);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return new Response(JSON.stringify({ error: "Invalid webhook JSON object." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      eventPayload = parsed as Record<string, unknown>;
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON webhook payload." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const isCreem = Boolean(creemSig) || Boolean(eventPayload.eventType);
    const providerName = isCreem ? "creem" : "lemonsqueezy";

    let providerEnvelopeId = "";
    let eventName = "";
    let customUserId = "";
    let subId = "";
    let orderId = "";
    let parsedEventTimeIso: string | null = null;
    let renewsAt: string | null = null;
    let isCancelled = false;
    let isExpired = false;
    let isRefunded = false;
    let isInitialCreation = false;

    if (isCreem) {
      providerEnvelopeId = String(eventPayload.id || "").trim();
      eventName = String(eventPayload.eventType || eventPayload.event_type || "unknown");
      if (!SUPPORTED_CREEM_EVENTS.has(eventName)) {
        return new Response(JSON.stringify({ ok: true, ignoredEvent: eventName }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const obj = (eventPayload.object as Record<string, unknown>) || {};
      const metadata = (obj.metadata as Record<string, unknown>) || {};
      const subField = obj.subscription;
      const subObj =
        typeof subField === "object" && subField !== null
          ? (subField as Record<string, unknown>)
          : {};
      const orderObj =
        typeof obj.order === "object" && obj.order !== null
          ? (obj.order as Record<string, unknown>)
          : {};

      customUserId = String(
        metadata.user_id ||
          (subObj.metadata as Record<string, unknown>)?.user_id ||
          obj.request_id ||
          ""
      ).trim();

      const objType = String(obj.object || obj.Object || "").toLowerCase();
      if (objType === "subscription") {
        subId = String(obj.id || "").trim();
      } else if (typeof subField === "string") {
        subId = subField.trim();
      } else {
        subId = String(subObj.id || obj.subscription_id || "").trim();
      }

      orderId = pickValidTransactionId(
        obj.last_transaction_id,
        obj.last_transaction,
        subObj.last_transaction_id,
        subObj.last_transaction,
        obj.transaction_id,
        obj.transaction,
        orderObj.transaction,
        objType === "refund" ? obj.transaction : ""
      );

      if (!orderId && subId && creemApiKey) {
        orderId = await resolveCreemTransactionIdFromSubscription(creemBaseUrl, creemApiKey, subId);
      }

      parsedEventTimeIso =
        parseFlexibleTimestamp(obj.updated_at) ||
        parseFlexibleTimestamp(obj.created_at) ||
        parseFlexibleTimestamp(eventPayload.created_at);

      const periodEndRaw =
        obj.current_period_end_date ||
        subObj.current_period_end_date ||
        obj.next_transaction_date ||
        null;
      renewsAt = periodEndRaw ? String(periodEndRaw) : null;

      const statusStr = String(obj.status || "").toLowerCase();
      isRefunded = eventName === "refund.created" || statusStr === "refunded";
      isExpired = eventName === "subscription.expired" || statusStr === "expired" || isRefunded;
      isCancelled =
        eventName === "subscription.canceled" ||
        eventName === "subscription.scheduled_cancel" ||
        statusStr === "canceled" ||
        statusStr === "scheduled_cancel";
      isInitialCreation =
        eventName === "checkout.completed" || eventName === "subscription.active";
    } else {
      const meta = (eventPayload.meta as Record<string, unknown>) || {};
      const customData = (meta.custom_data as Record<string, unknown>) || {};
      const dataObj = (eventPayload.data as Record<string, unknown>) || {};
      const attrs = (dataObj.attributes as Record<string, unknown>) || {};

      providerEnvelopeId = String(meta.webhook_id || "").trim();
      eventName = String(meta.event_name || "unknown");
      const resourceType = String(dataObj.type || "");

      if (
        !SUPPORTED_LEMON_EVENTS.has(eventName) ||
        (eventName !== "order_refunded" && resourceType && resourceType !== "subscriptions")
      ) {
        return new Response(JSON.stringify({ ok: true, ignoredEvent: eventName }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const isOrderResource = resourceType === "orders" || eventName === "order_refunded";
      customUserId = String(customData.user_id || "").trim();
      subId = isOrderResource
        ? String(attrs.subscription_id || "").trim()
        : String(dataObj.id || "").trim();
      orderId = isOrderResource
        ? String(dataObj.id || attrs.order_id || "").trim()
        : String(attrs.order_id || "").trim();

      parsedEventTimeIso =
        parseFlexibleTimestamp(attrs.updated_at) ||
        parseFlexibleTimestamp(attrs.created_at);

      const renewsRaw = attrs.renews_at || attrs.ends_at || null;
      renewsAt = renewsRaw ? String(renewsRaw) : null;
      isRefunded = eventName === "order_refunded" || Boolean(attrs.refunded);
      isCancelled = Boolean(attrs.cancelled) || eventName === "subscription_cancelled";
      isExpired = eventName === "subscription_expired" || attrs.status === "expired" || isRefunded;
      isInitialCreation = eventName === "subscription_created";
    }

    let existingProfile: Record<string, unknown> | null = null;
    const lookupFilters: string[] = [];
    if (customUserId) {
      lookupFilters.push(`user_id=eq.${encodeURIComponent(customUserId)}`);
    }
    if (subId) {
      lookupFilters.push(
        `subscription_provider=eq.${encodeURIComponent(providerName)}&subscription_id=eq.${encodeURIComponent(subId)}`
      );
    }
    if (orderId) {
      lookupFilters.push(
        `subscription_provider=eq.${encodeURIComponent(providerName)}&subscription_order_id=eq.${encodeURIComponent(orderId)}`
      );
    }

    for (const filter of lookupFilters) {
      const profLookupRes = await fetch(
        `${supabaseUrl}/rest/v1/profiles?${filter}&select=user_id,subscription_status,subscription_id,subscription_order_id,subscription_started_at,pro_features_used,subscription_updated_at`,
        {
          headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`
          }
        }
      );
      if (!profLookupRes.ok) {
        return new Response(
          JSON.stringify({ error: "Failed to query profile association for webhook." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const rows = await profLookupRes.json().catch(() => []);
      if (Array.isArray(rows) && rows[0]) {
        existingProfile = rows[0] as Record<string, unknown>;
        break;
      }
    }

    if (!customUserId && existingProfile?.user_id) {
      customUserId = String(existingProfile.user_id);
    }

    const currentProfSubId = String(existingProfile?.subscription_id || "").trim();
    let currentProfOrderId = String(existingProfile?.subscription_order_id || "").trim();

    if (
      providerName === "creem" &&
      currentProfOrderId.startsWith("ord_") &&
      currentProfSubId &&
      creemApiKey
    ) {
      const normalizedTx = await resolveCreemTransactionIdFromSubscription(
        creemBaseUrl,
        creemApiKey,
        currentProfSubId
      );
      currentProfOrderId = normalizedTx || "";
    } else if (providerName === "creem" && currentProfOrderId.startsWith("ord_")) {
      currentProfOrderId = "";
    }

    if (existingProfile) {
      if (isRefunded) {
        if (!subId && !orderId) {
          return new Response(
            JSON.stringify({ error: "Missing subscription or order identifier in refund webhook." }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        if (subId && currentProfSubId && subId !== currentProfSubId) {
          return new Response(
            JSON.stringify({ ok: true, ignoredHistoricalRefund: true }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        if (orderId && currentProfOrderId && orderId !== currentProfOrderId) {
          return new Response(
            JSON.stringify({ ok: true, ignoredHistoricalRefund: true }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        if (!subId && currentProfSubId) {
          if (orderId && currentProfOrderId && orderId === currentProfOrderId) {
            subId = currentProfSubId;
          } else {
            return new Response(
              JSON.stringify({ ok: true, ignoredUnmatchedOrderRefund: true }),
              { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        }
        if (!orderId && currentProfOrderId && subId && subId === currentProfSubId) {
          orderId = currentProfOrderId;
        }
      } else {
        if (
          !isInitialCreation &&
          (isExpired || isCancelled) &&
          subId &&
          currentProfSubId &&
          subId !== currentProfSubId
        ) {
          return new Response(
            JSON.stringify({ ok: true, ignoredHistoricalSubscriptionEvent: true }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        if (!subId && currentProfSubId) {
          subId = currentProfSubId;
        }
        if (!orderId && currentProfOrderId) {
          orderId = currentProfOrderId;
        }
      }
    }

    if (!customUserId || (!subId && !orderId)) {
      return new Response(
        JSON.stringify({ error: "Missing user_id or subscription/order identifier in webhook." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const eventUpdatedAt = parsedEventTimeIso || new Date().toISOString();
    const payloadHash =
      !providerEnvelopeId && !parsedEventTimeIso
        ? (await computeHmacSha256Hex("webhook_dedup", rawBody)).slice(0, 24)
        : "";
    const eventId = providerEnvelopeId
      ? `${providerName}_${providerEnvelopeId}`
      : `${providerName}_${eventName}_${subId || orderId}_${parsedEventTimeIso || payloadHash}`;

    const dedupCheck = await checkBillingEventRecorded(supabaseUrl, serviceRoleKey, eventId);
    if (!dedupCheck.ok) {
      return new Response(
        JSON.stringify({ error: "Failed to verify webhook deduplication state." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (dedupCheck.exists) {
      return new Response(JSON.stringify({ ok: true, duplicate: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const refundKeyId = subId || orderId || customUserId;
    const refundTxMarkerId = `refund_tx_${providerName}_${refundKeyId}`;
    const refundIntentMarkerId = `refund_intent_${providerName}_${refundKeyId}`;
    const refundPendingMarkerId = `refund_pending_${providerName}_${refundKeyId}`;
    const refundCancelMarkerId = `refund_cancel_done_${providerName}_${refundKeyId}`;

    const isSameExistingSubscription =
      Boolean(subId) && existingProfile?.subscription_id === subId;

    const existingSubStatus = String(existingProfile?.subscription_status || "");
    let refundTxMarkerExists = false;
    if (
      !isInitialCreation &&
      isSameExistingSubscription &&
      existingSubStatus !== "refunded" &&
      existingSubStatus !== "refund_cancel_pending" &&
      existingSubStatus !== "refund_finalize_pending"
    ) {
      const txMarkerCheck = await checkBillingEventRecorded(
        supabaseUrl,
        serviceRoleKey,
        refundTxMarkerId
      );
      if (!txMarkerCheck.ok) {
        return new Response(
          JSON.stringify({ error: "Failed to verify refund transaction marker state." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      refundTxMarkerExists = txMarkerCheck.exists;
    }

    const wasAlreadyRefundedForSameSub =
      !isInitialCreation &&
      isSameExistingSubscription &&
      (existingSubStatus === "refunded" ||
        existingSubStatus === "refund_cancel_pending" ||
        existingSubStatus === "refund_finalize_pending" ||
        refundTxMarkerExists);

    const effectiveIsRefunded = isRefunded || wasAlreadyRefundedForSameSub;
    const effectiveIsExpired = isExpired || effectiveIsRefunded;

    const updateBody: Record<string, unknown> = {
      subscription_tier: effectiveIsExpired ? "free" : "pro",
      subscription_status: effectiveIsRefunded
        ? "refunded"
        : effectiveIsExpired
          ? "expired"
          : isCancelled
            ? "canceled_pending_expiry"
            : "active",
      subscription_provider: providerName,
      subscription_period_end: effectiveIsRefunded ? null : renewsAt,
      cancel_at_period_end: isCancelled && !effectiveIsExpired,
      subscription_updated_at: eventUpdatedAt
    };

    if (subId) {
      updateBody.subscription_id = subId;
    }
    if (orderId) {
      updateBody.subscription_order_id = orderId;
    }

    if (
      !effectiveIsExpired &&
      (!isSameExistingSubscription || !existingProfile?.subscription_started_at)
    ) {
      updateBody.subscription_started_at = eventUpdatedAt;
      if (!isSameExistingSubscription) {
        updateBody.pro_features_used = false;
      }
    }
    if (effectiveIsRefunded) {
      updateBody.has_claimed_refund = true;
    }

    const writeResult = await updateProfileBillingRow({
      supabaseUrl,
      serviceRoleKey,
      userId: customUserId,
      patchBody: updateBody,
      minUpdatedAtIso: eventUpdatedAt
    });

    if (!writeResult.ok) {
      if (writeResult.status >= 400) {
        return new Response(JSON.stringify({ error: writeResult.error || "Failed to update profile." }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      if (!existingProfile) {
        return new Response(JSON.stringify({ error: "Target user profile not found for webhook." }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      if (!isRefunded) {
        return new Response(JSON.stringify({ ok: true, ignoredStaleEvent: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      await updateProfileBillingRow({
        supabaseUrl,
        serviceRoleKey,
        userId: customUserId,
        patchBody: { has_claimed_refund: true }
      });

      if (subId) {
        const fallbackRevoke = await updateProfileBillingRow({
          supabaseUrl,
          serviceRoleKey,
          userId: customUserId,
          subscriptionId: subId,
          patchBody: {
            subscription_tier: "free",
            subscription_status: "refunded",
            subscription_period_end: null,
            cancel_at_period_end: false,
            has_claimed_refund: true
          }
        });
        if (fallbackRevoke.status >= 400) {
          return new Response(
            JSON.stringify({ error: "Failed to persist refund revocation for subscription." }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
    }

    if (effectiveIsRefunded && isCancelled) {
      const cancelMarkerSaved = await recordBillingEvent({
        supabaseUrl,
        serviceRoleKey,
        eventId: refundCancelMarkerId,
        provider: providerName,
        eventType: "refund_cancel_succeeded",
        userId: customUserId
      });
      if (!cancelMarkerSaved) {
        return new Response(
          JSON.stringify({ error: "Failed to record refund cancellation marker." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Complete refund reconciliation BEFORE recording webhook event completion
    if (isRefunded) {
      const txRecorded = await recordBillingEvent({
        supabaseUrl,
        serviceRoleKey,
        eventId: refundTxMarkerId,
        provider: providerName,
        eventType: "refund_tx_succeeded",
        userId: customUserId
      });

      if (!txRecorded) {
        return new Response(
          JSON.stringify({ error: "Failed to record durable refund transaction marker." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const [intentRes, pendingRes, cancelDoneRes] = await Promise.all([
        checkBillingEventRecorded(supabaseUrl, serviceRoleKey, refundIntentMarkerId),
        checkBillingEventRecorded(supabaseUrl, serviceRoleKey, refundPendingMarkerId),
        checkBillingEventRecorded(supabaseUrl, serviceRoleKey, refundCancelMarkerId)
      ]);

      if (!intentRes.ok || !pendingRes.ok || !cancelDoneRes.ok) {
        return new Response(
          JSON.stringify({ error: "Failed to query refund reconciliation markers." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if ((intentRes.exists || pendingRes.exists) && subId && !cancelDoneRes.exists) {
        let cancelOk = false;
        const lemonApiKey = Deno.env.get("LEMONSQUEEZY_API_KEY") || "";

        if (providerName === "creem" && creemApiKey) {
          const cancelResp = await fetch(
            `${creemBaseUrl}/v1/subscriptions/${encodeURIComponent(subId)}/cancel`,
            {
              method: "POST",
              headers: {
                "x-api-key": creemApiKey,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({ mode: "immediate" })
            }
          ).catch(() => null);
          cancelOk = Boolean(cancelResp && (cancelResp.ok || cancelResp.status === 404));
        } else if (providerName === "lemonsqueezy" && lemonApiKey) {
          const cancelResp = await fetch(
            `https://api.lemonsqueezy.com/v1/subscriptions/${encodeURIComponent(subId)}`,
            {
              method: "DELETE",
              headers: {
                Accept: "application/vnd.api+json",
                "Content-Type": "application/vnd.api+json",
                Authorization: `Bearer ${lemonApiKey}`
              }
            }
          ).catch(() => null);
          cancelOk = Boolean(cancelResp && (cancelResp.ok || cancelResp.status === 404));
        }

        if (cancelOk) {
          const cancelSaved = await recordBillingEvent({
            supabaseUrl,
            serviceRoleKey,
            eventId: refundCancelMarkerId,
            provider: providerName,
            eventType: "refund_cancel_succeeded",
            userId: customUserId
          });
          if (!cancelSaved) {
            return new Response(
              JSON.stringify({ error: "Failed to persist refund_cancel_succeeded marker." }),
              { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        } else {
          const pendingCancelWrite = await updateProfileBillingRow({
            supabaseUrl,
            serviceRoleKey,
            userId: customUserId,
            subscriptionId: subId,
            patchBody: {
              subscription_tier: "free",
              subscription_status: "refund_cancel_pending",
              has_claimed_refund: true
            }
          });
          if (pendingCancelWrite.status >= 400) {
            return new Response(
              JSON.stringify({ error: "Failed to persist refund_cancel_pending state." }),
              { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        }
      }
    }

    const eventRecorded = await recordBillingEvent({
      supabaseUrl,
      serviceRoleKey,
      eventId,
      provider: providerName,
      eventType: eventName,
      userId: customUserId
    });

    if (!eventRecorded) {
      return new Response(
        JSON.stringify({ error: "Failed to record completed webhook event." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // 2. AUTHENTICATED USER ACTIONS (create_checkout / cancel_subscription / request_refund)
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !supabaseAnonKey) {
    return new Response(JSON.stringify({ error: "Missing authorization header." }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  const userResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
    method: "GET",
    headers: {
      Authorization: authHeader,
      apikey: supabaseAnonKey
    }
  });

  if (!userResp.ok) {
    return new Response(JSON.stringify({ error: "Unauthorized session." }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  const authUser = await userResp.json().catch(() => null);
  const userId = String(authUser?.id || "");
  const userEmail = String(authUser?.email || "");

  if (!userId) {
    return new Response(JSON.stringify({ error: "Invalid user identity." }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  let body: Record<string, unknown> = {};
  try {
    const parsed = rawBody ? JSON.parse(rawBody) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    return new Response(JSON.stringify({ error: "Malformed JSON body." }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  const action = String(body.action || "");
  const allowSandboxSim = Deno.env.get("ALLOW_SANDBOX_SIMULATION") === "true";

  // ACTION A: CREATE CHECKOUT SESSION
  if (action === "create_checkout") {
    const returnUrl = sanitizeCheckoutReturnUrl(body.returnUrl);

    if (creemApiKey && creemProductId) {
      const creemResp = await fetch(`${creemBaseUrl}/v1/checkouts`, {
        method: "POST",
        headers: {
          "x-api-key": creemApiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          product_id: creemProductId,
          request_id: userId,
          success_url: returnUrl,
          customer: userEmail ? { email: userEmail } : undefined,
          metadata: { user_id: userId }
        })
      });

      const creemData = await creemResp.json().catch(() => ({}));
      if (!creemResp.ok || !creemData?.checkout_url) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: "Could not initialize Creem checkout session. Please verify CREEM_API_KEY and CREEM_PRODUCT_ID."
          }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(JSON.stringify({ ok: true, checkoutUrl: String(creemData.checkout_url) }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const checkoutBaseUrl = Deno.env.get("PAYMENT_CHECKOUT_URL") || "";
    if (checkoutBaseUrl) {
      const separator = checkoutBaseUrl.includes("?") ? "&" : "?";
      const checkoutUrl =
        `${checkoutBaseUrl}${separator}checkout[email]=${encodeURIComponent(userEmail)}` +
        `&checkout[custom][user_id]=${encodeURIComponent(userId)}` +
        `&checkout[redirect_url]=${encodeURIComponent(returnUrl)}` +
        `&request_id=${encodeURIComponent(userId)}`;

      return new Response(JSON.stringify({ ok: true, checkoutUrl }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (allowSandboxSim) {
      // Restrict sandbox simulation strictly to owner and dev roles
      const roleRes = await fetch(
        `${supabaseUrl}/rest/v1/profiles?user_id=eq.${encodeURIComponent(userId)}&select=role`,
        {
          headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`
          }
        }
      );
      if (!roleRes.ok) {
        return new Response(
          JSON.stringify({ ok: false, error: "Could not verify account role for sandbox simulation." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const roleRows = await roleRes.json().catch(() => []);
      const callerRole = String((Array.isArray(roleRows) && roleRows[0]?.role) || "user");
      if (callerRole !== "owner" && callerRole !== "dev") {
        return new Response(
          JSON.stringify({
            ok: false,
            error: "Live payment checkout is currently in maintenance. Sandbox simulation is restricted to staff accounts."
          }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const nowIso = new Date().toISOString();
      const simNonce = Date.now().toString(36);

      const simWrite = await updateProfileBillingRow({
        supabaseUrl,
        serviceRoleKey,
        userId,
        patchBody: {
          subscription_tier: "pro",
          subscription_status: "active",
          subscription_provider: "sandbox",
          subscription_id: `sub_sandbox_${userId.slice(0, 8)}_${simNonce}`,
          subscription_order_id: `tx_sandbox_${userId.slice(0, 8)}_${simNonce}`,
          subscription_started_at: nowIso,
          pro_features_used: false,
          subscription_period_end: periodEnd,
          cancel_at_period_end: false,
          subscription_updated_at: nowIso
        }
      });

      if (!simWrite.ok) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: "Could not persist simulated Pro activation to your profile. Please try again."
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          ok: true,
          simulated: true,
          subscriptionTier: "pro",
          subscriptionStatus: "active",
          subscriptionStartedAt: nowIso,
          proFeaturesUsed: false,
          subscriptionPeriodEnd: periodEnd,
          cancelAtPeriodEnd: false
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        ok: false,
        error:
          "Payment checkout is not configured yet. Set CREEM_API_KEY + CREEM_PRODUCT_ID, PAYMENT_CHECKOUT_URL, or ALLOW_SANDBOX_SIMULATION=true in Supabase secrets."
      }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // ACTION B: 1-CLICK CANCEL SUBSCRIPTION
  if (action === "cancel_subscription") {
    const profRes = await fetch(
      `${supabaseUrl}/rest/v1/profiles?user_id=eq.${encodeURIComponent(userId)}&select=subscription_tier,subscription_status,subscription_provider,subscription_id,subscription_period_end,cancel_at_period_end`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`
        }
      }
    );

    if (!profRes.ok) {
      return new Response(
        JSON.stringify({ ok: false, error: "Could not load your current subscription details." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const rows = await profRes.json().catch(() => []);
    const profile = Array.isArray(rows) ? rows[0] : null;

    if (!profile || profile.subscription_tier !== "pro") {
      return new Response(
        JSON.stringify({ ok: false, error: "No active MANAGED Pro subscription found to cancel." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (profile.cancel_at_period_end) {
      return new Response(
        JSON.stringify({
          ok: true,
          alreadyCanceled: true,
          subscriptionStatus: "canceled_pending_expiry",
          subscriptionPeriodEnd: profile.subscription_period_end,
          cancelAtPeriodEnd: true
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const provider = String(profile.subscription_provider || "");
    const subId = String(profile.subscription_id || "");
    const lemonApiKey = Deno.env.get("LEMONSQUEEZY_API_KEY") || "";

    if (provider !== "sandbox") {
      if (provider === "creem") {
        if (!subId || !creemApiKey) {
          return new Response(
            JSON.stringify({
              ok: false,
              error: "Cannot cancel subscription: Creem API credentials or subscription ID are missing."
            }),
            { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const cancelResp = await fetch(
          `${creemBaseUrl}/v1/subscriptions/${encodeURIComponent(subId)}/cancel`,
          {
            method: "POST",
            headers: {
              "x-api-key": creemApiKey,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ mode: "scheduled" })
          }
        );

        if (!cancelResp.ok) {
          return new Response(
            JSON.stringify({ ok: false, error: "Payment provider could not process the cancellation right now." }),
            { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      } else if (provider === "lemonsqueezy") {
        if (!subId || !lemonApiKey) {
          return new Response(
            JSON.stringify({
              ok: false,
              error: "Cannot cancel subscription: billing provider credentials or subscription ID are not configured."
            }),
            { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const cancelResp = await fetch(
          `https://api.lemonsqueezy.com/v1/subscriptions/${encodeURIComponent(subId)}`,
          {
            method: "DELETE",
            headers: {
              Accept: "application/vnd.api+json",
              "Content-Type": "application/vnd.api+json",
              Authorization: `Bearer ${lemonApiKey}`
            }
          }
        );

        if (!cancelResp.ok) {
          return new Response(
            JSON.stringify({ ok: false, error: "Payment provider could not process the cancellation right now." }),
            { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      } else {
        return new Response(
          JSON.stringify({
            ok: false,
            error: "Cannot cancel subscription: unrecognized billing provider."
          }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const fallbackPeriodEnd =
      profile.subscription_period_end || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const nowIso = new Date().toISOString();

    const cancelWrite = await updateProfileBillingRow({
      supabaseUrl,
      serviceRoleKey,
      userId,
      subscriptionId: subId || undefined,
      patchBody: {
        subscription_status: "canceled_pending_expiry",
        cancel_at_period_end: true,
        subscription_period_end: fallbackPeriodEnd,
        subscription_updated_at: nowIso
      }
    });

    if (!cancelWrite.ok) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Failed to save cancellation status to your profile. Please refresh and try again."
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        subscriptionStatus: "canceled_pending_expiry",
        subscriptionPeriodEnd: fallbackPeriodEnd,
        cancelAtPeriodEnd: true
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // ACTION C: 2-HOUR UNUSED SUBSCRIPTION REFUND
  if (action === "request_refund") {
    const profRes = await fetch(
      `${supabaseUrl}/rest/v1/profiles?user_id=eq.${encodeURIComponent(userId)}&select=subscription_tier,subscription_status,subscription_provider,subscription_id,subscription_order_id,subscription_started_at,pro_features_used,has_claimed_refund,wealth_objectives`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`
        }
      }
    );

    if (!profRes.ok) {
      return new Response(
        JSON.stringify({ ok: false, error: "Could not load your subscription details for refund verification." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const rows = await profRes.json().catch(() => []);
    const profile = Array.isArray(rows) ? rows[0] : null;

    if (!profile) {
      return new Response(
        JSON.stringify({ ok: false, error: "User profile not found." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const provider = String(profile.subscription_provider || "");
    const subId = String(profile.subscription_id || "");
    let orderId = String(profile.subscription_order_id || "");
    const currentStatus = String(profile.subscription_status || "");

    if (provider === "creem" && (!orderId || orderId.startsWith("ord_")) && subId && creemApiKey) {
      const resolvedTx = await resolveCreemTransactionIdFromSubscription(
        creemBaseUrl,
        creemApiKey,
        subId
      );
      if (resolvedTx) {
        orderId = resolvedTx;
        await updateProfileBillingRow({
          supabaseUrl,
          serviceRoleKey,
          userId,
          subscriptionId: subId,
          patchBody: { subscription_order_id: orderId }
        });
      }
    }

    const refundKeyId = subId || orderId || userId;
    const refundIntentMarkerId = `refund_intent_${provider}_${refundKeyId}`;
    const refundTxMarkerId = `refund_tx_${provider}_${refundKeyId}`;
    const refundCancelMarkerId = `refund_cancel_done_${provider}_${refundKeyId}`;
    const refundPendingMarkerId = `refund_pending_${provider}_${refundKeyId}`;

    const [txMarkerRes, cancelMarkerRes, pendingMarkerRes] = await Promise.all([
      checkBillingEventRecorded(supabaseUrl, serviceRoleKey, refundTxMarkerId),
      checkBillingEventRecorded(supabaseUrl, serviceRoleKey, refundCancelMarkerId),
      checkBillingEventRecorded(supabaseUrl, serviceRoleKey, refundPendingMarkerId)
    ]);

    if (!txMarkerRes.ok || !cancelMarkerRes.ok || !pendingMarkerRes.ok) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Could not verify refund state right now. Please try again in a moment."
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const txAlreadyRefunded = txMarkerRes.exists;
    const cancelAlreadyCompleted = cancelMarkerRes.exists;
    const isRefundPending = pendingMarkerRes.exists;

    const isResumingPartialRefund =
      txAlreadyRefunded ||
      currentStatus === "refund_cancel_pending" ||
      currentStatus === "refund_finalize_pending";

    if (!txAlreadyRefunded && (currentStatus === "refund_pending" || isRefundPending)) {
      return new Response(
        JSON.stringify({
          ok: false,
          pending: true,
          subscriptionStatus: "refund_pending",
          error:
            "Your refund is currently pending confirmation with the payment provider. Your workspace will update automatically as soon as the provider completes the refund."
        }),
        { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!isResumingPartialRefund) {
      if (profile.subscription_tier !== "pro") {
        return new Response(
          JSON.stringify({ ok: false, error: "No active MANAGED Pro subscription found to refund." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (profile.has_claimed_refund) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: "Refund ineligible: this account has already claimed a one-time subscription refund previously."
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const capacityCheck = await checkServerSideProCapacityUsed({
        supabaseUrl,
        serviceRoleKey,
        userId,
        wealthObjectives: profile.wealth_objectives
      });

      if (!capacityCheck.ok) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: "Could not verify workspace Pro feature usage right now. Please try again."
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (profile.pro_features_used || capacityCheck.used) {
        if (capacityCheck.used && !profile.pro_features_used) {
          await updateProfileBillingRow({
            supabaseUrl,
            serviceRoleKey,
            userId,
            patchBody: { pro_features_used: true }
          });
        }
        return new Response(
          JSON.stringify({
            ok: false,
            error:
              "Refund ineligible: MANAGED Pro features have already been used during this subscription. You can still cancel recurring billing with one click."
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const startedAtRaw = profile.subscription_started_at ? String(profile.subscription_started_at) : "";
      const startedAtMs = startedAtRaw ? Date.parse(startedAtRaw) : NaN;
      if (!Number.isFinite(startedAtMs) || Date.now() - startedAtMs > TWO_HOURS_MS) {
        return new Response(
          JSON.stringify({
            ok: false,
            error:
              "Refund ineligible: the 2-hour unused refund window has expired. You can still cancel future recurring billing at any time."
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const lemonApiKey = Deno.env.get("LEMONSQUEEZY_API_KEY") || "";

    if (provider !== "sandbox") {
      if (provider === "creem") {
        if (!creemApiKey || !orderId || orderId.startsWith("ord_")) {
          return new Response(
            JSON.stringify({
              ok: false,
              error:
                "Cannot process refund: no refundable Creem transaction ID is available for this subscription yet."
            }),
            { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      } else if (provider === "lemonsqueezy") {
        if (!lemonApiKey || !orderId) {
          return new Response(
            JSON.stringify({
              ok: false,
              error: "Cannot process refund: provider order ID or API key is missing."
            }),
            { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      } else {
        return new Response(
          JSON.stringify({ ok: false, error: "Cannot process refund: unrecognized billing provider." }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // STEP 1: Atomically claim the refund intent lock BEFORE calling the provider so concurrent requests cannot double-refund
    if (!isResumingPartialRefund && provider !== "sandbox") {
      const intentLock = await claimBillingEventLock({
        supabaseUrl,
        serviceRoleKey,
        eventId: refundIntentMarkerId,
        provider,
        eventType: "refund_intent_registered",
        userId
      });

      if (!intentLock.ok) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: "Could not initialize refund lock right now. Please try again."
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!intentLock.claimed) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: "A refund request for this subscription is already in progress. Please wait a moment and refresh."
          }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (provider === "creem") {
        const refundResp = await fetch(`${creemBaseUrl}/v1/refunds`, {
          method: "POST",
          headers: {
            "x-api-key": creemApiKey,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            transaction_id: orderId,
            reason: "requested_by_customer"
          })
        }).catch(() => null);

        if (!refundResp || !refundResp.ok) {
          await releaseBillingEventLock(supabaseUrl, serviceRoleKey, refundIntentMarkerId);
          return new Response(
            JSON.stringify({ ok: false, error: "Payment provider could not process the refund right now." }),
            { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const refundData = (await refundResp.json().catch(() => ({}))) as Record<string, unknown>;
        const refundObj =
          (refundData.refund as Record<string, unknown>) ||
          (refundData.object as Record<string, unknown>) ||
          refundData;
        const refundStatus = String(refundObj.status || "").trim().toLowerCase();

        if (
          refundStatus === "failed" ||
          refundStatus === "canceled" ||
          refundStatus === "cancelled" ||
          refundStatus === "requiresaction" ||
          refundStatus === "requires_action" ||
          !refundStatus
        ) {
          await releaseBillingEventLock(supabaseUrl, serviceRoleKey, refundIntentMarkerId);
          return new Response(
            JSON.stringify({
              ok: false,
              error: `Payment provider rejected the refund (status: ${refundStatus || "unknown"}).`
            }),
            { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (refundStatus === "pending" || refundStatus === "processing") {
          const fastWebhookCheck = await checkBillingEventRecorded(
            supabaseUrl,
            serviceRoleKey,
            refundTxMarkerId
          );

          if (!fastWebhookCheck.ok) {
            return new Response(
              JSON.stringify({
                ok: false,
                error: "Refund submitted, but status verification failed. Please refresh the page."
              }),
              { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          if (!fastWebhookCheck.exists) {
            await recordBillingEvent({
              supabaseUrl,
              serviceRoleKey,
              eventId: refundPendingMarkerId,
              provider,
              eventType: "refund_pending",
              userId
            });

            const recheckCompleted = await checkBillingEventRecorded(
              supabaseUrl,
              serviceRoleKey,
              refundTxMarkerId
            );

            if (!recheckCompleted.ok || !recheckCompleted.exists) {
              await updateProfileBillingRow({
                supabaseUrl,
                serviceRoleKey,
                userId,
                subscriptionId: subId || undefined,
                patchBody: {
                  subscription_status: "refund_pending"
                }
              });
              return new Response(
                JSON.stringify({
                  ok: false,
                  pending: true,
                  subscriptionStatus: "refund_pending",
                  error:
                    "Your refund request was submitted and is pending confirmation from the payment provider."
                }),
                { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }
          }
        }
      } else if (provider === "lemonsqueezy") {
        const refundResp = await fetch(
          `https://api.lemonsqueezy.com/v1/orders/${encodeURIComponent(orderId)}/refund`,
          {
            method: "POST",
            headers: {
              Accept: "application/vnd.api+json",
              "Content-Type": "application/vnd.api+json",
              Authorization: `Bearer ${lemonApiKey}`
            },
            body: JSON.stringify({
              data: {
                type: "orders",
                id: String(orderId)
              }
            })
          }
        ).catch(() => null);

        if (!refundResp || !refundResp.ok) {
          await releaseBillingEventLock(supabaseUrl, serviceRoleKey, refundIntentMarkerId);
          return new Response(
            JSON.stringify({ ok: false, error: "Payment provider could not process the refund right now." }),
            { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      const txSaved = await recordBillingEvent({
        supabaseUrl,
        serviceRoleKey,
        eventId: refundTxMarkerId,
        provider,
        eventType: "refund_tx_succeeded",
        userId
      });

      if (!txSaved) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: "Refund succeeded, but recording the refund marker failed. Please click Complete Refund Cancellation to finish."
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // STEP 2: Cancel the provider subscription and verify the response before revoking access
    const latestCancelCheck = cancelAlreadyCompleted
      ? { ok: true, exists: true }
      : await checkBillingEventRecorded(supabaseUrl, serviceRoleKey, refundCancelMarkerId);

    if (!latestCancelCheck.ok) {
      return new Response(
        JSON.stringify({
          ok: false,
          retryableCancel: true,
          subscriptionStatus: "refund_cancel_pending",
          error: "Could not verify subscription cancellation state. Please click Complete Refund Cancellation to retry."
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!latestCancelCheck.exists && provider !== "sandbox" && subId) {
      let cancelSucceeded = false;

      if (provider === "creem") {
        const cancelResp = await fetch(
          `${creemBaseUrl}/v1/subscriptions/${encodeURIComponent(subId)}/cancel`,
          {
            method: "POST",
            headers: {
              "x-api-key": creemApiKey,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ mode: "immediate" })
          }
        );
        cancelSucceeded = cancelResp.ok || cancelResp.status === 404;
      } else if (provider === "lemonsqueezy") {
        const cancelResp = await fetch(
          `https://api.lemonsqueezy.com/v1/subscriptions/${encodeURIComponent(subId)}`,
          {
            method: "DELETE",
            headers: {
              Accept: "application/vnd.api+json",
              "Content-Type": "application/vnd.api+json",
              Authorization: `Bearer ${lemonApiKey}`
            }
          }
        );
        cancelSucceeded = cancelResp.ok || cancelResp.status === 404;
      }

      if (!cancelSucceeded) {
        await updateProfileBillingRow({
          supabaseUrl,
          serviceRoleKey,
          userId,
          patchBody: { has_claimed_refund: true }
        });
        await updateProfileBillingRow({
          supabaseUrl,
          serviceRoleKey,
          userId,
          subscriptionId: subId,
          patchBody: {
            subscription_status: "refund_cancel_pending",
            has_claimed_refund: true
          }
        });
        return new Response(
          JSON.stringify({
            ok: false,
            retryableCancel: true,
            subscriptionStatus: "refund_cancel_pending",
            error:
              "Your payment refund succeeded, but stopping future subscription renewal did not complete. Please click Complete Refund Cancellation to finish cancelling without issuing another refund."
          }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const cancelSaved = await recordBillingEvent({
        supabaseUrl,
        serviceRoleKey,
        eventId: refundCancelMarkerId,
        provider,
        eventType: "refund_cancel_succeeded",
        userId
      });

      if (!cancelSaved) {
        return new Response(
          JSON.stringify({
            ok: false,
            retryableCancel: true,
            subscriptionStatus: "refund_cancel_pending",
            error: "Subscription cancelled, but saving cancellation state failed. Please click Complete Refund Cancellation to finish."
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // STEP 3: Record account-wide refund claim unconditionally, then revoke access ONLY on the refunded subscription
    const claimWrite = await updateProfileBillingRow({
      supabaseUrl,
      serviceRoleKey,
      userId,
      patchBody: {
        has_claimed_refund: true
      }
    });

    if (!claimWrite.ok) {
      return new Response(
        JSON.stringify({
          ok: false,
          retryableFinalize: true,
          subscriptionStatus: "refund_finalize_pending",
          error:
            "Your refund and cancellation succeeded, but updating your profile failed. Click Complete Refund Cancellation to sync your profile without issuing another refund."
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const nowIso = new Date().toISOString();
    const refundWrite = await updateProfileBillingRow({
      supabaseUrl,
      serviceRoleKey,
      userId,
      subscriptionId: subId || undefined,
      patchBody: {
        subscription_tier: "free",
        subscription_status: "refunded",
        subscription_period_end: null,
        cancel_at_period_end: false,
        has_claimed_refund: true,
        subscription_updated_at: nowIso
      }
    });

    if (!refundWrite.ok) {
      if (refundWrite.status >= 400 || !subId) {
        return new Response(
          JSON.stringify({
            ok: false,
            retryableFinalize: true,
            subscriptionStatus: "refund_finalize_pending",
            error:
              "Your refund and cancellation succeeded, but updating your profile failed. Click Complete Refund Cancellation to sync your profile without issuing another refund."
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const recheckRes = await fetch(
        `${supabaseUrl}/rest/v1/profiles?user_id=eq.${encodeURIComponent(userId)}&select=subscription_id,subscription_tier,subscription_status`,
        {
          headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`
          }
        }
      );

      if (!recheckRes.ok) {
        return new Response(
          JSON.stringify({
            ok: false,
            retryableFinalize: true,
            subscriptionStatus: "refund_finalize_pending",
            error:
              "Your refund and cancellation succeeded, but verifying your profile failed. Click Complete Refund Cancellation to sync your profile."
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const recheckRows = await recheckRes.json().catch(() => []);
      const latestProf = Array.isArray(recheckRows) ? recheckRows[0] : null;
      const latestSubId = String(latestProf?.subscription_id || "");

      if (!latestProf || latestSubId === subId) {
        return new Response(
          JSON.stringify({
            ok: false,
            retryableFinalize: true,
            subscriptionStatus: "refund_finalize_pending",
            error:
              "Your refund and cancellation succeeded, but updating your profile failed. Click Complete Refund Cancellation to sync your profile."
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          ok: true,
          refunded: true,
          supersededByNewSubscription: true,
          subscriptionTier: String(latestProf.subscription_tier || "pro"),
          subscriptionStatus: String(latestProf.subscription_status || "active"),
          hasClaimedRefund: true
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        refunded: true,
        subscriptionTier: "free",
        subscriptionStatus: "refunded",
        hasClaimedRefund: true
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  return new Response(JSON.stringify({ error: "Unsupported billing action." }), {
    status: 400,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
});