import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";
import { AppShell } from "@/components/app-shell";
import { HeaderProvider } from "@/lib/header-context";

export const metadata: Metadata = {
  title: "TinyClaw Mission Control",
  description: "Multi-agent orchestration dashboard for TinyClaw",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">
        <HeaderProvider>
          <div className="flex h-screen overflow-hidden">
            <Sidebar />
            <div className="flex flex-1 flex-col min-w-0">
              <AppShell />
              <main className="flex-1 overflow-y-auto">
                {children}
              </main>
            </div>
          </div>
        </HeaderProvider>
      </body>
    </html>
  );
}
