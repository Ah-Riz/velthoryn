import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? "development",
  // Do not set tracesSampleRate here — server-side traces are
  // controlled by the Node SDK's default settings.
});
