// Full-page support inbox — used by both /dashboard/support and
// /supplier/support. Wider layout than the floating drawer (list on the
// left, active thread on the right). Same /api/support/* endpoints; the
// server figures out who the caller is.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import {
  SUPPORT_STATUS_LABELS,
  SUPPORT_THREAD_STATUSES,
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

const STATUS_STYLES: Record<SupportThreadStatusValue, { bg: string; text: string }> = {
  OPEN: { bg: "bg-blue-100", text: "text-blue-800" },
  WAITING_MERCHANT: { bg: "bg-amber-100", text: "text-amber-900" },
  WAITING_SUPPLIER: { bg: "bg-amber-100", text: "text-amber-900" },
  WAITING_ADMIN: { bg: "bg-indigo-100", text: "text-indigo-800" },
  RESOLVED: { bg: "bg-emerald-100", text: "text-emerald-800" },
  CLOSED: { bg: "bg-gray-200", text: "text-gray-700" },
};

const FILTER_TABS: { key: SupportThreadStatusValue | "ALL"; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "OPEN", label: "Open" },
  { key: "WAITING_ADMIN", label: "Waiting on support" },
  { key: "WAITING_MERCHANT", label: "Waiting on you" },
  { key: "RESOLVED", label: "Resolved" },
  { key: "CLOSED", label: "Closed" },
];

function fmtRelative(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function SupportInboxPage() {
  const [activeStatus, setActiveStatus] =
    useState<SupportThreadStatusValue | "ALL">("ALL");
  const [threads, setThreads] = useState<ThreadListRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [showNew, setShowNew] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const listUrl = useMemo(() => {
    const q = new URLSearchParams();
    if (activeStatus !== "ALL") q.set("status", activeStatus);
    const qs = q.toString();
    return "/api/support/threads" + (qs ? `?${qs}` : "");
  }, [activeStatus]);

  const fetchList = useCallback(async () => {
    try {
      const res = await fetch(listUrl, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { threads: ThreadListRow[] };
      setThreads(data.threads);
    } catch (err) {
      toast.error("Failed to load conversations");
      console.error(err);
    }
  }, [listUrl]);

  const fetchDetail = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/support/threads/${id}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { thread: ThreadDetail };
      setDetail(data.thread);
    } catch (err) {
      toast.error("Failed to load conversation");
      console.error(err);
    }
  }, []);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  useEffect(() => {
    if (selectedId) {
      fetchDetail(selectedId);
      // Mark read on open. Fire-and-forget; the badge polls its own signal.
      fetch(`/api/support/threads/${selectedId}/read`, { method: "POST" }).catch(() => {});
    } else {
      setDetail(null);
    }
  }, [selectedId, fetchDetail]);

  // Poll while tab is visible — same cadence as tapapp-admin's SupportClient.
  useEffect(() => {
    const tick = () => {
      if (document.hidden) return;
      fetchList();
      if (selectedId) fetchDetail(selectedId);
    };
    const t = setInterval(tick, 5000);
    return () => clearInterval(t);
  }, [fetchList, fetchDetail, selectedId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [detail?.messages.length]);

  return (
    <div className="flex gap-4 h-[calc(100vh-140px)] min-h-[520px]">
      <aside className="w-[360px] shrink-0 flex flex-col bg-white rounded-2xl border border-gray-100">
        <div className="p-3 border-b border-gray-100">
          <button
            type="button"
            onClick={() => setShowNew(true)}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 text-white text-sm font-medium py-2 hover:bg-indigo-700"
          >
            <Icon icon="solar:add-square-linear" className="w-4 h-4" />
            New conversation
          </button>
        </div>
        <div className="px-2 pt-2 pb-1 flex flex-wrap gap-1 border-b border-gray-100">
          {FILTER_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveStatus(t.key)}
              className={`px-2 py-1 rounded-lg text-xs font-medium transition-colors ${
                activeStatus === t.key
                  ? "bg-gray-900 text-white"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto">
          {threads.length === 0 ? (
            <div className="p-6 text-sm text-gray-500 text-center">
              No conversations here.
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {threads.map((t) => {
                const style = STATUS_STYLES[t.status];
                const active = t.id === selectedId;
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(t.id)}
                      className={`w-full text-left px-3 py-3 hover:bg-gray-50 ${
                        active ? "bg-indigo-50 border-l-2 border-indigo-600" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-medium text-sm text-gray-900 truncate">
                          {t.subject}
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${style.bg} ${style.text}`}
                        >
                          {SUPPORT_STATUS_LABELS[t.status]}
                        </span>
                      </div>
                      <div className="text-[11px] text-gray-400 mt-1">
                        {t._count.messages} msg · {fmtRelative(t.lastMessageAt)}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      <section className="flex-1 min-w-0 flex flex-col bg-white rounded-2xl border border-gray-100">
        {!selectedId ? (
          <div className="flex-1 flex items-center justify-center text-sm text-gray-500">
            Pick a conversation from the list, or start a new one.
          </div>
        ) : !detail ? (
          <div className="flex-1 flex items-center justify-center text-sm text-gray-500">
            Loading…
          </div>
        ) : (
          <>
            <header className="p-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-gray-900 truncate">
                  {detail.subject}
                </h2>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[detail.status].bg} ${STATUS_STYLES[detail.status].text}`}
                >
                  {SUPPORT_STATUS_LABELS[detail.status]}
                </span>
              </div>
              <div className="text-[11px] text-gray-400 mt-1">
                Opened {fmtRelative(detail.createdAt)}
              </div>
            </header>
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50/50">
              {detail.messages.map((m) => (
                <MessageBubble key={m.id} message={m} />
              ))}
              <div ref={messagesEndRef} />
            </div>
            <Composer
              threadId={detail.id}
              disabled={detail.status === "CLOSED"}
              onPosted={async () => {
                await Promise.all([fetchList(), fetchDetail(detail.id)]);
              }}
            />
          </>
        )}
      </section>

      {showNew && (
        <NewThreadModal
          onClose={() => setShowNew(false)}
          onCreated={async (id) => {
            setShowNew(false);
            await fetchList();
            setSelectedId(id);
          }}
        />
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isMine =
    message.senderType === "MERCHANT" || message.senderType === "SUPPLIER";
  const isAdmin = message.senderType === "ADMIN";
  const isSystem = message.senderType === "SYSTEM";

  if (isSystem) {
    return (
      <div className="text-center text-[11px] text-gray-400 my-2">
        {message.body}
      </div>
    );
  }

  return (
    <div className={`flex flex-col ${isMine ? "items-end" : "items-start"}`}>
      <div
        className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
          isMine
            ? "bg-indigo-600 text-white"
            : isAdmin
              ? "bg-white border border-gray-200 text-gray-900"
              : "bg-gray-100 text-gray-900"
        }`}
      >
        {message.body}
        {message.attachments && message.attachments.length > 0 && (
          <div className="mt-2 space-y-1">
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
      <div className="text-[10px] text-gray-500 mt-0.5">
        {message.senderName || message.senderType} · {fmtRelative(message.createdAt)}
      </div>
    </div>
  );
}

function Composer({
  threadId,
  disabled,
  onPosted,
}: {
  threadId: string;
  disabled: boolean;
  onPosted: () => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
      const uploaded: UploadedAttachment[] = [];
      for (const file of pending) {
        try {
          const meta = await uploadSupportAttachment({
            threadId,
            file,
            presignUrl: `/api/support/threads/${threadId}/attachments/presign`,
          });
          uploaded.push(meta);
        } catch (err) {
          throw new Error(`Failed to upload ${file.name}: ${(err as Error).message}`);
        }
      }
      const res = await fetch(`/api/support/threads/${threadId}/messages`, {
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

  if (disabled) {
    return (
      <div className="border-t border-gray-100 p-4 text-xs text-gray-500 text-center">
        This conversation is closed. Open a new one if you need more help.
      </div>
    );
  }

  return (
    <div className="border-t border-gray-100 p-3">
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
                onClick={() => setPending((p) => p.filter((_, j) => j !== i))}
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
        rows={3}
        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
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
    </div>
  );
}

function NewThreadModal({
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
        body: JSON.stringify({ subject: subject.trim(), firstMessage: body.trim() }),
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl">
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">
            Start a conversation with support
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
            aria-label="Close"
          >
            <Icon icon="solar:close-circle-linear" className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-700">Subject</label>
            <input
              type="text"
              maxLength={255}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="What do you need help with?"
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700">Message</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              placeholder="Describe the issue…"
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
            />
          </div>
        </div>
        <div className="p-5 border-t border-gray-100 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving || !subject.trim() || !body.trim()}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Sending…" : "Send to support"}
          </button>
        </div>
      </div>
    </div>
  );
}
