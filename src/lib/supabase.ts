import { createClient } from "@supabase/supabase-js";

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase environment variables. Copy .env.example to .env.local and set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

/**
 * Invokes a Supabase Edge Function with the current user's JWT attached.
 * All external API calls (Claude, GHL, AssemblyAI) go through Edge Functions —
 * keys never reach the browser (Section 3, Security Requirements).
 */
/**
 * supabase-js collapses every non-2xx into the same "non-2xx status code"
 * message and leaves the actual response on error.context, so a function's own
 * error text never reaches the caller. This digs it back out — without it a
 * validation failure is indistinguishable from an outage in the UI.
 */
async function edgeFunctionErrorDetail(error: unknown): Promise<string | null> {
  const context = (error as { context?: unknown })?.context;
  if (!(context instanceof Response)) return null;
  try {
    const body = await context.clone().json();
    const message = (body as { error?: unknown; message?: unknown })?.error ??
      (body as { message?: unknown })?.message;
    return typeof message === "string" && message.trim() ? message : null;
  } catch {
    return null;
  }
}

export async function invokeEdgeFunction<TResponse>(
  name: string,
  body: Record<string, unknown>
): Promise<TResponse> {
  const { data, error } = await supabase.functions.invoke<TResponse>(name, { body });
  if (error) {
    const detail = await edgeFunctionErrorDetail(error);
    throw new Error(`${name} failed: ${detail ?? error.message}`);
  }
  if (data === null) throw new Error(`${name} returned no data`);
  return data;
}

/**
 * Invokes a streaming Edge Function (plain text-delta stream) and feeds
 * chunks to onChunk as they arrive. supabase.functions.invoke buffers the
 * full response, so streaming goes through fetch directly with the
 * session JWT attached. Returns the complete accumulated text.
 */
export async function streamEdgeFunction(
  name: string,
  body: Record<string, unknown>,
  onChunk: (text: string, fullSoFar: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error("Not authenticated.");

  const res = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: supabaseAnonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    let message = `${name} failed with status ${res.status}`;
    try {
      const errBody = await res.json();
      if (errBody?.error) message = errBody.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message);
  }
  if (!res.body) throw new Error(`${name} returned no stream.`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    if (text) {
      full += text;
      onChunk(text, full);
    }
  }
  return full;
}
