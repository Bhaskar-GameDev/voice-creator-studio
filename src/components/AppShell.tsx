import { Link, useRouterState } from "@tanstack/react-router";
import { Mic2, FolderOpen, Settings, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const nav = [
  { to: "/", label: "Projects", icon: FolderOpen, exact: true },
  { to: "/studio", label: "New Recording", icon: Plus, exact: false },
  { to: "/settings", label: "Settings", icon: Settings, exact: false },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="sticky top-0 z-40 glass-panel border-b">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5 group">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20 transition-transform group-hover:scale-105">
              <Mic2 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="font-display text-base font-bold leading-none">Voice Studio</div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Pro Audio</div>
            </div>
          </Link>
          <nav className="flex items-center gap-1">
            {nav.map((n) => {
              const active = n.exact ? pathname === n.to : pathname.startsWith(n.to);
              const Icon = n.icon;
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{n.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t py-6 text-center text-xs text-muted-foreground">
        Voice Studio · audio stays on your device
      </footer>
    </div>
  );
}
