"use client";

// PO message thread — shared between merchant PO detail
// (/dashboard/admin/marketplace/orders/[orderId]) and supplier PO detail
// (/supplier/orders/[orderId]). The only per-side inputs are the API
// paths (list/post/read) and the viewerSide flag so we can flip
// alignment/colours.

import { useEffect, useRef, useState } from "react";

export interface PoMessage {
  id: string;
  senderSide: "MERCHANT" | "SUPPLIER";
  senderName: string | null;
  body: string;
  readByOtherSideAt: string | Date | null;
  createdAt: string | Date;
}

export interface PoMessageThreadProps {
  viewerSide: "MERCHANT" | "SUPPLIER";
  /** GET returns { messages: PoMessage[] }; POST accepts { body }. */
  threadUrl: string;
  /** POST endpoint that marks the OTHER side's messages read. */
  readUrl: string;
  /** Optional: called when unread state may have changed (0 unread after open). */
  onMarkRead?: () => void;
}

function fmtTime(v: string | Date): string {
  const d = typeof v === "string" ? new Date(v) : v;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function PoMessageThread({
  viewerSide,
  threadUrl,
  readUrl,
  onMarkRead,
}: PoMessageThreadProps) {
  const [messages, setMessages] = useState<PoMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  async function load() {
    try {
      setError(null);
      const res = await fetch(threadUrl);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load messages");
      setMessages(data.messages || []);
    } catch (e: any) {
      setError(e?.message || "Failed to load messages");
    } finally {
      setLoading(false);
    }
  }

  async function markRead() {
    try {
      await fetch(readUrl, { method: "POST" });
      onMarkRead?.();
    } catch {
      // Non-fatal — the badge just stays stale until next reload.
    }
  }

  useEffect(() => {
    load().then(() => markRead());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadUrl]);

  // Auto-scroll to bottom on new message.
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed || posting) return;
    setPosting(true);
    setError(null);
    try {
      const res = await fetch(threadUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to send");
      setMessages((prev) => [...prev, data.message]);
      setBody("");
    } catch (e: any) {
      setError(e?.message || "Failed to send");
    } finally {
      setPosting(false);
    }
  }

  const otherSideLabel = viewerSide === "MERCHANT" ? "supplier" : "merchant";

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-900">Messages</h3>
        <p className="mt-0.5 text-xs text-gray-500">
          Chat with the {otherSideLabel} about this purchase order.
        </p>
      </div>

      <div
        ref={listRef}
        className="max-h-96 min-h-[10rem] overflow-y-auto p-4 space-y-3 bg-gray-50"
      >
        {loading ? (
          <p className="text-sm text-gray-500">Loading messages…</p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-gray-500">
            No messages yet. Send the first one below.
          </p>
        ) : (
          messages.map((m) => {
            const mine = m.senderSide === viewerSide;
            return (
              <div
                key={m.id}
                className={`flex ${mine ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[75%] rounded-lg px-3 py-2 shadow-sm ${
                    mine
                      ? "bg-indigo-600 text-white"
                      : "bg-white text-gray-900 border border-gray-200"
                  }`}
                >
                  <div
                    className={`text-[11px] mb-0.5 ${
                      mine ? "text-indigo-100" : "text-gray-500"
                    }`}
                  >
                    <span className="font-medium">
                      {m.senderName || (mine ? "You" : otherSideLabel)}
                    </span>
                    <span className="mx-1">•</span>
                    <span>{fmtTime(m.createdAt)}</span>
                    {mine && (
                      <span className="ml-1">
                        {m.readByOtherSideAt ? "· Seen" : ""}
                      </span>
                    )}
                  </div>
                  <div className="whitespace-pre-wrap break-words text-sm leading-snug">
                    {m.body}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <form onSubmit={send} className="border-t border-gray-100 p-3">
        {error && (
          <p className="mb-2 text-xs text-red-600">{error}</p>
        )}
        <div className="flex gap-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              // Cmd/Ctrl+Enter to send — matches most chat UIs.
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                send(e as any);
              }
            }}
            rows={2}
            maxLength={4000}
            placeholder={`Message the ${otherSideLabel}…`}
            className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
            disabled={posting}
          />
          <button
            type="submit"
            disabled={posting || !body.trim()}
            className="px-4 py-2 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed self-end"
          >
            {posting ? "Sending…" : "Send"}
          </button>
        </div>
        <p className="mt-1 text-[11px] text-gray-400">
          Ctrl+Enter to send. Max 4,000 characters.
        </p>
      </form>
    </div>
  );
}
