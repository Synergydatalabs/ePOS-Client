"use client";

import { useState, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";

interface Ticket {
  id: string;
  ticketNumber: string;
  category: "trip_issue" | "payment" | "driver_complaint" | "lost_item" | "app_bug" | "other";
  subject: string;
  description: string;
  reporterName: string;
  reporterPhone: string;
  reporterEmail: string | null;
  tripNumber: string | null;
  status: "open" | "in_progress" | "resolved" | "closed";
  priority: "low" | "medium" | "high" | "urgent";
  assignedTo: string | null;
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
}

const STATUS_CONFIG: Record<string, { color: string; text: string; bg: string; label: string }> = {
  open: { color: "bg-amber-500", text: "text-amber-700", bg: "bg-amber-50", label: "Open" },
  in_progress: { color: "bg-blue-500", text: "text-blue-700", bg: "bg-blue-50", label: "In Progress" },
  resolved: { color: "bg-green-500", text: "text-green-700", bg: "bg-green-50", label: "Resolved" },
  closed: { color: "bg-gray-400", text: "text-gray-700", bg: "bg-gray-50", label: "Closed" },
};

const PRIORITY_CONFIG: Record<string, { color: string; text: string; bg: string; label: string }> = {
  low: { color: "bg-gray-400", text: "text-gray-700", bg: "bg-gray-50", label: "Low" },
  medium: { color: "bg-blue-500", text: "text-blue-700", bg: "bg-blue-50", label: "Medium" },
  high: { color: "bg-amber-500", text: "text-amber-700", bg: "bg-amber-50", label: "High" },
  urgent: { color: "bg-red-500", text: "text-red-700", bg: "bg-red-50", label: "Urgent" },
};

const CATEGORY_CONFIG: Record<string, { icon: string; label: string; color: string; bg: string }> = {
  trip_issue: { icon: "solar:route-bold", label: "Trip Issue", color: "text-indigo-700", bg: "bg-indigo-50" },
  payment: { icon: "solar:card-bold", label: "Payment", color: "text-green-700", bg: "bg-green-50" },
  driver_complaint: { icon: "solar:user-bold", label: "Driver Complaint", color: "text-red-700", bg: "bg-red-50" },
  lost_item: { icon: "solar:box-bold", label: "Lost Item", color: "text-amber-700", bg: "bg-amber-50" },
  app_bug: { icon: "solar:bug-bold", label: "App Bug", color: "text-purple-700", bg: "bg-purple-50" },
  other: { icon: "solar:chat-round-dots-bold", label: "Other", color: "text-gray-700", bg: "bg-gray-50" },
};

export default function SupportPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [resolutionText, setResolutionText] = useState("");
  const [updateStatus, setUpdateStatus] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const tenantId = typeof window !== "undefined"
    ? localStorage.getItem("tenantId") || localStorage.getItem("tap_active_tenant") || ""
    : "";

  const fetchTickets = useCallback(async () => {
    if (!tenantId) return;
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (priorityFilter !== "all") params.set("priority", priorityFilter);

      const res = await fetch(`/api/tenants/${tenantId}/cab/support?${params.toString()}`);
      const data = await res.json();
      if (data.tickets) setTickets(data.tickets);
    } catch {
      toast.error("Failed to load tickets");
    } finally {
      setLoading(false);
    }
  }, [tenantId, statusFilter, priorityFilter]);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  const openTicketDetails = (ticket: Ticket) => {
    setSelectedTicket(ticket);
    setResolutionText(ticket.resolution || "");
    setUpdateStatus(ticket.status);
  };

  const handleUpdateTicket = async () => {
    if (!selectedTicket) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/cab/support/${selectedTicket.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: updateStatus,
          resolution: resolutionText || null,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("Ticket updated");
        setSelectedTicket(null);
        fetchTickets();
      } else {
        toast.error(data.error || "Failed to update ticket");
      }
    } catch {
      toast.error("Failed to update ticket");
    } finally {
      setActionLoading(false);
    }
  };

  const statusTabs = [
    { key: "all", label: "All", count: tickets.length },
    { key: "open", label: "Open", count: tickets.filter((t) => t.status === "open").length },
    { key: "in_progress", label: "In Progress", count: tickets.filter((t) => t.status === "in_progress").length },
    { key: "resolved", label: "Resolved", count: tickets.filter((t) => t.status === "resolved").length },
    { key: "closed", label: "Closed", count: tickets.filter((t) => t.status === "closed").length },
  ];

  const filteredTickets = tickets.filter((t) => {
    const matchesStatus = statusFilter === "all" || t.status === statusFilter;
    const matchesPriority = priorityFilter === "all" || t.priority === priorityFilter;
    return matchesStatus && matchesPriority;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Icon icon="solar:refresh-bold" className="w-8 h-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Support Tickets</h1>
          <p className="text-gray-500 mt-1">Manage customer support requests and complaints</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 text-red-700">
            <Icon icon="solar:danger-triangle-bold" className="w-4 h-4" />
            <span className="font-medium">{tickets.filter((t) => t.priority === "urgent" && t.status === "open").length} urgent</span>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        {/* Status Tabs */}
        <div className="flex gap-2 flex-1 overflow-x-auto pb-1">
          {statusTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-colors ${
                statusFilter === tab.key
                  ? "bg-indigo-600 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-50 border border-gray-200"
              }`}
            >
              {tab.label}
              <span className={`px-1.5 py-0.5 rounded-full text-xs ${
                statusFilter === tab.key ? "bg-white/20 text-white" : "bg-gray-100 text-gray-600"
              }`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* Priority Filter */}
        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="px-4 py-2 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
        >
          <option value="all">All Priorities</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>

      {/* Ticket List */}
      {filteredTickets.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center">
          <Icon icon="solar:chat-round-dots-bold" className="w-16 h-16 mx-auto text-gray-300 mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No Tickets Found</h3>
          <p className="text-gray-500 max-w-md mx-auto">
            Support tickets from customers will appear here. No open tickets at the moment.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredTickets.map((ticket) => {
            const statusCfg = STATUS_CONFIG[ticket.status];
            const priorityCfg = PRIORITY_CONFIG[ticket.priority];
            const categoryCfg = CATEGORY_CONFIG[ticket.category] || CATEGORY_CONFIG.other;
            return (
              <div
                key={ticket.id}
                onClick={() => openTicketDetails(ticket)}
                className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 cursor-pointer hover:shadow-md transition-all"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4 flex-1">
                    <div className={`w-10 h-10 rounded-xl ${categoryCfg.bg} flex items-center justify-center flex-shrink-0`}>
                      <Icon icon={categoryCfg.icon} className={`w-5 h-5 ${categoryCfg.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-xs text-gray-400">#{ticket.ticketNumber}</span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${categoryCfg.bg} ${categoryCfg.color}`}>
                          {categoryCfg.label}
                        </span>
                        {ticket.tripNumber && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                            Trip #{ticket.tripNumber}
                          </span>
                        )}
                      </div>
                      <h3 className="font-semibold text-gray-900 mb-1">{ticket.subject}</h3>
                      <div className="flex items-center gap-3 text-sm text-gray-500">
                        <span>{ticket.reporterName}</span>
                        <span className="text-gray-300">|</span>
                        <span>{new Date(ticket.createdAt).toLocaleDateString()}</span>
                        {ticket.assignedTo && (
                          <>
                            <span className="text-gray-300">|</span>
                            <span className="text-indigo-600">Assigned: {ticket.assignedTo}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${priorityCfg.bg} ${priorityCfg.text}`}>
                      {priorityCfg.label}
                    </span>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${statusCfg.bg} ${statusCfg.text}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${statusCfg.color}`} />
                      {statusCfg.label}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Ticket Details Modal */}
      {selectedTicket && (
        <div className="fixed inset-0 bg-black/50 z-50 flex justify-end" onClick={() => setSelectedTicket(null)}>
          <div className="w-full max-w-lg bg-white h-full overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900">Ticket #{selectedTicket.ticketNumber}</h3>
              <button onClick={() => setSelectedTicket(null)} className="p-2 rounded-lg hover:bg-gray-100">
                <Icon icon="solar:close-circle-bold" className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Status & Priority Badges */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium ${STATUS_CONFIG[selectedTicket.status].bg} ${STATUS_CONFIG[selectedTicket.status].text}`}>
                  <span className={`w-2 h-2 rounded-full ${STATUS_CONFIG[selectedTicket.status].color}`} />
                  {STATUS_CONFIG[selectedTicket.status].label}
                </span>
                <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium ${PRIORITY_CONFIG[selectedTicket.priority].bg} ${PRIORITY_CONFIG[selectedTicket.priority].text}`}>
                  {PRIORITY_CONFIG[selectedTicket.priority].label} Priority
                </span>
                <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium ${(CATEGORY_CONFIG[selectedTicket.category] || CATEGORY_CONFIG.other).bg} ${(CATEGORY_CONFIG[selectedTicket.category] || CATEGORY_CONFIG.other).color}`}>
                  {(CATEGORY_CONFIG[selectedTicket.category] || CATEGORY_CONFIG.other).label}
                </span>
              </div>

              {/* Subject */}
              <div>
                <h2 className="text-xl font-bold text-gray-900">{selectedTicket.subject}</h2>
              </div>

              {/* Description */}
              <div className="p-4 rounded-xl bg-gray-50">
                <span className="text-xs text-gray-500 font-medium">Description</span>
                <p className="text-sm text-gray-700 mt-2 whitespace-pre-wrap">{selectedTicket.description}</p>
              </div>

              {/* Reporter Info */}
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-gray-50">
                  <span className="text-xs text-gray-500 font-medium">Reporter</span>
                  <p className="font-medium text-gray-900 mt-1">{selectedTicket.reporterName}</p>
                  <p className="text-sm text-gray-500">{selectedTicket.reporterPhone}</p>
                  {selectedTicket.reporterEmail && (
                    <p className="text-sm text-gray-500">{selectedTicket.reporterEmail}</p>
                  )}
                </div>
                <div className="p-4 rounded-xl bg-gray-50">
                  <span className="text-xs text-gray-500 font-medium">Details</span>
                  {selectedTicket.tripNumber && (
                    <p className="text-sm text-gray-900 mt-1">Trip: #{selectedTicket.tripNumber}</p>
                  )}
                  {selectedTicket.assignedTo && (
                    <p className="text-sm text-gray-900">Assigned: {selectedTicket.assignedTo}</p>
                  )}
                  <p className="text-sm text-gray-500 mt-1">Created: {new Date(selectedTicket.createdAt).toLocaleString()}</p>
                </div>
              </div>

              {/* Existing Resolution */}
              {selectedTicket.resolution && (
                <div className="p-4 rounded-xl bg-green-50 border border-green-100">
                  <span className="text-xs text-green-600 font-medium">Resolution</span>
                  <p className="text-sm text-gray-700 mt-2 whitespace-pre-wrap">{selectedTicket.resolution}</p>
                </div>
              )}

              {/* Update Form */}
              <div className="border-t border-gray-100 pt-6">
                <h4 className="font-semibold text-gray-900 mb-4">Update Ticket</h4>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                    <select
                      value={updateStatus}
                      onChange={(e) => setUpdateStatus(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    >
                      <option value="open">Open</option>
                      <option value="in_progress">In Progress</option>
                      <option value="resolved">Resolved</option>
                      <option value="closed">Closed</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Resolution / Notes</label>
                    <textarea
                      value={resolutionText}
                      onChange={(e) => setResolutionText(e.target.value)}
                      placeholder="Add resolution details or internal notes..."
                      rows={4}
                      className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
                    />
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={handleUpdateTicket}
                      disabled={actionLoading}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50"
                    >
                      {actionLoading ? (
                        <Icon icon="solar:refresh-bold" className="w-4 h-4 animate-spin" />
                      ) : (
                        <Icon icon="solar:check-circle-bold" className="w-4 h-4" />
                      )}
                      {actionLoading ? "Updating..." : "Update Ticket"}
                    </button>
                    <button
                      onClick={() => setSelectedTicket(null)}
                      className="px-4 py-2.5 rounded-xl border border-gray-200 text-gray-700 font-medium hover:bg-gray-50 transition-colors"
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
