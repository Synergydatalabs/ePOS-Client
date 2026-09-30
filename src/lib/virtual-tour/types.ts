// ============================================================================
// src/lib/virtual-tour/types.ts
//
// Shared types for virtual tour editor + viewer.
// ============================================================================

export type HotspotType = "SCENE_LINK" | "TABLE_LINK" | "INFO" | "EXTERNAL_URL";

export interface TourHotspot {
  id: string;
  hotspotType: HotspotType;
  yaw: number;
  pitch: number;
  label: string;
  iconUrl?: string | null;
  targetSceneMediaId?: string | null;
  targetTableId?: string | null;
  externalUrl?: string | null;
  targetYaw?: number | null;
  targetPitch?: number | null;
}

export interface TourScene {
  id: string;
  sceneName: string | null;
  publicUrl: string;
  initialYaw?: number | null;
  initialPitch?: number | null;
  initialFov?: number | null;
  isDefaultScene?: boolean;
  hotspots: TourHotspot[];
}

export interface TourTable {
  id: string;
  tableNumber: string;
  displayLabel?: string | null;
  capacity: number;
  minPartySize?: number;
  maxPartySize?: number | null;
  section?: {
    id: string;
    name: string;
    color?: string;
  } | null;
}

export interface PublicTourPayload {
  location: {
    id: string;
    name: string;
    slug: string;
    tenantName: string;
  };
  scenes: TourScene[];
  tables: TourTable[];
}
