// Edge Function: brand-scan
// Module 1 — "Business URL triggers optional auto-scan on entry (populates
// brand kit fields from website content)."
// Fetches the page server-side, reduces it to text, and asks Claude to
// extract brand kit field suggestions as strict JSON. The Anthropic key
// never leaves this function (Section 3, Security Requirements).
//
// Deploy: supabase functions deploy brand-scan
// Secret: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

import { corsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const CLAUDE_MODEL = "claude-sonnet-4-6";
const MAX_PAGE_CHARS = 12_000;
const FETCH_TIMEOUT_MS = 10_000;

interface ScanSuggestions {
  business_name?: string;
  tagline?: string;
  mission?: string;
  voice?: string[];
  icp?: {
    demographics?: string;
    pain_points?: string;
    goals?: string;
    objections?: string;
  };
  pillars?: string[];
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
      headers: { "User-Agent": "SkilledContentOS-BrandScan/1.0" },
    });
    if (!res.ok) throw new Error(`Site returned ${res.status}`);
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      throw new Error("URL did not return a readable web page.");
    }
    const html = await res.text();
    const text = htmlToText(html);
    if (text.length < 100) throw new Error("Page had too little readable content to scan.");
    return text.slice(0, MAX_PAGE_CHARS);
  } finally {
    clearTimeout(timer);
  }
}

async function extractBrandFields(pageText: string, url: string): Promise<ScanSuggestions> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1200,
      system:
        "You extract brand identity information from website text for a marketing platform. " +
        "Respond with ONLY a JSON object — no markdown fences, no preamble. Schema: " +
        '{"business_name": string, "tagline": string, "mission": string, ' +
        '"voice": string[] (3-5 single-word or short tone descriptors), ' +
        '"icp": {"demographics": string, "pain_points": string, "goals": string, "objections": string}, ' +
        '"pillars": string[] (3-5 content topic areas this business should consistently cover)}. ' +
        "Base everything strictly on the provided text. If a field cannot be inferred, use an empty string or empty array.",
      messages: [
        {
          role: "user",
          content: `Website: ${url}\n\nPage text:\n${pageText}`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Claude API error ${res.status}: ${detail.slice(0, 300)}`);
  }

  const data = await res.json();
  const text: string = (data.content ?? [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("\n");

  const cleaned = text.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(cleaned) as ScanSuggestions;

  // Normalize defensively — never trust shape blindly.
  return {
    business_name: typeof parsed.business_name === "string" ? parsed.business_name : "",
    tagline: typeof parsed.tagline === "string" ? parsed.tagline : "",
    mission: typeof parsed.mission === "string" ? parsed.mission : "",
    voice: Array.isArray(parsed.voice) ? parsed.voice.filter((v) => typeof v === "string").slice(0, 6) : [],
    icp: {
      demographics: parsed.icp?.demographics ?? "",
      pain_points: parsed.icp?.pain_points ?? "",
      goals: parsed.icp?.goals ?? "",
      objections: parsed.icp?.objections ?? "",
    },
    pillars: Array.isArray(parsed.pillars) ? parsed.pillars.filter((p) => typeof p === "string").slice(0, 5) : [],
  };
}

Deno.serve(async (req) => {
  const preflight = handleCorsPreflightIfNeeded(req);
  if (preflight) return preflight;

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!ANTHROPIC_API_KEY) return json({ error: "ANTHROPIC_API_KEY is not configured." }, 500);

  let url: string;
  try {
    const body = await req.json();
    url = String(body.url ?? "").trim();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
  } catch {
    return json({ error: "Enter a valid website URL." }, 400);
  }

  try {
    const pageText = await fetchPageText(url);
    const suggestions = await extractBrandFields(pageText, url);
    return json({ url, suggestions });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scan failed.";
    return json({ error: message }, 422);
  }
});
