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

/**
 * Parses ISO date strings, numeric epoch milliseconds, or numeric epoch seconds.
 * Returns null if the input cannot be parsed as a valid timestamp.
 */
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

/**
 * Extracts a valid Creem transaction ID (excluding order IDs that start with 'ord_').
 */
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

async function hasRecordedBillingEvent(
  supabaseUrl: string,
  serviceRoleKey: string,
  eventId: string
): Promise<boolean> {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/billing_webhook_events?event_id=eq.${encodeURIComponent(eventId)}&select=event_id`,
    {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`
      }
    }
  );
  if (!res.ok) return false;
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows.length > 0;
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

/**
 * Queries Creem's subscription endpoint to resolve the latest refundable transaction ID
 * when a profile has a subscription_id but no stored transaction ID.
 */
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

      // Store only a valid refundable transaction ID (never an ord_ order ID)
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
      // Keep subscription IDs and order IDs strictly separate
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

    // Look up existing profile by user_id, subscription_id, or subscription_order_id
    // so refund webhooks without custom metadata resolve their owning account and preserve associations
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
        `${supabaseUrl}/rest/v1/profiles?${filter}&select=user_id,subscription_id,subscription_order_id,subscription_started_at,pro_features_used,subscription_updated_at`,
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
    if (!subId && existingProfile?.subscription_id) {
      subId = String(existingProfile.subscription_id);
    }
    if (!orderId && existingProfile?.subscription_order_id) {
      orderId = String(existingProfile.subscription_order_id);
    }

    if (!customUserId || (!subId && !orderId)) {
      return new Response(
        JSON.stringify({ error: "Missing user_id or subscription/order identifier in webhook." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build a deterministic deduplication key from the provider event ID (or payload hash fallback)
    const eventUpdatedAt = parsedEventTimeIso || new Date().toISOString();
    const payloadHash =
      !providerEnvelopeId && !parsedEventTimeIso
        ? (await computeHmacSha256Hex("webhook_dedup", rawBody)).slice(0, 24)
        : "";
    const eventId = providerEnvelopeId
      ? `${providerName}_${providerEnvelopeId}`
      : `${providerName}_${eventName}_${subId || orderId}_${parsedEventTimeIso || payloadHash}`;

    const alreadyProcessed = await hasRecordedBillingEvent(
      supabaseUrl,
      serviceRoleKey,
      eventId
    );
    if (alreadyProcessed) {
      return new Response(JSON.stringify({ ok: true, duplicate: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const updateBody: Record<string, unknown> = {
      subscription_tier: isExpired ? "free" : "pro",
      subscription_status: isRefunded
        ? "refunded"
        : isExpired
          ? "expired"
          : isCancelled
            ? "canceled_pending_expiry"
            : "active",
      subscription_provider: providerName,
      subscription_period_end: isRefunded ? null : renewsAt,
      cancel_at_period_end: isCancelled && !isExpired,
      subscription_updated_at: eventUpdatedAt
    };

    if (subId) {
      updateBody.subscription_id = subId;
    }
    if (orderId) {
      updateBody.subscription_order_id = orderId;
    }

    // Only initialize subscription_started_at and reset pro_features_used when activating a brand-new subscription ID
    const isSameExistingSubscription =
      Boolean(subId) &&
      existingProfile?.subscription_id === subId &&
      Boolean(existingProfile?.subscription_started_at);

    if (isInitialCreation && !isSameExistingSubscription) {
      updateBody.subscription_started_at = eventUpdatedAt;
      updateBody.pro_features_used = false;
    }
    if (isRefunded) {
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

      return new Response(JSON.stringify({ ok: true, ignoredStaleEvent: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    await recordBillingEvent({
      supabaseUrl,
      serviceRoleKey,
      eventId,
      provider: providerName,
      eventType: eventName,
      userId: customUserId
    });

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
    const returnUrl = String(body.returnUrl || "https://sterlingmanagedapp.com/?checkout=success");

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

  // ACTION C: 2-HOUR UNUSED SUBSCRIPTION REFUND (With Idempotent Recovery & Cancellation Verification)
  if (action === "request_refund") {
    const profRes = await fetch(
      `${supabaseUrl}/rest/v1/profiles?user_id=eq.${encodeURIComponent(userId)}&select=subscription_tier,subscription_status,subscription_provider,subscription_id,subscription_order_id,subscription_started_at,pro_features_used,has_claimed_refund`,
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

    // Resolve Creem transaction ID from subscription if missing or if an ord_ ID was stored
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
          patchBody: { subscription_order_id: orderId }
        });
      }
    }

    const refundKeyId = subId || orderId || userId;
    const refundTxMarkerId = `refund_tx_${provider}_${refundKeyId}`;
    const refundCancelMarkerId = `refund_cancel_done_${provider}_${refundKeyId}`;
    const refundPendingMarkerId = `refund_pending_${provider}_${refundKeyId}`;

    const [txAlreadyRefunded, cancelAlreadyCompleted, isRefundPending] = await Promise.all([
      hasRecordedBillingEvent(supabaseUrl, serviceRoleKey, refundTxMarkerId),
      hasRecordedBillingEvent(supabaseUrl, serviceRoleKey, refundCancelMarkerId),
      hasRecordedBillingEvent(supabaseUrl, serviceRoleKey, refundPendingMarkerId)
    ]);

    const isResumingPartialRefund =
      txAlreadyRefunded || currentStatus === "refund_cancel_pending";

    if (currentStatus === "refund_pending" || (isRefundPending && !txAlreadyRefunded)) {
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

    // Standard eligibility checks apply only when starting a fresh refund (not when finishing a partially completed refund)
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

      if (profile.pro_features_used) {
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

    // Validate required provider credentials and refundable transaction/order IDs BEFORE calling provider endpoints
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

    // STEP 1: Execute provider refund if not already completed in an earlier attempt
    if (!isResumingPartialRefund && provider !== "sandbox") {
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
        });

        if (!refundResp.ok) {
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
          return new Response(
            JSON.stringify({
              ok: false,
              error: `Payment provider rejected the refund (status: ${refundStatus || "unknown"}).`
            }),
            { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (refundStatus === "pending" || refundStatus === "processing") {
          await recordBillingEvent({
            supabaseUrl,
            serviceRoleKey,
            eventId: refundPendingMarkerId,
            provider,
            eventType: "refund_pending",
            userId
          });
          await updateProfileBillingRow({
            supabaseUrl,
            serviceRoleKey,
            userId,
            subscriptionId: subId || undefined,
            patchBody: {
              subscription_status: "refund_pending",
              subscription_updated_at: new Date().toISOString()
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
        );

        if (!refundResp.ok) {
          return new Response(
            JSON.stringify({ ok: false, error: "Payment provider could not process the refund right now." }),
            { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      // Durably record that the provider refund succeeded so retries never issue a duplicate refund
      await recordBillingEvent({
        supabaseUrl,
        serviceRoleKey,
        eventId: refundTxMarkerId,
        provider,
        eventType: "refund_tx_succeeded",
        userId
      });
    }

    // STEP 2: Cancel the provider subscription and verify the response before revoking access
    if (!cancelAlreadyCompleted && provider !== "sandbox" && subId) {
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
          subscriptionId: subId || undefined,
          patchBody: {
            subscription_status: "refund_cancel_pending",
            has_claimed_refund: true,
            subscription_updated_at: new Date().toISOString()
          }
        });
        return new Response(
          JSON.stringify({
            ok: false,
            retryableCancel: true,
            subscriptionStatus: "refund_cancel_pending",
            error:
              "Your payment refund succeeded, but stopping future subscription renewal did not complete. Please click Request 2-Hour Refund again to finish cancelling without issuing another refund."
          }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      await recordBillingEvent({
        supabaseUrl,
        serviceRoleKey,
        eventId: refundCancelMarkerId,
        provider,
        eventType: "refund_cancel_succeeded",
        userId
      });
    }

    // STEP 3: Finalize profile revocation
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
      return new Response(
        JSON.stringify({
          ok: false,
          error:
            "Your refund and cancellation succeeded, but updating your profile failed. Please click Request 2-Hour Refund again to sync your profile without issuing another refund."
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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