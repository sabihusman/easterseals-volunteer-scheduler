import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import App from "./App.tsx";
import { initSentry, Sentry } from "./lib/sentry";
import "./index.css";

// Initialize Sentry before React mounts so unhandled errors during
// the initial render are captured.
initSentry();

// Detect Trusted Web Activity (Android app) context
const isTWA = document.referrer.startsWith("android-app://");
if (isTWA) {
  document.documentElement.classList.add("twa");
}

function ErrorFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="max-w-md text-center space-y-3">
        <h1 className="text-xl font-semibold">Something went wrong.</h1>
        <p className="text-sm text-muted-foreground">
          Please refresh the page or contact support.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm"
        >
          Refresh Page
        </button>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <App />
      <Analytics />
      <SpeedInsights />
    </ThemeProvider>
  </Sentry.ErrorBoundary>
);
