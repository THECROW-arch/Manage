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

const ALLOWED_TAGS = new Set([
  "div", "h1", "h2", "h3", "p", "ul", "ol", "li",
  "strong", "b", "em", "i", "span", "br",
  "table", "thead", "tbody", "tr", "th", "td", "a"
]);

const VOID_TAGS = new Set(["br"]);
const DROP_CONTENT_TAGS = new Set(["script", "style", "iframe", "object", "embed", "svg", "math"]);

function escapeHtmlEntities(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function decodeHtmlEntities(raw: string): string {
  return raw
    .replace(/&#x([0-9a-fA-F]+);?/g, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&#([0-9]+);?/g, (_, dec) => {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&(colon|tab|newline|amp|lt|gt|quot|apos|#39);?/gi, (match, name) => {
      const lower = String(name).toLowerCase();
      if (lower === "colon") return ":";
      if (lower === "tab") return "\t";
      if (lower === "newline") return "\n";
      if (lower === "amp") return "&";
      if (lower === "lt") return "<";
      if (lower === "gt") return ">";
      if (lower === "quot") return '"';
      if (lower === "apos" || lower === "#39") return "'";
      return match;
    });
}

function sanitizeSafeStyle(rawStyle: string): string {
  const decoded = decodeHtmlEntities(rawStyle).replace(/[\u0000-\u001F\u007F]/g, "");
  if (/(?:url\s*\(|expression\s*\(|javascript\s*:|vbscript\s*:|data\s*:|-moz-binding|@import)/i.test(decoded)) {
    return "";
  }
  return decoded.replace(/[<>"]/g, "").trim().slice(0, 300);
}

function sanitizeSafeHref(rawHref: string): string {
  const decoded = decodeHtmlEntities(rawHref)
    .replace(/[\u0000-\u0020\u007F]+/g, "")
    .trim();
  if (!decoded) return "";
  try {
    const parsed = new URL(decoded);
    if (parsed.protocol === "https:" || parsed.protocol === "mailto:") {
      return parsed.toString();
    }
  } catch {
    return "";
  }
  return "";
}

/**
 * Parser-based HTML sanitizer that tokenizes markup and rebuilds only allowlisted tags
 * and verified attributes, preventing nested tag reassembly and encoded scheme bypasses.
 */
function sanitizeEmailHtml(inputHtml: string): string {
  const src = String(inputHtml || "");
  const out: string[] = [];
  let i = 0;
  let skipUntilClosingTag: string | null = null;

  while (i < src.length) {
    const ltIndex = src.indexOf("<", i);
    if (ltIndex === -1) {
      if (!skipUntilClosingTag) {
        out.push(escapeHtmlEntities(src.slice(i)));
      }
      break;
    }

    if (ltIndex > i && !skipUntilClosingTag) {
      out.push(escapeHtmlEntities(src.slice(i, ltIndex)));
    }

    const gtIndex = src.indexOf(">", ltIndex + 1);
    if (gtIndex === -1) {
      if (!skipUntilClosingTag) {
        out.push(escapeHtmlEntities(src.slice(ltIndex)));
      }
      break;
    }

    const rawTagContent = src.slice(ltIndex + 1, gtIndex).trim();
    i = gtIndex + 1;

    if (rawTagContent.startsWith("!--")) {
      continue;
    }

    const isClosing = rawTagContent.startsWith("/");
    const bodyAfterSlash = isClosing ? rawTagContent.slice(1).trim() : rawTagContent;
    const tagMatch = bodyAfterSlash.match(/^([a-zA-Z0-9]+)(?:[\s/>]|$)/);
    if (!tagMatch) {
      continue;
    }

    const tagName = tagMatch[1].toLowerCase();

    if (skipUntilClosingTag) {
      if (isClosing && tagName === skipUntilClosingTag) {
        skipUntilClosingTag = null;
      }
      continue;
    }

    if (DROP_CONTENT_TAGS.has(tagName)) {
      if (!isClosing && !rawTagContent.endsWith("/")) {
        skipUntilClosingTag = tagName;
      }
      continue;
    }

    if (!ALLOWED_TAGS.has(tagName)) {
      continue;
    }

    if (isClosing) {
      if (!VOID_TAGS.has(tagName)) {
        out.push(`</${tagName}>`);
      }
      continue;
    }

    const attrString = bodyAfterSlash.slice(tagMatch[1].length).replace(/\/$/, "").trim();
    const safeAttrs: string[] = [];
    const attrRegex = /([a-zA-Z0-9_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
    let match: RegExpExecArray | null;

    while ((match = attrRegex.exec(attrString)) !== null) {
      const attrName = match[1].toLowerCase();
      const rawVal = match[2] ?? match[3] ?? match[4] ?? "";

      if (attrName === "style") {
        const cleanStyle = sanitizeSafeStyle(rawVal);
        if (cleanStyle) {
          safeAttrs.push(`style="${escapeHtmlEntities(cleanStyle)}"`);
        }
      } else if (attrName === "href" && tagName === "a") {
        const cleanHref = sanitizeSafeHref(rawVal);
        if (cleanHref) {
          safeAttrs.push(`href="${escapeHtmlEntities(cleanHref)}"`);
          safeAttrs.push(`rel="noopener noreferrer"`);
        }
      }
    }

    const attrSuffix = safeAttrs.length > 0 ? " " + safeAttrs.join(" ") : "";
    out.push(VOID_TAGS.has(tagName) ? `<${tagName} />` : `<${tagName}${attrSuffix}>`);
  }

  return out.join("");
}

function sanitizeTagValue(rawTag: string): string {
  return rawTag.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
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
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!authHeader || !supabaseUrl || !supabaseAnonKey) {
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
    const authenticatedEmail = String(authUser?.email || "").trim().toLowerCase();

    if (!authenticatedEmail) {
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

    const { to, subject, text, html, periodKey } = payload;
    const requestedTo = String(to || "").trim().toLowerCase();

    if (requestedTo && requestedTo !== authenticatedEmail) {
      return new Response(
        JSON.stringify({ error: "Forbidden: recipient email must match the authenticated user." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!subject || (!html && !text)) {
      return new Response(
        JSON.stringify({ error: "Missing required email fields (subject, html/text)." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const fromAddress = Deno.env.get("REMINDER_FROM_EMAIL") || "MANAGED <onboarding@resend.dev>";

    if (!resendApiKey) {
      return new Response(
        JSON.stringify({ error: "RESEND_API_KEY is not configured in Supabase Edge Function secrets." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const safeSubject = String(subject).replace(/[\r\n]+/g, " ").trim().slice(0, 200);
    const safeHtml = html ? sanitizeEmailHtml(String(html)) : undefined;
    const safeText = text ? String(text).slice(0, 10000) : undefined;
    const safePeriodTag = periodKey ? sanitizeTagValue(String(periodKey)) : "";

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [authUser.email],
        subject: safeSubject,
        html: safeHtml,
        text: safeText,
        tags: safePeriodTag ? [{ name: "period", value: safePeriodTag }] : undefined
      })
    });

    const resultData = await resendResponse.json().catch(() => ({}));

    if (!resendResponse.ok) {
      console.error("Resend provider error:", {
        status: resendResponse.status,
        details: resultData
      });
      return new Response(
        JSON.stringify({ error: "Email delivery provider failed to process the reminder request." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ ok: true, id: resultData?.id || null }),
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