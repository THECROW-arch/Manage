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
    // 1. Verify caller identity via Supabase Auth using the Authorization header
    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!authHeader || !supabaseUrl || !supabaseAnonKey) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header or Supabase environment configuration." }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
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
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    const authUser = await userResp.json().catch(() => null);
    const authenticatedEmail = String(authUser?.email || "").trim().toLowerCase();

    if (!authenticatedEmail) {
      return new Response(
        JSON.stringify({ error: "Authenticated user does not have a verified email address." }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    // 2. Parse request JSON in its own try block and return 400 on malformed body
    let payload: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return new Response(
          JSON.stringify({ error: "Request body must be a valid JSON object." }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          }
        );
      }
      payload = parsed as Record<string, unknown>;
    } catch {
      return new Response(
        JSON.stringify({ error: "Malformed JSON in request body." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    const { to, subject, text, html, periodKey } = payload;
    const requestedTo = String(to || "").trim().toLowerCase();

    // 3. Restrict recipient strictly to the authenticated caller's own email address
    if (requestedTo && requestedTo !== authenticatedEmail) {
      return new Response(
        JSON.stringify({ error: "Forbidden: recipient email must match the authenticated user." }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    if (!subject || (!html && !text)) {
      return new Response(
        JSON.stringify({ error: "Missing required email fields (subject, html/text)." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const fromAddress = Deno.env.get("REMINDER_FROM_EMAIL") || "MANAGED <onboarding@resend.dev>";

    if (!resendApiKey) {
      return new Response(
        JSON.stringify({
          error: "RESEND_API_KEY is not configured in Supabase Edge Function secrets."
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [authUser.email],
        subject: String(subject),
        html: html ? String(html) : undefined,
        text: text ? String(text) : undefined,
        tags: periodKey ? [{ name: "period", value: String(periodKey) }] : undefined
      })
    });

    const resultData = await resendResponse.json().catch(() => ({}));

    // 4. Return 502 Bad Gateway on upstream provider error so 401/403 API key errors are not misread as user auth errors
    if (!resendResponse.ok) {
      console.error("Resend provider error:", {
        status: resendResponse.status,
        details: resultData
      });
      return new Response(
        JSON.stringify({
          error: "Email delivery provider failed to process the reminder request."
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    return new Response(
      JSON.stringify({ ok: true, id: resultData?.id || null }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  } catch (err) {
    console.error("Unexpected error in send-recurring-reminder:", err);
    return new Response(
      JSON.stringify({ error: "Unexpected server error in send-recurring-reminder." }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  }
});