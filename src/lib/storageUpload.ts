/**
 * Uploads to Supabase Storage, resumable for anything large.
 *
 * supabase.storage.upload() is a single PUT: the whole file has to survive one
 * request, there is no progress short of "started/finished", and a dropped
 * connection restarts from zero. That is survivable for a logo and not for a
 * 4K drone clip, so anything past RESUMABLE_THRESHOLD_BYTES goes over TUS
 * instead, which chunks the file and can resume.
 *
 * Note this has never been about the Edge Function's 150s wall clock — bytes
 * go browser → storage directly and no function sees them. TUS buys reliability
 * and progress on large files, not headroom against that limit.
 */
import * as tus from "tus-js-client";
import { supabase, supabaseUrl } from "@/lib/supabase";

/**
 * Supabase requires exactly 6MB chunks on its TUS endpoint. Not tunable.
 * https://supabase.com/docs/guides/storage/uploads/resumable-uploads
 */
const TUS_CHUNK_BYTES = 6 * 1024 * 1024;

/** Below this a single request is faster than TUS's create + patch round trips. */
const RESUMABLE_THRESHOLD_BYTES = 6 * 1024 * 1024;

/** Backoff between chunk retries, in ms. Empty array would fail on one blip. */
const RETRY_DELAYS = [0, 3000, 5000, 10000, 20000];

export interface UploadOptions {
  bucket: string;
  path: string;
  data: Blob | File;
  contentType?: string;
  /** Fraction complete, 0–1. Only meaningful on the resumable path. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/** True when this upload will take the chunked path. */
export function willUseResumable(sizeBytes: number): boolean {
  return sizeBytes > RESUMABLE_THRESHOLD_BYTES;
}

async function uploadResumable(opts: UploadOptions): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error("Not authenticated.");

  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(opts.data, {
      endpoint: `${supabaseUrl}/storage/v1/upload/resumable`,
      headers: { authorization: `Bearer ${accessToken}` },
      chunkSize: TUS_CHUNK_BYTES,
      retryDelays: RETRY_DELAYS,
      // Sends the first chunk with the create request, saving a round trip.
      uploadDataDuringCreation: true,
      // Without this a retried upload of the same file resumes a stale URL.
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: opts.bucket,
        objectName: opts.path,
        contentType: opts.contentType || "application/octet-stream",
        cacheControl: "3600",
      },
      onError: (err) => reject(err instanceof Error ? err : new Error(String(err))),
      onProgress: (sent, total) => {
        if (total > 0) opts.onProgress?.(sent / total);
      },
      onSuccess: () => resolve(),
    });

    opts.signal?.addEventListener("abort", () => {
      void upload.abort();
      reject(new Error("Upload cancelled."));
    });

    upload.start();
  });
}

async function uploadSingleRequest(opts: UploadOptions): Promise<void> {
  const { error } = await supabase.storage
    .from(opts.bucket)
    .upload(opts.path, opts.data, {
      contentType: opts.contentType || undefined,
      upsert: false,
    });
  if (error) throw new Error(error.message);
  opts.onProgress?.(1);
}

/**
 * Uploads to storage, picking the resumable path for large files. Rejects with
 * a plain Error on failure either way.
 */
export async function uploadToStorage(opts: UploadOptions): Promise<void> {
  opts.onProgress?.(0);
  if (willUseResumable(opts.data.size)) {
    await uploadResumable(opts);
    return;
  }
  await uploadSingleRequest(opts);
}
