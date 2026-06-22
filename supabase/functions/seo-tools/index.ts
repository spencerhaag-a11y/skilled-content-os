// Edge Function: seo-tools
// Module 14 — SEO Tools. One function, three tasks:
//   keyword_research → seed keyword in, related terms + relative volume out
//   onpage_score     → fetch a URL, score it 0-100 with concrete fixes
//   meta_generate    → topic/keyword in, title tag + meta description options out
//
// Engineering decision: real search-volume APIs (Ahrefs/SEMrush) are not in
// v1.0 scope, so volumes are Claude's relative estimates (low/medium/high +
// 0-100 score), clearly labeled as estimates in the UI.
//
// Deploy: supabase functions deploy seo-tools

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import { callClaude, parseJsonBlock } from "../_shared/claude.ts";

const TASKS = ["keyword_research", "onpage_score", "meta_generate"];
const MAX_PAGE_CHARS = 12_000;
const FETCH_TIMEOUT_MS = 12_000;

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
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
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
      headers: { "User-Agent": "SkilledContentOS-SeoTools/1.0" },
    });
    if (!res.ok) throw new Error(`Site returned ${res.status}`);
    const text = htmlToText(await res.text());
    if (text.length < 80) throw new Error("Page had too little readable content to score.");
    return text.slice(0, MAX_PAGE_CHARS);
  } finally {
    clearTimeout(timer);
  }
}

const SCHEMAS: Record<string, string> = {
  keyword_research: `{
  "seed": string,
  "keywords": [ { "keyword": string, "intent": "informational" | "commercial" | "transactional" | "navigational", "volume": "low" | "medium" | "high", "difficulty": number (0-100) } ] (12-20 related terms),
  "clusters": [ { "name": string, "keywords": string[] } ] (3-5 topical clusters)
}`,
  onpage_score: `{
  "url": string,
  "score": number (0-100),
  "found": { "title": string, "meta_description": string, "h1": string, "word_count_estimate": number },
  "actions": [ { "priority": "high" | "medium" | "low", "action": string } ] (6-12 concrete fixes)
}`,
  meta_generate: `{
  "titles": string[] (5 title-tag options, each <= 60 chars),
  "meta_descriptions": string[] (5 options, each <= 155 chars)
}`,
};

Deno.serve(async (req) => {
  const preflight = handleCorsPreflightIfNeeded(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let task = "";
  let input = "";
  let url = "";
  let keyword = "";
  try {
    const body = await req.json();
    task = String(body.task ?? "").trim();
    input = String(body.input ?? "").trim().slice(0, 400);
    url = String(body.url ?? "").trim();
    keyword = String(body.keyword ?? "").trim().slice(0, 200);
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }
  if (!TASKS.includes(task)) return json({ error: "Unknown task." }, 400);

  // Auth (RLS-scoped client) — gate access even though SEO tasks don't persist.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } }
  );
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) return json({ error: "Not authenticated." }, 401);

  try {
    let userContent = "";
    if (task === "keyword_research") {
      if (input.length < 2) return json({ error: "Enter a seed keyword." }, 400);
      userContent = `Seed keyword: ${input}`;
    } else if (task === "onpage_score") {
      if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
      try {
        new URL(url);
      } catch {
        return json({ error: "Enter a valid page URL." }, 400);
      }
      const pageText = await fetchPageText(url);
      userContent = `Score this page for on-page SEO.\nURL: ${url}\n\nPage text:\n${pageText}`;
    } else {
      if (input.length < 2) return json({ error: "Enter a topic for the page." }, 400);
      userContent = `Topic: ${input}${keyword ? `\nPrimary keyword: ${keyword}` : ""}`;
    }

    const system =
      "You are an SEO specialist. Volumes and difficulty are RELATIVE ESTIMATES (no live keyword API). " +
      "Respond with ONLY a JSON object — no markdown fences, no preamble. Schema: " +
      SCHEMAS[task];

    const raw = await callClaude({ system, userContent, maxTokens: 2000 });
    const results = parseJsonBlock<Record<string, unknown>>(raw);
    return json({ task, results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "SEO task failed.";
    return json({ error: message }, 422);
  }
});
