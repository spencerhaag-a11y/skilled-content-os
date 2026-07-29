import { useState } from "react";
import { Loader2, Check, AlertTriangle, HardDrive } from "lucide-react";
import { invokeEdgeFunction, supabase } from "@/lib/supabase";
import { useAccountStore } from "@/stores/accountStore";
import { useAuthStore } from "@/stores/authStore";
import { sanitizeFileName } from "@/stores/knowledgeBaseStore";
import {
  downloadDriveFile,
  driveConfigError,
  isGoogleNativeFile,
  isImage,
  isVideo,
  openDrivePicker,
  requestDriveAccessToken,
  type DriveFile,
} from "@/lib/googleDrive";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ItemState = "pending" | "downloading" | "uploading" | "recording" | "done" | "error";

interface ImportItem {
  file: DriveFile;
  state: ItemState;
  error: string | null;
}

export interface DriveImportResult {
  /** Rows created in knowledge_base_files, newest first. */
  images: unknown[];
  /** Rows created in video_jobs, newest first. */
  videos: { id: string }[];
}

interface DrivePickerButtonProps {
  /**
   * Knowledge Base section that imported photos are filed under. Omit to
   * decline photos (the Video module has nowhere to put them).
   */
  imageSectionId?: string;
  /** Sub-category for sections that group files (e.g. Brand Assets). */
  imageCategoryKey?: string;
  /** Import videos into the Video module. Off by default. */
  allowVideos?: boolean;
  label?: string;
  variant?: "default" | "outline" | "ghost";
  size?: "sm" | "default";
  disabled?: boolean;
  /** Fired once per run, after every file has settled. */
  onImported?: (result: DriveImportResult) => void;
}

/**
 * Imports photos and videos from Google Drive.
 *
 * The browser does the work: it downloads the bytes from Drive and uploads
 * them straight to Supabase Storage, then drive-import records the row. That
 * keeps large videos away from the Edge Function's 150s wall clock, and means
 * no Google token is ever sent to the server.
 */
export default function DrivePickerButton({
  imageSectionId,
  imageCategoryKey,
  allowVideos = false,
  label = "Import from Drive",
  variant = "outline",
  size = "sm",
  disabled = false,
  onImported,
}: DrivePickerButtonProps) {
  const account = useAccountStore((s) => s.account);
  const user = useAuthStore((s) => s.user);

  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"connecting" | "picking" | "importing" | null>(null);
  const [items, setItems] = useState<ImportItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const configError = driveConfigError();

  function patch(id: string, patchItem: Partial<ImportItem>) {
    setItems((arr) => arr.map((it) => (it.file.id === id ? { ...it, ...patchItem } : it)));
  }

  /** Why a picked file can't be imported here, or null if it can. */
  function rejectionReason(file: DriveFile): string | null {
    if (isGoogleNativeFile(file.mimeType)) return "Google documents can't be imported.";
    if (isImage(file.mimeType)) {
      return imageSectionId ? null : "Photos can't be imported here.";
    }
    if (isVideo(file.mimeType)) {
      return allowVideos ? null : "Videos can't be imported here.";
    }
    return "Only photos and videos can be imported.";
  }

  async function importOne(token: string, file: DriveFile, accountId: string) {
    const image = isImage(file.mimeType);
    const bucket = image ? "knowledge-base" : "video-uploads";
    const folder = image ? "knowledge-base" : "video";
    const safeName = sanitizeFileName(file.name);
    const path = `${accountId}/${folder}/${Date.now()}_${safeName}`;

    patch(file.id, { state: "downloading" });
    const blob = await downloadDriveFile(token, file);

    patch(file.id, { state: "uploading" });
    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(path, blob, { contentType: file.mimeType || undefined, upsert: false });
    if (uploadError) throw new Error(uploadError.message);

    patch(file.id, { state: "recording" });
    try {
      const result = await invokeEdgeFunction<{ kind: string; row: Record<string, unknown> }>(
        "drive-import",
        {
          bucket,
          path,
          file_name: file.name,
          mime_type: file.mimeType,
          file_size: blob.size,
          drive_file_id: file.id,
          section_id: image ? imageSectionId : undefined,
          category_key: image ? imageCategoryKey : undefined,
        }
      );
      patch(file.id, { state: "done" });
      return result;
    } catch (err) {
      // The bytes are already in storage; without a row they'd be orphaned.
      await supabase.storage.from(bucket).remove([path]);
      throw err;
    }
  }

  async function run() {
    if (busy || !account || !user) return;
    setError(null);
    setItems([]);
    setBusy(true);

    try {
      setPhase("connecting");
      const token = await requestDriveAccessToken();

      setPhase("picking");
      const picked = await openDrivePicker(token);
      if (picked.length === 0) return;

      setPhase("importing");
      setItems(picked.map((file) => ({ file, state: "pending", error: null })));

      const images: unknown[] = [];
      const videos: { id: string }[] = [];

      // Sequential on purpose: parallel downloads of large videos compete for
      // bandwidth and make the per-file progress meaningless.
      for (const file of picked) {
        const reason = rejectionReason(file);
        if (reason) {
          patch(file.id, { state: "error", error: reason });
          continue;
        }
        try {
          const result = await importOne(token, file, account.id);
          if (result?.kind === "video_job") videos.push(result.row as { id: string });
          else images.push(result?.row);
        } catch (err) {
          patch(file.id, {
            state: "error",
            error: err instanceof Error ? err.message : "Import failed.",
          });
        }
      }

      onImported?.({ images, videos });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not import from Google Drive.");
    } finally {
      setBusy(false);
      setPhase(null);
    }
  }

  const phaseLabel =
    phase === "connecting"
      ? "Connecting to Google…"
      : phase === "picking"
        ? "Choose files…"
        : phase === "importing"
          ? "Importing…"
          : label;

  const settled = items.filter((it) => it.state === "done" || it.state === "error");
  const failed = items.filter((it) => it.state === "error");

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant={variant}
        size={size}
        onClick={() => void run()}
        disabled={disabled || busy || configError !== null}
        title={configError ?? undefined}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <HardDrive className="h-4 w-4" />}
        {phaseLabel}
      </Button>

      {configError && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {configError}
        </p>
      )}

      {error && (
        <p className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}

      {items.length > 0 && (
        <ul className="space-y-1">
          {items.map((it) => (
            <li
              key={it.file.id}
              className="flex items-start justify-between gap-2 rounded-md border px-2.5 py-1.5 text-xs"
            >
              <span className="min-w-0 flex-1 truncate" title={it.file.name}>
                {it.file.name}
              </span>
              <span
                className={cn(
                  "flex shrink-0 items-center gap-1",
                  it.state === "error" ? "text-destructive" : "text-muted-foreground",
                  it.state === "done" && "text-primary"
                )}
              >
                {it.state === "done" && <Check className="h-3.5 w-3.5" />}
                {it.state === "error" && <AlertTriangle className="h-3.5 w-3.5" />}
                {(it.state === "downloading" ||
                  it.state === "uploading" ||
                  it.state === "recording") && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {it.state === "pending" && "Queued"}
                {it.state === "downloading" && "Downloading"}
                {it.state === "uploading" && "Uploading"}
                {it.state === "recording" && "Saving"}
                {it.state === "done" && "Imported"}
                {it.state === "error" && (it.error ?? "Failed")}
              </span>
            </li>
          ))}
        </ul>
      )}

      {!busy && settled.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {settled.length - failed.length} of {items.length} imported
          {failed.length > 0 ? ` · ${failed.length} failed` : ""}.
        </p>
      )}
    </div>
  );
}
