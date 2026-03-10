"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

interface HeaderContextValue {
  rightSlot: ReactNode;
  setRightSlot: (node: ReactNode) => void;
}

const HeaderContext = createContext<HeaderContextValue | null>(null);

export function HeaderProvider({ children }: { children: ReactNode }) {
  const [rightSlot, setRightSlotState] = useState<ReactNode>(null);
  const setRightSlot = useCallback((node: ReactNode) => setRightSlotState(node), []);
  return (
    <HeaderContext.Provider value={{ rightSlot, setRightSlot }}>
      {children}
    </HeaderContext.Provider>
  );
}

export function useHeader() {
  const ctx = useContext(HeaderContext);
  return ctx;
}
