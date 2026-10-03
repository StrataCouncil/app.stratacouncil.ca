/**
 * Shared, non-server-only helpers for corporation identity and roles —
 * imported by both Server Actions and Client Components, so nothing here
 * touches Supabase.
 */

/**
 * Normalizes what someone types as their Strata Plan number into the
 * canonical `strata_corporations.strata_plan_number` form (doc01 §4, e.g.
 * 'BCS-1234'): uppercase, prefix and number joined by a single hyphen.
 * "bcs 1234", "BCS1234" and "BCS-1234" all become "BCS-1234". Returns
 * null for anything that isn't letters followed by digits — the lookup
 * would never match it, so better to say so than to report "not found".
 */
export function normalizeStrataPlanNumber(input: string): string | null {
  const match = input
    .trim()
    .toUpperCase()
    .match(/^([A-Z]{2,4})[\s\-_.]*(\d{1,6})$/);
  if (!match) return null;
  return `${match[1]}-${match[2]}`;
}

export const jurisdictions = [
  { code: "BC", label: "British Columbia" },
  { code: "AB", label: "Alberta" },
  { code: "SK", label: "Saskatchewan" },
  { code: "MB", label: "Manitoba" },
  { code: "ON", label: "Ontario" },
  { code: "QC", label: "Quebec" },
  { code: "NB", label: "New Brunswick" },
  { code: "NS", label: "Nova Scotia" },
  { code: "PE", label: "Prince Edward Island" },
  { code: "NL", label: "Newfoundland and Labrador" },
  { code: "YT", label: "Yukon" },
  { code: "NT", label: "Northwest Territories" },
  { code: "NU", label: "Nunavut" },
] as const;

export function isJurisdictionCode(value: string): boolean {
  return jurisdictions.some((j) => j.code === value);
}

/**
 * `corporation_role_assignments.role` values (doc01 §4). Every role but
 * `manager` has exactly one holder per corporation (partial unique index,
 * 0002); `manager` can have several (a management company's staff).
 */
export const corporationRoles = [
  "admin",
  "president",
  "vice_president",
  "treasurer",
  "secretary",
  "member_at_large",
  "manager",
] as const;

export type CorporationRole = (typeof corporationRoles)[number];

export const corporationRoleLabels: Record<CorporationRole, string> = {
  admin: "Admin",
  president: "President",
  vice_president: "Vice President",
  treasurer: "Treasurer",
  secretary: "Secretary",
  member_at_large: "Member at Large",
  manager: "Manager",
};

/** Roles that make someone a council member (and their lot a council lot). */
export const councilRoles: readonly CorporationRole[] = ["president", "vice_president", "treasurer", "secretary", "member_at_large"];

/**
 * The executive offices. Holding any of them means someone isn't a Member at
 * Large (that is, by definition, a council member with no office); Admin is
 * a platform role and doesn't count. Enforced by set_corporation_member_roles (0022).
 */
export const executiveRoles: readonly CorporationRole[] = ["president", "vice_president", "treasurer", "secretary"];

/** Applying the rule: an executive office removes Member at Large. */
export function withoutConflictingRoles(roles: CorporationRole[]): CorporationRole[] {
  return roles.some((r) => executiveRoles.includes(r)) ? roles.filter((r) => r !== "member_at_large") : roles;
}

export function isCorporationRole(value: string): value is CorporationRole {
  return (corporationRoles as readonly string[]).includes(value);
}

/** Offices with one holder at a time. Admin is not one: a strata can have up to MAX_ADMINS. */
export function isSingleHolderRole(role: CorporationRole): boolean {
  return role !== "admin" && role !== "manager" && role !== "member_at_large";
}

/** Two admins for good governance; raise if customers need more (0027). */
export const MAX_ADMINS = 2;

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
