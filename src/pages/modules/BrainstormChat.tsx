import { useEffect, useRef, useState } from "react";
import {
  MessagesSquare,
  Loader2,
  Send,
  Plus,
  Trash2,
  BookmarkPlus,
  Save,
  Check,
  PanelLeft,
} from "lucide-react";
import { streamEdgeFunction, supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/authStore";
import { useAccountStore } from "@/stores/accountStore";
import { useHandoffStore } from "@/stores/handoffStore";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface Session {
  id: string;
  title: string;
  messages_json: ChatMessage[];
  updated_at: string;
}

interface ParsedPiece {
  type: string;
  platform: string | null;
  title: string;
  body: string;
}

const MODES = [
  { value: "chat", label: "Chat" },
  { value: "multi_format", label: "Multi-format" },
  { value: "brain_dump", label: "Brain dump" },
] as const;

const VALID_TYPES = new Set([
  "caption", "linkedin_post", "email", "blog", "reel_script",
  "carousel", "story_frames", "thread", "sms",
]);
const VALID_PLATFORMS = new Set([
  "Instagram", "TikTok", "LinkedIn", "Facebook", "X", "Email", "Blog",
]);

const PIECE_RE = /===PIECE:\s*([^|=]+)\|([^|=]*)\|([^=]+)===\s*([\s\S]*?)===END===/g;

function parsePieces(content: string): ParsedPiece[] {
  const pieces: ParsedPiece[] = [];
  for (const m of content.matchAll(PIECE_RE)) {
    const type = m[1].trim().toLowerCase();
    const platform = m[2].trim();
    pieces.push({
      type: VALID_TYPES.has(type) ? type : "caption",
      platform: VALID_PLATFORMS.has(platform) ? platform : null,
      title: m[3].trim().slice(0, 140) || "Brainstorm piece",
      body: m[4].trim(),
    });
  }
  return pieces;
}

/** Renders assistant content with PIECE blocks visually separated. */
function renderSegments(content: string): { kind: "text" | "piece"; value: string; piece?: ParsedPiece }[] {
  const segments: { kind: "text" | "piece"; value: string; piece?: ParsedPiece }[] = [];
  let lastIndex = 0;
  for (const m of content.matchAll(PIECE_RE)) {
    if (m.index! > lastIndex) {
      const text = content.slice(lastIndex, m.index).trim();
      if (text) segments.push({ kind: "text", value: text });
    }
    const [piece] = parsePieces(m[0]);
    if (piece) segments.push({ kind: "piece", value: m[0], piece });
    lastIndex = m.index! + m[0].length;
  }
  const tail = content.slice(lastIndex).trim();
  if (tail) segments.push({ kind: "text", value: tail });
  return segments.length ? segments : [{ kind: "text", value: content }];
}

export default function BrainstormChat() {
  const user = useAuthStore((s) => s.user);
  const account = useAccountStore((s) => s.account);
  const takeHandoff = useHandoffStore((s) => s.take);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [mode, setMode] = useState<(typeof MODES)[number]["value"]>("chat");
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Handoffs into Brainstorm: the cross-module handoff store (Niche Research,
  // Website/Social Listener) takes precedence; the Prompt Library still uses
  // the legacy sessionStorage prefill (Phase 14).
  useEffect(() => {
    const p = takeHandoff("/brainstorm");
    if (p) {
      const seed = p.body || p.topic || "";
      if (seed) setInput(seed);
      if (p.body) setMode("brain_dump");
      sessionStorage.removeItem("brainstorm-prefill");
      return;
    }
    const prefill = sessionStorage.getItem("brainstorm-prefill");
    if (prefill) {
      setInput(prefill);
      sessionStorage.removeItem("brainstorm-prefill");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [takeHandoff]);

  useEffect(() => {
    if (!account) return;
    void supabase
      .from("brainstorm_sessions")
      .select("id, title, messages_json, updated_at")
      .eq("account_id", account.id)
      .order("updated_at", { ascending: false })
      .limit(30)
      .then(({ data, error: loadError }) => {
        if (loadError) setError(loadError.message);
        else setSessions((data ?? []) as Session[]);
      });
  }, [account]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streamText]);

  function newSession() {
    setSessionId(null);
    setMessages([]);
    setSavedKeys(new Set());
    setSidebarOpen(false);
  }

  function openSession(s: Session) {
    setSessionId(s.id);
    setMessages(s.messages_json);
    setSavedKeys(new Set());
    setSidebarOpen(false);
  }

  async function deleteSession(id: string) {
    await supabase.from("brainstorm_sessions").delete().eq("id", id);
    setSessions((arr) => arr.filter((s) => s.id !== id));
    if (sessionId === id) newSession();
  }

  async function persistSession(nextMessages: ChatMessage[]) {
    if (!account || !user) return;
    const title = nextMessages.find((m) => m.role === "user")?.content.slice(0, 60) ?? "New session";
    if (sessionId) {
      await supabase
        .from("brainstorm_sessions")
        .update({ messages_json: nextMessages, title })
        .eq("id", sessionId);
      setSessions((arr) =>
        arr.map((s) =>
          s.id === sessionId
            ? { ...s, messages_json: nextMessages, title, updated_at: new Date().toISOString() }
            : s
        )
      );
    } else {
      const { data } = await supabase
        .from("brainstorm_sessions")
        .insert({
          account_id: account.id,
          created_by: user.id,
          title,
          messages_json: nextMessages,
        })
        .select("id, title, messages_json, updated_at")
        .single();
      if (data) {
        setSessionId(data.id);
        setSessions((arr) => [data as Session, ...arr]);
      }
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    setError(null);
    setInput("");
    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setStreaming(true);
    setStreamText("");

    try {
      const full = await streamEdgeFunction(
        "brainstorm",
        { mode, messages: nextMessages },
        (_c, soFar) => setStreamText(soFar)
      );
      const finalMessages: ChatMessage[] = [...nextMessages, { role: "assistant", content: full }];
      setMessages(finalMessages);
      setStreamText("");
      await persistSession(finalMessages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chat failed.");
      setMessages(messages); // drop the unanswered user turn so retry is clean
      setInput(text);
    } finally {
      setStreaming(false);
    }
  }

  async function savePiece(piece: ParsedPiece, key: string) {
    if (!account || !user) return;
    const { error: insertError } = await supabase.from("content_pieces").insert({
      account_id: account.id,
      created_by: user.id,
      type: piece.type,
      platform: piece.platform,
      title: piece.title,
      body: piece.body,
      status: "draft",
    });
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setSavedKeys((s) => new Set(s).add(key));
  }

  async function saveWholeReply(content: string, key: string) {
    if (!account || !user) return;
    const { error: insertError } = await supabase.from("content_pieces").insert({
      account_id: account.id,
      created_by: user.id,
      type: "caption",
      platform: null,
      title: `Brainstorm — ${content.slice(0, 60)}`,
      body: content,
      status: "draft",
    });
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setSavedKeys((s) => new Set(s).add(key));
  }

  async function savePrompt(content: string, key: string) {
    if (!account || !user) return;
    const { error: insertError } = await supabase.from("prompt_library").insert({
      account_id: account.id,
      created_by: user.id,
      name: content.slice(0, 60),
      prompt_text: content,
      content_type: "Brainstorm",
    });
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setSavedKeys((s) => new Set(s).add(key));
  }

  return (
    <div className="-mx-4 -my-6 flex h-[calc(100vh-4rem)] lg:-mx-8">
      {/* ── Sessions panel ── */}
      <aside
        className={cn(
          "absolute inset-y-16 left-0 z-30 w-64 border-r bg-background transition-transform lg:static lg:inset-auto lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-full flex-col">
          <div className="border-b p-3">
            <Button type="button" size="sm" className="w-full" onClick={newSession}>
              <Plus className="h-4 w-4" />
              New session
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {sessions.length === 0 && (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                Past sessions show up here.
              </p>
            )}
            {sessions.map((s) => (
              <div
                key={s.id}
                className={cn(
                  "group mb-1 flex items-center gap-1 rounded-md px-2 py-2 text-sm transition-colors hover:bg-secondary",
                  sessionId === s.id && "bg-secondary"
                )}
              >
                <button
                  type="button"
                  onClick={() => openSession(s)}
                  className="min-w-0 flex-1 truncate text-left"
                >
                  {s.title}
                </button>
                <button
                  type="button"
                  onClick={() => void deleteSession(s.id)}
                  className="rounded p-1 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
                  aria-label="Delete session"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* ── Chat pane ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSidebarOpen((v) => !v)}
              className="rounded p-1.5 hover:bg-secondary lg:hidden"
              aria-label="Toggle sessions"
            >
              <PanelLeft className="h-5 w-5" />
            </button>
            <MessagesSquare className="h-5 w-5 text-primary" />
            <h1 className="text-base font-semibold">Brainstorm Chat</h1>
          </div>
          <div className="flex gap-1.5">
            {MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => setMode(m.value)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  mode === m.value
                    ? "border-primary bg-primary text-primary-foreground"
                    : "hover:bg-secondary"
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
          <div className="mx-auto max-w-2xl space-y-5">
            {messages.length === 0 && !streaming && (
              <div className="rounded-lg border border-dashed px-6 py-10 text-center">
                <p className="font-medium">This AI knows your whole business.</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                  Brand kit and knowledge base load automatically. Try Multi-format for 3–5
                  pieces from one prompt, or Brain dump to paste raw notes.
                </p>
              </div>
            )}

            {messages.map((msg, i) => {
              const key = `m${i}`;
              if (msg.role === "user") {
                return (
                  <div key={key} className="flex justify-end">
                    <div className="max-w-[85%]">
                      <div className="rounded-lg bg-primary px-3.5 py-2.5 text-sm text-primary-foreground">
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      </div>
                      <div className="mt-1 flex justify-end">
                        <button
                          type="button"
                          onClick={() => void savePrompt(msg.content, `${key}-prompt`)}
                          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary"
                        >
                          {savedKeys.has(`${key}-prompt`) ? (
                            <>
                              <Check className="h-3 w-3" /> Saved to prompts
                            </>
                          ) : (
                            <>
                              <BookmarkPlus className="h-3 w-3" /> Save prompt
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              }
              const segments = renderSegments(msg.content);
              const hasPieces = segments.some((s) => s.kind === "piece");
              return (
                <div key={key} className="flex justify-start">
                  <div className="w-full max-w-[92%] space-y-2">
                    {segments.map((seg, j) =>
                      seg.kind === "text" ? (
                        <div key={j} className="rounded-lg border bg-card px-3.5 py-2.5 text-sm">
                          <p className="whitespace-pre-wrap">{seg.value}</p>
                        </div>
                      ) : (
                        <div key={j} className="rounded-lg border border-primary/30 bg-accent/40 p-3">
                          <div className="mb-1.5 flex items-center justify-between gap-2">
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">
                              {seg.piece!.type.replace(/_/g, " ")}
                              {seg.piece!.platform ? ` · ${seg.piece!.platform}` : ""}
                            </p>
                            <button
                              type="button"
                              onClick={() => void savePiece(seg.piece!, `${key}-p${j}`)}
                              className="flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-[11px] font-medium hover:bg-secondary"
                            >
                              {savedKeys.has(`${key}-p${j}`) ? (
                                <>
                                  <Check className="h-3 w-3 text-primary" /> Saved
                                </>
                              ) : (
                                <>
                                  <Save className="h-3 w-3" /> Save to library
                                </>
                              )}
                            </button>
                          </div>
                          <p className="text-sm font-medium">{seg.piece!.title}</p>
                          <pre className="mt-1 whitespace-pre-wrap text-xs leading-relaxed">
                            {seg.piece!.body}
                          </pre>
                        </div>
                      )
                    )}
                    {!hasPieces && (
                      <button
                        type="button"
                        onClick={() => void saveWholeReply(msg.content, `${key}-whole`)}
                        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary"
                      >
                        {savedKeys.has(`${key}-whole`) ? (
                          <>
                            <Check className="h-3 w-3" /> Saved to library
                          </>
                        ) : (
                          <>
                            <Save className="h-3 w-3" /> Save reply to library
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {streaming && (
              <div className="flex justify-start">
                <div className="w-full max-w-[92%] rounded-lg border bg-card px-3.5 py-2.5 text-sm">
                  <p className="whitespace-pre-wrap">
                    {streamText}
                    <span className="animate-pulse">▍</span>
                  </p>
                </div>
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        </div>

        <div className="border-t p-3">
          <div className="mx-auto flex max-w-2xl items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={mode === "brain_dump" ? 5 : 2}
              placeholder={
                mode === "brain_dump"
                  ? "Paste raw notes or a transcript…"
                  : mode === "multi_format"
                    ? "One prompt in — 3 to 5 pieces out…"
                    : "What are we making today?"
              }
              className="text-sm"
              aria-label="Message"
            />
            <Button type="button" onClick={() => void send()} disabled={streaming || !input.trim()} className="shrink-0">
              {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
