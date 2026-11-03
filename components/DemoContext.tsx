"use client";

import { createContext, useContext } from "react";
import { IS_DEMO } from "@/lib/demo";

/**
 * Whether the demo's restrictions apply to this screen (lib/demo-sandbox.ts):
 * true on the demo site, except in a Super Admin's sandbox. Set by AppShell;
 * without it, the demo's restrictions apply wherever the demo runs.
 */
const DemoRestricted = createContext<boolean>(IS_DEMO);

export function DemoRestrictedProvider({ restricted, children }: { restricted: boolean; children: React.ReactNode }) {
  return <DemoRestricted.Provider value={restricted}>{children}</DemoRestricted.Provider>;
}

export const useDemoRestricted = () => useContext(DemoRestricted);
