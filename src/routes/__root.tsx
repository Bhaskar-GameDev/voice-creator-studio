import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { AppShell } from "@/components/AppShell";
import { Toaster } from "@/components/ui/sonner";
import { DiagnosticsDashboard } from "@/components/DiagnosticsDashboard";
import { diagnostics } from "@/lib/diagnostics";

function NotFoundComponent() {
  useEffect(() => {
    diagnostics.log("warning", "navigation", `Broken navigation: route not found (${typeof window !== "undefined" ? window.location.pathname : "?"})`);
  }, []);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
    // React render errors don't trigger window.onerror — log them here so the
    // diagnostics dashboard captures unhandled exceptions surfaced by the boundary.
    diagnostics.log("error", "exception", `Render boundary caught: ${error?.message || String(error)}`, error?.stack);
  }, [error]);

  const handleRepair = () => {
    try {
      // Clear locks
      localStorage.removeItem("voice-studio:active-recorder-lock");
      // Validate project array and remove corrupted items
      const raw = localStorage.getItem("voice-studio:projects");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const clean = parsed.filter(p => p && typeof p === "object" && typeof p.id === "string" && typeof p.name === "string");
          localStorage.setItem("voice-studio:projects", JSON.stringify(clean));
        }
      }
      alert("Application state repaired successfully. We will now reload the page.");
      window.location.href = "/";
    } catch (e) {
      localStorage.removeItem("voice-studio:projects");
      localStorage.removeItem("voice-studio:active-project-id");
      alert("Corrupted database was reset. Workspace is clean.");
      window.location.reload();
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <div className="max-w-lg w-full rounded-2xl border border-destructive/20 bg-card/60 p-6 md:p-8 text-center backdrop-blur-md">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive mb-4">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </div>
        <h1 className="text-xl font-bold tracking-tight text-foreground">
          Voice Studio Encountered a Crash
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We apologize for the interruption. The system has automatically isolated the issue to prevent data loss.
        </p>

        {error && (
          <div className="mt-4 rounded-lg bg-secondary/80 p-3 text-left font-mono text-xs text-destructive-foreground overflow-auto max-h-32 border border-border">
            <span className="font-semibold">Error:</span> {error.message || String(error)}
          </div>
        )}

        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/95 transition-colors cursor-pointer"
          >
            Try Again
          </button>
          <button
            onClick={handleRepair}
            className="inline-flex items-center justify-center rounded-lg border border-input bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors cursor-pointer"
          >
            Repair State & Diagnostics
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-lg border border-input bg-secondary px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary/85 transition-colors"
          >
            Go Home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Voice Studio — Record, Edit & Export Audio" },
      { name: "description", content: "Professional in-browser voice recording studio. Record, upload, preview and export high-quality audio. Files stay on your device." },
      { name: "theme-color", content: "#1a1a2e" },
      { property: "og:title", content: "Voice Studio" },
      { property: "og:description", content: "Record, edit, and export voice projects in your browser." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <AppShell>
        <Outlet />
      </AppShell>
      <Toaster theme="dark" position="bottom-right" richColors />
      <DiagnosticsDashboard />
    </QueryClientProvider>
  );
}
