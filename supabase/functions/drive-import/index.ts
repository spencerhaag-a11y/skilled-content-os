// Edge Function: drive-import
// Records a file the browser has already imported from Google Drive.
//
// The client downloads the bytes from Drive and uploads them straight to
// Supabase Storage, so this function never touches Google and never streams a
// file — which is what keeps large videos clear of the 150s wall clock. Its job
// is to validate that the object really landed in the caller's own folder and
// then create the right row: photos become knowledge_base_files, videos become
// video_jobs.
//
// Deploy: supabase functions deploy drive-import

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";

const BUCKETS = {
  "knowledge-base": "image",
  "video-uploads": "video",
} as const;

type Bucket = keyof typeof BUCKETS;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Mirrors EXT_ALIASES in knowledgeBaseStore.ts. A section listing "jpg" means
// the JPEG format, and Drive hands back .jpeg far more often than .jpg, so
// without this every photo import fails the accepted_types gate below.
const EXT_ALIASES: Record<string, string> = { jpeg: "jpg" };

function fileExt(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function normalizeExt(name: string): string {
  const ext = fileExt(name);
  return EXT_ALIASES[ext] ?? ext;
}

Deno.serve(async (req) => {
  const preflight = handleCorsPreflightIfNeeded(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let bucket = "";
  let path = "";
  let fileName = "";
  let mimeType = "";
  let fileSize = 0;
  let sectionId = "";
  try {
    const body = await req.json();
    bucket = String(body.bucket ?? "").trim();
    path = String(body.path ?? "").trim();
    fileName = String(body.file_name ?? "").trim().slice(0, 300);
    mimeType = String(body.mime_type ?? "").trim().toLowerCase();
    fileSize = Number(body.file_size ?? 0) || 0;
    sectionId = String(body.section_id ?? "").trim();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  if (!(bucket in BUCKETS)) return json({ error: "Unknown destination bucket." }, 400);
  if (!path || !fileName) return json({ error: "A storage path and file name are required." }, 400);

  const isImage = mimeType.startsWith("image/");
  const isVideo = mimeType.startsWith("video/");
  if (!isImage && !isVideo) return json({ error: "Only photos and videos can be imported." }, 400);

  // The bucket has to match what the file actually is, or the row would point
  // into the wrong storage policy.
  const expected = BUCKETS[bucket as Bucket];
  if ((isImage && expected !== "image") || (isVideo && expected !== "video")) {
    return json({ error: "This file type does not belong in that bucket." }, 400);
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

  // Storage paths are {account_id}/{module}/{file}. Anchoring on the account
  // prefix stops a caller recording a row against another account's object.
  if (!path.startsWith(`${accountId}/`)) {
    return json({ error: "That storage path does not belong to this account." }, 403);
  }

  try {
    // Confirm the upload actually landed before writing a row that claims it did.
    const lastSlash = path.lastIndexOf("/");
    const dir = path.slice(0, lastSlash);
    const objectName = path.slice(lastSlash + 1);
    const { data: listed, error: listError } = await supabase.storage
      .from(bucket)
      .list(dir, { limit: 100, search: objectName });
    if (listError) throw new Error(listError.message);
    if (!(listed ?? []).some((o: { name: string }) => o.name === objectName)) {
      return json({ error: "No uploaded file was found at that path." }, 404);
    }

    if (isVideo) {
      const { data: job, error: insertError } = await supabase
        .from("video_jobs")
        .insert({
          account_id: accountId,
          created_by: userId,
          file_path: path,
          file_name: fileName,
          file_size: fileSize,
          title: fileName.replace(/\.[^.]+$/, "") || "Untitled video",
          status: "uploaded",
        })
        .select("id, title, file_path, file_name, file_size, status, created_at")
        .single();
      if (insertError) throw new Error(insertError.message);
      return json({ kind: "video_job", row: job });
    }

    // Photos are filed against a Knowledge Base section.
    if (!sectionId) return json({ error: "A Knowledge Base section is required for photos." }, 400);
    const { data: section } = await supabase
      .from("knowledge_base_sections")
      .select("id, accepted_types")
      .eq("id", sectionId)
      .eq("account_id", accountId)
      .maybeSingle();
    if (!section) return json({ error: "That Knowledge Base section was not found." }, 404);

    // Same gate the direct upload applies, so a Drive import can't slip a type
    // past a section's rules.
    const ext = normalizeExt(fileName);
    const accepted: string[] = section.accepted_types ?? [];
    if (accepted.length > 0 && !accepted.includes(ext)) {
      return json(
        { error: `This section accepts: ${accepted.join(", ").toUpperCase()}.` },
        400
      );
    }

    const { data: row, error: insertError } = await supabase
      .from("knowledge_base_files")
      .insert({
        account_id: accountId,
        section_id: sectionId,
        file_url: path,
        file_name: fileName,
        file_type: ext,
        file_size: fileSize,
        // Images carry no extractable text — same rule the direct upload uses.
        extraction_status: "not_applicable",
        created_by: userId,
      })
      .select(
        "id, section_id, file_url, file_name, file_type, file_size, extraction_status, slot_key, category_key, created_at"
      )
      .single();
    if (insertError) throw new Error(insertError.message);

    return json({ kind: "kb_file", row });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Import failed.";
    return json({ error: message }, 500);
  }
});
