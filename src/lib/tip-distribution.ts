// Tip pool distribution engine.
//
// Given a pool amount + list of contributing members (with hours and role),
// computes each member's share according to the chosen rule and returns
// the resulting distributions. Money is in cents throughout.
//
// Rules:
//   BY_HOURS  — proportional to hoursWorked. Members with 0 hours skipped.
//   EVENLY    — equal split across all clocked-in members.
//   BY_ROLE   — proportional to (hoursWorked × roleWeight). roleWeights
//               is a { role → percent } map; missing roles get 0 and are
//               skipped.
//
// Rounding: each share is Math.floor'd first, then the leftover cents
// (0..N-1) are handed out one at a time to the members with the highest
// fractional remainder. Guarantees Σ shares === poolAmount exactly, so
// the merchant never has a stray cent.

export type Rule = "BY_HOURS" | "EVENLY" | "BY_ROLE";

export interface Contributor {
  membershipId: string;
  role: string;
  hoursWorked: number; // decimal hours
}

export interface DistributionInput {
  poolAmount: number; // cents
  rule: Rule;
  contributors: Contributor[];
  /** Only used when rule === "BY_ROLE". { role: percent } */
  roleWeights?: Record<string, number>;
}

export interface DistributionRow {
  membershipId: string;
  role: string;
  hoursWorked: number;
  weight: number; // the effective weight used in the split
  shareAmount: number; // cents
}

export function distributeTips({
  poolAmount,
  rule,
  contributors,
  roleWeights,
}: DistributionInput): DistributionRow[] {
  if (poolAmount <= 0 || contributors.length === 0) {
    return contributors.map((c) => ({
      membershipId: c.membershipId,
      role: c.role,
      hoursWorked: c.hoursWorked,
      weight: 0,
      shareAmount: 0,
    }));
  }

  // Compute a weight per contributor based on the rule.
  const weighted = contributors.map((c) => {
    let weight = 0;
    if (rule === "EVENLY") {
      weight = 1;
    } else if (rule === "BY_HOURS") {
      weight = Math.max(0, c.hoursWorked);
    } else if (rule === "BY_ROLE") {
      const rw = (roleWeights?.[c.role] ?? 0) / 100;
      weight = Math.max(0, c.hoursWorked * rw);
    }
    return { ...c, weight };
  });

  const totalWeight = weighted.reduce((s, w) => s + w.weight, 0);

  // If total weight is zero (no hours, all-zero role weights, etc.),
  // fall back to zero shares — never divide by zero. Caller can adjust.
  if (totalWeight <= 0) {
    return weighted.map((w) => ({
      membershipId: w.membershipId,
      role: w.role,
      hoursWorked: w.hoursWorked,
      weight: w.weight,
      shareAmount: 0,
    }));
  }

  // Two-pass: floor first, then hand out leftover cents by largest
  // fractional remainder so Σ shares === poolAmount exactly.
  const raw = weighted.map((w) => {
    const exact = (poolAmount * w.weight) / totalWeight;
    const floor = Math.floor(exact);
    return { ...w, exact, floor, remainder: exact - floor };
  });

  const distributed = raw.reduce((s, r) => s + r.floor, 0);
  let leftover = poolAmount - distributed;

  // Sort a copy by descending remainder for leftover assignment
  const byRemainder = [...raw].sort((a, b) => b.remainder - a.remainder);
  const bonusByMember = new Map<string, number>();
  for (const r of byRemainder) {
    if (leftover <= 0) break;
    bonusByMember.set(r.membershipId, 1);
    leftover -= 1;
  }

  return raw.map((r) => ({
    membershipId: r.membershipId,
    role: r.role,
    hoursWorked: r.hoursWorked,
    weight: r.weight,
    shareAmount: r.floor + (bonusByMember.get(r.membershipId) || 0),
  }));
}
