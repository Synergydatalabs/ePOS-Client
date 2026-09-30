// Floating chat button + slide-in drawer, mounted globally in merchant
// dashboard and supplier portal layouts. One shared component — the API
// side (getSupportSession) figures out who's asking.
//
// Phase 3b.1 shipped the message flow. Phase 3b.2 adds:
//   • unread badge on the button + per-thread dot in the list
//   • attachment upload in composer, download chips in bubbles
//   • auto-mark-read on thread open
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import {
  SUPPORT_STATUS_LABELS,
  type SupportThreadStatusValue,
} from "@/lib/support/constants";
import {
  humanFileSize,
  uploadSupportAttachment,
  type UploadedAttachment,
} from "@/lib/support/upload-attachment";

interface ThreadListRow {
  id: string;
  subject: string;
  status: SupportThreadStatusValue;
  merchantTenantId: string | null;
  supplierTenantId: string | null;
  createdByType: string;
  createdByName: string | null;
  lastMessageAt: string;
  createdAt: string;
  _count: { messages: number };
}

interface AttachmentView {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  downloadUrl: string;
}

interface Message {
  id: string;
  threadId: string;
  senderType: string;
  senderId: string | null;
  senderName: string | null;
  body: string;
  internalNote: boolean;
  createdAt: string;
  attachments?: AttachmentView[];
}

interface ThreadDetail extends ThreadListRow {
  closedAt: string | null;
  messages: Message[];
}

const STATUS_STYLES: Record<
  SupportThreadStatusValue,
  { bg: string; text: string }
> = {
  OPEN: { bg: "bg-blue-100", text: "text-blue-800" },
  WAITING_MERCHANT: { bg: "bg-amber-100", text: "text-amber-900" },
  WAITING_SUPPLIER: { bg: "bg-amber-100", text: "text-amber-900" },
  WAITING_ADMIN: { bg: "bg-indigo-100", text: "text-indigo-800" },
  RESOLVED: { bg: "bg-emerald-100", text: "text-emerald-800" },
  CLOSED: { bg: "bg-gray-200", text: "text-gray-700" },
};

// Poll cadences. The unread ping is deliberately cheaper than the full
// list, so we can afford to run it even when the drawer is closed.
const LIST_POLL_OPEN_MS = 15_000;
const LIST_POLL_CLOSED_MS = 60_000;
const DETAIL_POLL_MS = 5_000;
const UNREAD_POLL_MS = 30_000;

function fmtRelative(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function SupportChatButton() {
  const [open, setOpen] = useState(false);
  const [threads, setThreads] = useState<ThreadListRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [composing, setComposing] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [unreadIds, setUnreadIds] = useState<string[]>([]);

  const fetchThreads = useCallback(async () => {
    try {
      const res = await fetch("/api/support/threads", { cache: "no-store" });
      if (res.status === 401) {
        setEnabled(false);
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as { threads: ThreadListRow[] };
      setThreads(data.threads);
      setEnabled(true);
    } catch {
      // silent
    }
  }, []);

  const fetchUnread = useCallback(async () => {
    try {
      const res = await fetch("/api/support/unread", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { threadIds: string[] };
      setUnreadIds(data.threadIds);
    } catch {
      // silent — badge just won't update
    }
  }, []);

  // Initial + polled list fetch.
  useEffect(() => {
    fetchThreads();
    const t = setInterval(
      fetchThreads,
      open ? LIST_POLL_OPEN_MS : LIST_POLL_CLOSED_MS
    );
    return () => clearInterval(t);
  }, [fetchThreads, open]);

  // Unread ping — runs whether the drawer is open or closed so the badge
  // catches new-message events even while the widget is minimized.
  useEffect(() => {
    fetchUnread();
    const t = setInterval(fetchUnread, UNREAD_POLL_MS);
    return () => clearInterval(t);
  }, [fetchUnread]);

  // Detail + auto-mark-read when a thread is opened. Read call runs on
  // open AND every time new messages come in, so an admin reply arriving
  // while the user is looking at the thread doesn't linger as unread.
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/support/threads/${selectedId}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as { thread: ThreadDetail };
        if (alive) setDetail(data.thread);
        // Fire-and-forget mark-read; server will upsert the receipt.
        fetch(`/api/support/threads/${selectedId}/read`, { method: "POST" })
          .then(() => fetchUnread())
          .catch(() => {});
      } catch {
        // silent
      }
    };
    load();
    const t = setInterval(load, DETAIL_POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [selectedId, fetchUnread]);

  if (!enabled) return null;

  const unreadCount = unreadIds.length;

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          // Phase 3b.3 (2026-09-15): top-right icon instead of the
          // bottom-right pill. Slots to the LEFT of the tenant switcher
          // ("MegoPOS" chip is ~180px + right-4 padding, so right-52
          // clears it with breathing room). Compact icon button reads
          // as a utility affordance, not a promo — better fit for
          // data-dense pages like POS.
          className="fixed top-3 right-52 z-40 group flex items-center justify-center w-9 h-9 rounded-full bg-white border border-gray-200 text-gray-600 hover:text-indigo-600 hover:border-indigo-300 hover:shadow-md transition-all"
          aria-label="Open support chat"
          title="Support"
        >
          <div className="relative">
            <Icon icon="solar:chat-round-line-bold" className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute -top-2 -right-2 min-w-[16px] h-[16px] px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold flex items-center justify-center">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </div>
        </button>
      )}

      {open && (
        // Drawer anchors below the top-right button. Height fills the
        // viewport below the header so long threads have room. Width
        // caps at 380px; on narrow screens it goes full-width minus
        // the small side margin.
        <div className="fixed top-16 right-4 z-40 w-[380px] max-w-[calc(100vw-2rem)] h-[560px] max-h-[calc(100vh-5rem)] bg-white rounded-2xl shadow-2xl border border-gray-100 flex flex-col overflow-hidden">
          <header className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
            <div className="flex items-center gap-2 min-w-0">
              {detail ? (
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="text-gray-500 hover:text-gray-700"
                  aria-label="Back"
                >
                  <Icon icon="solar:arrow-left-linear" className="w-5 h-5" />
                </button>
              ) : null}
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-900 truncate">
                  {detail ? detail.subject : "Support"}
                </div>
                {!detail && (
                  <div className="text-[11px] text-gray-500">
                    Chat directly with the platform team
                  </div>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setSelectedId(null);
                setComposing(false);
              }}
              className="text-gray-400 hover:text-gray-600"
              aria-label="Close"
            >
              <Icon icon="solar:close-circle-linear" className="w-5 h-5" />
            </button>
          </header>

          {composing ? (
            <NewThreadForm
              onClose={() => setComposing(false)}
              onCreated={async (id) => {
                setComposing(false);
                await Promise.all([fetchThreads(), fetchUnread()]);
                setSelectedId(id);
              }}
            />
          ) : detail ? (
            <ThreadDetailView
              thread={detail}
              onPosted={async () => {
                await Promise.all([fetchThreads(), fetchUnread()]);
              }}
            />
          ) : (
            <ThreadListView
              threads={threads}
              unreadIds={new Set(unreadIds)}
              onSelect={setSelectedId}
              onCompose={() => setComposing(true)}
            />
          )}
        </div>
      )}
    </>
  );
}

function ThreadListView({
  threads,
  unreadIds,
  onSelect,
  onCompose,
}: {
  threads: ThreadListRow[];
  unreadIds: Set<string>;
  onSelect: (id: string) => void;
  onCompose: () => void;
}) {
  return (
    <>
      <div className="p-3 border-b border-gray-100">
        <button
          type="button"
          onClick={onCompose}
          className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 text-white text-sm font-medium py-2 hover:bg-indigo-700"
        >
          <Icon icon="solar:add-square-linear" className="w-4 h-4" />
          New conversation
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {threads.length === 0 ? (
          <div className="p-6 text-sm text-gray-500 text-center">
            No conversations yet.
            <br />
            Tap <strong>New conversation</strong> to reach support.
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {threads.map((t) => {
              const style = STATUS_STYLES[t.status];
              const isUnread = unreadIds.has(t.id);
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(t.id)}
                    className="w-full text-left px-3 py-3 hover:bg-gray-50"
                  >
                    <div className="flex items-start gap-2">
                      {isUnread && (
                        <span className="mt-1.5 w-2 h-2 rounded-full bg-red-500 shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className={`text-sm truncate ${isUnread ? "font-semibold text-gray-900" : "font-medium text-gray-800"}`}>
                            {t.subject}
                          </div>
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${style.bg} ${style.text}`}
                          >
                            {SUPPORT_STATUS_LABELS[t.status]}
                          </span>
                        </div>
                        <div className="text-[11px] text-gray-400 mt-1 flex items-center gap-1.5">
                          <span>{t._count.messages} msg</span>
                          <span>·</span>
                          <span>{fmtRelative(t.lastMessageAt)}</span>
                        </div>
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}

function ThreadDetailView({
  thread,
  onPosted,
}: {
  thread: ThreadDetail;
  onPosted: () => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [thread.messages.length]);

  const canReply = thread.status !== "CLOSED";

  function onPickFiles(files: FileList | null) {
    if (!files) return;
    const next = [...pending];
    for (const f of Array.from(files)) {
      if (next.length >= 5) {
        toast.error("Max 5 attachments per message");
        break;
      }
      next.push(f);
    }
    setPending(next);
  }

  async function send() {
    const body = text.trim();
    if ((!body && pending.length === 0) || sending) return;
    if (!body) {
      toast.error("Write a message to send with your attachment");
      return;
    }
    setSending(true);
    try {
      // Upload attachments (if any) in sequence — parallel uploads can
      // overwhelm slow uplinks and lose ordering on the "sending…" toast.
      const uploaded: UploadedAttachment[] = [];
      for (const file of pending) {
        try {
          const meta = await uploadSupportAttachment({
            threadId: thread.id,
            file,
            presignUrl: `/api/support/threads/${thread.id}/attachments/presign`,
          });
          uploaded.push(meta);
        } catch (err) {
          throw new Error(`Failed to upload ${file.name}: ${(err as Error).message}`);
        }
      }

      const res = await fetch(`/api/support/threads/${thread.id}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body, attachments: uploaded }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      setText("");
      setPending([]);
      await onPosted();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-gray-50/50">
        {thread.messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        <div ref={endRef} />
      </div>
      <div className="border-t border-gray-100 p-3">
        {canReply ? (
          <>
            {pending.length > 0 && (
              <div className="mb-2 space-y-1">
                {pending.map((f, i) => (
                  <div
                    key={`${f.name}-${i}`}
                    className="flex items-center justify-between gap-2 bg-gray-50 rounded-lg px-2 py-1 text-[11px]"
                  >
                    <div className="min-w-0 flex items-center gap-1.5">
                      <Icon icon="solar:paperclip-linear" className="w-3.5 h-3.5 text-gray-500" />
                      <span className="truncate text-gray-800">{f.name}</span>
                      <span className="text-gray-400 shrink-0">{humanFileSize(f.size)}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setPending((p) => p.filter((_, j) => j !== i))
                      }
                      className="text-gray-400 hover:text-red-500"
                      aria-label="Remove"
                    >
                      <Icon icon="solar:close-circle-linear" className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Type a reply…"
              rows={2}
              className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
            />
            <div className="mt-2 flex items-center justify-between">
              <label className="inline-flex items-center gap-1 text-xs text-gray-500 cursor-pointer hover:text-indigo-600">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={(e) => {
                    onPickFiles(e.target.files);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                  className="hidden"
                />
                <Icon icon="solar:paperclip-linear" className="w-4 h-4" />
                Attach
              </label>
              <button
                type="button"
                onClick={send}
                disabled={sending || (!text.trim() && pending.length === 0)}
                className="rounded-xl bg-indigo-600 text-white text-sm px-4 py-1.5 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sending ? "Sending…" : "Send"}
              </button>
            </div>
          </>
        ) : (
          <div className="text-xs text-gray-500 text-center">
            This conversation is closed.
            <br />
            Start a new one if you need more help.
          </div>
        )}
      </div>
    </>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isMine =
    message.senderType === "MERCHANT" || message.senderType === "SUPPLIER";
  const isAdmin = message.senderType === "ADMIN";
  const isSystem = message.senderType === "SYSTEM";

  if (isSystem) {
    return (
      <div className="text-center text-[11px] text-gray-400 my-1">
        {message.body}
      </div>
    );
  }

  return (
    <div className={`flex flex-col ${isMine ? "items-end" : "items-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-3 py-1.5 text-sm whitespace-pre-wrap ${
          isMine
            ? "bg-indigo-600 text-white"
            : isAdmin
              ? "bg-white border border-gray-200 text-gray-900"
              : "bg-gray-100 text-gray-900"
        }`}
      >
        {message.body}
        {message.attachments && message.attachments.length > 0 && (
          <div className={`mt-1.5 space-y-1 ${isMine ? "" : ""}`}>
            {message.attachments.map((a) => (
              <a
                key={a.id}
                href={a.downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] ${
                  isMine
                    ? "bg-indigo-700 hover:bg-indigo-800 text-white"
                    : "bg-gray-200 hover:bg-gray-300 text-gray-900"
                }`}
              >
                <Icon icon="solar:paperclip-linear" className="w-3 h-3 shrink-0" />
                <span className="truncate">{a.fileName}</span>
                <span className={`shrink-0 ${isMine ? "text-indigo-100" : "text-gray-500"}`}>
                  {humanFileSize(a.sizeBytes)}
                </span>
              </a>
            ))}
          </div>
        )}
      </div>
      <div className="text-[10px] text-gray-400 mt-0.5">
        {message.senderName || message.senderType} · {fmtRelative(message.createdAt)}
      </div>
    </div>
  );
}

function NewThreadForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => Promise<void>;
}) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!subject.trim() || !body.trim() || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/support/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subject: subject.trim(),
          firstMessage: body.trim(),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { thread: { id: string } };
      await onCreated(data.thread.id);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col p-3 gap-3">
      <div>
        <label className="text-xs font-medium text-gray-700">Subject</label>
        <input
          type="text"
          maxLength={255}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="What do you need help with?"
          className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
        />
      </div>
      <div className="flex-1 flex flex-col">
        <label className="text-xs font-medium text-gray-700">Message</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Describe the issue…"
          className="mt-1 flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none resize-none"
        />
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={saving || !subject.trim() || !body.trim()}
          className="rounded-xl bg-indigo-600 text-white text-sm px-3 py-1.5 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? "Sending…" : "Send to support"}
        </button>
      </div>
    </div>
  );
}
