"use client";

import { usePathname } from "next/navigation";

const PAGE_TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/office": "Office",
  "/tasks": "Tasks",
  "/agents": "Agents",
  "/teams": "Teams",
  "/logs": "Logs",
  "/console": "New Chat",
  "/settings": "Settings",
};

function getPageTitle(pathname: string): string {
  if (pathname === "/") return "Dashboard";
  for (const [path, title] of Object.entries(PAGE_TITLES)) {
    if (path !== "/" && pathname.startsWith(path)) return title;
  }
  if (pathname.startsWith("/chat/agent/")) return "Agent Chat";
  if (pathname.startsWith("/chat/team/")) return "Team Chat";
  return "TinyClaw";
}

export function AppHeader({
  subtitle,
  rightSlot = null,
}: {
  subtitle?: string;
  rightSlot?: React.ReactNode | null;
}) {
  const pathname = usePathname();
  const title = getPageTitle(pathname);

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border/60 bg-background/95 px-6">
      <div className="flex items-baseline gap-2">
        <h1 className="text-sm font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        {subtitle && (
          <span className="text-xs text-muted-foreground">{subtitle}</span>
        )}
      </div>
      {rightSlot && <div className="flex items-center gap-3">{rightSlot}</div>}
    </header>
  );
}
