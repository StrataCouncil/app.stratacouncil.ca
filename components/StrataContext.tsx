"use client";

import { createContext, useContext } from "react";

/**
 * The current corporation, as the `/strata/[corpId]` layout resolved it
 * for the signed-in user — so client components under it (the sub-nav,
 * upgrade prompts) don't each re-derive the corp id from the URL or
 * guess at subscription state from placeholder data.
 */
export interface StrataContextValue {
  corpId: string;
  subscribed: boolean;
  /** Subscribed, with Stripe still confirming the first payment. */
  pending: boolean;
  isAdmin: boolean;
  /** Admin or Manager: sees the Management tab. */
  canManage: boolean;
  /** The admin, or the Manager when the admin allows it: uses Billing and subscribes. */
  canBill: boolean;
}

const StrataContext = createContext<StrataContextValue | null>(null);

export function StrataContextProvider({
  value,
  children,
}: {
  value: StrataContextValue;
  children: React.ReactNode;
}) {
  return <StrataContext.Provider value={value}>{children}</StrataContext.Provider>;
}

/** The same, or null outside a strata's pages (the home page). */
export function useOptionalStrata(): StrataContextValue | null {
  return useContext(StrataContext);
}

export function useStrata(): StrataContextValue {
  const value = useContext(StrataContext);
  if (!value) throw new Error("useStrata() must be used inside the /strata/[corpId] layout.");
  return value;
}
