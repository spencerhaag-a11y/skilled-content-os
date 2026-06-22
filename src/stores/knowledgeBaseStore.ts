import { create } from "zustand";
import { supabase, invokeEdgeFunction } from "@/lib/supabase";

export interface KbSection {
  id: string;
  section_type: string;
  title: string;
  description: string;
  sort_order: number;
  accepted_types: string[];
  use_in_generation: boolean;
}

export interface KbFile {
  id: string;
  section_id: string;
  file_url: string; // storage object path
  file_name: string;
  file_type: string;
  file_size: number;
  extraction_status: "pending" | "done" | "failed" | "not_applicable";
  created_at: string;
}

const EXTRACTABLE = new Set(["pdf", "docx", "txt"]);
const TYPE_TO_MIME: Record<string, string[]> = {
  pdf: ["application/pdf"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  png: ["image/png"],
  jpg: ["image/jpeg"],
  svg: ["image/svg+xml"],
  mp4: ["video/mp4", "video/quicktime"],
  txt: ["text/plain"],
};
const MAX_DOC_BYTES = 50 * 1024 * 1024; // Section 5: 50MB documents
const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024; // Section 5: 2GB video

type Status = "idle" | "loading" | "ready" | "error";

interface KnowledgeBaseState {
  sections: KbSection[];
  filesBySection: Record<string, KbFile[]>;
  status: Status;
  error: string | null;
  /** file ids currently uploading or extracting */
  busyFileNames: string[];
  load: (accountId: string) => Promise<void>;
  upload: (args: {
    accountId: string;
    userId: string;
    section: KbSection;
    file: File;
  }) => Promise<string | null>; // returns error message or null on success
  remove: (file: KbFile) => Promise<string | null>;
  signedUrl: (file: KbFile) => Promise<string | null>;
}

export function fileExt(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function sanitizeFileName(name: string): string {
  const ext = fileExt(name);
  const base = name.replace(/\.[^.]+$/, "");
  const clean = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return `${clean || "file"}.${ext}`;
}

export function validateFile(file: File, acceptedTypes: string[]): string | null {
  const ext = fileExt(file.name);
  if (!acceptedTypes.includes(ext)) {
    return `This section accepts: ${acceptedTypes.join(", ").toUpperCase()}.`;
  }
  const mimes = TYPE_TO_MIME[ext] ?? [];
  if (file.type && mimes.length > 0 && !mimes.includes(file.type)) {
    return "File contents don't match the file extension.";
  }
  const limit = ext === "mp4" ? MAX_VIDEO_BYTES : MAX_DOC_BYTES;
  if (file.size > limit) {
    return `Max size is ${ext === "mp4" ? "2GB" : "50MB"} for this file type.`;
  }
  return null;
}

export const useKnowledgeBaseStore = create<KnowledgeBaseState>((set, get) => ({
  sections: [],
  filesBySection: {},
  status: "idle",
  error: null,
  busyFileNames: [],

  load: async (accountId) => {
    set({ status: "loading", error: null });
    const [sectionsRes, filesRes] = await Promise.all([
      supabase
        .from("knowledge_base_sections")
        .select("id, section_type, title, description, sort_order, accepted_types, use_in_generation")
        .eq("account_id", accountId)
        .order("sort_order"),
      supabase
        .from("knowledge_base_files")
        .select("id, section_id, file_url, file_name, file_type, file_size, extraction_status, created_at")
        .eq("account_id", accountId)
        .order("created_at", { ascending: false }),
    ]);
    if (sectionsRes.error || filesRes.error) {
      set({ status: "error", error: (sectionsRes.error ?? filesRes.error)!.message });
      return;
    }
    const filesBySection: Record<string, KbFile[]> = {};
    for (const f of (filesRes.data ?? []) as KbFile[]) {
      (filesBySection[f.section_id] ??= []).push(f);
    }
    set({ sections: sectionsRes.data ?? [], filesBySection, status: "ready" });
  },

  upload: async ({ accountId, userId, section, file }) => {
    const validationError = validateFile(file, section.accepted_types);
    if (validationError) return validationError;

    const safeName = sanitizeFileName(file.name);
    // Section 5 naming: {account_id}/{module}/{timestamp}_{sanitized_filename}
    const path = `${accountId}/knowledge-base/${Date.now()}_${safeName}`;
    set((s) => ({ busyFileNames: [...s.busyFileNames, file.name] }));

    try {
      const { error: uploadError } = await supabase.storage
        .from("knowledge-base")
        .upload(path, file, { contentType: file.type || undefined, upsert: false });
      if (uploadError) return uploadError.message;

      const ext = fileExt(file.name);
      const extractable = EXTRACTABLE.has(ext);

      const { data: row, error: insertError } = await supabase
        .from("knowledge_base_files")
        .insert({
          account_id: accountId,
          section_id: section.id,
          file_url: path,
          file_name: file.name,
          file_type: ext,
          file_size: file.size,
          extraction_status: extractable ? "pending" : "not_applicable",
          created_by: userId,
        })
        .select("id, section_id, file_url, file_name, file_type, file_size, extraction_status, created_at")
        .single();
      if (insertError) {
        await supabase.storage.from("knowledge-base").remove([path]);
        return insertError.message;
      }

      set((s) => ({
        filesBySection: {
          ...s.filesBySection,
          [section.id]: [row as KbFile, ...(s.filesBySection[section.id] ?? [])],
        },
      }));

      if (extractable) {
        try {
          await invokeEdgeFunction("kb-extract-text", { file_id: row.id });
          set((s) => ({
            filesBySection: {
              ...s.filesBySection,
              [section.id]: (s.filesBySection[section.id] ?? []).map((f) =>
                f.id === row.id ? { ...f, extraction_status: "done" } : f
              ),
            },
          }));
        } catch {
          set((s) => ({
            filesBySection: {
              ...s.filesBySection,
              [section.id]: (s.filesBySection[section.id] ?? []).map((f) =>
                f.id === row.id ? { ...f, extraction_status: "failed" } : f
              ),
            },
          }));
        }
      }
      return null;
    } finally {
      set((s) => ({ busyFileNames: s.busyFileNames.filter((n) => n !== file.name) }));
    }
  },

  remove: async (file) => {
    const { error: dbError } = await supabase
      .from("knowledge_base_files")
      .delete()
      .eq("id", file.id);
    if (dbError) return dbError.message;
    // Storage cleanup is best-effort; an orphaned object is harmless.
    await supabase.storage.from("knowledge-base").remove([file.file_url]);
    set((s) => ({
      filesBySection: {
        ...s.filesBySection,
        [file.section_id]: (s.filesBySection[file.section_id] ?? []).filter(
          (f) => f.id !== file.id
        ),
      },
    }));
    return null;
  },

  signedUrl: async (file) => {
    const { data, error } = await supabase.storage
      .from("knowledge-base")
      .createSignedUrl(file.file_url, 3600);
    if (error || !data) return null;
    return data.signedUrl;
  },

  get busy() {
    return get().busyFileNames.length > 0;
  },
}));
