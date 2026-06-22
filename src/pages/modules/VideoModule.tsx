import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Video,
  Loader2,
  UploadCloud,
  Recycle,
  Download,
  Scissors,
  Sparkles,
  AlertTriangle,
  FileText,
  Clock,
} from "lucide-react";
import { invokeEdgeFunction, supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/authStore";
import { useAccountStore } from "@/stores/accountStore";
import { useHandoffStore } from "@/stores/handoffStore";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2GB (Section 5)
const ACCEPT = ["video/mp4", "video/quicktime"];
const POLL_MS = 5000;

interface EditMarker {
  kind: "filler" | "dead_air" | "highlight" | "cut";
  label: string;
  start: number;
  end: number;
  note: string;
}
interface Clip {
  title: string;
  start: number;
  end: number;
  why: string;
}
type VideoStatus = "uploaded" | "transcribing" | "analyzing" | "done" | "failed";

interface VideoJob {
  id: string;
  file_name: string;
  status: VideoStatus;
  transcript: string | null;
  srt: string | null;
  vtt: string | null;
  edit_markers: EditMarker[];
  clip_suggestions: Clip[];
  duration_seconds: number | null;
  error_detail: string | null;
  created_at: string;
}

const JOB_COLUMNS =
  "id, file_name, status, transcript, srt, vtt, edit_markers, clip_suggestions, duration_seconds, error_detail, created_at";

// Statuses where the webhook may still update the row, so the UI keeps polling.
const PROCESSING: VideoStatus[] = ["transcribing", "analyzing"];

function fmtTime(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}
function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
}
function download(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const MARKER_STYLE: Record<EditMarker["kind"], string> = {
  filler: "bg-amber-100 text-amber-800",
  dead_air: "bg-amber-100 text-amber-800",
  highlight: "bg-accent text-accent-foreground",
  cut: "bg-destructive/10 text-destructive",
};

export default function VideoModule() {
  const user = useAuthStore((s) => s.user);
  const account = useAccountStore((s) => s.account);
  const send = useHandoffStore((s) => s.send);
  const navigate = useNavigate();

  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const selected = jobs.find((j) => j.id === selectedId) ?? null;
  const anyProcessing = jobs.some((j) => PROCESSING.includes(j.status));

  async function loadJobs() {
    if (!account) return;
    const { data } = await supabase
      .from("video_jobs")
      .select(JOB_COLUMNS)
      .eq("account_id", account.id)
      .order("created_at", { ascending: false })
      .limit(25);
    setJobs((data ?? []) as VideoJob[]);
  }

  useEffect(() => {
    void loadJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);

  // Poll while anything is still processing (the webhook updates the row).
  useEffect(() => {
    if (!anyProcessing) return;
    const t = setInterval(() => void loadJobs(), POLL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyProcessing, account]);

  async function handleFile(file: File) {
    setError(null);
    if (!ACCEPT.includes(file.type) && !/\.(mp4|mov)$/i.test(file.name)) {
      setError("Upload an MP4 or MOV file.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("File exceeds the 2GB limit.");
      return;
    }
    if (!account || !user) return;

    setUploading(true);
    setUploadPct(0);
    try {
      const path = `${account.id}/video/${Date.now()}_${sanitize(file.name)}`;
      const { error: uploadError } = await supabase.storage
        .from("video-uploads")
        .upload(path, file, { contentType: file.type || "video/mp4", upsert: false });
      if (uploadError) throw new Error(uploadError.message);
      setUploadPct(100);

      const { data: job, error: insertError } = await supabase
        .from("video_jobs")
        .insert({
          account_id: account.id,
          created_by: user.id,
          file_path: path,
          file_name: file.name,
          file_size: file.size,
          status: "uploaded",
        })
        .select(JOB_COLUMNS)
        .single();
      if (insertError) throw new Error(insertError.message);

      setJobs((j) => [job as VideoJob, ...j]);
      setSelectedId(job.id);

      // Kick off transcription.
      await invokeEdgeFunction("video-transcribe", { video_job_id: job.id });
      await loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  function repurpose(job: VideoJob) {
    if (!job.transcript) return;
    send({
      target: "/repurpose",
      body: job.transcript,
      format: "video_transcript",
      source: "Video Module",
    });
    navigate("/repurpose");
  }

  return (
    <div className="mx-auto max-w-3xl pb-12">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Video className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Video</h1>
          <p className="text-sm text-muted-foreground">
            Upload footage for transcripts, edit markers, captions, clip picks, and one-click repurposing.
          </p>
        </div>
      </div>

      {/* Upload */}
      <Card>
        <CardContent className="py-6">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed border-input py-10 transition-colors hover:border-primary hover:bg-secondary/40 disabled:opacity-60"
          >
            {uploading ? (
              <>
                <Loader2 className="h-7 w-7 animate-spin text-primary" />
                <p className="text-sm font-medium">Uploading… {uploadPct}%</p>
              </>
            ) : (
              <>
                <UploadCloud className="h-7 w-7 text-muted-foreground" />
                <p className="text-sm font-medium">Click to upload MP4 or MOV</p>
                <p className="text-xs text-muted-foreground">Up to 2GB · 4K supported</p>
              </>
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="video/mp4,video/quicktime,.mp4,.mov"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              e.target.value = "";
            }}
          />
          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      {/* Job list */}
      {jobs.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-2">
          {jobs.map((j) => (
            <button
              key={j.id}
              type="button"
              onClick={() => setSelectedId(j.id)}
              className={cn(
                "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors hover:bg-secondary",
                selectedId === j.id && "border-primary bg-secondary"
              )}
            >
              {PROCESSING.includes(j.status) && <Loader2 className="h-3 w-3 animate-spin" />}
              {j.status === "failed" && <AlertTriangle className="h-3 w-3 text-destructive" />}
              <span className="max-w-[160px] truncate">{j.file_name}</span>
            </button>
          ))}
        </div>
      )}

      {/* Selected job detail */}
      {selected && (
        <div className="mt-6 space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">{selected.file_name}</CardTitle>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-xs font-medium",
                    selected.status === "done"
                      ? "bg-accent text-accent-foreground"
                      : selected.status === "failed"
                        ? "bg-destructive/10 text-destructive"
                        : "bg-amber-100 text-amber-800"
                  )}
                >
                  {selected.status === "transcribing"
                    ? "Transcribing…"
                    : selected.status === "analyzing"
                      ? "Analyzing…"
                      : selected.status === "done"
                        ? "Ready"
                        : selected.status === "failed"
                          ? "Failed"
                          : "Uploaded"}
                </span>
              </div>
              {selected.duration_seconds ? (
                <CardDescription className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" /> {fmtTime(selected.duration_seconds)}
                </CardDescription>
              ) : null}
            </CardHeader>

            <CardContent className="space-y-4">
              {PROCESSING.includes(selected.status) && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  AssemblyAI is processing this video. The page updates automatically when it's done.
                </p>
              )}
              {selected.status === "failed" && (
                <p className="text-sm text-destructive">{selected.error_detail ?? "Transcription failed."}</p>
              )}

              {selected.status === "done" && (
                <>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" onClick={() => repurpose(selected)}>
                      <Recycle className="h-4 w-4" /> Repurpose transcript
                    </Button>
                    {selected.srt && (
                      <Button type="button" variant="outline" size="sm" onClick={() => download(`${sanitize(selected.file_name)}.srt`, selected.srt!)}>
                        <Download className="h-4 w-4" /> SRT
                      </Button>
                    )}
                    {selected.vtt && (
                      <Button type="button" variant="outline" size="sm" onClick={() => download(`${sanitize(selected.file_name)}.vtt`, selected.vtt!)}>
                        <Download className="h-4 w-4" /> VTT
                      </Button>
                    )}
                  </div>

                  {/* Clips */}
                  {selected.clip_suggestions.length > 0 && (
                    <div>
                      <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                        <Scissors className="h-4 w-4 text-primary" /> Suggested clips
                      </p>
                      <div className="space-y-2">
                        {selected.clip_suggestions.map((c, i) => (
                          <div key={i} className="rounded-md border p-2.5 text-sm">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium">{c.title}</span>
                              <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[11px] tabular-nums">
                                {fmtTime(c.start)}–{fmtTime(c.end)}
                              </span>
                            </div>
                            {c.why && <p className="mt-0.5 text-muted-foreground">{c.why}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Edit markers */}
                  {selected.edit_markers.length > 0 && (
                    <div>
                      <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                        <Sparkles className="h-4 w-4 text-primary" /> Edit markers
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {selected.edit_markers.map((m, i) => (
                          <span
                            key={i}
                            title={m.note}
                            className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", MARKER_STYLE[m.kind])}
                          >
                            {fmtTime(m.start)} · {m.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Transcript */}
                  {selected.transcript && (
                    <div>
                      <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                        <FileText className="h-4 w-4 text-primary" /> Transcript
                      </p>
                      <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-md bg-secondary/40 p-3 text-xs leading-relaxed">
                        {selected.transcript}
                      </pre>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
