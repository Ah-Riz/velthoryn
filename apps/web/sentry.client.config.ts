import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? "development",
  tracesSampleRate: 0.1,
  // Session replays: only capture on errors to keep quota low
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
});
