import * as Sentry from "@sentry/react";

/**
 * Initialize Sentry — only runs in production builds. DSN is sourced
 * from VITE_SENTRY_DSN (Vercel env / .env.local). If the DSN is absent,
 * Sentry is silently disabled so builds without the secret don't crash.
 */
export function initSentry() {
  // Guard: only run in production builds — no noise from local dev.
  if (!import.meta.env.PROD) return;

  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) {
    // Missing DSN: log a warning in prod but don't throw — the app
    // should still boot even if observability is misconfigured.
    console.warn("[sentry] VITE_SENTRY_DSN is not set; Sentry disabled.");
    return;
  }

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_APP_VERSION || undefined,
    tracesSampleRate: 0.2,
  });
}

export { Sentry };
