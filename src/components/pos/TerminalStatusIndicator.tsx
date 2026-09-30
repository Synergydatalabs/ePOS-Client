// ============================================
// DEPRECATED — legacy UPA terminal status indicator.
// Kept as a stub so older POS pages still compile.
// New UCI flow doesn't need a status indicator
// (cloud-relayed, always "connected").
// ============================================

export default function TerminalStatusIndicator(_: { tenantId: string | null }) {
  return null;
}
