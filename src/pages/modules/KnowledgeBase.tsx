import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Loader2,
  Upload,
  Trash2,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Film,
  File as FileIcon,
  Lock,
} from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { useAccountStore } from "@/stores/accountStore";
import {
  useKnowledgeBaseStore,
  type KbFile,
  type KbSection,
} from "@/stores/knowledgeBaseStore";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function FileTypeIcon({ type }: { type: string }) {
  if (["png", "jpg", "svg"].includes(type)) return <ImageIcon className="h-4 w-4" />;
  if (type === "mp4") return <Film className="h-4 w-4" />;
  if (["pdf", "docx", "txt"].includes(type)) return <FileText className="h-4 w-4" />;
  return <FileIcon className="h-4 w-4" />;
}

function ExtractionBadge({ status }: { status: KbFile["extraction_status"] }) {
  if (status === "not_applicable") return null;
  const styles: Record<string, string> = {
    pending: "bg-secondary text-secondary-foreground",
    done: "bg-accent text-accent-foreground",
    failed: "bg-destructive/10 text-destructive",
  };
  const labels: Record<string, string> = {
    pending: "Extracting…",
    done: "AI-readable",
    failed: "Extraction failed",
  };
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", styles[status])}>
      {labels[status]}
    </span>
  );
}

function SectionCard({ section }: { section: KbSection }) {
  const user = useAuthStore((s) => s.user);
  const account = useAccountStore((s) => s.account);
  const filesBySection = useKnowledgeBaseStore((s) => s.filesBySection);
  const upload = useKnowledgeBaseStore((s) => s.upload);
  const remove = useKnowledgeBaseStore((s) => s.remove);
  const signedUrl = useKnowledgeBaseStore((s) => s.signedUrl);

  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [sectionError, setSectionError] = useState<string | null>(null);

  const files = filesBySection[section.id] ?? [];
  const accept = section.accepted_types.map((t) => `.${t}`).join(",");

  async function handleFiles(list: FileList | null) {
    if (!list || !account || !user) return;
    setSectionError(null);
    setUploading(true);
    for (const file of Array.from(list)) {
      const err = await upload({ accountId: account.id, userId: user.id, section, file });
      if (err) {
        setSectionError(`${file.name}: ${err}`);
        break;
      }
    }
    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleOpen(file: KbFile) {
    const url = await signedUrl(file);
    if (url) window.open(url, "_blank", "noopener");
    else setSectionError("Couldn't generate a link for that file.");
  }

  async function handleDelete(file: KbFile) {
    setSectionError(null);
    const err = await remove(file);
    if (err) setSectionError(err);
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              {section.title}
              {!section.use_in_generation && (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                  title="Internal only — never used in public content generation"
                >
                  <Lock className="h-3 w-3" /> Internal
                </span>
              )}
            </CardTitle>
            <CardDescription className="mt-1">{section.description}</CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {uploading ? "Uploading…" : "Upload"}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            multiple
            className="hidden"
            onChange={(e) => void handleFiles(e.target.files)}
          />
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {files.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
            Nothing here yet. Accepts {section.accepted_types.join(", ").toUpperCase()}.
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {files.map((file) => (
              <li key={file.id} className="flex items-center gap-3 px-3 py-2.5">
                <span className="text-muted-foreground">
                  <FileTypeIcon type={file.file_type} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{file.file_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(file.file_size)} ·{" "}
                    {new Date(file.created_at).toLocaleDateString()}
                  </p>
                </div>
                <ExtractionBadge status={file.extraction_status} />
                <button
                  type="button"
                  onClick={() => void handleOpen(file)}
                  className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                  aria-label={`Open ${file.file_name}`}
                >
                  <ExternalLink className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(file)}
                  className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  aria-label={`Delete ${file.file_name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {sectionError && <p className="mt-2 text-sm text-destructive">{sectionError}</p>}
      </CardContent>
    </Card>
  );
}

export default function KnowledgeBase() {
  const account = useAccountStore((s) => s.account);
  const { sections, filesBySection, status, error, load } = useKnowledgeBaseStore();

  useEffect(() => {
    if (account) void load(account.id);
  }, [account, load]);

  const filledCount = sections.filter((s) => (filesBySection[s.id] ?? []).length > 0).length;
  const completeness =
    sections.length > 0 ? Math.round((filledCount / sections.length) * 100) : 0;

  if (status === "loading" || status === "idle") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="mx-auto max-w-3xl">
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Couldn't load the knowledge base: {error}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl pb-12">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <BookOpen className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Knowledge Base</h1>
            <p className="text-sm text-muted-foreground">
              Everything the AI knows about your business. The more you add, the sharper the
              content.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-2.5">
          <div className="h-2 w-28 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${completeness}%` }}
            />
          </div>
          <span className="whitespace-nowrap text-sm font-semibold tabular-nums">
            {filledCount}/{sections.length} filled
          </span>
        </div>
      </div>

      <div className="space-y-4">
        {sections.map((section) => (
          <SectionCard key={section.id} section={section} />
        ))}
      </div>
    </div>
  );
}
