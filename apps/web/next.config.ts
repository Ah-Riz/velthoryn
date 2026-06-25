import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import path from "node:path";

const allowLocalRpc =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_E2E_MOCK_WALLET === "true";

const localRpcConnectSrc = allowLocalRpc
  ? " http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*"
  : "";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, "../.."),
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "img-src 'self' data: https:",
              "font-src 'self' data: https://fonts.gstatic.com",
              `connect-src 'self' https://*.solana.com https://*.helius-rpc.com wss://*.helius-rpc.com https://*.supabase.co wss://*.solana.com https://api.devnet.solana.com https://api.mainnet-beta.solana.com${localRpcConnectSrc}`,
              "media-src 'self' https://*.supabase.co",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

// Wrap with Sentry only when DSN is configured (local dev/CI without DSN stays clean)
export default process.env.NEXT_PUBLIC_SENTRY_DSN
  ? withSentryConfig(nextConfig, {
      // Suppress noisy Sentry build output unless debugging
      silent: true,
      // Source maps help Sentry de-obfuscate stack traces; strip them from the
      // production bundle so they are not shipped to end users.
      sourcemaps: { disable: false },
    })
  : nextConfig;
