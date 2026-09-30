// =============================================================================
// IP intelligence — Phase H #4 (2026-09-02)
//
// One helper, one purpose: given a client IP, tell us whether it's a VPN,
// proxy, Tor exit node, or datacenter/hosting IP. Used only by the invoice
// pay endpoints — nothing else on the site consults this — to hard-block
// obfuscated payment attempts. The rest of the site (browsing the
// marketplace, signing up, etc.) is unaffected.
//
// Provider: IPQualityScore (https://www.ipqualityscore.com/). Free tier is
// 5,000 lookups/mo which comfortably covers hub's 10–15 invoices/day.
//
// FAILS OPEN when IPQS_KEY isn't set OR the lookup errors — a real customer
// must never be blocked from paying because our fraud API had a bad day.
// Every failure logs a warning so ops can see it.
//
// Result semantics:
//   isBlocked → set only when the caller wants a hard-block decision from
//               a single boolean. Combines `isVpn || isProxy || isTor ||
//               isHosting` — the four categories a real invoice payer
//               almost never sits behind. Consumer / corporate VPN is
//               included here per the current pay-page policy (block all
//               VPN); if you soften the policy later, split it out.
//   reason    → human-readable label suitable for logging or a UI toast.
// =============================================================================

export interface IpIntelligence {
  ok: boolean;
  ip: string;
  isVpn: boolean;
  isProxy: boolean;
  isTor: boolean;
  isHosting: boolean;
  isBlocked: boolean;
  country?: string;
  reason?: string;
  // Raw provider response — kept only when the caller passed `verbose` so
  // logs can carry the full signal without every code path paying that
  // JSON serialisation cost.
  raw?: unknown;
}

interface IpqsResponse {
  success: boolean;
  message?: string;
  vpn?: boolean;
  proxy?: boolean;
  tor?: boolean;
  active_vpn?: boolean;
  active_tor?: boolean;
  is_crawler?: boolean;
  recent_abuse?: boolean;
  bot_status?: boolean;
  fraud_score?: number;
  country_code?: string;
  host?: string;
  ISP?: string;
  connection_type?: string;
}

// Bare IPv4 / IPv6 sniff so we don't hit the API with garbage values.
function isRoutableIp(candidate: string): boolean {
  if (!candidate) return false;
  const s = candidate.trim();
  if (!s) return false;
  // Localhost / private ranges — no point in a lookup, treat as OK.
  if (
    s === "::1" ||
    s === "127.0.0.1" ||
    s.startsWith("10.") ||
    s.startsWith("192.168.") ||
    s.startsWith("172.16.") ||
    s.startsWith("172.17.") ||
    s.startsWith("172.18.") ||
    s.startsWith("172.19.") ||
    s.startsWith("172.20.") ||
    s.startsWith("172.21.") ||
    s.startsWith("172.22.") ||
    s.startsWith("172.23.") ||
    s.startsWith("172.24.") ||
    s.startsWith("172.25.") ||
    s.startsWith("172.26.") ||
    s.startsWith("172.27.") ||
    s.startsWith("172.28.") ||
    s.startsWith("172.29.") ||
    s.startsWith("172.30.") ||
    s.startsWith("172.31.") ||
    s.startsWith("169.254.") ||
    s.startsWith("fc") ||
    s.startsWith("fd") ||
    s.startsWith("fe80")
  ) {
    return false;
  }
  return true;
}

export async function lookupIp(ip: string, opts?: { verbose?: boolean }): Promise<IpIntelligence> {
  const key = process.env.IPQS_KEY;
  const base: IpIntelligence = {
    ok: true,
    ip,
    isVpn: false,
    isProxy: false,
    isTor: false,
    isHosting: false,
    isBlocked: false,
  };

  // Dev / local requests: don't consult the API, don't block. Local RFC1918
  // ranges legitimately come from ops testing, staging containers, and
  // corporate LAN traffic.
  if (!isRoutableIp(ip)) {
    return { ...base, reason: "local-or-private-ip" };
  }
  if (!key) {
    console.warn("[ip-intel] IPQS_KEY not set — accepting request without lookup.");
    return { ...base, reason: "provider-not-configured" };
  }

  const url =
    `https://www.ipqualityscore.com/api/json/ip/${encodeURIComponent(key)}/${encodeURIComponent(ip)}` +
    // strictness=1 is Google's suggested public-form baseline — lower =
    // fewer false positives, higher = more aggressive. `allow_public_access
    // _points` = false so shared airport / cafe wifi doesn't count as VPN.
    `?strictness=1&allow_public_access_points=false&lighter_penalties=true&fast=true`;

  try {
    // 4-second budget so a slow provider can't stall the pay button. If we
    // don't answer inside that window we fail open — better than blocking
    // a real customer while IPQS is degraded.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);

    if (!res.ok) {
      console.warn(`[ip-intel] IPQS HTTP ${res.status}; failing open for ${ip}.`);
      return { ...base, reason: `provider-http-${res.status}` };
    }
    const data = (await res.json()) as IpqsResponse;
    if (!data?.success) {
      console.warn(`[ip-intel] IPQS unsuccessful: ${data?.message}; failing open for ${ip}.`);
      return { ...base, reason: "provider-unsuccessful" };
    }

    // IPQS returns `vpn` / `proxy` / `tor` as booleans.
    const isVpn = Boolean(data.vpn || data.active_vpn);
    const isProxy = Boolean(data.proxy);
    const isTor = Boolean(data.tor || data.active_tor);
    // FIX 2026-09-08: `host` is just reverse-DNS and is populated for
    // virtually every routable IP (residential ISPs included), so keying
    // hosting on `host` present blocked most real customers. Only
    // connection_type === "Data Center" is a reliable hosting signal.
    const isHosting = data.connection_type === "Data Center";

    const isBlocked = isVpn || isProxy || isTor || isHosting;

    // Human-readable reason for the log / UI — first flag wins so ops
    // sees the strongest signal, not a joined list.
    const reason = isTor
      ? "tor-exit-node"
      : isHosting
      ? "datacenter-or-hosting-ip"
      : isProxy
      ? "public-proxy"
      : isVpn
      ? "vpn"
      : "clean";

    return {
      ok: true,
      ip,
      isVpn,
      isProxy,
      isTor,
      isHosting,
      isBlocked,
      country: data.country_code,
      reason,
      raw: opts?.verbose ? data : undefined,
    };
  } catch (err: any) {
    // Timeout, DNS failure, TLS error — always fail open, log so ops
    // can spot systemic outages.
    console.warn("[ip-intel] IPQS lookup failed:", err?.name || err?.message || err);
    return { ...base, reason: "provider-error" };
  }
}
