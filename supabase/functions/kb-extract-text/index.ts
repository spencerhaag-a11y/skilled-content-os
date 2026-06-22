// Edge Function: kb-extract-text
// Module 2 — "On upload, text-extractable files (PDF, DOCX, TXT) are parsed
// and stored as searchable text in the database."
// Runs with the CALLER's JWT, so RLS guarantees a user can only trigger
// extraction on files inside their own account.
//
// Deploy: supabase functions deploy kb-extract-text

import { createClient } from "npm:@supabase/supabase-js@2";
import mammoth from "npm:mammoth@1.8.0";
import { extractText, getDocumentProxy } from "npm:unpdf@0.12.1";
import { corsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";

const MAX_EXTRACTED_CHARS = 100_000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function extract(fileName: string, blob: Blob): Promise<string> {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "txt") {
    return await blob.text();
  }
  if (ext === "pdf") {
    const buffer = new Uint8Array(await blob.arrayBuffer());
    const pdf = await getDocumentProxy(buffer);
    const { text } = await extractText(pdf, { mergePages: true });
    return typeof text === "string" ? text : (text as string[]).join("\n");
  }
  if (ext === "docx") {
    const arrayBuffer = await blob.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
  }
  throw new Error(`Unsupported extraction type: .${ext}`);
}

Deno.serve(async (req) => {
  const preflight = handleCorsPreflightIfNeeded(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let fileId: string;
  try {
    const body = await req.json();
    fileId = String(body.file_id ?? "");
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }
  if (!fileId) return json({ error: "file_id is required." }, 400);

  // Caller-scoped client: every query below is subject to the caller's RLS.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } }
  );

  const { data: file, error: fileError } = await supabase
    .from("knowledge_base_files")
    .select("id, file_url, file_name")
    .eq("id", fileId)
    .maybeSingle();

  if (fileError) return json({ error: fileError.message }, 500);
  if (!file) return json({ error: "File not found or not accessible." }, 404);

  try {
    const { data: blob, error: downloadError } = await supabase.storage
      .from("knowledge-base")
      .download(file.file_url);
    if (downloadError || !blob) {
      throw new Error(downloadError?.message ?? "Download failed.");
    }

    const raw = await extract(file.file_name, blob);
    const text = raw.replace(/\s+/g, " ").trim().slice(0, MAX_EXTRACTED_CHARS);

    const { error: updateError } = await supabase
      .from("knowledge_base_files")
      .update({ extracted_text: text, extraction_status: "done" })
      .eq("id", fileId);
    if (updateError) throw new Error(updateError.message);

    return json({ file_id: fileId, status: "done", characters: text.length });
  } catch (err) {
    await supabase
      .from("knowledge_base_files")
      .update({ extraction_status: "failed" })
      .eq("id", fileId);
    const message = err instanceof Error ? err.message : "Extraction failed.";
    return json({ file_id: fileId, status: "failed", error: message }, 422);
  }
});
