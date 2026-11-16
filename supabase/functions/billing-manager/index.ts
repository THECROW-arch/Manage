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
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-signature, stripe-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const SUPPORTED_SUBSCRIPTION_EVENTS = new Set([
  "subscription_created",
  "subscription_updated",
  "subscription_cancelled",
  "subscription_resumed",
  "subscription_expired",
  "subscription_paused",
  "subscription_unpaused"
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
 * Performs a verified PATCH against public.profiles and confirms that the target profile row
 * was actually updated. Optionally enforces an atomic subscription_updated_at ordering filter.
 */
async function updateProfileBillingRow(params: {
  supabaseUrl: string;
  serviceRoleKey: string;
  userId: string;
  patchBody: Record<string, unknown>;
  minUpdatedAtIso?: string;
}): Promise<{ ok: boolean; updatedCount: number; status: number; error?: string }> {
  const { supabaseUrl, serviceRoleKey, userId, patchBody, minUpdatedAtIso } = params;
  let query = `user_id=eq.${encodeURIComponent(userId)}`;
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

  // 1. WEBHOOK PATH: Verify HMAC-SHA256 signature and process subscription events atomically
  const lemonSig = req.headers.get("x-signature");
  const webhookSecret = Deno.env.get("PAYMENT_WEBHOOK_SECRET") || "";

  if (lemonSig) {
    if (!webhookSecret) {
      return new Response(JSON.stringify({ error: "Webhook secret not configured." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const expectedHex = await computeHmacSha256Hex(webhookSecret, rawBody);
    if (!timingSafeHexEqual(lemonSig, expectedHex)) {
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

    const meta = (eventPayload.meta as Record<string, unknown>) || {};
    const customData = (meta.custom_data as Record<string, unknown>) || {};
    const dataObj = (eventPayload.data as Record<string, unknown>) || {};
    const attrs = (dataObj.attributes as Record<string, unknown>) || {};

    const eventName = String(meta.event_name || "unknown");
    const resourceType = String(dataObj.type || "");

    // Accept only subscription lifecycle events carrying a subscriptions resource object
    if (!SUPPORTED_SUBSCRIPTION_EVENTS.has(eventName) || (resourceType && resourceType !== "subscriptions")) {
      return new Response(JSON.stringify({ ok: true, ignoredEvent: eventName }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const customUserId = String(customData.user_id || "");
    const subId = String(dataObj.id || "");
    const rawUpdatedAt = attrs.updated_at ? String(attrs.updated_at) : "";
    const parsedTime = rawUpdatedAt ? Date.parse(rawUpdatedAt) : NaN;
    const eventUpdatedAt = Number.isFinite(parsedTime)
      ? new Date(parsedTime).toISOString()
      : new Date().toISOString();
    const eventId = `${eventName}_${subId}_${eventUpdatedAt}`;

    if (!customUserId || !subId) {
      return new Response(JSON.stringify({ error: "Missing custom_data.user_id or subscription id in webhook." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Check if this exact event was already completed
    const existingDedupRes = await fetch(
      `${supabaseUrl}/rest/v1/billing_webhook_events?event_id=eq.${encodeURIComponent(eventId)}&select=event_id`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`
        }
      }
    );

    if (!existingDedupRes.ok) {
      return new Response(JSON.stringify({ error: "Failed to check webhook deduplication state." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const existingDedupRows = await existingDedupRes.json().catch(() => []);
    if (Array.isArray(existingDedupRows) && existingDedupRows.length > 0) {
      return new Response(JSON.stringify({ ok: true, duplicate: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const renewsAt = attrs.renews_at || attrs.ends_at || null;
    const isCancelled = Boolean(attrs.cancelled) || eventName === "subscription_cancelled";
    const isExpired = eventName === "subscription_expired" || attrs.status === "expired";

    const updateBody = {
      subscription_tier: isExpired ? "free" : "pro",
      subscription_status: isExpired ? "expired" : isCancelled ? "canceled_pending_expiry" : "active",
      subscription_provider: "lemonsqueezy",
      subscription_id: subId,
      subscription_period_end: renewsAt ? String(renewsAt) : null,
      cancel_at_period_end: isCancelled && !isExpired,
      subscription_updated_at: eventUpdatedAt
    };

    // Enforce timestamp ordering atomically in the database UPDATE filter
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

      // 0 rows matched: distinguish between a stale out-of-order event and a missing profile row
      const checkProfRes = await fetch(
        `${supabaseUrl}/rest/v1/profiles?user_id=eq.${encodeURIComponent(customUserId)}&select=user_id,subscription_updated_at`,
        {
          headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`
          }
        }
      );

      if (!checkProfRes.ok) {
        return new Response(JSON.stringify({ error: "Failed to verify profile after conditional update." }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const checkRows = await checkProfRes.json().catch(() => []);
      const existingProf = Array.isArray(checkRows) ? checkRows[0] : null;

      if (!existingProf) {
        return new Response(JSON.stringify({ error: "Target user profile not found for webhook." }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // Profile exists with a newer subscription_updated_at timestamp; ignore stale out-of-order event
      return new Response(JSON.stringify({ ok: true, ignoredStaleEvent: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Record webhook completion only after the profile update has succeeded
    const dedupInsertRes = await fetch(`${supabaseUrl}/rest/v1/billing_webhook_events`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        event_id: eventId,
        provider: "lemonsqueezy",
        event_type: eventName,
        user_id: customUserId
      })
    });

    if (!dedupInsertRes.ok && dedupInsertRes.status !== 409) {
      console.warn("Could not record completed webhook event_id:", eventId);
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // 2. AUTHENTICATED USER ACTIONS (create_checkout / cancel_subscription)
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
    const checkoutBaseUrl = Deno.env.get("PAYMENT_CHECKOUT_URL") || "";
    const returnUrl = String(body.returnUrl || "https://sterlingmanagedapp.com/?checkout=success");

    if (checkoutBaseUrl) {
      const separator = checkoutBaseUrl.includes("?") ? "&" : "?";
      const checkoutUrl =
        `${checkoutBaseUrl}${separator}checkout[email]=${encodeURIComponent(userEmail)}` +
        `&checkout[custom][user_id]=${encodeURIComponent(userId)}` +
        `&checkout[redirect_url]=${encodeURIComponent(returnUrl)}`;

      return new Response(JSON.stringify({ ok: true, checkoutUrl }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (allowSandboxSim) {
      const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const nowIso = new Date().toISOString();

      const simWrite = await updateProfileBillingRow({
        supabaseUrl,
        serviceRoleKey,
        userId,
        patchBody: {
          subscription_tier: "pro",
          subscription_status: "active",
          subscription_provider: "sandbox",
          subscription_id: `sub_sandbox_${userId.slice(0, 8)}`,
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
          subscriptionPeriodEnd: periodEnd,
          cancelAtPeriodEnd: false
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        ok: false,
        error: "Payment checkout URL is not configured yet. Set PAYMENT_CHECKOUT_URL or ALLOW_SANDBOX_SIMULATION=true in Supabase secrets."
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

    // Require provider credentials unless this is an explicit sandbox subscription
    if (provider !== "sandbox") {
      if (provider !== "lemonsqueezy" || !subId || !lemonApiKey) {
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
    }

    const fallbackPeriodEnd =
      profile.subscription_period_end || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const nowIso = new Date().toISOString();

    const cancelWrite = await updateProfileBillingRow({
      supabaseUrl,
      serviceRoleKey,
      userId,
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

  return new Response(JSON.stringify({ error: "Unsupported billing action." }), {
    status: 400,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
});