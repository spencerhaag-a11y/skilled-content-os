// Edge Function: website-scanner
// Module 16 — Website Scanner. Fetches a URL server-side, reduces it to text,
// and asks Claude for a structured brand summary plus a gap analysis (missing
// pages, weak CTAs, SEO gaps, thin content). Competitor mode adds positioning.
// Every scan is saved to scan_history. The Anthropic key never leaves here.
//
// Deploy: supabase functions deploy website-scanner
// Secret: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import { callClaude, parseJsonBlock } from "../_shared/claude.ts";

const MAX_PAGE_CHARS = 14_000;
const FETCH_TIMEOUT_MS = 12_000;

interface ScanResults {
  summary: {
    business_name: string;
    services: string[];
    tone: string;
    audience: string;
    keywords: string[];
  };
  issues: {
    missing_pages: string[];
    weak_ctas: string[];
    seo_gaps: string[];
    thin_content: string[];
  };
  positioning?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchPageText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "SkilledContentOS-WebsiteScanner/1.0" },
    });
    if (!res.ok) throw new Error(`Site returned ${res.status}`);
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      throw new Error("URL did not return a readable web page.");
    }
    const text = htmlToText(await res.text());
    if (text.length < 100) throw new Error("Page had too little readable content to scan.");
    return text.slice(0, MAX_PAGE_CHARS);
  } finally {
    clearTimeout(timer);
  }
}

const SCHEMA = `Respond with ONLY a JSON object — no markdown fences, no preamble. Schema:
{
  "summary": {
    "business_name": string,
    "services": string[] (each service or offer the site sells),
    "tone": string (one sentence on the brand's voice/tone),
    "audience": string (who the site is clearly speaking to),
    "keywords": string[] (5-12 terms this site ranks for or should target)
  },
  "issues": {
    "missing_pages": string[] (standard pages absent or not linked: about, services, contact, pricing, blog, testimonials, etc.),
    "weak_ctas": string[] (specific weak or missing calls to action),
    "seo_gaps": string[] (missing meta, thin titles, no H1, no schema signals, etc.),
    "thin_content": string[] (sections that are too sparse to convert or rank)
  }
}`;

Deno.serve(async (req) => {
  const preflight = handleCorsPreflightIfNeeded(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let url = "";
  let scanType = "website";
  try {
    const body = await req.json();
    url = String(body.url ?? "").trim();
    scanType = String(body.scan_type ?? "website").trim();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }
  if (scanType !== "website" && scanType !== "competitor") {
    return json({ error: "scan_type must be 'website' or 'competitor'." }, 400);
  }

  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
  } catch {
    return json({ error: "Enter a valid website URL." }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } }
  );

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) return json({ error: "Not authenticated." }, 401);
  const userId = userData.user.id;

  const { data: profile } = await supabase
    .from("profiles")
    .select("account_id")
    .eq("id", userId)
    .maybeSingle();
  if (!profile?.account_id) return json({ error: "No account found for this user." }, 403);
  const accountId = profile.account_id;

  try {
    const pageText = await fetchPageText(url);
    const competitor = scanType === "competitor";
    const system =
      "You analyze website text for a marketing platform and return strict JSON. " +
      "Base everything strictly on the provided page text; if something cannot be inferred, use an empty string or empty array. " +
      (competitor
        ? 'Also include a "positioning" string (2-4 sentences) describing how this competitor positions itself and where a challenger brand could differentiate. '
        : "") +
      SCHEMA;

    const raw = await callClaude({
      system,
      userContent: `Scan type: ${scanType}\nWebsite: ${url}\n\nPage text:\n${pageText}`,
      maxTokens: 1600,
    });
    const results = parseJsonBlock<ScanResults>(raw);

    // Defensive normalization — never trust model shape blindly.
    const norm: ScanResults = {
      summary: {
        business_name: results.summary?.business_name ?? "",
        services: Array.isArray(results.summary?.services) ? results.summary!.services.slice(0, 20) : [],
        tone: results.summary?.tone ?? "",
        audience: results.summary?.audience ?? "",
        keywords: Array.isArray(results.summary?.keywords) ? results.summary!.keywords.slice(0, 15) : [],
      },
      issues: {
        missing_pages: Array.isArray(results.issues?.missing_pages) ? results.issues!.missing_pages.slice(0, 15) : [],
        weak_ctas: Array.isArray(results.issues?.weak_ctas) ? results.issues!.weak_ctas.slice(0, 15) : [],
        seo_gaps: Array.isArray(results.issues?.seo_gaps) ? results.issues!.seo_gaps.slice(0, 15) : [],
        thin_content: Array.isArray(results.issues?.thin_content) ? results.issues!.thin_content.slice(0, 15) : [],
      },
      ...(competitor && typeof results.positioning === "string" ? { positioning: results.positioning } : {}),
    };

    const { data: scan, error: insertError } = await supabase
      .from("scan_history")
      .insert({
        account_id: accountId,
        created_by: userId,
        url,
        scan_type: scanType,
        results_json: norm,
      })
      .select("id, url, scan_type, results_json, created_at")
      .single();
    if (insertError) throw new Error(insertError.message);

    return json({ scan });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scan failed.";
    return json({ error: message }, 422);
  }
});
