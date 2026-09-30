"use client";

import { useState, useEffect } from "react";
import { Icon } from "@iconify/react";

interface Technician {
  id: string;
  firstName?: string;
  lastName?: string;
  email: string;
  specialties: string[];
}

interface TechnicianSelectorProps {
  tenantId: string;
  productId: string;
  onSelect: (technician: Technician) => void;
  onClose: () => void;
}

export default function TechnicianSelector({
  tenantId,
  productId,
  onSelect,
  onClose,
}: TechnicianSelectorProps) {
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTechnicians();
  }, [tenantId, productId]);

  const loadTechnicians = async () => {
    try {
      const res = await fetch(`/api/tenants/${tenantId}/members?includeSpecialties=true`);
      const data = await res.json();
      if (data.success) {
        // Filter technicians who can perform this service
        const eligible = (data.members || []).filter((m: Technician) => {
          if (m.specialties.length === 0) return true; // No specialties = can do everything
          return m.specialties.includes(productId);
        });
        setTechnicians(eligible);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  };

  const getDisplayName = (t: Technician) => {
    if (t.firstName) return `${t.firstName}${t.lastName ? ` ${t.lastName}` : ""}`;
    return t.email.split("@")[0];
  };

  const getInitials = (t: Technician) => {
    if (t.firstName) {
      return `${t.firstName.charAt(0)}${t.lastName?.charAt(0) || ""}`.toUpperCase();
    }
    return t.email.charAt(0).toUpperCase();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[80vh] overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <div>
            <h3 className="font-semibold text-gray-900">Assign Technician</h3>
            <p className="text-sm text-gray-500">Who will perform this service?</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100">
            <Icon icon="solar:close-circle-linear" className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto max-h-[60vh]">
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="animate-pulse flex items-center gap-3 p-3">
                  <div className="w-10 h-10 bg-gray-200 rounded-full" />
                  <div className="flex-1">
                    <div className="h-4 bg-gray-200 rounded w-1/3 mb-1" />
                    <div className="h-3 bg-gray-200 rounded w-1/4" />
                  </div>
                </div>
              ))}
            </div>
          ) : technicians.length === 0 ? (
            <div className="text-center py-8">
              <Icon icon="solar:user-cross-linear" className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">No available technicians for this service</p>
            </div>
          ) : (
            <div className="space-y-2">
              {/* "Any available" option */}
              <button
                onClick={() =>
                  onSelect({
                    id: "",
                    firstName: "Any",
                    lastName: "Available",
                    email: "",
                    specialties: [],
                  })
                }
                className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 transition-colors text-left"
              >
                <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center">
                  <Icon icon="solar:users-group-rounded-bold" className="w-5 h-5 text-indigo-600" />
                </div>
                <div>
                  <p className="font-medium text-gray-900">Any Available</p>
                  <p className="text-xs text-gray-500">First available technician</p>
                </div>
              </button>

              {technicians.map((tech) => (
                <button
                  key={tech.id}
                  onClick={() => onSelect(tech)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 transition-colors text-left"
                >
                  <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center">
                    <span className="text-sm font-semibold text-gray-600">{getInitials(tech)}</span>
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">{getDisplayName(tech)}</p>
                    <p className="text-xs text-gray-500">{tech.email}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
