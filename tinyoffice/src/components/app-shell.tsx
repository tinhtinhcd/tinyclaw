"use client";

import { AppHeader } from "./app-header";
import { useHeader } from "@/lib/header-context";

export function AppShell() {
  const header = useHeader();
  return <AppHeader rightSlot={header?.rightSlot} />;
}
