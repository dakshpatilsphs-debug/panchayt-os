import { createContext, useContext } from "react";
import type { SocietySettings } from "../../lib/types";

export interface AdminCtx {
  settings: SocietySettings;
  /** Saves to Firestore/localStorage and keeps the shared state fresh. */
  commit: (s: SocietySettings) => Promise<void>;
}

const Ctx = createContext<AdminCtx | null>(null);

export const AdminProvider = Ctx.Provider;

export function useAdmin(): AdminCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAdmin must be used inside <AdminProvider>");
  return v;
}
