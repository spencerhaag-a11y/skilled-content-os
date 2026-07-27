// Shared Claude API helper for all Edge Functions (Section 3: Claude API
// claude-sonnet-4-6, keys only in Edge Functions).

export const CLAUDE_MODEL = "claude-sonnet-4-6";

export async function callClaude(opts: {
  system: string;
  userContent: string;
  maxTokens: number;
}): Promise<string> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured.");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: opts.maxTokens,
      system: opts.system,
      messages: [{ role: "user", content: opts.userContent }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Claude API error ${res.status}: ${detail.slice(0, 300)}`);
  }

  const data = await res.json();
  return (data.content ?? [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("\n");
}

/** Text blocks only — server-tool blocks (search calls/results) are dropped. */
function textOf(content: { type: string; text?: string }[]): string {
  return (content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("\n");
}

/**
 * Claude call with the server-side web_search tool enabled (Module: trend
 * matching). Separate from callClaude so existing generation functions keep
 * their tool-free request shape.
 *
 * Web search runs on Anthropic's side: it returns search/result blocks inline
 * and the model's own text alongside them. Its server-side loop pauses after
 * a bounded number of iterations with stop_reason "pause_turn" — resuming is
 * just re-sending the accumulated turn.
 *
 * Budgeting matters here: Supabase terminates an Edge Function at 150s wall
 * clock (status 546), and a single search round trip can take 30-60s. So the
 * search count, the resume count, and a hard deadline are all capped well
 * inside that limit — better a fast, honest failure than a platform kill,
 * which surfaces to the client as an opaque non-2xx.
 */
const WEB_SEARCH_DEADLINE_MS = 90_000;
const WEB_SEARCH_MAX_RESUMES = 1;

export async function callClaudeWithWebSearch(opts: {
  system: string;
  userContent: string;
  maxTokens: number;
  maxSearches?: number;
  deadlineMs?: number;
}): Promise<string> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured.");

  const startedAt = Date.now();
  const deadlineMs = opts.deadlineMs ?? WEB_SEARCH_DEADLINE_MS;
  const messages: { role: string; content: unknown }[] = [
    { role: "user", content: opts.userContent },
  ];
  const collected: string[] = [];

  for (let attempt = 0; attempt <= WEB_SEARCH_MAX_RESUMES; attempt++) {
    const remaining = deadlineMs - (Date.now() - startedAt);
    if (remaining <= 5_000) break;

    // Abort the individual call too, so one slow request can't consume the
    // whole budget and leave nothing for a graceful return.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    let data: { content?: { type: string; text?: string }[]; stop_reason?: string };
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: CLAUDE_MODEL,
          max_tokens: opts.maxTokens,
          system: opts.system,
          messages,
          tools: [
            {
              // Basic web search, deliberately not web_search_20260209: the
              // newer variant runs dynamic filtering (code execution) under
              // the hood, which measured >90s per call here and blew the
              // Edge Function budget. The basic tool returns plain results
              // and is fast enough to fit; we only need two queries.
              type: "web_search_20250305",
              name: "web_search",
              max_uses: opts.maxSearches ?? 2,
            },
          ],
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const detail = await res.text();
        throw new Error(`Claude API error ${res.status}: ${detail.slice(0, 300)}`);
      }
      data = await res.json();
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") break;
      throw err;
    } finally {
      clearTimeout(timer);
    }

    const text = textOf(data.content ?? []);
    if (text) collected.push(text);

    if (data.stop_reason !== "pause_turn") {
      // The concluding turn carries the JSON; fall back to everything the
      // model said if that turn was pure tool traffic.
      return text.includes("{") ? text : collected.join("\n");
    }
    messages.push({ role: "assistant", content: data.content });
  }

  // Out of budget. Anything already synthesised is still worth parsing.
  const salvaged = collected.join("\n");
  if (salvaged.includes("{")) return salvaged;
  throw new Error("Trend search timed out before returning formats. Try again.");
}

/**
 * Defensive JSON extraction: strips markdown fences, then parses the first
 * balanced top-level JSON object in the text.
 */
export function parseJsonBlock<T>(text: string): T {
  const cleaned = text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf("{");
    if (start === -1) throw new Error("Model response contained no JSON object.");
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          return JSON.parse(cleaned.slice(start, i + 1)) as T;
        }
      }
    }
    throw new Error("Model response contained malformed JSON.");
  }
}
