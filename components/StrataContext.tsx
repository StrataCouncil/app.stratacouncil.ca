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
  isAdmin: boolean;
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

export function useStrata(): StrataContextValue {
  const value = useContext(StrataContext);
  if (!value) throw new Error("useStrata() must be used inside the /strata/[corpId] layout.");
  return value;
}
